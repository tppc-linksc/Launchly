package com.launchly.auth.services;

import com.launchly.auth.dto.LoginRequest;
import com.launchly.auth.dto.LoginResponse;
import com.launchly.auth.entities.User;
import com.launchly.auth.repositories.UserRepository;
import com.launchly.workspace.entities.Workspace;
import com.launchly.workspace.repositories.WorkspaceMemberRepository;
import com.launchly.workspace.repositories.WorkspaceRepository;
import io.jsonwebtoken.Claims;
import org.springframework.stereotype.Service;

@Service
public class AuthService {
    private final UserRepository userRepository;
    private final WorkspaceMemberRepository workspaceMemberRepository;
    private final WorkspaceRepository workspaceRepository;
    private final PasswordService passwordService;
    private final TokenService tokenService;

    public AuthService(UserRepository userRepository,
                       WorkspaceMemberRepository workspaceMemberRepository,
                       WorkspaceRepository workspaceRepository,
                       PasswordService passwordService,
                       TokenService tokenService) {
        this.userRepository = userRepository;
        this.workspaceMemberRepository = workspaceMemberRepository;
        this.workspaceRepository = workspaceRepository;
        this.passwordService = passwordService;
        this.tokenService = tokenService;
    }

    public LoginResponse login(LoginRequest request) {
        User user = userRepository.findByAccount(request.account())
                .orElseThrow(() -> new IllegalArgumentException("Invalid account or password"));

        if (!passwordService.matches(request.password(), user.getPasswordHash())) {
            throw new IllegalArgumentException("Invalid account or password");
        }

        String workspaceId = null;
        String workspaceName = null;

        var members = workspaceMemberRepository.findByUserId(user.getId());
        if (!members.isEmpty()) {
            workspaceId = members.get(0).getWorkspaceId();
            Workspace ws = workspaceRepository.findById(workspaceId).orElse(null);
            if (ws != null) {
                workspaceName = ws.getName();
            }
        }

        String accessToken = tokenService.generateAccessToken(user.getId(), workspaceId);
        String refreshToken = tokenService.generateRefreshToken(user.getId());

        var userInfo = new LoginResponse.UserInfo(user.getId(), user.getAccount(), user.getDisplayName());
        var workspaceInfo = workspaceId != null
                ? new LoginResponse.WorkspaceInfo(workspaceId, workspaceName)
                : null;

        return new LoginResponse(accessToken, refreshToken, userInfo, workspaceInfo);
    }

    public LoginResponse refresh(String refreshToken) {
        Claims claims = tokenService.validateToken(refreshToken);
        String userId = claims.get("uid", String.class);

        User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));

        String workspaceId = null;
        String workspaceName = null;

        var members = workspaceMemberRepository.findByUserId(user.getId());
        if (!members.isEmpty()) {
            workspaceId = members.get(0).getWorkspaceId();
            Workspace ws = workspaceRepository.findById(workspaceId).orElse(null);
            if (ws != null) {
                workspaceName = ws.getName();
            }
        }

        String newAccessToken = tokenService.generateAccessToken(user.getId(), workspaceId);
        String newRefreshToken = tokenService.generateRefreshToken(user.getId());

        var userInfo = new LoginResponse.UserInfo(user.getId(), user.getAccount(), user.getDisplayName());
        var workspaceInfo = workspaceId != null
                ? new LoginResponse.WorkspaceInfo(workspaceId, workspaceName)
                : null;

        return new LoginResponse(newAccessToken, newRefreshToken, userInfo, workspaceInfo);
    }
}
