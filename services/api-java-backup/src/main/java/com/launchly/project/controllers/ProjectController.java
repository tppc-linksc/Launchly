package com.launchly.project.controllers;

import com.launchly.common.security.AuthContext;
import org.springframework.security.access.prepost.PreAuthorize;
import com.launchly.project.dto.CreateProjectRequest;
import com.launchly.project.dto.ProjectResponse;
import com.launchly.project.dto.RepositoryHintsResponse;
import com.launchly.project.services.ProjectService;
import com.launchly.project.services.RepositoryHintsService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/projects")
public class ProjectController {
    private final ProjectService projectService;
    private final RepositoryHintsService repositoryHintsService;

    public ProjectController(ProjectService projectService, RepositoryHintsService repositoryHintsService) {
        this.projectService = projectService;
        this.repositoryHintsService = repositoryHintsService;
    }

    @GetMapping("/repository-hints")
    public ResponseEntity<RepositoryHintsResponse> repositoryHints(
            @RequestParam String repositoryUrl,
            @RequestParam(required = false) String branch) {
        String b = (branch == null || branch.isBlank()) ? "main" : branch.trim();
        return ResponseEntity.ok(
                repositoryHintsService.infer(repositoryUrl.trim(), b)
                        .orElse(RepositoryHintsResponse.defaults())
        );
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('OWNER', 'ADMIN', 'DEVELOPER')")
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
    @PreAuthorize("hasAnyRole('OWNER', 'ADMIN', 'DEVELOPER')")
    public ResponseEntity<ProjectResponse> update(@PathVariable String id, @Valid @RequestBody CreateProjectRequest request) {
        return ResponseEntity.ok(projectService.update(id, request, AuthContext.workspaceId(), AuthContext.userId()));
    }
}
