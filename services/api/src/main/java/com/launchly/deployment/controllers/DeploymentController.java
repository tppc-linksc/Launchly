package com.launchly.deployment.controllers;

import com.launchly.common.security.AuthContext;
import com.launchly.deployment.dto.CreateDeploymentRequest;
import com.launchly.deployment.dto.DeploymentResponse;
import com.launchly.deployment.entities.DeploymentStageLog;
import com.launchly.deployment.repositories.DeploymentStageLogRepository;
import com.launchly.deployment.services.DeploymentService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/deployments")
public class DeploymentController {
    private final DeploymentService deploymentService;
    private final DeploymentStageLogRepository stageLogRepository;

    public DeploymentController(DeploymentService deploymentService,
                                DeploymentStageLogRepository stageLogRepository) {
        this.deploymentService = deploymentService;
        this.stageLogRepository = stageLogRepository;
    }

    @PostMapping
    public ResponseEntity<DeploymentResponse> create(@Valid @RequestBody CreateDeploymentRequest request) {
        return ResponseEntity.ok(deploymentService.create(request, AuthContext.userId()));
    }

    @GetMapping
    public ResponseEntity<List<DeploymentResponse>> list(
            @RequestParam(required = false) String projectId,
            @RequestParam(required = false) String environmentId) {
        if (environmentId != null) {
            return ResponseEntity.ok(deploymentService.listByEnvironment(environmentId));
        }
        if (projectId != null) {
            return ResponseEntity.ok(deploymentService.listByProject(projectId));
        }
        return ResponseEntity.ok(List.of());
    }

    @GetMapping("/{id}")
    public ResponseEntity<DeploymentResponse> get(@PathVariable String id) {
        return ResponseEntity.ok(deploymentService.getById(id));
    }

    @GetMapping("/{id}/logs")
    public ResponseEntity<List<DeploymentStageLog>> logs(@PathVariable String id) {
        return ResponseEntity.ok(stageLogRepository.findByDeploymentIdOrderByStageAsc(id));
    }

    @PostMapping("/{id}/rollback")
    public ResponseEntity<DeploymentResponse> rollback(@PathVariable String id) {
        return ResponseEntity.ok(deploymentService.rollback(id, AuthContext.userId()));
    }
}
