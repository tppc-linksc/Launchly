package com.launchly.worker.runner;

import com.launchly.worker.entities.Deployment;
import com.launchly.worker.entities.Project;
import com.launchly.worker.repositories.DeploymentRepository;
import com.launchly.worker.repositories.ProjectRepository;
import org.springframework.stereotype.Component;

import java.io.File;

@Component
public class ShellRunner implements Runner {

    private static final int BUILD_TIMEOUT = 1200; // 20 minutes
    private static final int DEFAULT_TIMEOUT = 300;
    private static final String BUILD_ROOT = "/tmp/launchly-builds";

    private final ProjectRepository projectRepository;
    private final DeploymentRepository deploymentRepository;

    public ShellRunner(ProjectRepository projectRepository, DeploymentRepository deploymentRepository) {
        this.projectRepository = projectRepository;
        this.deploymentRepository = deploymentRepository;
    }

    @Override
    public RunnerResult execute(RunnerContext context) {
        String refId = context.getRefId();
        String projectId = (String) context.getPayload().getOrDefault("projectId", "");

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
        String command = null;
        int timeout = DEFAULT_TIMEOUT;

        if ("PROJECT_BUILD".equals(taskType)) {
            // Build: install dependencies + build
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
            int port = project.getDefaultPort() != null ? project.getDefaultPort() : 3000;
            command = "curl -f -s -o /dev/null -w '%{http_code}' http://localhost:" + port + healthPath
                    + " | grep -q '200' && echo 'Health check OK' || exit 1";
            timeout = 120; // 2 minutes
        } else {
            return RunnerResult.success("ShellRunner: no command for task type " + taskType, "");
        }

        return CommandExecutor.execute(command, workDir, timeout);
    }
}
