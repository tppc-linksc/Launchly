package com.launchly.target.repositories;

import com.launchly.target.entities.DeployTarget;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DeployTargetRepository extends JpaRepository<DeployTarget, String> {
    List<DeployTarget> findByProjectIdOrderByCreatedAtDesc(String projectId);
}
