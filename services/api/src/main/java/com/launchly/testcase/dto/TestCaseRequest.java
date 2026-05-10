package com.launchly.testcase.dto;

import jakarta.validation.constraints.NotBlank;

public record TestCaseRequest(
    @NotBlank String title,
    String module,
    String steps,
    String expectedResult,
    String priority,
    String tags,
    String ownerId
) {}
