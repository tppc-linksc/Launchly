package com.launchly.worker.runner;

import com.launchly.worker.entities.EnvironmentVariable;
import com.launchly.worker.entities.Project;
import com.launchly.worker.repositories.EnvironmentVariableRepository;
import com.launchly.worker.repositories.ProjectRepository;
import org.springframework.stereotype.Component;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.nio.file.Files;
import java.util.List;

@Component
public class DockerRunner implements Runner {

    private static final int DEPLOY_TIMEOUT = 300; // 5 minutes
    private static final String BUILD_ROOT = "/tmp/launchly-builds";

    private final ProjectRepository projectRepository;
    private final EnvironmentVariableRepository envVarRepository;
    private final SecretValueService secretValueService;

    public DockerRunner(ProjectRepository projectRepository,
                        EnvironmentVariableRepository envVarRepository,
                        SecretValueService secretValueService) {
        this.projectRepository = projectRepository;
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

        File workDir = new File(BUILD_ROOT, projectId + "/" + refId);
        if (!workDir.exists()) {
            workDir.mkdirs();
        }

        // Generate compose file
        String projectName = "launchly-" + projectId.substring(0, 8) + "-" + environmentId.substring(0, 8);
        File composeFile = new File(workDir, "docker-compose.yml");
        File envFile = new File(workDir, ".env.project");

        try {
            List<EnvironmentVariable> envVars = envVarRepository.findByEnvironmentId(environmentId);
            generateEnvFile(envFile, envVars);
            generateComposeFile(composeFile, project, projectName, envVars);

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
                "Docker Compose started (project: " + projectName + ")\n" + upResult.getStdout(),
                upResult.getStderr());

        } catch (IOException e) {
            return RunnerResult.failure("Failed to generate compose/env files: " + e.getMessage(), "", "", -1);
        }
    }

    public RunnerResult down(String projectId, String environmentId, String refId) {
        File workDir = new File(BUILD_ROOT, projectId + "/" + refId);
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
        File workDir = new File(BUILD_ROOT, projectId + "/" + refId);
        File composeFile = new File(workDir, "docker-compose.yml");
        String projectName = "launchly-" + projectId.substring(0, 8) + "-" + environmentId.substring(0, 8);

        return CommandExecutor.execute(
            new String[]{"docker", "compose", "-f", composeFile.getAbsolutePath(), "-p", projectName, "logs", "--tail", "100"},
            workDir, 30);
    }

    private void generateComposeFile(File file, Project project, String projectName,
                                     List<EnvironmentVariable> envVars) throws IOException {
        int port = project.getDefaultPort() != null ? project.getDefaultPort() : 3000;

        StringBuilder yml = new StringBuilder();
        yml.append("services:\n");
        yml.append("  app:\n");
        yml.append("    image: ").append(projectName).append(":latest\n");
        yml.append("    container_name: ").append(projectName).append("\n");
        yml.append("    build:\n");
        yml.append("      context: .\n");
        yml.append("    ports:\n");
        yml.append("      - \"").append(port).append(":").append(port).append("\"\n");
        yml.append("    env_file:\n");
        yml.append("      - .env.project\n");

        // Add named volumes if needed
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
            // For sensitive vars, use encrypted value; for non-sensitive, use plain text
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
