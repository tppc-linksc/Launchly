package com.launchly.worker.repositories;

import com.launchly.worker.entities.DeployTarget;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DeployTargetRepository extends JpaRepository<DeployTarget, String> {
}
