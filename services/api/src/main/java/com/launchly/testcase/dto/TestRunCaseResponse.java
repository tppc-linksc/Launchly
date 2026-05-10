package com.launchly.testcase.dto;

import com.launchly.testcase.entities.TestRunCase;
import java.time.Instant;

public record TestRunCaseResponse(
    String id,
    String testRunId,
    String testCaseId,
    String result,
    String notes,
    String executedBy,
    Instant executedAt
) {
    public static TestRunCaseResponse from(TestRunCase trc) {
        return new TestRunCaseResponse(
            trc.getId(), trc.getTestRunId(), trc.getTestCaseId(),
            trc.getResult() != null ? trc.getResult().name() : null,
            trc.getNotes(), trc.getExecutedBy(), trc.getExecutedAt()
        );
    }
}
