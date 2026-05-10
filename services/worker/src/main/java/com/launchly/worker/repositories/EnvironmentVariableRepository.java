package com.launchly.worker.repositories;

import com.launchly.worker.entities.EnvironmentVariable;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface EnvironmentVariableRepository extends JpaRepository<EnvironmentVariable, String> {
    List<EnvironmentVariable> findByEnvironmentId(String environmentId);
}
