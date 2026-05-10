package com.launchly.auth.dto;

public record LoginResponse(
        String accessToken,
        String refreshToken,
        UserInfo user,
        WorkspaceInfo workspace
) {
    public record UserInfo(String id, String account, String displayName) {}
    public record WorkspaceInfo(String id, String name) {}
}
