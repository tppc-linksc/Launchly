package com.launchly.project.repositories;

import com.launchly.project.entities.Project;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface ProjectRepository extends JpaRepository<Project, String> {
    List<Project> findByWorkspaceIdOrderByCreatedAtDesc(String workspaceId);
    long countByWorkspaceId(String workspaceId);
}
