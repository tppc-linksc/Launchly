package com.launchly.worker.enums;

public enum TaskType {
    REPO_CLONE,
    REPO_PULL,
    PROJECT_BUILD,
    PROJECT_DEPLOY,
    HEALTH_CHECK,
    TEST_RUN,
    NOTIFICATION_SEND,
    PRODUCTION_ROLLBACK
}
