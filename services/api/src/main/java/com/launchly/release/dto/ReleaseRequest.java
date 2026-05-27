package com.launchly.release.dto;

import jakarta.validation.constraints.NotBlank;

public record ReleaseRequest(
    @NotBlank String deploymentId,
    @NotBlank String environmentId,
    String version,
    String notes
) {}
