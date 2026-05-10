package com.launchly.project.controllers;

import com.launchly.common.security.AuthContext;
import com.launchly.project.dto.CreateProjectRequest;
import com.launchly.project.dto.ProjectResponse;
import com.launchly.project.services.ProjectService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/projects")
public class ProjectController {
    private final ProjectService projectService;

    public ProjectController(ProjectService projectService) {
        this.projectService = projectService;
    }

    @PostMapping
    public ResponseEntity<ProjectResponse> create(@Valid @RequestBody CreateProjectRequest request) {
        return ResponseEntity.ok(projectService.create(request, AuthContext.workspaceId(), AuthContext.userId()));
    }

    @GetMapping
    public ResponseEntity<List<ProjectResponse>> list() {
        return ResponseEntity.ok(projectService.listByWorkspace(AuthContext.workspaceId()));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ProjectResponse> get(@PathVariable String id) {
        return ResponseEntity.ok(projectService.getById(id, AuthContext.workspaceId()));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ProjectResponse> update(@PathVariable String id, @Valid @RequestBody CreateProjectRequest request) {
        return ResponseEntity.ok(projectService.update(id, request, AuthContext.workspaceId(), AuthContext.userId()));
    }
}
