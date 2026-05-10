package com.launchly.environment.entities;

import com.launchly.environment.enums.EnvironmentType;
import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "environments")
public class Environment {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(name = "project_id", nullable = false)
    private String projectId;

    @Column(nullable = false)
    private String name;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private EnvironmentType type;

    @Column
    private String url;

    @Column
    private String status = "inactive";

    @Column(name = "current_deployment_id")
    private String currentDeploymentId;

    @Column(nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(nullable = false)
    private Instant updatedAt = Instant.now();

    public Environment() {}

    public Environment(String projectId, String name, EnvironmentType type) {
        this.projectId = projectId;
        this.name = name;
        this.type = type;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public EnvironmentType getType() { return type; }
    public void setType(EnvironmentType type) { this.type = type; }
    public String getUrl() { return url; }
    public void setUrl(String url) { this.url = url; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public String getCurrentDeploymentId() { return currentDeploymentId; }
    public void setCurrentDeploymentId(String currentDeploymentId) { this.currentDeploymentId = currentDeploymentId; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
