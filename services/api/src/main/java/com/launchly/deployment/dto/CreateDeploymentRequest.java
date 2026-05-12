package com.launchly.deployment.dto;

import jakarta.validation.constraints.NotBlank;

public record CreateDeploymentRequest(
        @NotBlank String projectId,
        @NotBlank String environmentId,
        @NotBlank String deployTargetId,
        String branch,
        String commitSha,
        String notes
) {
}
