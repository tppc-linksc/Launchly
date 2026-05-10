package com.launchly.workspace.repositories;

import com.launchly.workspace.entities.WorkspaceMember;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface WorkspaceMemberRepository extends JpaRepository<WorkspaceMember, String> {
    List<WorkspaceMember> findByWorkspaceId(String workspaceId);
    Optional<WorkspaceMember> findByWorkspaceIdAndUserId(String workspaceId, String userId);
    List<WorkspaceMember> findByUserId(String userId);
}
