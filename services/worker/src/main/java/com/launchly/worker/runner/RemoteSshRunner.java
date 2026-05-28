package com.launchly.worker.runner;

import com.jcraft.jsch.ChannelExec;
import com.jcraft.jsch.ChannelSftp;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.JSchException;
import com.jcraft.jsch.Session;
import com.jcraft.jsch.SftpException;
import com.launchly.worker.deploy.ImplicitDockerfileGenerator;
import com.launchly.worker.entities.DeployTarget;
import com.launchly.worker.entities.Deployment;
import com.launchly.worker.entities.Environment;
import com.launchly.worker.entities.EnvironmentVariable;
import com.launchly.worker.entities.Project;
import com.launchly.worker.repositories.DeployTargetRepository;
import com.launchly.worker.repositories.DeploymentRepository;
import com.launchly.worker.repositories.EnvironmentRepository;
import com.launchly.worker.repositories.EnvironmentVariableRepository;
import com.launchly.worker.repositories.ProjectRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.List;

@Component
public class RemoteSshRunner implements Runner {

    private static final Logger log = LoggerFactory.getLogger(RemoteSshRunner.class);
    private static final int SSH_CONNECT_TIMEOUT = 10000;
    private static final int DEPLOY_TIMEOUT = 300;
    private static final int IMAGE_BUILD_TIMEOUT = 600;
    private static final int IMAGE_SAVE_TIMEOUT = 120;
    private static final int IMAGE_LOAD_TIMEOUT = 120;
    private static final int SCP_TRANSFER_TIMEOUT = 600;

    private final DeployTargetRepository deployTargetRepository;
    private final DeploymentRepository deploymentRepository;
    private final ProjectRepository projectRepository;
    private final EnvironmentRepository environmentRepository;
    private final EnvironmentVariableRepository envVarRepository;
    private final SecretValueService secretValueService;

    public RemoteSshRunner(DeployTargetRepository deployTargetRepository,
                           DeploymentRepository deploymentRepository,
                           ProjectRepository projectRepository,
                           EnvironmentRepository environmentRepository,
                           EnvironmentVariableRepository envVarRepository,
                           SecretValueService secretValueService) {
        this.deployTargetRepository = deployTargetRepository;
        this.deploymentRepository = deploymentRepository;
        this.projectRepository = projectRepository;
        this.environmentRepository = environmentRepository;
        this.envVarRepository = envVarRepository;
        this.secretValueService = secretValueService;
    }

