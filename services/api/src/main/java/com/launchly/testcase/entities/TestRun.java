package com.launchly.testcase.entities;

import com.launchly.testcase.enums.TestRunStatus;
import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "test_runs")
public class TestRun {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(name = "project_id", nullable = false)
    private String projectId;

    @Column(name = "deployment_id", nullable = false)
    private String deploymentId;

    @Column(name = "environment_id")
    private String environmentId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private TestRunStatus status = TestRunStatus.PENDING;

    @Column(name = "created_by")
    private String createdBy;

    @Column(nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "finished_at")
    private Instant finishedAt;

    public TestRun() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }
    public String getDeploymentId() { return deploymentId; }
    public void setDeploymentId(String deploymentId) { this.deploymentId = deploymentId; }
    public String getEnvironmentId() { return environmentId; }
    public void setEnvironmentId(String environmentId) { this.environmentId = environmentId; }
    public TestRunStatus getStatus() { return status; }
    public void setStatus(TestRunStatus status) { this.status = status; }
    public String getCreatedBy() { return createdBy; }
    public void setCreatedBy(String createdBy) { this.createdBy = createdBy; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getFinishedAt() { return finishedAt; }
    public void setFinishedAt(Instant finishedAt) { this.finishedAt = finishedAt; }
}
