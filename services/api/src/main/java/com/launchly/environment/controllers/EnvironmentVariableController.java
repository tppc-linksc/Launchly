package com.launchly.environment.controllers;

import com.launchly.common.security.AuthContext;
import com.launchly.environment.dto.CreateEnvironmentVariableRequest;
import com.launchly.environment.dto.EnvironmentVariableResponse;
import com.launchly.environment.services.EnvironmentVariableService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/environments/{environmentId}/variables")
public class EnvironmentVariableController {
    private final EnvironmentVariableService variableService;

    public EnvironmentVariableController(EnvironmentVariableService variableService) {
        this.variableService = variableService;
    }

    @GetMapping
    public ResponseEntity<List<EnvironmentVariableResponse>> list(@PathVariable String environmentId) {
        return ResponseEntity.ok(variableService.listByEnvironment(environmentId));
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('OWNER', 'ADMIN', 'DEVELOPER')")
    public ResponseEntity<EnvironmentVariableResponse> create(@PathVariable String environmentId,
                                                               @Valid @RequestBody CreateEnvironmentVariableRequest request) {
        return ResponseEntity.ok(variableService.create(environmentId, request, AuthContext.userId(), AuthContext.workspaceId()));
    }

    @DeleteMapping("/{variableId}")
    @PreAuthorize("hasAnyRole('OWNER', 'ADMIN', 'DEVELOPER')")
    public ResponseEntity<Void> delete(@PathVariable String environmentId, @PathVariable String variableId) {
        variableService.delete(variableId, AuthContext.userId(), AuthContext.workspaceId());
        return ResponseEntity.noContent().build();
    }
}