    @Override
    public RunnerResult execute(RunnerContext context) {
        String refId = context.getRefId();
        String projectId = (String) context.getPayload().getOrDefault("projectId", "");
        String environmentId = (String) context.getPayload().getOrDefault("environmentId", "");

        Deployment deployment = deploymentRepository.findById(refId).orElse(null);
        if (deployment == null) {
            return RunnerResult.failure("Deployment not found: " + refId, "", "", -1);
        }

        String deployTargetId = deployment.getDeployTargetId();
        if (deployTargetId == null || deployTargetId.isBlank()) {
            return RunnerResult.failure("Deployment has no deploy target configured", "", "", -1);
        }

        DeployTarget target = deployTargetRepository.findById(deployTargetId).orElse(null);
        if (target == null) {
            return RunnerResult.failure("Deploy target not found: " + deployTargetId, "", "", -1);
        }

        Project project = projectRepository.findById(projectId).orElse(null);
        if (project == null) {
            return RunnerResult.failure("Project not found: " + projectId, "", "", -1);
        }

        Environment env = environmentRepository.findById(environmentId).orElse(null);
        if (env == null) {
            return RunnerResult.failure("Environment not found: " + environmentId, "", "", -1);
        }

        int externalPort = DockerRunner.getEffectivePort(env, project);
        int internalPort = project.getDefaultPort() != null ? project.getDefaultPort() : 3000;

        File workRoot = DockerRunner.resolveBuildRoot(env);
        File workDir = new File(workRoot, projectId + "/" + refId);
        if (!workDir.exists()) {
            workDir.mkdirs();
        }

        String projectName = "launchly-" + projectId.substring(0, 8) + "-" + environmentId.substring(0, 8);
        File composeFile = new File(workDir, "docker-compose.yml");
        File envFile = new File(workDir, ".env.project");
        String imageTag = projectName + ":latest";
        File imageTar = new File(workDir, projectName + ".tar");

        String credential = secretValueService.decrypt(target.getEncryptedCredential());
        String remoteDir = env.getDeployDir() != null && !env.getDeployDir().isBlank()
                ? env.getDeployDir()
                : "/opt/launchly/" + projectName;

        StringBuilder deployLog = new StringBuilder();
        Session session = null;

        try {
            List<EnvironmentVariable> envVars = envVarRepository.findByEnvironmentId(environmentId);

            String implicitDockerfile = ImplicitDockerfileGenerator.writeIfMissing(workDir, project);

            // --- Step 1: Build Docker image locally ---
            log.info("Building Docker image {} in {}", imageTag, workDir);
            String[] buildCmd = implicitDockerfile != null
                    ? new String[]{"docker", "build", "-f", implicitDockerfile, "-t", imageTag, "."}
                    : new String[]{"docker", "build", "-t", imageTag, "."};
            RunnerResult buildResult = CommandExecutor.execute(buildCmd, workDir, IMAGE_BUILD_TIMEOUT);
            if (!buildResult.isSuccess()) {
                return RunnerResult.failure(
                        "Docker image build failed: " + buildResult.getErrorMessage(),
                        buildResult.getStdout(), buildResult.getStderr(), buildResult.getExitCode());
            }
            deployLog.append("[1/5] Image built: ").append(imageTag).append("\n");

            // --- Step 2: Export image as tar ---
            log.info("Exporting image {} to {}", imageTag, imageTar);
            String[] saveCmd = {"docker", "save", "-o", imageTar.getAbsolutePath(), imageTag};
            RunnerResult saveResult = CommandExecutor.execute(saveCmd, workDir, IMAGE_SAVE_TIMEOUT);
            if (!saveResult.isSuccess()) {
                return RunnerResult.failure(
                        "Docker image save failed: " + saveResult.getErrorMessage(),
                        saveResult.getStdout(), saveResult.getStderr(), saveResult.getExitCode());
            }
            deployLog.append("[2/5] Image exported: ").append(imageTar.length()).append(" bytes\n");

            // --- Step 3: Establish SSH and transfer image ---
            session = createSession(target, credential);
            execCommand(session, "mkdir -p " + remoteDir, 30);

            log.info("Uploading image tar to {}:{}", target.getHost(), remoteDir + "/" + imageTar.getName());
            uploadFile(session, imageTar.getAbsolutePath(), remoteDir + "/" + imageTar.getName());
            deployLog.append("[3/5] Image transferred to ").append(target.getHost()).append("\n");

            // --- Step 4: Load image on remote ---
            String loadCmd = "docker load -i " + remoteDir + "/" + imageTar.getName();
            RunnerResult loadResult = execCommand(session, loadCmd, IMAGE_LOAD_TIMEOUT);
            if (!loadResult.isSuccess()) {
                return RunnerResult.failure(
                        "Remote docker load failed: " + loadResult.getErrorMessage(),
                        loadResult.getStdout(), loadResult.getStderr(), loadResult.getExitCode());
            }
            deployLog.append("[4/5] Image loaded on remote\n");

            // Clean up tar on remote after load
            execCommand(session, "rm -f " + remoteDir + "/" + imageTar.getName(), 30);

            // --- Step 5: Upload compose/env and start ---
            generateComposeFile(composeFile, projectName, externalPort, internalPort, envVars, imageTag);
            generateEnvFile(envFile, envVars);
            uploadFile(session, composeFile.getAbsolutePath(), remoteDir + "/docker-compose.yml");
            uploadFile(session, envFile.getAbsolutePath(), remoteDir + "/.env.project");

            String upCmd = "cd " + remoteDir + " && docker compose -p " + projectName + " up -d";
            RunnerResult upResult = execCommand(session, upCmd, DEPLOY_TIMEOUT);

            if (!upResult.isSuccess()) {
                execCommand(session, "cd " + remoteDir + " && docker compose -p " + projectName + " down", 60);
                return RunnerResult.failure(
                        "Remote docker compose up failed on " + target.getHost() + ": " + upResult.getErrorMessage(),
                        upResult.getStdout(), upResult.getStderr(), upResult.getExitCode());
            }

            deployLog.append("[5/5] Docker Compose started on ")
                    .append(target.getHost()).append(" (project: ").append(projectName)
                    .append(", port: ").append(externalPort).append(":").append(internalPort).append(")\n")
                    .append(upResult.getStdout());

            return RunnerResult.success(deployLog.toString(), upResult.getStderr());

        } catch (JSchException e) {
            log.error("SSH connection to {} failed: {}", target.getHost(), e.getMessage());
            return RunnerResult.failure(
                    "SSH connection to " + target.getHost() + " failed: " + e.getMessage(),
                    deployLog.toString(), "", -1);
        } catch (SftpException e) {
            log.error("SFTP upload to {} failed: {}", target.getHost(), e.getMessage());
            return RunnerResult.failure(
                    "SFTP upload to " + target.getHost() + " failed: " + e.getMessage(),
                    deployLog.toString(), "", -1);
        } catch (IOException e) {
            return RunnerResult.failure("Failed to generate files: " + e.getMessage(),
                    deployLog.toString(), "", -1);
        } finally {
            if (session != null) {
                session.disconnect();
            }
            // Clean up local image tar
            if (imageTar.exists()) {
                imageTar.delete();
            }
        }
    }

    private Session createSession(DeployTarget target, String credential) throws JSchException {
        JSch jsch = new JSch();

        if ("KEY".equals(target.getAuthMethod()) && credential != null && !credential.isBlank()) {
            jsch.addIdentity("deploy-target-" + target.getId(),
                    credential.getBytes(StandardCharsets.UTF_8), null, null);
        }

        Session session = jsch.getSession(target.getUsername(), target.getHost(), target.getPort());
        session.setConfig("StrictHostKeyChecking", "accept-new");  // accept new hosts, reject changed ones (MITM protection)

        if ("PASSWORD".equals(target.getAuthMethod()) && credential != null) {
            session.setPassword(credential);
        }

        session.connect(SSH_CONNECT_TIMEOUT);
        return session;
    }

