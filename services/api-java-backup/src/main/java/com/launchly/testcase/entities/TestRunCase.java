package com.launchly.testcase.entities;

import com.launchly.testcase.enums.TestResult;
import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "test_run_cases")
public class TestRunCase {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(name = "test_run_id", nullable = false)
    private String testRunId;

    @Column(name = "test_case_id", nullable = false)
    private String testCaseId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private TestResult result = TestResult.SKIPPED;

    @Column(columnDefinition = "TEXT")
    private String notes;

    @Column(name = "executed_by")
    private String executedBy;

    @Column(name = "executed_at")
    private Instant executedAt;

    public TestRunCase() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getTestRunId() { return testRunId; }
    public void setTestRunId(String testRunId) { this.testRunId = testRunId; }
    public String getTestCaseId() { return testCaseId; }
    public void setTestCaseId(String testCaseId) { this.testCaseId = testCaseId; }
    public TestResult getResult() { return result; }
    public void setResult(TestResult result) { this.result = result; }
    public String getNotes() { return notes; }
    public void setNotes(String notes) { this.notes = notes; }
    public String getExecutedBy() { return executedBy; }
    public void setExecutedBy(String executedBy) { this.executedBy = executedBy; }
    public Instant getExecutedAt() { return executedAt; }
    public void setExecutedAt(Instant executedAt) { this.executedAt = executedAt; }
}
