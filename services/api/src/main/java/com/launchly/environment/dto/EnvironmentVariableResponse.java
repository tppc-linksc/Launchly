package com.launchly.environment.dto;

import com.launchly.environment.entities.EnvironmentVariable;
import java.time.Instant;

public record EnvironmentVariableResponse(
        String id,
        String environmentId,
        String key,
        String maskedValue,
        boolean sensitive,
        String description,
        Instant createdAt,
        Instant updatedAt
) {
    public static EnvironmentVariableResponse from(EnvironmentVariable v) {
        return new EnvironmentVariableResponse(
                v.getId(), v.getEnvironmentId(), v.getKey(),
                v.isSensitive() ? v.getMaskedValue() : v.getEncryptedValue(),
                v.isSensitive(), v.getDescription(),
                v.getCreatedAt(), v.getUpdatedAt()
        );
    }
}
