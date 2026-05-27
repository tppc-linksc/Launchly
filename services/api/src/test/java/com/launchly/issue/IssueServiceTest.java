package com.launchly.issue;

import com.launchly.issue.dto.*;
import com.launchly.issue.entities.Issue;
import com.launchly.issue.enums.IssueStatus;
import com.launchly.issue.repositories.IssueRepository;
import com.launchly.issue.services.IssueService;
import com.launchly.notification.services.NotificationService;
import com.launchly.testcase.enums.Priority;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class IssueServiceTest {

    @Mock
    private IssueRepository issueRepository;

    @Mock
    private NotificationService notificationService;

    @InjectMocks
    private IssueService issueService;

    private Issue savedIssue;

    @BeforeEach
    void setUp() {
        savedIssue = new Issue();
        savedIssue.setId("issue-1");
        savedIssue.setProjectId("project-1");
        savedIssue.setTitle("测试 Issue");
        savedIssue.setDescription("测试描述");
        savedIssue.setPriority(Priority.P2);
        savedIssue.setStatus(IssueStatus.OPEN);
        savedIssue.setReporterId("user-1");
    }

    @Test
    void shouldCreateIssueAsOpen() {
        CreateIssueRequest request = new CreateIssueRequest(
            "测试标题", "描述", "P1", null, null, null, null, null, null
        );

        when(issueRepository.save(any(Issue.class))).thenAnswer(inv -> {
            Issue i = inv.getArgument(0);
            i.setId("new-issue-id");
            return i;
        });

        IssueResponse response = issueService.createIssue("project-1", request, "user-1");

        assertNotNull(response);
        assertEquals("测试标题", response.title());
        assertEquals("P1", response.priority());
        assertEquals("OPEN", response.status());
        assertEquals("user-1", response.reporterId());
    }

    @Test
    void shouldCreateIssueAsAssignedWhenAssigneeExists() {
        CreateIssueRequest request = new CreateIssueRequest(
            "测试标题", "描述", "P1", "user-2", null, null, null, null, null
        );

        when(issueRepository.save(any(Issue.class))).thenAnswer(inv -> {
            Issue i = inv.getArgument(0);
            i.setId("new-issue-id");
            return i;
        });

        IssueResponse response = issueService.createIssue("project-1", request, "user-1");

        assertEquals("ASSIGNED", response.status());
        assertEquals("user-2", response.assigneeId());
    }

    @Test
    void shouldTransitionFromOpenToAssigned() {
        savedIssue.setStatus(IssueStatus.OPEN);
        savedIssue.setAssigneeId("user-2");
        when(issueRepository.findById("issue-1")).thenReturn(Optional.of(savedIssue));
        when(issueRepository.save(any(Issue.class))).thenReturn(savedIssue);

        IssueResponse response = issueService.transition("issue-1",
            new TransitionRequest("ASSIGNED", null), "user-1");

        assertEquals("ASSIGNED", response.status());
    }

    @Test
    void shouldRejectTransitionFromOpenToNonAllowedStatus() {
        savedIssue.setStatus(IssueStatus.OPEN);
        when(issueRepository.findById("issue-1")).thenReturn(Optional.of(savedIssue));

        assertThrows(IllegalStateException.class, () -> {
            issueService.transition("issue-1",
                new TransitionRequest("FIXING", null), "user-1");
        });
    }

    @Test
    void shouldRequireCommitShaWhenFixingToFixed() {
        savedIssue.setStatus(IssueStatus.FIXING);
        when(issueRepository.findById("issue-1")).thenReturn(Optional.of(savedIssue));

        assertThrows(IllegalStateException.class, () -> {
            issueService.transition("issue-1",
                new TransitionRequest("FIXED", null), "user-1");
        });
    }

    @Test
    void shouldTransitionFromFixedToClosed() {
        savedIssue.setStatus(IssueStatus.FIXED);
        savedIssue.setFixedCommitSha("abc123");
        when(issueRepository.findById("issue-1")).thenReturn(Optional.of(savedIssue));
        when(issueRepository.save(any(Issue.class))).thenReturn(savedIssue);

        IssueResponse response = issueService.transition("issue-1",
            new TransitionRequest("CLOSED", null), "user-1");

        assertEquals("CLOSED", response.status());
        assertNotNull(response.closedAt());
    }

    @Test
    void shouldNotTransitionFromClosedStatus() {
        savedIssue.setStatus(IssueStatus.CLOSED);
        when(issueRepository.findById("issue-1")).thenReturn(Optional.of(savedIssue));

        assertThrows(IllegalStateException.class, () -> {
            issueService.transition("issue-1",
                new TransitionRequest("REOPENED", null), "user-1");
        });
    }

    @Test
    void shouldCompleteFullLifecycle() {
        // OPEN → ASSIGNED
        savedIssue.setId("lifecycle-1");
        savedIssue.setStatus(IssueStatus.OPEN);
        savedIssue.setAssigneeId("user-2");
        savedIssue.setReporterId("user-1");
        when(issueRepository.findById("lifecycle-1")).thenReturn(Optional.of(savedIssue));
        when(issueRepository.save(any(Issue.class))).thenReturn(savedIssue);

        IssueResponse r1 = issueService.transition("lifecycle-1",
            new TransitionRequest("ASSIGNED", null), "user-1");
        assertEquals("ASSIGNED", r1.status());

        // ASSIGNED → FIXING
        savedIssue.setStatus(IssueStatus.ASSIGNED);
        IssueResponse r2 = issueService.transition("lifecycle-1",
            new TransitionRequest("FIXING", null), "user-2");
        assertEquals("FIXING", r2.status());

        // FIXING → FIXED
        savedIssue.setStatus(IssueStatus.FIXING);
        IssueResponse r3 = issueService.transition("lifecycle-1",
            new TransitionRequest("FIXED", "abc123"), "user-2");
        assertEquals("FIXED", r3.status());
        assertEquals("abc123", r3.fixedCommitSha());

        // FIXED → CLOSED
        savedIssue.setStatus(IssueStatus.FIXED);
        IssueResponse r4 = issueService.transition("lifecycle-1",
            new TransitionRequest("CLOSED", null), "user-1");
        assertEquals("CLOSED", r4.status());
        assertNotNull(r4.closedAt());
    }

    @Test
    void shouldThrowWhenIssueNotFound() {
        when(issueRepository.findById("non-existent")).thenReturn(Optional.empty());

        assertThrows(IllegalArgumentException.class, () -> {
            issueService.getIssue("non-existent");
        });
    }

    @Test
    void shouldSendNotificationOnAssign() {
        savedIssue.setStatus(IssueStatus.OPEN);
        savedIssue.setAssigneeId("user-2");
        savedIssue.setReporterId("user-1");
        when(issueRepository.findById("issue-1")).thenReturn(Optional.of(savedIssue));
        when(issueRepository.save(any(Issue.class))).thenReturn(savedIssue);

        issueService.transition("issue-1",
            new TransitionRequest("ASSIGNED", null), "user-1");

        verify(notificationService, atLeastOnce()).create(
            eq("user-2"),
            any(),
            any(),
            any(),
            eq("issue-1")
        );
    }
}
