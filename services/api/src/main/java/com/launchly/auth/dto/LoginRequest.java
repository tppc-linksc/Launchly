package com.launchly.auth.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import jakarta.validation.constraints.NotBlank;

public record LoginRequest(
        @JsonAlias("email") @NotBlank String account,
        @NotBlank String password
) {
}
