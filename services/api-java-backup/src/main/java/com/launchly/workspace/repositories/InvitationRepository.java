package com.launchly.workspace.repositories;

import com.launchly.workspace.entities.Invitation;
import com.launchly.workspace.enums.InvitationStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface InvitationRepository extends JpaRepository<Invitation, String> {
    Optional<Invitation> findByTokenAndStatus(String token, InvitationStatus status);
    List<Invitation> findByWorkspaceId(String workspaceId);
}
