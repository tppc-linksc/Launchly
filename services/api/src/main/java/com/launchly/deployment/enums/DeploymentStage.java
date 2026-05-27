package com.launchly.deployment.enums;

public enum DeploymentStage {
    CLONE(1),
    BUILD(2),
    DEPLOY(3),
    HEALTH_CHECK(4);

    private final int stepOrder;

    DeploymentStage(int stepOrder) {
        this.stepOrder = stepOrder;
    }

    public int getStepOrder() {
        return stepOrder;
    }
}
