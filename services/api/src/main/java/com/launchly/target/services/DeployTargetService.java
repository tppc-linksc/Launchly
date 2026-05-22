package com.launchly.target.services;

import com.jcraft.jsch.JSch;
import com.jcraft.jsch.Session;
import com.jcraft.jsch.UIKeyboardInteractive;
import com.jcraft.jsch.UserInfo;
import com.launchly.common.security.AuthContext;
import com.launchly.deployment.repositories.DeploymentRepository;
import com.launchly.environment.services.SecretValueService;
import com.launchly.target.dto.DeployTargetCreateRequest;
import com.launchly.target.dto.DeployTargetDto;
import com.launchly.target.dto.DeployTargetUpdateRequest;
import com.launchly.target.dto.VerifyTargetResponse;
import com.launchly.target.entities.DeployTarget;
import com.launchly.target.enums.AuthMethod;
import com.launchly.target.enums.TargetStatus;
import com.launchly.target.enums.TargetType;
import com.launchly.target.repositories.DeployTargetRepository;
import net.schmizz.sshj.SSHClient;
import net.schmizz.sshj.common.IOUtils;
import net.schmizz.sshj.connection.channel.direct.Session.Command;
import net.schmizz.sshj.transport.verification.PromiscuousVerifier;
import net.schmizz.sshj.userauth.keyprovider.KeyProvider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Instant;
import java.util.List;
import java.util.Properties;
import java.util.concurrent.TimeUnit;

@Service
public class DeployTargetService {

    private static final Logger log = LoggerFactory.getLogger(DeployTargetService.class);

    private final DeployTargetRepository repository;
    private final SecretValueService secretValueService;
    private final DeploymentRepository deploymentRepository;

    public DeployTargetService(DeployTargetRepository repository,
                               SecretValueService secretValueService,
                               DeploymentRepository deploymentRepository) {
        this.repository = repository;
        this.secretValueService = secretValueService;
        this.deploymentRepository = deploymentRepository;
    }

    public List<DeployTargetDto> listByProject(String projectId) {
        return repository.findByProjectIdOrderByCreatedAtDesc(projectId)
                .stream().map(DeployTargetDto::from).toList();
    }

    public DeployTargetDto getById(String id) {
        DeployTarget entity = repository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Deploy target not found: " + id));
        return DeployTargetDto.from(entity);
    }

    @Transactional
    public DeployTargetDto create(String projectId, DeployTargetCreateRequest request) {
        DeployTarget entity = new DeployTarget();
        entity.setOrganizationId(AuthContext.current().workspaceId());
        entity.setProjectId(projectId);
        entity.setName(request.getName());
        entity.setHost(request.getHost());
        entity.setPort(request.getPort() != null ? request.getPort() : 22);
        entity.setUsername(request.getUsername());
        entity.setAuthMethod("PASSWORD".equals(request.getAuthMethod())
                ? AuthMethod.PASSWORD : AuthMethod.KEY);

        if (request.getPrivateKey() != null && !request.getPrivateKey().isBlank()) {
            entity.setEncryptedCredential(secretValueService.encrypt(request.getPrivateKey()));
        }

        log.info("Deploy target created: id={}, name={}, host={}", entity.getId(), entity.getName(), entity.getHost());
        return DeployTargetDto.from(repository.save(entity));
    }

    @Transactional
    public DeployTargetDto update(String id, DeployTargetUpdateRequest request) {
        DeployTarget entity = repository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Deploy target not found: " + id));

        if (request.getName() != null) entity.setName(request.getName());
        if (request.getHost() != null) entity.setHost(request.getHost());
        if (request.getPort() != null) entity.setPort(request.getPort());
        if (request.getUsername() != null) entity.setUsername(request.getUsername());
        if (request.getAuthMethod() != null) {
            entity.setAuthMethod("PASSWORD".equals(request.getAuthMethod())
                    ? AuthMethod.PASSWORD : AuthMethod.KEY);
        }
        if (request.getPrivateKey() != null && !request.getPrivateKey().isBlank()) {
            entity.setEncryptedCredential(secretValueService.encrypt(request.getPrivateKey()));
        }

        return DeployTargetDto.from(repository.save(entity));
    }

