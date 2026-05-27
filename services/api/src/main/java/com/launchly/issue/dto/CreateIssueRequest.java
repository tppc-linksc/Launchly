package com.launchly.issue.dto;

import jakarta.validation.constraints.NotBlank;

public record CreateIssueRequest(
    @NotBlank String title,
    String description,
    String priority,
    String assigneeId,
    String environmentId,
    String deploymentId,
    String testCaseId,
    String testRunCaseId,
    String dueDate
) {}
