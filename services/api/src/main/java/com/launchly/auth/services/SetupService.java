package com.launchly.auth.services;

import com.launchly.auth.dto.SetupOwnerRequest;
import com.launchly.auth.dto.SetupOwnerResponse;
import com.launchly.auth.dto.SetupStatusResponse;
import com.launchly.auth.entities.User;
import com.launchly.auth.repositories.UserRepository;
import com.launchly.workspace.entities.Workspace;
import com.launchly.workspace.entities.WorkspaceMember;
import com.launchly.workspace.enums.Role;
import com.launchly.workspace.repositories.WorkspaceMemberRepository;
import com.launchly.workspace.repositories.WorkspaceRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SetupService {
    private final UserRepository userRepository;
    private final WorkspaceRepository workspaceRepository;
    private final WorkspaceMemberRepository workspaceMemberRepository;
    private final PasswordService passwordService;

    public SetupService(UserRepository userRepository,
                        WorkspaceRepository workspaceRepository,
                        WorkspaceMemberRepository workspaceMemberRepository,
                        PasswordService passwordService) {
        this.userRepository = userRepository;
        this.workspaceRepository = workspaceRepository;
        this.workspaceMemberRepository = workspaceMemberRepository;
        this.passwordService = passwordService;
    }

    public SetupStatusResponse getStatus() {
        boolean initialized = userRepository.count() > 0;
        return new SetupStatusResponse(initialized);
    }

    @Transactional
    public SetupOwnerResponse createOwner(SetupOwnerRequest request) {
        if (userRepository.count() > 0) {
            throw new IllegalStateException("System is already initialized");
        }

        String passwordHash = passwordService.hash(request.password());
        User owner = new User(request.account(), request.displayName(), passwordHash);
        owner = userRepository.save(owner);

        Workspace workspace = new Workspace(request.workspaceName(), null);
        workspace = workspaceRepository.save(workspace);

        WorkspaceMember member = new WorkspaceMember(workspace.getId(), owner.getId(), Role.OWNER);
        workspaceMemberRepository.save(member);

        return new SetupOwnerResponse(owner.getId(), owner.getAccount(),
                workspace.getId(), workspace.getName(), true);
    }
}
