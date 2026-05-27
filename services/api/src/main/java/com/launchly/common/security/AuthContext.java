package com.launchly.common.security;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

public final class AuthContext {
    private AuthContext() {
    }

    public static AuthPrincipal current() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !(authentication.getPrincipal() instanceof AuthPrincipal principal)) {
            throw new IllegalStateException("Authenticated user context is required");
        }
        return principal;
    }

    public static String userId() {
        return current().userId();
    }

    public static String workspaceId() {
        String workspaceId = current().workspaceId();
        if (workspaceId == null || workspaceId.isBlank()) {
            throw new IllegalStateException("Authenticated workspace context is required");
        }
        return workspaceId;
    }
}
