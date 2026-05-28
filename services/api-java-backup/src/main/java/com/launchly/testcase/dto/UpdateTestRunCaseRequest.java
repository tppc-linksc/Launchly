package com.launchly.testcase.dto;

public record UpdateTestRunCaseRequest(
    String result,
    String notes,
    String executedBy
) {}
