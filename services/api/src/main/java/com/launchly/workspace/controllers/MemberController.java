package com.launchly.workspace.controllers;

import com.launchly.auth.entities.User;
import com.launchly.auth.repositories.UserRepository;
import com.launchly.common.security.AuthContext;
import com.launchly.workspace.entities.WorkspaceMember;
import com.launchly.workspace.enums.Role;
import com.launchly.workspace.repositories.WorkspaceMemberRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/members")
public class MemberController {
    private final WorkspaceMemberRepository memberRepository;
    private final UserRepository userRepository;

    public MemberController(WorkspaceMemberRepository memberRepository, UserRepository userRepository) {
        this.memberRepository = memberRepository;
        this.userRepository = userRepository;
    }

    @GetMapping
    public ResponseEntity<List<MemberResponse>> list() {
        String workspaceId = AuthContext.workspaceId();
        List<WorkspaceMember> members = memberRepository.findByWorkspaceId(workspaceId);

        List<String> userIds = members.stream().map(WorkspaceMember::getUserId).collect(Collectors.toList());
        Map<String, User> userMap = userRepository.findAllById(userIds).stream()
                .collect(Collectors.toMap(User::getId, u -> u));

        List<MemberResponse> result = members.stream().map(m -> {
            User user = userMap.get(m.getUserId());
            String account = user != null ? user.getAccount() : "unknown";
            String displayName = user != null ? user.getDisplayName() : null;
            return new MemberResponse(m.getId(), m.getUserId(), account, displayName, m.getRole().name(), m.getCreatedAt().toString());
        }).collect(Collectors.toList());

        return ResponseEntity.ok(result);
    }

    @PutMapping("/{id}/role")
    @PreAuthorize("hasRole('OWNER')")
    public ResponseEntity<Void> updateRole(@PathVariable String id, @RequestBody Map<String, String> body) {
        String workspaceId = AuthContext.workspaceId();
        WorkspaceMember member = memberRepository.findById(id).orElse(null);
        if (member == null || !member.getWorkspaceId().equals(workspaceId)) {
            return ResponseEntity.notFound().build();
        }

        String newRole = body.get("role");
        if (newRole == null) {
            return ResponseEntity.badRequest().build();
        }

        try {
            member.setRole(Role.valueOf(newRole));
            memberRepository.save(member);
            return ResponseEntity.ok().build();
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().build();
        }
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('OWNER')")
    public ResponseEntity<Void> remove(@PathVariable String id) {
        String workspaceId = AuthContext.workspaceId();
        WorkspaceMember member = memberRepository.findById(id).orElse(null);
        if (member == null || !member.getWorkspaceId().equals(workspaceId)) {
            return ResponseEntity.notFound().build();
        }

        // Prevent removing the last owner
        if (member.getRole() == Role.OWNER) {
            long ownerCount = memberRepository.findByWorkspaceId(workspaceId).stream()
                    .filter(m -> m.getRole() == Role.OWNER)
                    .count();
            if (ownerCount <= 1) {
                return ResponseEntity.status(409).build();
            }
        }

        memberRepository.delete(member);
        return ResponseEntity.ok().build();
    }

    public record MemberResponse(String id, String userId, String account, String displayName, String role, String createdAt) {}
}
