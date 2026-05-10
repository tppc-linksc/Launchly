package com.launchly.testcase.dto;

import com.launchly.testcase.entities.TestRun;
import java.time.Instant;

public record TestRunResponse(
    String id,
    String projectId,
    String deploymentId,
    String environmentId,
    String status,
    String createdBy,
    Instant createdAt,
    Instant finishedAt
) {
    public static TestRunResponse from(TestRun tr) {
        return new TestRunResponse(
            tr.getId(), tr.getProjectId(), tr.getDeploymentId(), tr.getEnvironmentId(),
            tr.getStatus() != null ? tr.getStatus().name() : null,
            tr.getCreatedBy(), tr.getCreatedAt(), tr.getFinishedAt()
        );
    }
}
