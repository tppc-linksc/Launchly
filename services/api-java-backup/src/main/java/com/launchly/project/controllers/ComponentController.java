package com.launchly.project.controllers;

import com.launchly.common.security.AuthContext;
import org.springframework.security.access.prepost.PreAuthorize;
import com.launchly.project.entities.Component;
import com.launchly.project.entities.Project;
import com.launchly.project.repositories.ComponentRepository;
import com.launchly.project.repositories.ProjectRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/projects/{projectId}/components")
public class ComponentController {
    private final ComponentRepository componentRepository;
    private final ProjectRepository projectRepository;

    public ComponentController(ComponentRepository componentRepository, ProjectRepository projectRepository) {
        this.componentRepository = componentRepository;
        this.projectRepository = projectRepository;
    }

    @GetMapping
    public ResponseEntity<List<Component>> list(@PathVariable String projectId) {
        return ResponseEntity.ok(componentRepository.findByProjectId(projectId));
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('OWNER', 'ADMIN', 'DEVELOPER')")
    public ResponseEntity<Component> create(@PathVariable String projectId, @RequestBody Map<String, Object> body) {
        Project project = projectRepository.findById(projectId).orElse(null);
        if (project == null) return ResponseEntity.notFound().build();

        Component component = new Component();
        component.setProjectId(projectId);
        component.setName((String) body.getOrDefault("name", "component"));
        component.setDescription((String) body.get("description"));
        component.setRepositoryUrl((String) body.get("repositoryUrl"));
        component.setBuildCommand((String) body.get("buildCommand"));
        component.setStartCommand((String) body.get("startCommand"));
        component.setHealthCheckPath((String) body.get("healthCheckPath"));
        if (body.containsKey("defaultPort")) {
            component.setDefaultPort((Integer) body.get("defaultPort"));
        }
        component.setDefault(false);

        return ResponseEntity.ok(componentRepository.save(component));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAnyRole('OWNER', 'ADMIN', 'DEVELOPER')")
    public ResponseEntity<Component> update(@PathVariable String projectId, @PathVariable String id, @RequestBody Map<String, Object> body) {
        Component component = componentRepository.findById(id).orElse(null);
        if (component == null || !component.getProjectId().equals(projectId)) return ResponseEntity.notFound().build();

        if (body.containsKey("name")) component.setName((String) body.get("name"));
        if (body.containsKey("description")) component.setDescription((String) body.get("description"));
        if (body.containsKey("repositoryUrl")) component.setRepositoryUrl((String) body.get("repositoryUrl"));
        if (body.containsKey("buildCommand")) component.setBuildCommand((String) body.get("buildCommand"));
        if (body.containsKey("startCommand")) component.setStartCommand((String) body.get("startCommand"));
        if (body.containsKey("healthCheckPath")) component.setHealthCheckPath((String) body.get("healthCheckPath"));
        if (body.containsKey("defaultPort")) component.setDefaultPort((Integer) body.get("defaultPort"));

        return ResponseEntity.ok(componentRepository.save(component));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAnyRole('OWNER', 'ADMIN')")
    public ResponseEntity<Void> delete(@PathVariable String projectId, @PathVariable String id) {
        Component component = componentRepository.findById(id).orElse(null);
        if (component == null || !component.getProjectId().equals(projectId)) return ResponseEntity.notFound().build();
        if (component.isDefault()) return ResponseEntity.status(409).body(null);

        componentRepository.delete(component);
        return ResponseEntity.ok().build();
    }
}
