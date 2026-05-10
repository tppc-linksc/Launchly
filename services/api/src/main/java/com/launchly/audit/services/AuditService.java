package com.launchly.audit.services;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.launchly.audit.entities.AuditLog;
import com.launchly.audit.enums.AuditAction;
import com.launchly.audit.repositories.AuditLogRepository;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.Map;

@Service
public class AuditService {
    private final AuditLogRepository auditLogRepository;
    private final ObjectMapper objectMapper;

    public AuditService(AuditLogRepository auditLogRepository, ObjectMapper objectMapper) {
        this.auditLogRepository = auditLogRepository;
        this.objectMapper = objectMapper;
    }

    @Async
    public void record(String userId, AuditAction action, String targetType, String targetId,
                       Map<String, Object> detail) {
        record(userId, null, action, targetType, targetId, detail);
    }

    @Async
    public void record(String userId, String workspaceId, AuditAction action, String targetType, String targetId,
                       Map<String, Object> detail) {
        AuditLog log = new AuditLog();
        log.setUserId(userId);
        log.setWorkspaceId(workspaceId);
        log.setAction(action);
        log.setTargetType(targetType);
        log.setTargetId(targetId);
        try {
            log.setDetail(detail != null ? objectMapper.writeValueAsString(detail) : null);
        } catch (Exception ignored) {}
        auditLogRepository.save(log);
    }

    public java.util.List<AuditLog> list(String workspaceId) {
        return auditLogRepository.findByWorkspaceIdOrderByCreatedAtDesc(workspaceId);
    }
}
