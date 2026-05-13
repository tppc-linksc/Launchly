package com.launchly.target.services;

import com.jcraft.jsch.JSch;
import com.jcraft.jsch.Session;
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
import java.time.Instant;
import java.util.List;

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
    public DeployTargetDto create(DeployTargetCreateRequest request) {
        DeployTarget entity = new DeployTarget();
        entity.setOrganizationId(AuthContext.current().workspaceId());
        entity.setProjectId(request.getProjectId());
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

        String privateKey = secretValueService.decrypt(entity.getEncryptedCredential());
        Session session = null;

        try {
            JSch jsch = new JSch();
            jsch.addIdentity("launchly-key",
                    privateKey.getBytes(StandardCharsets.UTF_8),
                    null, null);
            privateKey = null;

            session = jsch.getSession(entity.getUsername(), entity.getHost(), entity.getPort());
            session.setConfig("StrictHostKeyChecking", "no");
            session.setTimeout(10_000);
            session.connect(10_000);

            String dockerVersion = execCommand(session, "docker version --format '{{.Server.Version}}'");
            log.info("Deploy target verified: id={}, host={}, dockerVersion={}",
                    entity.getId(), entity.getHost(), dockerVersion);

            entity.setStatus(TargetStatus.CONNECTED);
            entity.setLastVerifiedAt(Instant.now());
            repository.save(entity);

            return VerifyTargetResponse.connected(dockerVersion);
        } catch (Exception e) {
            log.warn("Deploy target verification failed: id={}, host={}, error={}",
                    entity.getId(), entity.getHost(), e.getMessage());
            entity.setStatus(TargetStatus.FAILED);
            entity.setLastVerifiedAt(Instant.now());
            repository.save(entity);
            return VerifyTargetResponse.failed(e.getMessage());
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
        channel.disconnect();

        if (output.isEmpty() && channel.getExitStatus() != 0) {
            throw new RuntimeException("Command exited with status " + channel.getExitStatus());
        }
        return output;
    }
}
