package com.launchly.target.dto;

import com.launchly.target.entities.DeployTarget;

import java.time.Instant;

public record DeployTargetDto(
        String id,
        String organizationId,
        String projectId,
        String name,
        String type,
        String host,
        Integer port,
        String username,
        String authMethod,
        String maskedCredential,
        String status,
        Instant lastVerifiedAt,
        Instant createdAt,
        Instant updatedAt
) {
    public static DeployTargetDto from(DeployTarget entity) {
        String masked = null;
        if (entity.getEncryptedCredential() != null && entity.getEncryptedCredential().length() > 8) {
            masked = entity.getEncryptedCredential().substring(0, 4) + "***" +
                    entity.getEncryptedCredential().substring(entity.getEncryptedCredential().length() - 4);
        }
        return new DeployTargetDto(
                entity.getId(),
                entity.getOrganizationId(),
                entity.getProjectId(),
                entity.getName(),
                entity.getType().name(),
                entity.getHost(),
                entity.getPort(),
                entity.getUsername(),
                entity.getAuthMethod().name(),
                masked,
                entity.getStatus().name(),
                entity.getLastVerifiedAt(),
                entity.getCreatedAt(),
                entity.getUpdatedAt()
        );
    }
}
