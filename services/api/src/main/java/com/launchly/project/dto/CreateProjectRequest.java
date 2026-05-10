package com.launchly.project.dto;

import com.launchly.project.enums.ProjectType;
import jakarta.validation.constraints.NotBlank;

public record CreateProjectRequest(
        @NotBlank String name,
        String description,
        ProjectType projectType,
        String repositoryUrl,
        String defaultBranch,
        String gitProvider,
        String installCommand,
        String buildCommand,
        String startCommand,
        String testCommand,
        String healthCheckPath,
        Integer defaultPort
) {
}
