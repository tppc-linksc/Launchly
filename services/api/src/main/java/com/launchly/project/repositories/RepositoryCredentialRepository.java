package com.launchly.project.repositories;

import com.launchly.project.entities.RepositoryCredential;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

public interface RepositoryCredentialRepository extends JpaRepository<RepositoryCredential, String> {
    Optional<RepositoryCredential> findByProjectId(String projectId);
}
