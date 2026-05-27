package com.launchly.worker.runner;

import com.launchly.worker.deploy.ImplicitDockerfileGenerator;
import com.launchly.worker.entities.Environment;
import com.launchly.worker.entities.EnvironmentVariable;
import com.launchly.worker.entities.Project;
import com.launchly.worker.repositories.EnvironmentRepository;
import com.launchly.worker.repositories.EnvironmentVariableRepository;
import com.launchly.worker.repositories.ProjectRepository;
import org.springframework.stereotype.Component;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.util.List;

@Component
public class DockerRunner implements Runner {

    private static final int DEPLOY_TIMEOUT = 300; // 5 minutes
    private static final String BUILD_ROOT = "/tmp/launchly-builds";

    private final ProjectRepository projectRepository;
    private final EnvironmentRepository environmentRepository;
    private final EnvironmentVariableRepository envVarRepository;
    private final SecretValueService secretValueService;

    public DockerRunner(ProjectRepository projectRepository,
                        EnvironmentRepository environmentRepository,
                        EnvironmentVariableRepository envVarRepository,
                        SecretValueService secretValueService) {
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

        Project project = projectRepository.findById(projectId).orElse(null);
        if (project == null) {
            return RunnerResult.failure("Project not found: " + projectId, "", "", -1);
        }

        Environment env = environmentRepository.findById(environmentId).orElse(null);
        if (env == null) {
            return RunnerResult.failure("Environment not found: " + environmentId, "", "", -1);
        }

        // Block remote deployment
        if ("remote".equals(env.getDeployMode())) {
            return RunnerResult.failure("远程部署功能开发中，暂不支持。请使用本地模式（local）部署。", "", "", -1);
        }

        int externalPort = getEffectivePort(env, project);
        int internalPort = project.getDefaultPort() != null ? project.getDefaultPort() : 3000;

        File workDir = new File(resolveBuildRoot(env), projectId + "/" + refId);
        if (!workDir.exists()) {
            workDir.mkdirs();
        }

        // Generate compose file
        String projectName = "launchly-" + projectId.substring(0, 8) + "-" + environmentId.substring(0, 8);
        File composeFile = new File(workDir, "docker-compose.yml");
        File envFile = new File(workDir, ".env.project");

        try {
            String implicitDockerfile = ImplicitDockerfileGenerator.writeIfMissing(workDir, project);
            List<EnvironmentVariable> envVars = envVarRepository.findByEnvironmentId(environmentId);
            generateEnvFile(envFile, envVars);
            generateComposeFile(composeFile, projectName, externalPort, internalPort, envVars, implicitDockerfile);

            // Run docker compose up
            String[] upCmd = {
                "docker", "compose", "-f", composeFile.getAbsolutePath(),
                "-p", projectName, "up", "-d"
            };
            RunnerResult upResult = CommandExecutor.execute(upCmd, workDir, DEPLOY_TIMEOUT);

            if (!upResult.isSuccess()) {
                // Cleanup on failure
                CommandExecutor.execute(
                    new String[]{"docker", "compose", "-f", composeFile.getAbsolutePath(), "-p", projectName, "down"},
                    workDir, 60);
                return RunnerResult.failure(
                    "Docker compose up failed: " + upResult.getErrorMessage(),
                    upResult.getStdout(), upResult.getStderr(), upResult.getExitCode());
            }

            return RunnerResult.success(
                "Docker Compose started (project: " + projectName + ", port: " + externalPort + ":" + internalPort + ")\n" + upResult.getStdout(),
                upResult.getStderr());

        } catch (IOException e) {
            return RunnerResult.failure("Failed to generate compose/env files: " + e.getMessage(), "", "", -1);
        }
    }

    /**
     * Worker-side parent for git/build/compose dirs ({@code projectId/refId} below this).
     * Uses {@link Environment#getLocalWorkRoot} when set; otherwise {@link #BUILD_ROOT}.
     */
    static File resolveBuildRoot(Environment env) {
        String custom = env.getLocalWorkRoot();
        if (custom != null && !custom.isBlank()) {
            return new File(custom.trim());
        }
        return new File(BUILD_ROOT);
    }

    /**
     * Determine the effective external port for deployment.
     * Priority: environment.externalPort → per-type default → project.defaultPort → 3000.
     */
    static int getEffectivePort(Environment env, Project project) {
        if (env.getExternalPort() != null && env.getExternalPort() > 0) {
            return env.getExternalPort();
        }
        String type = env.getType();
        if ("TEST".equals(type)) return 3001;
        if ("STAGING".equals(type)) return 3002;
        if ("PRODUCTION".equals(type)) return 3003;
        return project.getDefaultPort() != null ? project.getDefaultPort() : 3000;
    }

    public RunnerResult down(String projectId, String environmentId, String refId) {
        File root = environmentRepository.findById(environmentId)
                .map(DockerRunner::resolveBuildRoot)
                .orElseGet(() -> new File(BUILD_ROOT));
        File workDir = new File(root, projectId + "/" + refId);
        File composeFile = new File(workDir, "docker-compose.yml");
        String projectName = "launchly-" + projectId.substring(0, 8) + "-" + environmentId.substring(0, 8);

        if (!composeFile.exists()) {
            return RunnerResult.success("No compose file to clean up", "");
        }

        return CommandExecutor.execute(
            new String[]{"docker", "compose", "-f", composeFile.getAbsolutePath(), "-p", projectName, "down"},
            workDir, 60);
    }

    public RunnerResult logs(String projectId, String environmentId, String refId) {
        File root = environmentRepository.findById(environmentId)
                .map(DockerRunner::resolveBuildRoot)
                .orElseGet(() -> new File(BUILD_ROOT));
        File workDir = new File(root, projectId + "/" + refId);
        File composeFile = new File(workDir, "docker-compose.yml");
        String projectName = "launchly-" + projectId.substring(0, 8) + "-" + environmentId.substring(0, 8);

        return CommandExecutor.execute(
            new String[]{"docker", "compose", "-f", composeFile.getAbsolutePath(), "-p", projectName, "logs", "--tail", "100"},
            workDir, 30);
    }

    private void generateComposeFile(File file, String projectName, int externalPort, int internalPort,
                                     List<EnvironmentVariable> envVars, String implicitDockerfile) throws IOException {
        StringBuilder yml = new StringBuilder();
        yml.append("services:\n");
        yml.append("  app:\n");
        yml.append("    image: ").append(projectName).append(":latest\n");
        yml.append("    container_name: ").append(projectName).append("\n");
        yml.append("    build:\n");
        yml.append("      context: .\n");
        if (implicitDockerfile != null && !implicitDockerfile.isBlank()) {
            yml.append("      dockerfile: ").append(implicitDockerfile).append("\n");
        }
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
