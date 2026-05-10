package com.launchly.release.repositories;

import com.launchly.release.entities.Release;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ReleaseRepository extends JpaRepository<Release, String> {
    List<Release> findByProjectIdOrderByCreatedAtDesc(String projectId);
    List<Release> findByProjectIdAndEnvironmentIdOrderByCreatedAtDesc(String projectId, String environmentId);
}
