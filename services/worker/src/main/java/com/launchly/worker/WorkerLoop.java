package com.launchly.worker;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.launchly.worker.entities.Deployment;
import com.launchly.worker.entities.DeploymentStageLog;
import com.launchly.worker.entities.Task;
import com.launchly.worker.repositories.DeploymentRepository;
import com.launchly.worker.repositories.DeploymentStageLogRepository;
import com.launchly.worker.repositories.TaskRepository;
import com.launchly.worker.runner.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Component
public class WorkerLoop {
    private static final Logger log = LoggerFactory.getLogger(WorkerLoop.class);

    private final TaskRepository taskRepository;
    private final DeploymentRepository deploymentRepository;
    private final DeploymentStageLogRepository stageLogRepository;
    private final GitRunner gitRunner;
    private final ShellRunner shellRunner;
    private final DockerRunner dockerRunner;
    private final ObjectMapper objectMapper;

    public WorkerLoop(TaskRepository taskRepository,
                      DeploymentRepository deploymentRepository,
                      DeploymentStageLogRepository stageLogRepository,
                      GitRunner gitRunner,
                      ShellRunner shellRunner,
                      DockerRunner dockerRunner,
                      ObjectMapper objectMapper) {
        this.taskRepository = taskRepository;
        this.deploymentRepository = deploymentRepository;
        this.stageLogRepository = stageLogRepository;
        this.gitRunner = gitRunner;
        this.shellRunner = shellRunner;
        this.dockerRunner = dockerRunner;
        this.objectMapper = objectMapper;
    }

    @Scheduled(fixedDelayString = "${launchly.worker.polling-interval-ms:3000}")
    public void poll() {
        Optional<Task> claimed = claimNextTask();
        if (claimed.isEmpty()) return;

        Task task = claimed.get();
        log.info("Worker claimed task {} type={} refId={}", task.getId(), task.getTaskType(), task.getRefId());

        try {
            executeTask(task);
        } catch (Exception e) {
            log.error("Task {} execution failed: {}", task.getId(), e.getMessage(), e);
            task.setStatus("FAILED");
            task.setErrorMessage(e.getMessage());
            task.setFinishedAt(Instant.now());
            taskRepository.save(task);
        }
    }

    @Transactional
    public Optional<Task> claimNextTask() {
        return taskRepository.findNextPendingForUpdate().map(task -> {
            task.setStatus("RUNNING");
            task.setStartedAt(Instant.now());
            task.setAttempts(task.getAttempts() + 1);
            return taskRepository.save(task);
        });
    }

    private void executeTask(Task task) {
        Map<String, Object> payload = parsePayload(task.getPayload());
        String deploymentId = task.getRefId();

        String stage = mapTaskTypeToStage(task.getTaskType());
        if (stage == null) {
            task.setStatus("SUCCEEDED");
            task.setFinishedAt(Instant.now());
            taskRepository.save(task);
            return;
        }

        // Update deployment status to RUNNING on first task execution
        deploymentRepository.findById(deploymentId).ifPresent(deployment -> {
            if ("PENDING".equals(deployment.getStatus())) {
                deployment.setStatus("RUNNING");
                deployment.setStartedAt(Instant.now());
                deploymentRepository.save(deployment);
            }
        });

        // Write stage log RUNNING
        writeStageLog(deploymentId, stage, "RUNNING", "Starting " + task.getTaskType() + "...");

        // Dispatch to the appropriate runner
        RunnerContext context = new RunnerContext();
        context.setTaskType(task.getTaskType());
        context.setRefId(deploymentId);
        context.setPayload(payload);
        context.setStageLogCallback((status, logText) -> writeStageLog(deploymentId, stage, status, logText));

        RunnerResult result = dispatchRunner(task.getTaskType(), context);

        // Write stage log result
        String stageStatus = result.isSuccess() ? "SUCCEEDED" : "FAILED";
        String stageLog = result.isSuccess()
                ? result.getStdout()
                : result.getErrorMessage() + "\n" + result.getStdout();
        writeStageLogFinal(deploymentId, stage, stageStatus, stageLog);

        // Update task status
        if (result.isSuccess()) {
            task.setStatus("SUCCEEDED");
            enqueueNextStage(task);
            checkAndUpdateDeployment(deploymentId);
        } else {
            task.setStatus("FAILED");
            task.setErrorMessage(result.getErrorMessage());
            failDeployment(deploymentId, result.getErrorMessage());
        }
        task.setFinishedAt(Instant.now());
        taskRepository.save(task);
    }

