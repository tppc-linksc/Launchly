package com.launchly.release.dto;

import com.launchly.release.entities.Release;
import java.time.Instant;

public record ReleaseResponse(
    String id,
    String projectId,
    String environmentId,
    String deploymentId,
    String version,
    String notes,
    String status,
    String gateStatus,
    String releasedBy,
    Instant releasedAt,
    String rollbackDeploymentId,
    Instant createdAt
) {
    public static ReleaseResponse from(Release r) {
        return new ReleaseResponse(
            r.getId(), r.getProjectId(), r.getEnvironmentId(), r.getDeploymentId(),
            r.getVersion(), r.getNotes(),
            r.getStatus() != null ? r.getStatus().name() : null,
            r.getGateStatus(), r.getReleasedBy(), r.getReleasedAt(),
            r.getRollbackDeploymentId(), r.getCreatedAt()
        );
    }
}
