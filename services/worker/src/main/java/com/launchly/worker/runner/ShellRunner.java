package com.launchly.worker.runner;

import com.launchly.worker.entities.Environment;
import com.launchly.worker.entities.Project;
import com.launchly.worker.repositories.DeploymentRepository;
import com.launchly.worker.repositories.EnvironmentRepository;
import com.launchly.worker.repositories.ProjectRepository;
import org.springframework.stereotype.Component;

import java.io.File;

@Component
public class ShellRunner implements Runner {

    private static final int BUILD_TIMEOUT = 1200; // 20 minutes
    private static final int DEFAULT_TIMEOUT = 300;
    private static final String BUILD_ROOT = "/tmp/launchly-builds";

    private final ProjectRepository projectRepository;
    private final EnvironmentRepository environmentRepository;
    private final DeploymentRepository deploymentRepository;

    public ShellRunner(ProjectRepository projectRepository,
                       EnvironmentRepository environmentRepository,
                       DeploymentRepository deploymentRepository) {
        this.projectRepository = projectRepository;
        this.environmentRepository = environmentRepository;
        this.deploymentRepository = deploymentRepository;
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

        // Determine which command to execute based on task type
        String taskType = context.getTaskType();
        String command;
        int timeout = DEFAULT_TIMEOUT;

        if ("PROJECT_BUILD".equals(taskType)) {
            StringBuilder buildCmd = new StringBuilder();
            if (project.getInstallCommand() != null && !project.getInstallCommand().isEmpty()) {
                buildCmd.append(project.getInstallCommand()).append(" && ");
            }
            if (project.getBuildCommand() != null && !project.getBuildCommand().isEmpty()) {
                buildCmd.append(project.getBuildCommand());
            } else {
                buildCmd.append("echo 'no build command configured'");
            }
            command = buildCmd.toString();
            timeout = BUILD_TIMEOUT;
        } else if ("HEALTH_CHECK".equals(taskType)) {
            String healthPath = project.getHealthCheckPath();
            if (healthPath == null || healthPath.isEmpty()) {
                return RunnerResult.success("No health check path configured, skipping", "");
            }

            // Validate healthPath to prevent shell injection
            if (!healthPath.matches("^/[a-zA-Z0-9/._-]*$")) {
                return RunnerResult.failure("Invalid health check path: " + healthPath,
                        "", "Health check path contains invalid characters", -1);
            }

            // Use effective external port for health check
            int port = getEffectiveHealthCheckPort(environmentId, project);
            command = "curl -f -s -o /dev/null -w '%{http_code}' http://localhost:" + port + healthPath
                    + " | grep -q '200' && echo 'Health check OK' || exit 1";
            timeout = 120; // 2 minutes
        } else {
            return RunnerResult.success("ShellRunner: no command for task type " + taskType, "");
        }

        return CommandExecutor.execute(command, workDir, timeout);
    }

    /**
     * Determine the port to use for health check.
     * Same fallback rule as DockerRunner: environment.externalPort → type default → project.defaultPort → 3000.
     */
    private int getEffectiveHealthCheckPort(String environmentId, Project project) {
        if (environmentId != null && !environmentId.isEmpty()) {
            Environment env = environmentRepository.findById(environmentId).orElse(null);
            if (env != null) {
                return DockerRunner.getEffectivePort(env, project);
            }
        }
        return project.getDefaultPort() != null ? project.getDefaultPort() : 3000;
    }
}
