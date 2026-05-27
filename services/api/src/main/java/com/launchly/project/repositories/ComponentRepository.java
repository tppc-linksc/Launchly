package com.launchly.project.repositories;

import com.launchly.project.entities.Component;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface ComponentRepository extends JpaRepository<Component, String> {
    List<Component> findByProjectId(String projectId);
    Optional<Component> findByProjectIdAndIsDefaultTrue(String projectId);
}
