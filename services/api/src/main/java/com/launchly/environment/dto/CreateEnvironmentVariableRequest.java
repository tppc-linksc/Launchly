package com.launchly.environment.dto;

import jakarta.validation.constraints.NotBlank;

public record CreateEnvironmentVariableRequest(
        @NotBlank String key,
        @NotBlank String value,
        boolean sensitive,
        String description
) {
}
