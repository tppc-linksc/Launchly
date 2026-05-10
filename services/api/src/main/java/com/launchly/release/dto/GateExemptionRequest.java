package com.launchly.release.dto;

import jakarta.validation.constraints.NotBlank;

public record GateExemptionRequest(
    @NotBlank String reason
) {}
