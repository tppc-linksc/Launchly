package com.launchly.workspace.entities;

import com.launchly.workspace.enums.Role;
import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "workspace_members", uniqueConstraints = {
    @UniqueConstraint(columnNames = {"workspace_id", "user_id"})
})
public class WorkspaceMember {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(name = "workspace_id", nullable = false)
    private String workspaceId;

    @Column(name = "user_id", nullable = false)
    private String userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Role role;

    @Column(nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    public WorkspaceMember() {}

    public WorkspaceMember(String workspaceId, String userId, Role role) {
        this.workspaceId = workspaceId;
        this.userId = userId;
        this.role = role;
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getWorkspaceId() { return workspaceId; }
    public void setWorkspaceId(String workspaceId) { this.workspaceId = workspaceId; }
    public String getUserId() { return userId; }
    public void setUserId(String userId) { this.userId = userId; }
    public Role getRole() { return role; }
    public void setRole(Role role) { this.role = role; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}
