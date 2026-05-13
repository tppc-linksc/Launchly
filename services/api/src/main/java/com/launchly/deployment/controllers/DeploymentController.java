package com.launchly.deployment.controllers;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.launchly.common.security.AuthContext;
import com.launchly.deployment.dto.CreateDeploymentRequest;
import com.launchly.deployment.dto.DeploymentResponse;
import com.launchly.deployment.entities.Deployment;
import com.launchly.deployment.entities.DeploymentStageLog;
import com.launchly.deployment.repositories.DeploymentRepository;
import com.launchly.deployment.repositories.DeploymentStageLogRepository;
import com.launchly.deployment.services.DeploymentService;
import jakarta.validation.Valid;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@RestController
@RequestMapping("/api/deployments")
public class DeploymentController {
    private static final Logger log = LoggerFactory.getLogger(DeploymentController.class);
    private static final long SSE_TIMEOUT = 30 * 60 * 1000L; // 30 minutes

    private final DeploymentService deploymentService;
    private final DeploymentStageLogRepository stageLogRepository;
    private final DeploymentRepository deploymentRepository;
    private final ObjectMapper objectMapper;
    private final ExecutorService sseExecutor = Executors.newCachedThreadPool();

    public DeploymentController(DeploymentService deploymentService,
                                DeploymentStageLogRepository stageLogRepository,
                                DeploymentRepository deploymentRepository,
                                ObjectMapper objectMapper) {
        this.deploymentService = deploymentService;
        this.stageLogRepository = stageLogRepository;
        this.deploymentRepository = deploymentRepository;
        this.objectMapper = objectMapper;
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

    @GetMapping(value = "/{id}/logs/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamLogs(@PathVariable String id) {
        SseEmitter emitter = new SseEmitter(SSE_TIMEOUT);

        sseExecutor.execute(() -> {
            try {
                String lastLogSnapshot = "";
                boolean completed = false;

                while (!completed) {
                    Deployment deployment = deploymentRepository.findById(id).orElse(null);
                    if (deployment == null) {
                        emitter.send(SseEmitter.event()
                                .name("error")
                                .data("{\"error\":\"Deployment not found\"}"));
                        emitter.complete();
                        return;
                    }

                    List<DeploymentStageLog> logs = stageLogRepository.findByDeploymentIdOrderByStageAsc(id);
                    String currentSnapshot = objectMapper.writeValueAsString(logs);

                    if (!currentSnapshot.equals(lastLogSnapshot)) {
                        lastLogSnapshot = currentSnapshot;
                        emitter.send(SseEmitter.event()
                                .name("logs")
                                .data(currentSnapshot));
                    }

                    // Send deployment status update
                    emitter.send(SseEmitter.event()
                            .name("status")
                            .data(objectMapper.writeValueAsString(Map.of(
                                    "status", deployment.getStatus().name(),
                                    "errorMessage", deployment.getErrorMessage() != null ? deployment.getErrorMessage() : ""
                            ))));

                    String status = deployment.getStatus().name();
                    if ("SUCCEEDED".equals(status) || "FAILED".equals(status) || "CANCELED".equals(status)) {
                        completed = true;
                    } else {
                        Thread.sleep(2000);
                    }
                }

                emitter.complete();
            } catch (Exception e) {
                log.error("SSE stream error for deployment {}: {}", id, e.getMessage());
                try {
                    emitter.send(SseEmitter.event()
                            .name("error")
                            .data("{\"error\":\"" + e.getMessage() + "\"}"));
                } catch (Exception ignored) {
                }
                emitter.completeWithError(e);
            }
        });

        emitter.onCompletion(() -> log.debug("SSE stream completed for deployment {}", id));
        emitter.onTimeout(() -> log.debug("SSE stream timed out for deployment {}", id));

        return emitter;
    }

    @PostMapping("/{id}/rollback")
    public ResponseEntity<DeploymentResponse> rollback(@PathVariable String id) {
        return ResponseEntity.ok(deploymentService.rollback(id, AuthContext.userId()));
    }
}
