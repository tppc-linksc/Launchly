package com.launchly.issue.controllers;

import com.launchly.common.security.AuthContext;
import com.launchly.issue.dto.*;
import com.launchly.issue.services.IssueService;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/projects/{projectId}/issues")
public class IssueController {
    private final IssueService issueService;

    public IssueController(IssueService issueService) {
        this.issueService = issueService;
    }

    @PostMapping
    public ResponseEntity<IssueResponse> create(@PathVariable String projectId,
                                                 @Valid @RequestBody CreateIssueRequest request) {
        return ResponseEntity.ok(issueService.createIssue(projectId, request, AuthContext.userId()));
    }

    @PostMapping("/from-failed-test")
    public ResponseEntity<IssueResponse> createFromFailedTest(@PathVariable String projectId,
                                                               @RequestParam String testRunCaseId,
                                                               @RequestParam String deploymentId,
                                                               @RequestParam(required = false) String testCaseTitle) {
        return ResponseEntity.ok(issueService.createFromFailedTest(
            testRunCaseId, projectId, deploymentId, testCaseTitle, AuthContext.userId()));
    }

    @GetMapping
    public ResponseEntity<List<IssueResponse>> list(@PathVariable String projectId,
                                                     @RequestParam(required = false) String status,
                                                     @RequestParam(required = false) String priority,
                                                     @RequestParam(required = false) String assigneeId) {
        return ResponseEntity.ok(issueService.listIssues(projectId, status, priority, assigneeId));
    }

    @GetMapping("/{id}")
    public ResponseEntity<IssueResponse> get(@PathVariable String projectId, @PathVariable String id) {
        return ResponseEntity.ok(issueService.getIssue(id));
    }

    @PutMapping("/{id}")
    public ResponseEntity<IssueResponse> update(@PathVariable String projectId, @PathVariable String id,
                                                 @RequestBody UpdateIssueRequest request) {
        return ResponseEntity.ok(issueService.updateIssue(id, request));
    }

    @PutMapping("/{id}/status")
    public ResponseEntity<IssueResponse> transition(@PathVariable String projectId, @PathVariable String id,
                                                     @Valid @RequestBody TransitionRequest request) {
        return ResponseEntity.ok(issueService.transition(id, request, AuthContext.userId()));
    }
}
