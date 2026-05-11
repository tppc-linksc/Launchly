package com.launchly.worker.entities;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "environments")
public class Environment {
    @Id
    private String id;

    @Column(name = "project_id", nullable = false)
    private String projectId;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private String type;

    @Column
    private String url;

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

    @Column(name = "external_port")
    private Integer externalPort;

    @Column(name = "data_strategy")
    private String dataStrategy = "isolated";

    @Column
    private Boolean enabled = true;

    @Column
    private String status = "inactive";

    public Environment() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getType() { return type; }
    public void setType(String type) { this.type = type; }
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
    public Integer getExternalPort() { return externalPort; }
    public void setExternalPort(Integer externalPort) { this.externalPort = externalPort; }
    public String getDataStrategy() { return dataStrategy; }
    public void setDataStrategy(String dataStrategy) { this.dataStrategy = dataStrategy; }
    public Boolean getEnabled() { return enabled; }
    public void setEnabled(Boolean enabled) { this.enabled = enabled; }
}
