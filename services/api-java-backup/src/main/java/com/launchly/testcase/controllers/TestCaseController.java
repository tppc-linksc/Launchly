package com.launchly.testcase.controllers;

import com.launchly.testcase.dto.TestCaseRequest;
import com.launchly.testcase.dto.TestCaseResponse;
import com.launchly.testcase.services.TestService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/projects/{projectId}/test-cases")
public class TestCaseController {
    private final TestService testService;

    public TestCaseController(TestService testService) {
        this.testService = testService;
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('OWNER', 'ADMIN', 'DEVELOPER', 'TESTER')")
    public ResponseEntity<TestCaseResponse> create(@PathVariable String projectId,
                                                    @Valid @RequestBody TestCaseRequest request) {
        return ResponseEntity.ok(testService.createTestCase(projectId, request));
    }

    @GetMapping
    public ResponseEntity<List<TestCaseResponse>> list(@PathVariable String projectId) {
        return ResponseEntity.ok(testService.listTestCases(projectId));
    }

    @GetMapping("/{id}")
    public ResponseEntity<TestCaseResponse> get(@PathVariable String projectId, @PathVariable String id) {
        return ResponseEntity.ok(testService.getTestCase(id));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAnyRole('OWNER', 'ADMIN', 'DEVELOPER', 'TESTER')")
    public ResponseEntity<TestCaseResponse> update(@PathVariable String projectId, @PathVariable String id,
                                                    @Valid @RequestBody TestCaseRequest request) {
        return ResponseEntity.ok(testService.updateTestCase(id, request));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAnyRole('OWNER', 'ADMIN', 'DEVELOPER', 'TESTER')")
    public ResponseEntity<Void> delete(@PathVariable String projectId, @PathVariable String id) {
        testService.deleteTestCase(id);
        return ResponseEntity.noContent().build();
    }
}
