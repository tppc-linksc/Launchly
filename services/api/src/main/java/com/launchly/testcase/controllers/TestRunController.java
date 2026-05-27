package com.launchly.testcase.controllers;

import com.launchly.common.security.AuthContext;
import com.launchly.testcase.dto.TestRunCaseResponse;
import com.launchly.testcase.dto.TestRunResponse;
import com.launchly.testcase.dto.UpdateTestRunCaseRequest;
import com.launchly.testcase.services.TestService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api")
public class TestRunController {
    private final TestService testService;

    public TestRunController(TestService testService) {
        this.testService = testService;
    }

    @PostMapping("/deployments/{deploymentId}/test-runs")
    public ResponseEntity<TestRunResponse> create(@PathVariable String deploymentId,
                                                   @RequestParam String projectId,
                                                   @RequestParam(required = false) String environmentId) {
        return ResponseEntity.ok(testService.createTestRun(deploymentId, projectId,
                environmentId != null ? environmentId : "", AuthContext.userId()));
    }

    @GetMapping("/test-runs/{id}")
    public ResponseEntity<TestRunResponse> get(@PathVariable String id) {
        return ResponseEntity.ok(testService.getTestRun(id));
    }

    @GetMapping("/test-runs")
    public ResponseEntity<List<TestRunResponse>> list(@RequestParam String projectId) {
        return ResponseEntity.ok(testService.listTestRuns(projectId));
    }

    @GetMapping("/test-runs/{id}/cases")
    public ResponseEntity<List<TestRunCaseResponse>> cases(@PathVariable String id) {
        return ResponseEntity.ok(testService.getTestRunCases(id));
    }

    @PutMapping("/test-runs/{testRunId}/cases/{caseId}")
    public ResponseEntity<TestRunCaseResponse> updateCase(@PathVariable String testRunId,
                                                           @PathVariable String caseId,
                                                           @RequestBody UpdateTestRunCaseRequest request) {
        return ResponseEntity.ok(testService.updateTestRunCase(testRunId, caseId, request, AuthContext.userId()));
    }
}
