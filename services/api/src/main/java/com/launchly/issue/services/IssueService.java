package com.launchly.issue.services;

import com.launchly.issue.dto.*;
import com.launchly.issue.entities.Issue;
import com.launchly.issue.enums.IssueStatus;
import com.launchly.issue.repositories.IssueRepository;
import com.launchly.notification.enums.NotificationType;
import com.launchly.notification.services.NotificationService;
import com.launchly.testcase.enums.Priority;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class IssueService {
    private final IssueRepository issueRepository;
    private final NotificationService notificationService;

    private static final Set<IssueStatus> ALLOWED_CLOSERS = Set.of(
        IssueStatus.OPEN, IssueStatus.ASSIGNED, IssueStatus.FIXING, IssueStatus.FIXED, IssueStatus.REOPENED
    );

    public IssueService(IssueRepository issueRepository, NotificationService notificationService) {
        this.issueRepository = issueRepository;
        this.notificationService = notificationService;
    }

    public IssueResponse createIssue(String projectId, CreateIssueRequest request, String userId) {
        Issue issue = new Issue();
        issue.setProjectId(projectId);
        issue.setTitle(request.title());
        issue.setDescription(request.description());
        issue.setPriority(request.priority() != null ? Priority.valueOf(request.priority()) : Priority.P2);
        issue.setReporterId(userId);
        issue.setAssigneeId(request.assigneeId());
        issue.setEnvironmentId(request.environmentId());
        issue.setDeploymentId(request.deploymentId());
        issue.setTestCaseId(request.testCaseId());
        issue.setTestRunCaseId(request.testRunCaseId());
        if (request.dueDate() != null) {
            issue.setDueDate(Instant.parse(request.dueDate()));
        }
        issue.setStatus(IssueStatus.OPEN);

        // If assigned at creation, notify
        if (request.assigneeId() != null && !request.assigneeId().isEmpty()) {
            issue.setStatus(IssueStatus.ASSIGNED);
        }

        issue = issueRepository.save(issue);

        // Notify assignee
        if (issue.getAssigneeId() != null) {
            notificationService.create(issue.getAssigneeId(), NotificationType.ISSUE_ASSIGNED,
                "Issue 已指派: " + issue.getTitle(),
                "你被指派了一个 Issue: " + issue.getTitle(),
                issue.getId());
        }

        return IssueResponse.from(issue);
    }

    public IssueResponse createFromFailedTest(String testRunCaseId, String projectId, String deploymentId,
                                               String testCaseTitle, String userId) {
        CreateIssueRequest request = new CreateIssueRequest(
            "测试失败：" + (testCaseTitle != null ? testCaseTitle : "未知用例"),
            "该测试用例在部署 " + deploymentId + " 中执行失败，需要排查修复。",
            "P1", null, null, deploymentId, null, testRunCaseId, null
        );
        return createIssue(projectId, request, userId);
    }

    public List<IssueResponse> listIssues(String projectId, String status, String priority, String assigneeId) {
        List<Issue> issues;
        if (status != null && !status.isEmpty()) {
            issues = issueRepository.findByProjectIdAndStatus(projectId, IssueStatus.valueOf(status.toUpperCase()));
        } else {
            issues = issueRepository.findByProjectIdOrderByCreatedAtDesc(projectId);
        }

        return issues.stream()
            .filter(i -> priority == null || i.getPriority().name().equals(priority))
            .filter(i -> assigneeId == null || assigneeId.equals(i.getAssigneeId()))
            .map(IssueResponse::from)
            .collect(Collectors.toList());
    }

    public IssueResponse getIssue(String id) {
        Issue issue = issueRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Issue not found: " + id));
        return IssueResponse.from(issue);
    }

    public IssueResponse updateIssue(String id, UpdateIssueRequest request) {
        Issue issue = issueRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Issue not found: " + id));
        if (request.title() != null) issue.setTitle(request.title());
        if (request.description() != null) issue.setDescription(request.description());
        if (request.priority() != null) issue.setPriority(Priority.valueOf(request.priority()));
        if (request.assigneeId() != null) {
            issue.setAssigneeId(request.assigneeId());
            if (issue.getStatus() == IssueStatus.OPEN) {
                issue.setStatus(IssueStatus.ASSIGNED);
            }
            notificationService.create(issue.getAssigneeId(), NotificationType.ISSUE_ASSIGNED,
                "Issue 已指派: " + issue.getTitle(),
                "你被指派了一个 Issue: " + issue.getTitle(),
                issue.getId());
        }
        if (request.dueDate() != null) issue.setDueDate(Instant.parse(request.dueDate()));
        return IssueResponse.from(issueRepository.save(issue));
    }

    @Transactional
    public IssueResponse transition(String id, TransitionRequest request, String userId) {
        Issue issue = issueRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Issue not found: " + id));
        IssueStatus target = IssueStatus.valueOf(request.targetStatus());
        IssueStatus current = issue.getStatus();

        // Validate transition
        if (!isValidTransition(current, target)) {
            throw new IllegalStateException(
                "Invalid transition from " + current + " to " + target);
        }

        // Validate constraints
        if (target == IssueStatus.ASSIGNED && issue.getAssigneeId() == null) {
            throw new IllegalStateException("Must assign an assignee before ASSIGNED status");
        }
        if (target == IssueStatus.FIXED) {
            if (request.fixedCommitSha() == null || request.fixedCommitSha().isEmpty()) {
                throw new IllegalStateException("Must provide fixedCommitSha when marking FIXED");
            }
            issue.setFixedCommitSha(request.fixedCommitSha());
        }
        if (target == IssueStatus.FIXING) {
            issue.setAssigneeId(userId);
        }

        issue.setStatus(target);

        // Timestamps
        if (target == IssueStatus.CLOSED) {
            issue.setClosedAt(Instant.now());
        }

        issue = issueRepository.save(issue);

        // Send notifications
        sendTransitionNotification(issue, target, userId);

        return IssueResponse.from(issue);
    }

    private boolean isValidTransition(IssueStatus from, IssueStatus to) {
        return switch (from) {
            case OPEN -> to == IssueStatus.ASSIGNED || to == IssueStatus.CLOSED;
            case ASSIGNED -> to == IssueStatus.FIXING || to == IssueStatus.CLOSED;
            case FIXING -> to == IssueStatus.FIXED || to == IssueStatus.ASSIGNED;
            case FIXED -> to == IssueStatus.CLOSED || to == IssueStatus.REOPENED;
            case REOPENED -> to == IssueStatus.ASSIGNED || to == IssueStatus.CLOSED;
            case CLOSED -> false;
        };
    }

    private void sendTransitionNotification(Issue issue, IssueStatus target, String userId) {
        switch (target) {
            case FIXED -> {
                if (issue.getReporterId() != null) {
                    notificationService.create(issue.getReporterId(), NotificationType.ISSUE_FIXED,
                        "Issue 已修复: " + issue.getTitle(),
                        "Developer 已将 Issue 标记为 FIXED，请复测。commit: " + issue.getFixedCommitSha(),
                        issue.getId());
                }
            }
            case CLOSED -> {
                if (issue.getAssigneeId() != null) {
                    notificationService.create(issue.getAssigneeId(), NotificationType.ISSUE_CLOSED,
                        "Issue 已关闭: " + issue.getTitle(),
                        "Issue 已被关闭。",
                        issue.getId());
                }
            }
            case REOPENED -> {
                if (issue.getAssigneeId() != null) {
                    notificationService.create(issue.getAssigneeId(), NotificationType.ISSUE_REOPENED,
                        "Issue 已重新打开: " + issue.getTitle(),
                        "复测失败，Issue 已重新打开。请继续修复。",
                        issue.getId());
                }
            }
            case ASSIGNED -> {
                if (issue.getAssigneeId() != null && !issue.getAssigneeId().equals(userId)) {
                    notificationService.create(issue.getAssigneeId(), NotificationType.ISSUE_ASSIGNED,
                        "Issue 已指派: " + issue.getTitle(),
                        "你被指派了一个 Issue: " + issue.getTitle(),
                        issue.getId());
                }
            }
        }
    }
}
