package com.launchly.target.controllers;

import com.launchly.target.dto.DeployTargetCreateRequest;
import com.launchly.target.dto.DeployTargetDto;
import com.launchly.target.dto.DeployTargetUpdateRequest;
import com.launchly.target.dto.VerifyTargetResponse;
import com.launchly.target.services.DeployTargetService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.security.access.prepost.PreAuthorize;

import java.util.List;

@RestController
public class DeployTargetController {

    private final DeployTargetService service;

    public DeployTargetController(DeployTargetService service) {
        this.service = service;
    }

    @GetMapping("/api/projects/{projectId}/deploy-targets")
    public ResponseEntity<List<DeployTargetDto>> list(@PathVariable String projectId) {
        return ResponseEntity.ok(service.listByProject(projectId));
    }

    @PostMapping("/api/projects/{projectId}/deploy-targets")
    @PreAuthorize("hasAnyRole('OWNER', 'ADMIN', 'DEVELOPER')")
    public ResponseEntity<DeployTargetDto> create(@PathVariable String projectId,
                                                   @Valid @RequestBody DeployTargetCreateRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.create(projectId, request));
    }

    @GetMapping("/api/deploy-targets/{id}")
    public ResponseEntity<DeployTargetDto> get(@PathVariable String id) {
        return ResponseEntity.ok(service.getById(id));
    }

    @PatchMapping("/api/deploy-targets/{id}")
    @PreAuthorize("hasAnyRole('OWNER', 'ADMIN', 'DEVELOPER')")
    public ResponseEntity<DeployTargetDto> update(@PathVariable String id,
                                                   @Valid @RequestBody DeployTargetUpdateRequest request) {
        return ResponseEntity.ok(service.update(id, request));
    }

    @DeleteMapping("/api/deploy-targets/{id}")
    @PreAuthorize("hasAnyRole('OWNER', 'ADMIN')")
    public ResponseEntity<Void> delete(@PathVariable String id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/api/deploy-targets/{id}/verify")
    @PreAuthorize("hasAnyRole('OWNER', 'ADMIN', 'DEVELOPER')")
    public ResponseEntity<VerifyTargetResponse> verify(@PathVariable String id) {
        return ResponseEntity.ok(service.verify(id));
    }
}
