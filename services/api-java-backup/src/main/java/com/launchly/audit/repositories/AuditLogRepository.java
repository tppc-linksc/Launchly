package com.launchly.audit.repositories;

import com.launchly.audit.entities.AuditLog;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface AuditLogRepository extends JpaRepository<AuditLog, String> {
    List<AuditLog> findByWorkspaceIdOrderByCreatedAtDesc(String workspaceId);
    List<AuditLog> findByUserIdOrderByCreatedAtDesc(String userId);
}
