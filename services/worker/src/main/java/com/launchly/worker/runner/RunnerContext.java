package com.launchly.worker.runner;

import java.util.Map;
import java.util.function.BiConsumer;

public class RunnerContext {
    private String taskType;
    private String refId;
    private Map<String, Object> payload;
    private BiConsumer<String, String> stageLogCallback;

    public RunnerContext() {}

    public RunnerContext(String taskType, String refId, Map<String, Object> payload,
                         BiConsumer<String, String> stageLogCallback) {
        this.taskType = taskType;
        this.refId = refId;
        this.payload = payload;
        this.stageLogCallback = stageLogCallback;
    }

    public String getTaskType() { return taskType; }
    public void setTaskType(String taskType) { this.taskType = taskType; }
    public String getRefId() { return refId; }
    public void setRefId(String refId) { this.refId = refId; }
    public Map<String, Object> getPayload() { return payload; }
    public void setPayload(Map<String, Object> payload) { this.payload = payload; }
    public BiConsumer<String, String> getStageLogCallback() { return stageLogCallback; }
    public void setStageLogCallback(BiConsumer<String, String> stageLogCallback) { this.stageLogCallback = stageLogCallback; }
}
