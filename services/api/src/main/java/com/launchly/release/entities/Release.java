package com.launchly.release.entities;

import com.launchly.release.enums.ReleaseStatus;
import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "releases")
public class Release {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(name = "project_id", nullable = false)
    private String projectId;

    @Column(name = "environment_id", nullable = false)
    private String environmentId;

    @Column(name = "deployment_id")
    private String deploymentId;

    @Column(nullable = false)
    private String version;

    @Column(columnDefinition = "TEXT")
    private String notes;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private ReleaseStatus status = ReleaseStatus.DRAFT;

    @Column(name = "gate_status")
    private String gateStatus;

    @Column(name = "released_by")
    private String releasedBy;

    @Column(name = "released_at")
    private Instant releasedAt;

    @Column(name = "rollback_deployment_id")
    private String rollbackDeploymentId;

    @Column(nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    public Release() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }
    public String getEnvironmentId() { return environmentId; }
    public void setEnvironmentId(String environmentId) { this.environmentId = environmentId; }
    public String getDeploymentId() { return deploymentId; }
    public void setDeploymentId(String deploymentId) { this.deploymentId = deploymentId; }
    public String getVersion() { return version; }
    public void setVersion(String version) { this.version = version; }
    public String getNotes() { return notes; }
    public void setNotes(String notes) { this.notes = notes; }
    public ReleaseStatus getStatus() { return status; }
    public void setStatus(ReleaseStatus status) { this.status = status; }
    public String getGateStatus() { return gateStatus; }
    public void setGateStatus(String gateStatus) { this.gateStatus = gateStatus; }
    public String getReleasedBy() { return releasedBy; }
    public void setReleasedBy(String releasedBy) { this.releasedBy = releasedBy; }
    public Instant getReleasedAt() { return releasedAt; }
    public void setReleasedAt(Instant releasedAt) { this.releasedAt = releasedAt; }
    public String getRollbackDeploymentId() { return rollbackDeploymentId; }
    public void setRollbackDeploymentId(String rollbackDeploymentId) { this.rollbackDeploymentId = rollbackDeploymentId; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}
