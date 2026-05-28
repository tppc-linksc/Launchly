package com.launchly.environment.controllers;

import com.launchly.auth.entities.User;
import com.launchly.common.security.AuthContext;
import com.launchly.environment.dto.UpdateEnvironmentRequest;
import com.launchly.environment.entities.Environment;
import com.launchly.environment.repositories.EnvironmentRepository;
import com.launchly.project.entities.Project;
import com.launchly.project.repositories.ProjectRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/environments")
public class EnvironmentController {
    private final EnvironmentRepository environmentRepository;
    private final ProjectRepository projectRepository;

    public EnvironmentController(EnvironmentRepository environmentRepository,
                                  ProjectRepository projectRepository) {
        this.environmentRepository = environmentRepository;
        this.projectRepository = projectRepository;
    }

    @GetMapping
    public ResponseEntity<List<Environment>> listByProject(@RequestParam String projectId) {
        return ResponseEntity.ok(environmentRepository.findByProjectIdOrderByTypeAsc(projectId));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAnyRole('OWNER', 'ADMIN', 'DEVELOPER')")
    public ResponseEntity<Environment> update(@PathVariable String id,
                                               @RequestBody UpdateEnvironmentRequest request) {
        Environment env = environmentRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("环境不存在: " + id));

        // Ownership check: environment must belong to a project in current workspace
        Project project = projectRepository.findById(env.getProjectId())
                .orElseThrow(() -> new IllegalArgumentException("项目不存在: " + env.getProjectId()));
        if (!project.getWorkspaceId().equals(AuthContext.workspaceId())) {
            throw new IllegalArgumentException("无权更新此环境");
        }

        // Do not allow changing type or projectId
        if (request.name() != null) env.setName(request.name());
        if (request.url() != null) env.setUrl(request.url());
        if (request.deployMode() != null) env.setDeployMode(request.deployMode());
        if (request.host() != null) env.setHost(request.host());
        if (request.sshUser() != null) env.setSshUser(request.sshUser());
        if (request.deployDir() != null) env.setDeployDir(request.deployDir());
        if (request.localWorkRoot() != null) env.setLocalWorkRoot(request.localWorkRoot());
        if (request.externalPort() != null) env.setExternalPort(request.externalPort());
        if (request.dataStrategy() != null) env.setDataStrategy(request.dataStrategy());
        if (request.enabled() != null) env.setEnabled(request.enabled());

        return ResponseEntity.ok(environmentRepository.save(env));
    }
}
