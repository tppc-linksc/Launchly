package com.launchly.testcase.repositories;

import com.launchly.testcase.entities.TestRunCase;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface TestRunCaseRepository extends JpaRepository<TestRunCase, String> {
    List<TestRunCase> findByTestRunId(String testRunId);
}
