package com.launchly.release.controllers;

import com.launchly.common.security.AuthContext;
import com.launchly.release.dto.GateExemptionRequest;
import com.launchly.release.dto.ReleaseRequest;
import com.launchly.release.dto.ReleaseResponse;
import com.launchly.release.entities.GateExemption;
import com.launchly.release.services.GateCheckResult;
import com.launchly.release.services.ReleaseService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/projects/{projectId}/releases")
public class ReleaseController {
    private final ReleaseService releaseService;

    public ReleaseController(ReleaseService releaseService) {
        this.releaseService = releaseService;
    }

    @PostMapping
    public ResponseEntity<ReleaseResponse> create(@PathVariable String projectId,
                                                   @Valid @RequestBody ReleaseRequest request) {
        return ResponseEntity.ok(releaseService.createRelease(projectId, request, AuthContext.userId()));
    }

    @GetMapping
    public ResponseEntity<List<ReleaseResponse>> list(@PathVariable String projectId) {
        return ResponseEntity.ok(releaseService.listReleases(projectId));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ReleaseResponse> get(@PathVariable String projectId, @PathVariable String id) {
        return ResponseEntity.ok(releaseService.getRelease(id));
    }

    @GetMapping("/{id}/gates")
    public ResponseEntity<GateCheckResult> gates(@PathVariable String projectId, @PathVariable String id) {
        return ResponseEntity.ok(releaseService.getGateStatus(id));
    }

    @PutMapping("/{id}/publish")
    public ResponseEntity<ReleaseResponse> publish(@PathVariable String projectId, @PathVariable String id) {
        return ResponseEntity.ok(releaseService.publish(id, AuthContext.userId()));
    }

    @PostMapping("/{id}/gates/{gateName}/exempt")
    public ResponseEntity<GateExemption> exempt(@PathVariable String projectId,
                                                 @PathVariable String id,
                                                 @PathVariable String gateName,
                                                 @Valid @RequestBody GateExemptionRequest request) {
        return ResponseEntity.ok(releaseService.exemptGate(id, gateName, request, AuthContext.userId()));
    }

    @GetMapping("/{id}/exemptions")
    public ResponseEntity<List<GateExemption>> exemptions(@PathVariable String projectId,
                                                           @PathVariable String id) {
        return ResponseEntity.ok(releaseService.getExemptions(id));
    }
}
