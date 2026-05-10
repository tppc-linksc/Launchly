package com.launchly.environment.repositories;

import com.launchly.environment.entities.Environment;
import com.launchly.environment.enums.EnvironmentType;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface EnvironmentRepository extends JpaRepository<Environment, String> {
    List<Environment> findByProjectIdOrderByTypeAsc(String projectId);
    Optional<Environment> findByProjectIdAndType(String projectId, EnvironmentType type);
}
