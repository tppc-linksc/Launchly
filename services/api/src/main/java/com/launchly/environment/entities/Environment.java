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

    @Column(name = "deploy_mode")
    private String deployMode = "local";

    @Column
    private String host;

    @Column(name = "ssh_user")
    private String sshUser;

    @Column(name = "deploy_dir")
    private String deployDir;

    /** Worker-side parent directory for clone/build/compose when deploy_mode is local (optional). */
    @Column(name = "local_work_root")
    private String localWorkRoot;

    @Column(name = "external_port")
    private Integer externalPort;

    @Column(name = "data_strategy")
    private String dataStrategy = "isolated";

    @Column
    private Boolean enabled = true;

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
    public String getDeployMode() { return deployMode; }
    public void setDeployMode(String deployMode) { this.deployMode = deployMode; }
    public String getHost() { return host; }
    public void setHost(String host) { this.host = host; }
    public String getSshUser() { return sshUser; }
    public void setSshUser(String sshUser) { this.sshUser = sshUser; }
    public String getDeployDir() { return deployDir; }
    public void setDeployDir(String deployDir) { this.deployDir = deployDir; }
    public String getLocalWorkRoot() { return localWorkRoot; }
    public void setLocalWorkRoot(String localWorkRoot) { this.localWorkRoot = localWorkRoot; }
    public Integer getExternalPort() { return externalPort; }
    public void setExternalPort(Integer externalPort) { this.externalPort = externalPort; }
    public String getDataStrategy() { return dataStrategy; }
    public void setDataStrategy(String dataStrategy) { this.dataStrategy = dataStrategy; }
    public Boolean getEnabled() { return enabled; }
    public void setEnabled(Boolean enabled) { this.enabled = enabled; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
