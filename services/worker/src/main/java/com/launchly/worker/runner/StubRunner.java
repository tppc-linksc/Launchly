package com.launchly.worker.runner;

import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

import java.util.Random;

@Component
@Profile("dev")
public class StubRunner implements Runner {

    private final Random random = new Random();

    @Override
    public RunnerResult execute(RunnerContext context) {
        String taskType = context.getTaskType();
        String stageLogCallback = context.getStageLogCallback() != null ? "with callback" : "no callback";

        // Simulate work delay
        try {
            Thread.sleep(2000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return RunnerResult.failure("Interrupted", "", "", -1);
        }

        // 80% success rate
        boolean success = random.nextDouble() < 0.8;

        String stdout = "[STUB] Executed " + taskType + " for refId=" + context.getRefId() + " (" + stageLogCallback + ")\n"
                + "[STUB] Simulated output: everything looks good.\n";

        if (context.getStageLogCallback() != null) {
            context.getStageLogCallback().accept("RUNNING", "[STUB] Starting " + taskType + "...");
            if (success) {
                context.getStageLogCallback().accept("SUCCEEDED", stdout);
            } else {
                context.getStageLogCallback().accept("FAILED", "[STUB] Simulated failure for " + taskType);
            }
        }

        if (success) {
            return RunnerResult.success(stdout, "");
        } else {
            return RunnerResult.failure("[STUB] Simulated random failure for " + taskType, stdout, "", 1);
        }
    }
}
