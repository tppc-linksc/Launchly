package com.launchly.auth.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record SetupOwnerRequest(
        @NotBlank String account,
        @NotBlank @Size(min = 8) @Pattern(regexp = "^(?=.*[a-zA-Z])(?=.*\\d).+$",
                message = "Password must contain at least one letter and one digit")
        String password,
        String displayName,
        @NotBlank String workspaceName
) {
}
