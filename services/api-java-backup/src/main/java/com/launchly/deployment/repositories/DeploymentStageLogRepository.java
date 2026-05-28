package com.launchly.deployment.repositories;

import com.launchly.deployment.entities.DeploymentStageLog;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface DeploymentStageLogRepository extends JpaRepository<DeploymentStageLog, String> {
    List<DeploymentStageLog> findByDeploymentIdOrderByStepOrderAsc(String deploymentId);
}
