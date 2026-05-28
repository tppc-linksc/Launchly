package com.launchly.deployment.repositories;

import com.launchly.deployment.entities.Deployment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface DeploymentRepository extends JpaRepository<Deployment, String> {
    List<Deployment> findByProjectIdOrderByCreatedAtDesc(String projectId);
    List<Deployment> findByEnvironmentIdOrderByCreatedAtDesc(String environmentId);

    long countByDeployTargetId(String deployTargetId);

    @Query("SELECT d FROM Deployment d, Project p WHERE d.projectId = p.id AND p.workspaceId = :workspaceId ORDER BY d.createdAt DESC")
    List<Deployment> findByWorkspaceId(@Param("workspaceId") String workspaceId);
}
