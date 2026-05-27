package com.launchly.worker.entities;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "projects")
public class Project {
    @Id
    private String id;

    @Column(name = "workspace_id", nullable = false)
    private String workspaceId;

    @Column(nullable = false)
    private String name;

    @Column
    private String description;

    @Column(name = "project_type", nullable = false)
    private String projectType = "CUSTOM";

    @Column(name = "repository_url")
    private String repositoryUrl;

    @Column(name = "default_branch")
    private String defaultBranch = "main";

    @Column(name = "git_provider")
    private String gitProvider;

    @Column(name = "install_command")
    private String installCommand;

    @Column(name = "build_command")
    private String buildCommand;

    @Column(name = "start_command")
    private String startCommand;

    @Column(name = "test_command")
    private String testCommand;

    @Column(name = "health_check_path")
    private String healthCheckPath;

    @Column(name = "default_port")
    private Integer defaultPort;

    public Project() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getWorkspaceId() { return workspaceId; }
    public void setWorkspaceId(String workspaceId) { this.workspaceId = workspaceId; }
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getRepositoryUrl() { return repositoryUrl; }
    public void setRepositoryUrl(String repositoryUrl) { this.repositoryUrl = repositoryUrl; }
    public String getDefaultBranch() { return defaultBranch; }
    public void setDefaultBranch(String defaultBranch) { this.defaultBranch = defaultBranch; }
    public String getGitProvider() { return gitProvider; }
    public void setGitProvider(String gitProvider) { this.gitProvider = gitProvider; }
    public String getInstallCommand() { return installCommand; }
    public void setInstallCommand(String installCommand) { this.installCommand = installCommand; }
    public String getBuildCommand() { return buildCommand; }
    public void setBuildCommand(String buildCommand) { this.buildCommand = buildCommand; }
    public String getStartCommand() { return startCommand; }
    public void setStartCommand(String startCommand) { this.startCommand = startCommand; }
    public String getTestCommand() { return testCommand; }
    public void setTestCommand(String testCommand) { this.testCommand = testCommand; }
    public String getHealthCheckPath() { return healthCheckPath; }
    public void setHealthCheckPath(String healthCheckPath) { this.healthCheckPath = healthCheckPath; }
    public Integer getDefaultPort() { return defaultPort; }
    public void setDefaultPort(Integer defaultPort) { this.defaultPort = defaultPort; }
}