    @Transactional
    public void delete(String id) {
        DeployTarget entity = repository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Deploy target not found: " + id));
        long refs = deploymentRepository.countByDeployTargetId(id);
        if (refs > 0) {
            throw new ResponseStatusException(
                    HttpStatus.CONFLICT,
                    "无法删除：仍有 " + refs + " 条部署记录引用此部署目标。请先迁移或删除相关部署后再试。");
        }
        repository.delete(entity);
    }

    @Transactional
    public VerifyTargetResponse verify(String id) {
        DeployTarget entity = repository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Deploy target not found: " + id));

        if (entity.getEncryptedCredential() == null || entity.getEncryptedCredential().isBlank()) {
            entity.setStatus(TargetStatus.FAILED);
            entity.setLastVerifiedAt(Instant.now());
            repository.save(entity);
            return VerifyTargetResponse.failed("No credential configured");
        }

        String credential = secretValueService.decrypt(entity.getEncryptedCredential());

        try {
            String dockerVersion;
            try {
                dockerVersion = verifyWithSshj(entity, credential);
            } catch (Exception sshjEx) {
                log.warn("Deploy target SSHJ verification failed, fallback to JSch: id={}, host={}, error={}",
                        entity.getId(), entity.getHost(), sshjEx.getMessage());
                dockerVersion = verifyWithJsch(entity, credential);
            }
            log.info("Deploy target verified: id={}, host={}, dockerVersion={}",
                    entity.getId(), entity.getHost(), dockerVersion);

            entity.setStatus(TargetStatus.CONNECTED);
            entity.setLastVerifiedAt(Instant.now());
            repository.save(entity);

            return VerifyTargetResponse.connected(dockerVersion);
        } catch (Exception e) {
            String userError = buildVerifyErrorMessage(e);
            log.warn("Deploy target verification failed: id={}, host={}, error={}",
                    entity.getId(), entity.getHost(), userError);
            entity.setStatus(TargetStatus.FAILED);
            entity.setLastVerifiedAt(Instant.now());
            repository.save(entity);
            return VerifyTargetResponse.failed(userError);
        }
    }

    private String verifyWithSshj(DeployTarget entity, String credential) throws Exception {
        try (SSHClient ssh = new SSHClient()) {
            ssh.addHostKeyVerifier(new PromiscuousVerifier());
            ssh.setConnectTimeout(10_000);
            ssh.setTimeout(10_000);
            ssh.connect(entity.getHost(), entity.getPort());

            if (entity.getAuthMethod() == AuthMethod.PASSWORD) {
                ssh.authPassword(entity.getUsername(), credential);
            } else {
                KeyProvider keyProvider = loadKeyProvider(ssh, credential);
                ssh.authPublickey(entity.getUsername(), keyProvider);
            }

            try (net.schmizz.sshj.connection.channel.direct.Session sshSession = ssh.startSession()) {
                String command = "sh -lc 'export PATH=\"$PATH:/usr/local/bin:/opt/homebrew/bin\"; docker version --format \"{{.Server.Version}}\"'";
                Command exec = sshSession.exec(command);
                exec.join(12, TimeUnit.SECONDS);
                String stdout = IOUtils.readFully(exec.getInputStream()).toString(StandardCharsets.UTF_8).trim();
                String stderr = IOUtils.readFully(exec.getErrorStream()).toString(StandardCharsets.UTF_8).trim();
                Integer code = exec.getExitStatus();
                if (code == null) {
                    throw new RuntimeException("Remote command timeout");
                }
                if (code != 0) {
                    String msg = stderr.isBlank() ? stdout : stderr;
                    if (msg.isBlank()) {
                        msg = "Remote command failed with exit code " + code;
                    }
                    throw new RuntimeException(msg);
                }
                return stdout;
            }
        }
    }

    private KeyProvider loadKeyProvider(SSHClient ssh, String privateKeyContent) throws Exception {
        Path tmp = Files.createTempFile("launchly-key-", ".pem");
        try {
            Files.writeString(tmp, privateKeyContent, StandardCharsets.UTF_8,
                    StandardOpenOption.TRUNCATE_EXISTING);
            return ssh.loadKeys(tmp.toString());
        } finally {
            Files.deleteIfExists(tmp);
        }
    }

