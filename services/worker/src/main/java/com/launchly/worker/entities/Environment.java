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
}
