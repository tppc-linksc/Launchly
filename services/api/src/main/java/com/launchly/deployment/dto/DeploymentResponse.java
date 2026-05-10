package com.launchly.deployment.dto;

import com.launchly.deployment.entities.Deployment;
import java.time.Instant;

public record DeploymentResponse(
        String id,
        String projectId,
        String environmentId,
        String branch,
        String commitSha,
        String status,
        String triggeredBy,
        Instant startedAt,
        Instant finishedAt,
        String errorMessage,
        Instant createdAt
) {
    public static DeploymentResponse from(Deployment d) {
        return new DeploymentResponse(
                d.getId(), d.getProjectId(), d.getEnvironmentId(),
                d.getBranch(), d.getCommitSha(), d.getStatus().name(),
                d.getTriggeredBy(), d.getStartedAt(), d.getFinishedAt(),
                d.getErrorMessage(), d.getCreatedAt()
        );
    }
}
