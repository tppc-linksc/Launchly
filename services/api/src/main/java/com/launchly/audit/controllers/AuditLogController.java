package com.launchly.audit.controllers;

import com.launchly.audit.entities.AuditLog;
import com.launchly.audit.services.AuditService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/audit-logs")
public class AuditLogController {
    private final AuditService auditService;

    public AuditLogController(AuditService auditService) {
        this.auditService = auditService;
    }

    @GetMapping
    public ResponseEntity<List<AuditLog>> list(@RequestParam(required = false) String workspaceId) {
        return ResponseEntity.ok(auditService.list(workspaceId != null ? workspaceId : ""));
    }
}
