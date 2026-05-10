package com.launchly.issue.dto;

public record UpdateIssueRequest(
    String title,
    String description,
    String priority,
    String assigneeId,
    String dueDate
) {}