    private RunnerResult execCommand(Session session, String command, int timeoutSeconds) throws JSchException, IOException {
        StringBuilder stdout = new StringBuilder();
        StringBuilder stderr = new StringBuilder();

        ChannelExec channel = (ChannelExec) session.openChannel("exec");
        channel.setCommand(command);
        channel.setInputStream(null);
        channel.setErrStream(null);

        InputStream in = channel.getInputStream();
        InputStream err = channel.getErrStream();

        channel.connect(SSH_CONNECT_TIMEOUT);

        try {
            byte[] buf = new byte[8192];
            long deadline = System.currentTimeMillis() + timeoutSeconds * 1000L;

            while (true) {
                long remaining = deadline - System.currentTimeMillis();
                if (remaining <= 0) {
                    channel.disconnect();
                    return RunnerResult.failure(
                            "Remote command timed out after " + timeoutSeconds + "s",
                            CommandExecutor.sanitize(stdout.toString()),
                            CommandExecutor.sanitize(stderr.toString()), -1);
                }

                // Read stdout
                while (in.available() > 0) {
                    int n = in.read(buf, 0, Math.min(buf.length, in.available()));
                    if (n < 0) break;
                    stdout.append(new String(buf, 0, n, StandardCharsets.UTF_8));
                }

                // Read stderr
                while (err.available() > 0) {
                    int n = err.read(buf, 0, Math.min(buf.length, err.available()));
                    if (n < 0) break;
                    stderr.append(new String(buf, 0, n, StandardCharsets.UTF_8));
                }

                if (channel.isClosed()) {
                    if (in.available() > 0 || err.available() > 0) continue;
                    break;
                }

                try {
                    Thread.sleep(100);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        } catch (IOException e) {
            return RunnerResult.failure("Remote command IO error: " + e.getMessage(),
                    CommandExecutor.sanitize(stdout.toString()),
                    CommandExecutor.sanitize(stderr.toString()), -1);
        } finally {
            channel.disconnect();
        }

        int exitCode = channel.getExitStatus();
        if (exitCode == 0) {
            return RunnerResult.success(
                    CommandExecutor.sanitize(stdout.toString()),
                    CommandExecutor.sanitize(stderr.toString()));
        } else {
            return RunnerResult.failure("Remote command exited with code " + exitCode,
                    CommandExecutor.sanitize(stdout.toString()),
                    CommandExecutor.sanitize(stderr.toString()), exitCode);
        }
    }

    private void uploadFile(Session session, String localPath, String remotePath)
            throws JSchException, SftpException, IOException {
        ChannelSftp sftp = (ChannelSftp) session.openChannel("sftp");
        sftp.connect(SSH_CONNECT_TIMEOUT);
        try {
            sftp.put(localPath, remotePath, ChannelSftp.OVERWRITE);
        } finally {
            sftp.disconnect();
        }
    }

    private void generateComposeFile(File file, String projectName, int externalPort, int internalPort,
                                     List<EnvironmentVariable> envVars, String imageTag) throws IOException {
        StringBuilder yml = new StringBuilder();
        yml.append("services:\n");
        yml.append("  app:\n");
        yml.append("    image: ").append(imageTag).append("\n");
        yml.append("    container_name: ").append(projectName).append("\n");
        yml.append("    ports:\n");
        yml.append("      - \"").append(externalPort).append(":").append(internalPort).append("\"\n");
        yml.append("    env_file:\n");
        yml.append("      - .env.project\n");

        if (!envVars.isEmpty()) {
            yml.append("    environment:\n");
            for (EnvironmentVariable ev : envVars) {
                if (!ev.isSensitive()) {
                    yml.append("      - ").append(ev.getKey()).append("=${").append(ev.getKey()).append("}\n");
                }
            }
        }

        yml.append("    restart: unless-stopped\n");
        yml.append("    networks:\n");
        yml.append("      - ").append(projectName).append("-network\n\n");
        yml.append("networks:\n");
        yml.append("  ").append(projectName).append("-network:\n");
        yml.append("    name: ").append(projectName).append("-network\n");

        Files.writeString(file.toPath(), yml.toString());
    }

    private void generateEnvFile(File file, List<EnvironmentVariable> envVars) throws IOException {
        StringBuilder env = new StringBuilder();
        for (EnvironmentVariable ev : envVars) {
            String value = ev.isSensitive()
                    ? secretValueService.decrypt(ev.getEncryptedValue())
                    : (ev.getMaskedValue() != null ? ev.getMaskedValue() : "");
            if (value == null) {
                value = "";
            }
            env.append(ev.getKey()).append("=").append(value).append("\n");
        }
        Files.writeString(file.toPath(), env.toString());
    }
}
