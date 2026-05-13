package com.launchly.deployment.repositories;

import com.launchly.deployment.entities.Deployment;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface DeploymentRepository extends JpaRepository<Deployment, String> {
    List<Deployment> findByProjectIdOrderByCreatedAtDesc(String projectId);
    List<Deployment> findByEnvironmentIdOrderByCreatedAtDesc(String environmentId);

    long countByDeployTargetId(String deployTargetId);
}
