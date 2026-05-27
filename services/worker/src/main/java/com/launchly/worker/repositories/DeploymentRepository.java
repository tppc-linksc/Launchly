package com.launchly.worker.repositories;

import com.launchly.worker.entities.Deployment;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DeploymentRepository extends JpaRepository<Deployment, String> {
}
