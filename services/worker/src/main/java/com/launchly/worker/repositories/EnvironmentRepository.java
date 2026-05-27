package com.launchly.worker.repositories;

import com.launchly.worker.entities.Environment;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface EnvironmentRepository extends JpaRepository<Environment, String> {
    Optional<Environment> findByProjectIdAndType(String projectId, String type);
}
