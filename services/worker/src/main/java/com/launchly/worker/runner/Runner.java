package com.launchly.worker.runner;

public interface Runner {
    RunnerResult execute(RunnerContext context);
}
