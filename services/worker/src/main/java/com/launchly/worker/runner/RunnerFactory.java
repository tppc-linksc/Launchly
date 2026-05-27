package com.launchly.worker.runner;

import com.launchly.worker.entities.DeployTarget;
import com.launchly.worker.entities.Deployment;
import com.launchly.worker.repositories.DeployTargetRepository;
import com.launchly.worker.repositories.DeploymentRepository;
import org.springframework.stereotype.Component;

import java.util.Map;

@Component
public class RunnerFactory {

    private final GitRunner gitRunner;
    private final ShellRunner shellRunner;
    private final DockerRunner dockerRunner;
    private final RemoteSshRunner remoteSshRunner;
    private final DeploymentRepository deploymentRepository;
    private final DeployTargetRepository deployTargetRepository;

    public RunnerFactory(GitRunner gitRunner,
                         ShellRunner shellRunner,
                         DockerRunner dockerRunner,
                         RemoteSshRunner remoteSshRunner,
                         DeploymentRepository deploymentRepository,
                         DeployTargetRepository deployTargetRepository) {
        this.gitRunner = gitRunner;
        this.shellRunner = shellRunner;
        this.dockerRunner = dockerRunner;
        this.remoteSshRunner = remoteSshRunner;
        this.deploymentRepository = deploymentRepository;
        this.deployTargetRepository = deployTargetRepository;
    }

    public Runner getRunner(String taskType, RunnerContext context) {
        return switch (taskType) {
            case "REPO_CLONE" -> gitRunner;
            case "PROJECT_BUILD" -> shellRunner;
            case "PROJECT_DEPLOY" -> resolveDeployRunner(context);
            case "HEALTH_CHECK" -> shellRunner;
            default -> null;
        };
    }

    private Runner resolveDeployRunner(RunnerContext context) {
        String refId = context.getRefId();
        String deployTargetId = getDeployTargetId(refId, context.getPayload());
        if (deployTargetId == null || deployTargetId.isBlank()) {
            return dockerRunner;
        }

        DeployTarget target = deployTargetRepository.findById(deployTargetId).orElse(null);
        if (target == null) {
            return dockerRunner;
        }

        if ("BYOS_SSH".equals(target.getType())) {
            return remoteSshRunner;
        }

        return dockerRunner;
    }

    private String getDeployTargetId(String deploymentId, Map<String, Object> payload) {
        String fromPayload = (String) payload.get("deployTargetId");
        if (fromPayload != null && !fromPayload.isBlank()) {
            return fromPayload;
        }
        Deployment deployment = deploymentRepository.findById(deploymentId).orElse(null);
        if (deployment != null && deployment.getDeployTargetId() != null) {
            return deployment.getDeployTargetId();
        }
        return null;
    }
}
