package com.launchly.project.dto;

/**
 * Inferred build/deploy hints from a public repository (package.json / README).
 * Used for API preview and auto-fill on project create.
 */
public record RepositoryHintsResponse(
        String installCommand,
        String buildCommand,
        String startCommand,
        String testCommand,
        Integer defaultPort,
        String healthCheckPath,
        /** Where hints came from: {@code package.json}, {@code package.json+readme}, {@code defaults}. */
        String source
) {
    public static RepositoryHintsResponse defaults() {
        return new RepositoryHintsResponse(
                "npm ci --omit=dev || npm install --omit=dev",
                null,
                "npm start",
                null,
                3000,
                null,
                "defaults"
        );
    }
}
