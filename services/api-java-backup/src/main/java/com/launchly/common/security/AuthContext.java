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

    public static String role() {
        return current().role();
    }

    /**
     * 要求当前用户拥有指定或更高角色。不符合则抛 SecurityException。
     */
    public static void requireWrite(String minimumRole) {
        if (!current().hasRole(minimumRole)) {
            throw new SecurityException("权限不足：需要 " + minimumRole + " 或更高角色");
        }
    }

    /**
     * Viewer 角色不允许执行写操作。
     */
    public static void requireNotReadOnly() {
        if (current().isReadOnly()) {
            throw new SecurityException("权限不足：Viewer 角色不允许执行写操作");
        }
    }
}
