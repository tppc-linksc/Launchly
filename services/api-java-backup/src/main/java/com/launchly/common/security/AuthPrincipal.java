package com.launchly.common.security;

public record AuthPrincipal(String userId, String workspaceId, String role) {
    public AuthPrincipal(String userId, String workspaceId) {
        this(userId, workspaceId, null);
    }

    public boolean hasRole(String requiredRole) {
        if (role == null) return false;
        return switch (requiredRole) {
            case "OWNER" -> "OWNER".equals(role);
            case "ADMIN" -> "OWNER".equals(role) || "ADMIN".equals(role);
            case "DEVELOPER" -> "OWNER".equals(role) || "ADMIN".equals(role) || "DEVELOPER".equals(role);
            case "TESTER" -> "OWNER".equals(role) || "ADMIN".equals(role) || "DEVELOPER".equals(role) || "TESTER".equals(role);
            case "VIEWER" -> true;
            default -> false;
        };
    }

    public boolean isReadOnly() {
        return "VIEWER".equals(role);
    }
}
