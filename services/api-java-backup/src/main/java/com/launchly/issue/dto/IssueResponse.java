package com.launchly.issue.dto;

import com.launchly.issue.entities.Issue;
import java.time.Instant;

public record IssueResponse(
    String id,
    String projectId,
    String environmentId,
    String deploymentId,
    String testCaseId,
    String testRunCaseId,
    String title,
    String description,
    String priority,
    String status,
    String reporterId,
    String assigneeId,
    String fixedCommitSha,
    Instant createdAt,
    Instant updatedAt,
    Instant closedAt,
    Instant dueDate
) {
    public static IssueResponse from(Issue issue) {
        return new IssueResponse(
            issue.getId(), issue.getProjectId(), issue.getEnvironmentId(), issue.getDeploymentId(),
            issue.getTestCaseId(), issue.getTestRunCaseId(),
            issue.getTitle(), issue.getDescription(),
            issue.getPriority() != null ? issue.getPriority().name() : null,
            issue.getStatus() != null ? issue.getStatus().name() : null,
            issue.getReporterId(), issue.getAssigneeId(), issue.getFixedCommitSha(),
            issue.getCreatedAt(), issue.getUpdatedAt(), issue.getClosedAt(), issue.getDueDate()
        );
    }
}