    private RunnerResult dispatchRunner(String taskType, RunnerContext context) {
        return switch (taskType) {
            case "REPO_CLONE" -> gitRunner.execute(context);
            case "PROJECT_BUILD" -> shellRunner.execute(context);
            case "PROJECT_DEPLOY" -> dockerRunner.execute(context);
            case "HEALTH_CHECK" -> shellRunner.execute(context);
            default -> RunnerResult.failure("Unknown task type: " + taskType, "", "", -1);
        };
    }

    private void enqueueNextStage(Task completedTask) {
        String nextType = switch (completedTask.getTaskType()) {
            case "REPO_CLONE" -> "PROJECT_BUILD";
            case "PROJECT_BUILD" -> "PROJECT_DEPLOY";
            case "PROJECT_DEPLOY" -> "HEALTH_CHECK";
            default -> null;
        };
        if (nextType == null) {
            return;
        }

        Task next = new Task();
        next.setId(UUID.randomUUID().toString());
        next.setTaskType(nextType);
        next.setStatus("PENDING");
        next.setRefId(completedTask.getRefId());
        next.setPayload(completedTask.getPayload());
        next.setAttempts(0);
        next.setMaxAttempts(completedTask.getMaxAttempts());
        next.setCreatedAt(Instant.now());
        taskRepository.save(next);
    }

    private String mapTaskTypeToStage(String taskType) {
        return switch (taskType) {
            case "REPO_CLONE" -> "CLONE";
            case "PROJECT_BUILD" -> "BUILD";
            case "PROJECT_DEPLOY" -> "DEPLOY";
            case "HEALTH_CHECK" -> "HEALTH_CHECK";
            default -> null;
        };
    }

    private void writeStageLog(String deploymentId, String stage, String status, String logText) {
        List<DeploymentStageLog> logs = stageLogRepository.findByDeploymentIdOrderByStageAsc(deploymentId);
        for (DeploymentStageLog sl : logs) {
            if (sl.getStage().equals(stage)) {
                sl.setStatus(status);
                if (logText != null) {
                    sl.setLog((sl.getLog() == null ? "" : sl.getLog() + "\n") + logText);
                }
                if ("RUNNING".equals(status) && sl.getStartedAt() == null) {
                    sl.setStartedAt(Instant.now());
                }
                stageLogRepository.save(sl);
                return;
            }
        }
    }

    private void writeStageLogFinal(String deploymentId, String stage, String status, String logText) {
        List<DeploymentStageLog> logs = stageLogRepository.findByDeploymentIdOrderByStageAsc(deploymentId);
        for (DeploymentStageLog sl : logs) {
            if (sl.getStage().equals(stage)) {
                sl.setStatus(status);
                sl.setLog(CommandExecutor.sanitize(logText));
                sl.setFinishedAt(Instant.now());
                stageLogRepository.save(sl);
                return;
            }
        }
    }

    private void checkAndUpdateDeployment(String deploymentId) {
        List<DeploymentStageLog> logs = stageLogRepository.findByDeploymentIdOrderByStageAsc(deploymentId);
        boolean allSucceeded = logs.stream().allMatch(l -> "SUCCEEDED".equals(l.getStatus()));
        if (allSucceeded) {
            deploymentRepository.findById(deploymentId).ifPresent(deployment -> {
                deployment.setStatus("SUCCEEDED");
                deployment.setFinishedAt(Instant.now());
                deploymentRepository.save(deployment);
            });
        }
    }

    private void failDeployment(String deploymentId, String errorMessage) {
        deploymentRepository.findById(deploymentId).ifPresent(deployment -> {
            deployment.setStatus("FAILED");
            deployment.setErrorMessage(errorMessage);
            deployment.setFinishedAt(Instant.now());
            deploymentRepository.save(deployment);
        });
    }

    private Map<String, Object> parsePayload(String payload) {
        try {
            if (payload == null || payload.isEmpty()) return Map.of();
            return objectMapper.readValue(payload, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            log.warn("Failed to parse task payload: {}", e.getMessage());
            return Map.of();
        }
    }
}
