package com.launchly.testcase.dto;

import com.launchly.testcase.entities.TestCase;
import java.time.Instant;

public record TestCaseResponse(
    String id,
    String projectId,
    String title,
    String module,
    String steps,
    String expectedResult,
    String priority,
    String tags,
    String ownerId,
    String status,
    Instant createdAt,
    Instant updatedAt
) {
    public static TestCaseResponse from(TestCase tc) {
        return new TestCaseResponse(
            tc.getId(), tc.getProjectId(), tc.getTitle(), tc.getModule(),
            tc.getSteps(), tc.getExpectedResult(),
            tc.getPriority() != null ? tc.getPriority().name() : null,
            tc.getTags(), tc.getOwnerId(),
            tc.getStatus() != null ? tc.getStatus().name() : null,
            tc.getCreatedAt(), tc.getUpdatedAt()
        );
    }
}
