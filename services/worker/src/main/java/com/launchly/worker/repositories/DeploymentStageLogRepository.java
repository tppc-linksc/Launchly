package com.launchly.worker.repositories;

import com.launchly.worker.entities.DeploymentStageLog;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DeploymentStageLogRepository extends JpaRepository<DeploymentStageLog, String> {
    List<DeploymentStageLog> findByDeploymentIdOrderByStageAsc(String deploymentId);
}
