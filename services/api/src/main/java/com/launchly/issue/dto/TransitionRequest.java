package com.launchly.issue.dto;

import jakarta.validation.constraints.NotBlank;

public record TransitionRequest(
    @NotBlank String targetStatus,
    String fixedCommitSha
) {}
