package com.launchly.testcase.repositories;

import com.launchly.testcase.entities.TestCase;
import com.launchly.testcase.enums.Priority;
import com.launchly.testcase.enums.TestCaseStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface TestCaseRepository extends JpaRepository<TestCase, String> {
    List<TestCase> findByProjectIdOrderByCreatedAtDesc(String projectId);
    List<TestCase> findByProjectIdAndStatus(String projectId, TestCaseStatus status);
    List<TestCase> findByProjectIdAndModule(String projectId, String module);
    List<TestCase> findByProjectIdAndPriority(String projectId, Priority priority);
}
