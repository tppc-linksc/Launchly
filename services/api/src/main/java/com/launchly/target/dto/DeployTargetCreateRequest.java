package com.launchly.target.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

public class DeployTargetCreateRequest {

    @NotBlank
    private String projectId;

    @NotBlank
    private String name;

    @NotBlank
    private String host;

    @NotNull
    @Min(1) @Max(65535)
    private Integer port = 22;

    @NotBlank
    private String username;

    @NotBlank
    private String authMethod = "KEY";

    @JsonProperty(access = JsonProperty.Access.WRITE_ONLY)
    private String privateKey;

    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getHost() { return host; }
    public void setHost(String host) { this.host = host; }

    public Integer getPort() { return port; }
    public void setPort(Integer port) { this.port = port; }

    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }

    public String getAuthMethod() { return authMethod; }
    public void setAuthMethod(String authMethod) { this.authMethod = authMethod; }

    public String getPrivateKey() { return privateKey; }
    public void setPrivateKey(String privateKey) { this.privateKey = privateKey; }
}
