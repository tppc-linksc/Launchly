package com.launchly.auth.dto;

public record SetupOwnerResponse(
        String ownerId,
        String ownerAccount,
        String workspaceId,
        String workspaceName,
        boolean initialized
) {
}
