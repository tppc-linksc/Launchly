package com.launchly.deployment.dto;

import com.launchly.deployment.entities.Deployment;
import com.launchly.target.entities.DeployTarget;

import java.time.Instant;

public record DeploymentResponse(
        String id,
        String projectId,
        String environmentId,
        String environmentName,
        String deployTargetId,
        DeployTargetInfo deployTarget,
        String branch,
        String commitSha,
        String status,
        String triggeredBy,
        String triggeredByName,
        String accessUrl,
        Instant startedAt,
        Instant finishedAt,
        String errorMessage,
        Instant createdAt
) {
    public record DeployTargetInfo(
            String id,
            String name,
            String host
    ) {
    }

    public static DeploymentResponse from(Deployment d) {
        return new DeploymentResponse(
                d.getId(), d.getProjectId(), d.getEnvironmentId(),
                null,
                d.getDeployTargetId(),
                null,
                d.getBranch(), d.getCommitSha(), d.getStatus().name(),
                d.getTriggeredBy(), null, d.getAccessUrl(),
                d.getStartedAt(), d.getFinishedAt(),
                d.getErrorMessage(), d.getCreatedAt()
        );
    }

    public static DeploymentResponse from(Deployment d, DeployTarget deployTarget) {
        DeployTargetInfo info = null;
        if (deployTarget != null) {
            info = new DeployTargetInfo(deployTarget.getId(), deployTarget.getName(), deployTarget.getHost());
        }
        return new DeploymentResponse(
                d.getId(), d.getProjectId(), d.getEnvironmentId(),
                null,
                d.getDeployTargetId(),
                info,
                d.getBranch(), d.getCommitSha(), d.getStatus().name(),
                d.getTriggeredBy(), null, d.getAccessUrl(),
                d.getStartedAt(), d.getFinishedAt(),
                d.getErrorMessage(), d.getCreatedAt()
        );
    }

    public DeploymentResponse withTriggeredByName(String name) {
        return new DeploymentResponse(
                id, projectId, environmentId, environmentName, deployTargetId, deployTarget,
                branch, commitSha, status, triggeredBy, name, accessUrl,
                startedAt, finishedAt, errorMessage, createdAt
        );
    }

    public DeploymentResponse withEnvironmentName(String envName) {
        return new DeploymentResponse(
                id, projectId, environmentId, envName, deployTargetId, deployTarget,
                branch, commitSha, status, triggeredBy, triggeredByName, accessUrl,
                startedAt, finishedAt, errorMessage, createdAt
        );
    }
}
