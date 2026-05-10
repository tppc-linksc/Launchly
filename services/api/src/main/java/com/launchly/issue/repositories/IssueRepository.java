package com.launchly.issue.repositories;

import com.launchly.issue.entities.Issue;
import com.launchly.issue.enums.IssueStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface IssueRepository extends JpaRepository<Issue, String> {
    List<Issue> findByProjectIdOrderByCreatedAtDesc(String projectId);
    List<Issue> findByProjectIdAndStatus(String projectId, IssueStatus status);
    List<Issue> findByAssigneeId(String assigneeId);
    List<Issue> findByProjectIdAndStatusIn(String projectId, List<IssueStatus> statuses);
}
