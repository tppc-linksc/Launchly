package com.launchly.environment.repositories;

import com.launchly.environment.entities.EnvironmentVariable;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface EnvironmentVariableRepository extends JpaRepository<EnvironmentVariable, String> {
    List<EnvironmentVariable> findByEnvironmentIdOrderByKeyAsc(String environmentId);
}
