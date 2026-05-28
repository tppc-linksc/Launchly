package com.launchly.testcase.services;

import com.launchly.testcase.dto.*;
import com.launchly.testcase.entities.TestCase;
import com.launchly.testcase.entities.TestRun;
import com.launchly.testcase.entities.TestRunCase;
import com.launchly.testcase.enums.Priority;
import com.launchly.testcase.enums.TestCaseStatus;
import com.launchly.testcase.enums.TestResult;
import com.launchly.testcase.enums.TestRunStatus;
import com.launchly.testcase.repositories.TestCaseRepository;
import com.launchly.testcase.repositories.TestRunCaseRepository;
import com.launchly.testcase.repositories.TestRunRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.stream.Collectors;

@Service
public class TestService {
    private final TestCaseRepository testCaseRepository;
    private final TestRunRepository testRunRepository;
    private final TestRunCaseRepository testRunCaseRepository;

    public TestService(TestCaseRepository testCaseRepository,
                       TestRunRepository testRunRepository,
                       TestRunCaseRepository testRunCaseRepository) {
        this.testCaseRepository = testCaseRepository;
        this.testRunRepository = testRunRepository;
        this.testRunCaseRepository = testRunCaseRepository;
    }

    // --- TestCase ---
    public TestCaseResponse createTestCase(String projectId, TestCaseRequest request) {
        TestCase tc = new TestCase();
        tc.setProjectId(projectId);
        tc.setTitle(request.title());
        tc.setModule(request.module());
        tc.setSteps(request.steps());
        tc.setExpectedResult(request.expectedResult());
        tc.setPriority(request.priority() != null ? Priority.valueOf(request.priority()) : Priority.P2);
        tc.setTags(request.tags());
        tc.setOwnerId(request.ownerId());
        return TestCaseResponse.from(testCaseRepository.save(tc));
    }

    public List<TestCaseResponse> listTestCases(String projectId) {
        return testCaseRepository.findByProjectIdOrderByCreatedAtDesc(projectId)
                .stream().map(TestCaseResponse::from).collect(Collectors.toList());
    }

    public TestCaseResponse getTestCase(String id) {
        return TestCaseResponse.from(testCaseRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("TestCase not found: " + id)));
    }

    public TestCaseResponse updateTestCase(String id, TestCaseRequest request) {
        TestCase tc = testCaseRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("TestCase not found: " + id));
        tc.setTitle(request.title());
        tc.setModule(request.module());
        tc.setSteps(request.steps());
        tc.setExpectedResult(request.expectedResult());
        if (request.priority() != null) tc.setPriority(Priority.valueOf(request.priority()));
        tc.setTags(request.tags());
        tc.setOwnerId(request.ownerId());
        return TestCaseResponse.from(testCaseRepository.save(tc));
    }

    public void deleteTestCase(String id) {
        testCaseRepository.deleteById(id);
    }

    // --- TestRun ---
    @Transactional
    public TestRunResponse createTestRun(String deploymentId, String projectId, String environmentId, String userId) {
        TestRun tr = new TestRun();
        tr.setDeploymentId(deploymentId);
        tr.setProjectId(projectId);
        tr.setEnvironmentId(environmentId);
        tr.setCreatedBy(userId);
        tr.setStatus(TestRunStatus.PENDING);
        tr = testRunRepository.save(tr);

        // Auto-create TestRunCase for all ACTIVE test cases
        List<TestCase> activeCases = testCaseRepository.findByProjectIdAndStatus(
                projectId, TestCaseStatus.ACTIVE);
        for (TestCase tc : activeCases) {
            TestRunCase trc = new TestRunCase();
            trc.setTestRunId(tr.getId());
            trc.setTestCaseId(tc.getId());
            trc.setResult(TestResult.SKIPPED);
            testRunCaseRepository.save(trc);
        }

        return TestRunResponse.from(tr);
    }

    public TestRunResponse getTestRun(String id) {
        return TestRunResponse.from(testRunRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("TestRun not found: " + id)));
    }

    public List<TestRunResponse> listTestRuns(String projectId) {
        return testRunRepository.findByProjectIdOrderByCreatedAtDesc(projectId)
                .stream().map(TestRunResponse::from).collect(Collectors.toList());
    }

    public List<TestRunCaseResponse> getTestRunCases(String testRunId) {
        return testRunCaseRepository.findByTestRunId(testRunId)
                .stream().map(TestRunCaseResponse::from).collect(Collectors.toList());
    }

    public TestRunCaseResponse updateTestRunCase(String testRunId, String caseId,
                                                  UpdateTestRunCaseRequest request) {
        return updateTestRunCase(testRunId, caseId, request, request.executedBy());
    }

    public TestRunCaseResponse updateTestRunCase(String testRunId, String caseId,
                                                  UpdateTestRunCaseRequest request, String userId) {
        TestRunCase trc = testRunCaseRepository.findById(caseId)
                .orElseThrow(() -> new IllegalArgumentException("TestRunCase not found: " + caseId));
        if (!trc.getTestRunId().equals(testRunId)) {
            throw new IllegalArgumentException("TestRunCase does not belong to this TestRun");
        }
        if (request.result() != null) {
            trc.setResult(TestResult.valueOf(request.result()));
        }
        trc.setNotes(request.notes());
        trc.setExecutedBy(userId);
        trc.setExecutedAt(Instant.now());
        trc = testRunCaseRepository.save(trc);

        // Check if all cases are done
        List<TestRunCase> allCases = testRunCaseRepository.findByTestRunId(testRunId);
        boolean allDone = allCases.stream().noneMatch(c -> c.getResult() == TestResult.SKIPPED);
        if (allDone) {
            testRunRepository.findById(testRunId).ifPresent(tr -> {
                tr.setStatus(TestRunStatus.COMPLETED);
                tr.setFinishedAt(Instant.now());
                testRunRepository.save(tr);
            });
        }

        return TestRunCaseResponse.from(trc);
    }
}
