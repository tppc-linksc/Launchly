package com.launchly.worker.entities;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "deployments")
public class Deployment {
    @Id
    private String id;

    @Column(name = "project_id", nullable = false)
    private String projectId;

    @Column(name = "environment_id", nullable = false)
    private String environmentId;

    @Column
    private String branch;

    @Column(name = "commit_sha")
    private String commitSha;

    @Column(nullable = false)
    private String status = "PENDING";

    @Column(name = "triggered_by", nullable = false)
    private String triggeredBy;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "finished_at")
    private Instant finishedAt;

    @Column(name = "error_message")
    private String errorMessage;

    @Column(name = "deploy_target_id")
    private String deployTargetId;

    @Column(name = "rollback_from_deployment_id")
    private String rollbackFromDeploymentId;

    @Column(name = "access_url")
    private String accessUrl;

    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    public Deployment() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }
    public String getEnvironmentId() { return environmentId; }
    public void setEnvironmentId(String environmentId) { this.environmentId = environmentId; }
    public String getBranch() { return branch; }
    public void setBranch(String branch) { this.branch = branch; }
    public String getCommitSha() { return commitSha; }
    public void setCommitSha(String commitSha) { this.commitSha = commitSha; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getTriggeredBy() { return triggeredBy; }
    public void setTriggeredBy(String triggeredBy) { this.triggeredBy = triggeredBy; }
    public Instant getStartedAt() { return startedAt; }
    public void setStartedAt(Instant startedAt) { this.startedAt = startedAt; }
    public Instant getFinishedAt() { return finishedAt; }
    public void setFinishedAt(Instant finishedAt) { this.finishedAt = finishedAt; }
    public String getErrorMessage() { return errorMessage; }
    public void setErrorMessage(String errorMessage) { this.errorMessage = errorMessage; }
    public String getDeployTargetId() { return deployTargetId; }
    public void setDeployTargetId(String deployTargetId) { this.deployTargetId = deployTargetId; }
    public String getRollbackFromDeploymentId() { return rollbackFromDeploymentId; }
    public void setRollbackFromDeploymentId(String rollbackFromDeploymentId) { this.rollbackFromDeploymentId = rollbackFromDeploymentId; }
    public String getAccessUrl() { return accessUrl; }
    public void setAccessUrl(String accessUrl) { this.accessUrl = accessUrl; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
}