    private String verifyWithJsch(DeployTarget entity, String credential) throws Exception {
        Session session = null;
        try {
            JSch jsch = new JSch();
            if (entity.getAuthMethod() != AuthMethod.PASSWORD) {
                jsch.addIdentity("launchly-key",
                        credential.getBytes(StandardCharsets.UTF_8),
                        null, null);
            }

            session = jsch.getSession(entity.getUsername(), entity.getHost(), entity.getPort());
            Properties config = new Properties();
            config.put("StrictHostKeyChecking", "no");
            if (entity.getAuthMethod() == AuthMethod.PASSWORD) {
                config.put("PreferredAuthentications", "keyboard-interactive,password");
                config.put("PubkeyAuthentication", "no");
            } else {
                config.put("PreferredAuthentications", "publickey");
            }
            session.setConfig(config);
            session.setTimeout(10_000);
            session.setServerAliveInterval(5_000);
            session.setServerAliveCountMax(2);

            if (entity.getAuthMethod() == AuthMethod.PASSWORD) {
                session.setPassword(credential);
                session.setUserInfo(new FixedPasswordUserInfo(credential));
            }

            session.connect(10_000);
            return execCommand(session,
                    "sh -lc 'export PATH=\"$PATH:/usr/local/bin:/opt/homebrew/bin\"; docker version --format \"{{.Server.Version}}\"'");
        } finally {
            if (session != null && session.isConnected()) {
                session.disconnect();
            }
        }
    }

    private String execCommand(Session session, String command) throws Exception {
        com.jcraft.jsch.ChannelExec channel = (com.jcraft.jsch.ChannelExec) session.openChannel("exec");
        channel.setCommand(command);
        channel.setInputStream(null);

        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
        channel.setErrStream(outputStream);
        InputStream in = channel.getInputStream();

        channel.connect(10_000);

        byte[] buf = new byte[8192];
        int len;
        while ((len = in.read(buf)) != -1) {
            outputStream.write(buf, 0, len);
        }

        String output = outputStream.toString(StandardCharsets.UTF_8).trim();
        int exitStatus = channel.getExitStatus();
        channel.disconnect();

        if (exitStatus != 0) {
            if (output.isBlank()) {
                throw new RuntimeException("Remote command failed with exit code " + exitStatus);
            }
            throw new RuntimeException(output);
        }
        return output;
    }

    private String buildVerifyErrorMessage(Exception exception) {
        String raw = exception.getMessage();
        if (raw == null || raw.isBlank()) {
            return "连接失败：未知错误";
        }
        String msg = raw.trim();
        if (msg.toLowerCase().contains("auth fail")) {
            return "SSH 认证失败：请检查用户名与凭据（密码或私钥）";
        }
        if (msg.toLowerCase().contains("connection is closed by foreign host")) {
            return "SSH 连接被远端主动关闭：请检查 SSH 策略、认证方式或账号登录权限";
        }
        if (msg.contains("docker: not found") || msg.contains("docker command not found")) {
            return "目标主机未找到 Docker 命令，请先安装 Docker 或修正 PATH";
        }
        return msg;
    }

    private static final class FixedPasswordUserInfo implements UserInfo, UIKeyboardInteractive {
        private final String password;

        private FixedPasswordUserInfo(String password) {
            this.password = password;
        }

        @Override
        public String getPassphrase() {
            return null;
        }

        @Override
        public String getPassword() {
            return password;
        }

        @Override
        public boolean promptPassword(String message) {
            return true;
        }

        @Override
        public boolean promptPassphrase(String message) {
            return false;
        }

        @Override
        public boolean promptYesNo(String message) {
            return true;
        }

        @Override
        public void showMessage(String message) {
            // no-op
        }

        @Override
        public String[] promptKeyboardInteractive(String destination,
                                                  String name,
                                                  String instruction,
                                                  String[] prompt,
                                                  boolean[] echo) {
            if (prompt == null || prompt.length == 0) {
                return new String[0];
            }
            String[] answers = new String[prompt.length];
            for (int i = 0; i < prompt.length; i++) {
                answers[i] = password;
            }
            return answers;
        }
    }
}
