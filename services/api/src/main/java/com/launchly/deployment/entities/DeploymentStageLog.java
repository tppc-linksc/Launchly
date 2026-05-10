package com.launchly.deployment.entities;

import com.launchly.deployment.enums.DeploymentStage;
import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "deployment_stage_logs")
public class DeploymentStageLog {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(name = "deployment_id", nullable = false)
    private String deploymentId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private DeploymentStage stage;

    @Column(nullable = false)
    private String status = "PENDING";

    @Column(columnDefinition = "TEXT")
    private String log;

    @Column(name = "started_at")
    private Instant startedAt;

    @Column(name = "finished_at")
    private Instant finishedAt;

    public DeploymentStageLog() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getDeploymentId() { return deploymentId; }
    public void setDeploymentId(String deploymentId) { this.deploymentId = deploymentId; }
    public DeploymentStage getStage() { return stage; }
    public void setStage(DeploymentStage stage) { this.stage = stage; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getLog() { return log; }
    public void setLog(String log) { this.log = log; }
    public Instant getStartedAt() { return startedAt; }
    public void setStartedAt(Instant startedAt) { this.startedAt = startedAt; }
    public Instant getFinishedAt() { return finishedAt; }
    public void setFinishedAt(Instant finishedAt) { this.finishedAt = finishedAt; }
}
