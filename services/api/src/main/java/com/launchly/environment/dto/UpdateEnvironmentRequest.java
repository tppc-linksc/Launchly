package com.launchly.environment.dto;

public record UpdateEnvironmentRequest(
        String name,
        String url,
        String deployMode,
        String host,
        String sshUser,
        String deployDir,
        Integer externalPort,
        String dataStrategy,
        Boolean enabled
) {}
