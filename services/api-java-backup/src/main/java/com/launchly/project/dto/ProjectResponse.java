package com.launchly.project.dto;

import com.launchly.project.entities.Project;
import java.time.Instant;

public record ProjectResponse(
        String id,
        String workspaceId,
        String name,
        String description,
        String projectType,
        String repositoryUrl,
        String defaultBranch,
        String gitProvider,
        String installCommand,
        String buildCommand,
        String startCommand,
        String testCommand,
        String healthCheckPath,
        Integer defaultPort,
        String createdBy,
        Instant createdAt,
        Instant updatedAt
) {
    public static ProjectResponse from(Project p) {
        return new ProjectResponse(
                p.getId(), p.getWorkspaceId(), p.getName(), p.getDescription(),
                p.getProjectType().name(), p.getRepositoryUrl(), p.getDefaultBranch(),
                p.getGitProvider() != null ? p.getGitProvider().name() : null,
                p.getInstallCommand(), p.getBuildCommand(), p.getStartCommand(),
                p.getTestCommand(), p.getHealthCheckPath(), p.getDefaultPort(),
                p.getCreatedBy(), p.getCreatedAt(), p.getUpdatedAt()
        );
    }
}
