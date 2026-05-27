package com.launchly.audit.controllers;

import com.launchly.audit.entities.AuditLog;
import com.launchly.audit.services.AuditService;
import com.launchly.common.security.AuthContext;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
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

    @GetMapping("/export")
    public ResponseEntity<byte[]> export(@RequestParam(required = false) String workspaceId) {
        List<AuditLog> logs = auditService.list(workspaceId != null ? workspaceId : "");

        StringBuilder csv = new StringBuilder();
        csv.append("ID,用户ID,操作,资源类型,资源ID,详情,时间\n");
        for (AuditLog log : logs) {
            csv.append(escapeCsv(log.getId())).append(",");
            csv.append(escapeCsv(log.getUserId())).append(",");
            csv.append(escapeCsv(log.getAction())).append(",");
            csv.append(escapeCsv(log.getResourceType())).append(",");
            csv.append(escapeCsv(log.getResourceId())).append(",");
            csv.append(escapeCsv(log.getDetails())).append(",");
            csv.append(escapeCsv(log.getCreatedAt() != null ? log.getCreatedAt().toString() : "")).append("\n");
        }

        byte[] bytes = csv.toString().getBytes(StandardCharsets.UTF_8);
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType("text/csv"));
        headers.setContentDispositionFormData("attachment", "audit-logs.csv");

        return ResponseEntity.ok().headers(headers).body(bytes);
    }

    private String escapeCsv(String value) {
        if (value == null) return "";
        if (value.contains(",") || value.contains("\"") || value.contains("\n")) {
            return "\"" + value.replace("\"", "\"\"") + "\"";
        }
        return value;
    }
}
