package com.launchly.testcase.repositories;

import com.launchly.testcase.entities.TestRun;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface TestRunRepository extends JpaRepository<TestRun, String> {
    List<TestRun> findByProjectIdOrderByCreatedAtDesc(String projectId);
    List<TestRun> findByDeploymentId(String deploymentId);
}
