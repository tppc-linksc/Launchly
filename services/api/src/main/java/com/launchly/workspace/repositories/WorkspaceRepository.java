package com.launchly.workspace.repositories;

import com.launchly.workspace.entities.Workspace;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WorkspaceRepository extends JpaRepository<Workspace, String> {
}
