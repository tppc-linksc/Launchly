package com.launchly.release.services;

import com.launchly.deployment.entities.Deployment;
import com.launchly.deployment.entities.DeploymentStageLog;
import com.launchly.deployment.enums.DeploymentStatus;
import com.launchly.deployment.repositories.DeploymentRepository;
import com.launchly.deployment.repositories.DeploymentStageLogRepository;
import com.launchly.issue.enums.IssueStatus;
import com.launchly.issue.repositories.IssueRepository;
import com.launchly.testcase.entities.TestCase;
import com.launchly.testcase.entities.TestRun;
import com.launchly.testcase.entities.TestRunCase;
import com.launchly.testcase.enums.Priority;
import com.launchly.testcase.enums.TestResult;
import com.launchly.testcase.repositories.TestCaseRepository;
import com.launchly.testcase.repositories.TestRunCaseRepository;
import com.launchly.testcase.repositories.TestRunRepository;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class GateCheckService {

    private final DeploymentRepository deploymentRepository;
    private final DeploymentStageLogRepository stageLogRepository;
    private final TestCaseRepository testCaseRepository;
    private final TestRunRepository testRunRepository;
    private final TestRunCaseRepository testRunCaseRepository;
    private final IssueRepository issueRepository;

    public GateCheckService(DeploymentRepository deploymentRepository,
                            DeploymentStageLogRepository stageLogRepository,
                            TestCaseRepository testCaseRepository,
                            TestRunRepository testRunRepository,
                            TestRunCaseRepository testRunCaseRepository,
                            IssueRepository issueRepository) {
        this.deploymentRepository = deploymentRepository;
        this.stageLogRepository = stageLogRepository;
        this.testCaseRepository = testCaseRepository;
        this.testRunRepository = testRunRepository;
        this.testRunCaseRepository = testRunCaseRepository;
        this.issueRepository = issueRepository;
    }

    public GateCheckResult checkGates(String projectId, String environmentId, String deploymentId) {
        List<GateCheckResult.GateResult> results = new ArrayList<>();

        // 1. Staging deploy success
        results.add(checkStagingDeploySuccess(deploymentId));

        // 2. Staging health check
        results.add(checkStagingHealthCheck(deploymentId));

        // 3. P0 tests passed
        results.add(checkP0TestsPassed(projectId));

        // 4. No open P0/P1 issues
        results.add(checkNoOpenP0P1Issues(projectId));

        // 5. Auto test passed
        results.add(checkAutoTestPassed(deploymentId));

        boolean allPassed = results.stream().allMatch(GateCheckResult.GateResult::passed);
        return new GateCheckResult(allPassed, results);
    }

    private GateCheckResult.GateResult checkStagingDeploySuccess(String deploymentId) {
        Deployment d = deploymentRepository.findById(deploymentId).orElse(null);
        boolean passed = d != null && d.getStatus() == DeploymentStatus.SUCCEEDED;
        return new GateCheckResult.GateResult("staging_deploy_success", passed,
            passed ? "Staging deployment succeeded" : "Staging deployment not successful");
    }

    private GateCheckResult.GateResult checkStagingHealthCheck(String deploymentId) {
        List<DeploymentStageLog> logs = stageLogRepository.findByDeploymentIdOrderByStageAsc(deploymentId);
        boolean passed = logs.stream()
            .anyMatch(l -> "HEALTH_CHECK".equals(l.getStage().name()) && "SUCCEEDED".equals(l.getStatus()));
        return new GateCheckResult.GateResult("staging_health_check", passed,
            passed ? "Health check passed" : "Health check not passed");
    }

    private GateCheckResult.GateResult checkP0TestsPassed(String projectId) {
        List<TestCase> p0Cases = testCaseRepository.findByProjectIdAndPriority(projectId, Priority.P0);
        if (p0Cases.isEmpty()) {
            return new GateCheckResult.GateResult("p0_tests_passed", true, "No P0 test cases configured");
        }

        Set<String> p0CaseIds = p0Cases.stream().map(TestCase::getId).collect(Collectors.toSet());
        List<TestRun> testRuns = testRunRepository.findByProjectIdOrderByCreatedAtDesc(projectId);
        List<TestRunCase> p0Results = testRuns.stream()
                .flatMap(run -> testRunCaseRepository.findByTestRunId(run.getId()).stream())
                .filter(runCase -> p0CaseIds.contains(runCase.getTestCaseId()))
                .toList();
        Set<String> coveredCaseIds = p0Results.stream().map(TestRunCase::getTestCaseId).collect(Collectors.toSet());
        boolean passed = coveredCaseIds.containsAll(p0CaseIds)
                && p0Results.stream().allMatch(runCase -> runCase.getResult() == TestResult.PASSED);
        return new GateCheckResult.GateResult("p0_tests_passed", passed,
            passed ? "All P0 tests passed" : "Some P0 tests failed");
    }

    private GateCheckResult.GateResult checkNoOpenP0P1Issues(String projectId) {
        List<IssueStatus> openStatuses = List.of(IssueStatus.OPEN, IssueStatus.ASSIGNED, IssueStatus.FIXING);
        List<String> highPriorities = List.of("P0", "P1");
        // Simplified check: look for any open issues
        long count = issueRepository.findByProjectIdAndStatusIn(projectId, openStatuses)
            .stream().filter(i -> highPriorities.contains(i.getPriority().name())).count();
        boolean passed = count == 0;
        return new GateCheckResult.GateResult("no_open_p0p1_issues", passed,
            passed ? "No open P0/P1 issues" : count + " open P0/P1 issues");
    }

    private GateCheckResult.GateResult checkAutoTestPassed(String deploymentId) {
        List<TestRun> runs = testRunRepository.findByDeploymentId(deploymentId);
        if (runs.isEmpty()) {
            return new GateCheckResult.GateResult("auto_test_passed", false,
                "No test run exists for deployment");
        }

        List<TestRunCase> cases = runs.stream()
                .flatMap(run -> testRunCaseRepository.findByTestRunId(run.getId()).stream())
                .toList();
        boolean passed = !cases.isEmpty() && cases.stream()
                .allMatch(runCase -> runCase.getResult() == TestResult.PASSED);
        return new GateCheckResult.GateResult("auto_test_passed", passed,
            passed ? "Auto test passed" : "Auto test has failed, blocked, skipped, or missing cases");
    }
}
