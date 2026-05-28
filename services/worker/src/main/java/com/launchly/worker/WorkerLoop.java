package com.launchly.worker;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.launchly.worker.entities.DeployTarget;
import com.launchly.worker.entities.Deployment;
import com.launchly.worker.entities.DeploymentStageLog;
import com.launchly.worker.entities.Environment;
import com.launchly.worker.entities.Task;
import com.launchly.worker.repositories.DeployTargetRepository;
import com.launchly.worker.repositories.DeploymentRepository;
import com.launchly.worker.repositories.DeploymentStageLogRepository;
import com.launchly.worker.repositories.EnvironmentRepository;
import com.launchly.worker.repositories.TaskRepository;
import com.launchly.worker.runner.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
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
    private final EnvironmentRepository environmentRepository;
    private final DeployTargetRepository deployTargetRepository;
    private final GitRunner gitRunner;
    private final ShellRunner shellRunner;
    private final DockerRunner dockerRunner;
    private final RunnerFactory runnerFactory;
    private final ObjectMapper objectMapper;

    @Value("${launchly.worker.task-timeout-minutes:30}")
    private long taskTimeoutMinutes;

    public WorkerLoop(TaskRepository taskRepository,
                      DeploymentRepository deploymentRepository,
                      DeploymentStageLogRepository stageLogRepository,
                      EnvironmentRepository environmentRepository,
                      DeployTargetRepository deployTargetRepository,
                      GitRunner gitRunner,
                      ShellRunner shellRunner,
                      DockerRunner dockerRunner,
                      RunnerFactory runnerFactory,
                      ObjectMapper objectMapper) {
        this.taskRepository = taskRepository;
        this.deploymentRepository = deploymentRepository;
        this.stageLogRepository = stageLogRepository;
        this.environmentRepository = environmentRepository;
        this.deployTargetRepository = deployTargetRepository;
        this.gitRunner = gitRunner;
        this.shellRunner = shellRunner;
        this.dockerRunner = dockerRunner;
        this.runnerFactory = runnerFactory;
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
            handleTaskFailure(task, e.getMessage());
        }
    }

    /**
     * 定期检测卡死的 RUNNING 任务，超过 timeout 则标记失败或重试。
     * 每 60 秒执行一次。
     */
    @Scheduled(fixedDelay = 60000)
    @Transactional
    public void timeoutStuckTasks() {
        Instant cutoff = Instant.now().minus(taskTimeoutMinutes, ChronoUnit.MINUTES);
        List<Task> stuckTasks = taskRepository.findStuckRunningTasks(cutoff);

        for (Task task : stuckTasks) {
            log.warn("Task {} has been RUNNING for more than {} minutes, marking as timed out",
                    task.getId(), taskTimeoutMinutes);

            task.setStatus("FAILED");
            task.setErrorMessage("任务超时：已运行超过 " + taskTimeoutMinutes + " 分钟");
            task.setFinishedAt(Instant.now());
            taskRepository.save(task);

            // Try retry if attempts remain
            if (task.getAttempts() < task.getMaxAttempts()) {
                log.info("Retrying task {} (attempt {}/{})", task.getId(), task.getAttempts() + 1, task.getMaxAttempts());
                retryTask(task);
            } else {
                failDeployment(task.getRefId(), "任务超时失败，已无重试次数");
            }
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

        // When deploying via Docker Compose, skip the BUILD stage (build is handled by compose)
        if ("PROJECT_DEPLOY".equals(task.getTaskType())) {
            markBuildStageSkipped(deploymentId);
        }

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
            task.setFinishedAt(Instant.now());
            taskRepository.save(task);
            enqueueNextStage(task);
            checkAndUpdateDeployment(deploymentId);
        } else {
            handleTaskFailure(task, result.getErrorMessage());
        }
    }

    /**
     * 统一的失败处理：检查重试次数，决定是重试还是彻底失败。
     */
    private void handleTaskFailure(Task task, String errorMessage) {
        if (task.getAttempts() < task.getMaxAttempts()) {
            log.info("Task {} failed, retrying (attempt {}/{}): {}",
                    task.getId(), task.getAttempts(), task.getMaxAttempts(), errorMessage);

            // Write retry info to stage log
            String stage = mapTaskTypeToStage(task.getTaskType());
            if (stage != null) {
                writeStageLog(task.getRefId(), stage, "RUNNING",
                        "Retry attempt " + task.getAttempts() + "/" + task.getMaxAttempts() + ": " + errorMessage);
            }

            retryTask(task);
        } else {
            log.error("Task {} failed permanently after {} attempts: {}",
                    task.getId(), task.getAttempts(), errorMessage);

            task.setStatus("FAILED");
            task.setErrorMessage(errorMessage);
            task.setFinishedAt(Instant.now());
            taskRepository.save(task);

            failDeployment(task.getRefId(), errorMessage);
        }
    }

    /**
     * 重新入队一个可重试的任务：重置状态为 PENDING，保留原始 payload。
     */
    private void retryTask(Task failedTask) {
        failedTask.setStatus("PENDING");
        failedTask.setErrorMessage(null);
        failedTask.setStartedAt(null);
        failedTask.setFinishedAt(null);
        // Keep attempts as-is so next claimNextTask increments it
        taskRepository.save(failedTask);
    }

    private RunnerResult dispatchRunner(String taskType, RunnerContext context) {
        Runner runner = runnerFactory.getRunner(taskType, context);
        if (runner == null) {
            return RunnerResult.failure("Unknown task type: " + taskType, "", "", -1);
        }
        return runner.execute(context);
    }

    private void enqueueNextStage(Task completedTask) {
        String nextType = switch (completedTask.getTaskType()) {
            case "REPO_CLONE" -> "PROJECT_DEPLOY";
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

    /**
     * Mark the BUILD stage as SKIPPED when the pipeline bypasses PROJECT_BUILD
     * (e.g., for Docker Compose deployments where the Dockerfile handles the build).
     */
    private void markBuildStageSkipped(String deploymentId) {
        List<DeploymentStageLog> logs = stageLogRepository.findByDeploymentIdOrderByStepOrderAsc(deploymentId);
        for (DeploymentStageLog sl : logs) {
            if ("BUILD".equals(sl.getStage()) && "PENDING".equals(sl.getStatus())) {
                sl.setStatus("SKIPPED");
                sl.setLog("Skipped: Docker Compose handles the build");
                sl.setStartedAt(Instant.now());
                sl.setFinishedAt(Instant.now());
                stageLogRepository.save(sl);
                break;
            }
        }
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
        List<DeploymentStageLog> logs = stageLogRepository.findByDeploymentIdOrderByStepOrderAsc(deploymentId);
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
        List<DeploymentStageLog> logs = stageLogRepository.findByDeploymentIdOrderByStepOrderAsc(deploymentId);
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
        List<DeploymentStageLog> logs = stageLogRepository.findByDeploymentIdOrderByStepOrderAsc(deploymentId);
        boolean allSucceeded = logs.stream().allMatch(l ->
                "SUCCEEDED".equals(l.getStatus()) || "SKIPPED".equals(l.getStatus()));
        if (allSucceeded) {
            deploymentRepository.findById(deploymentId).ifPresent(deployment -> {
                deployment.setStatus("SUCCEEDED");
                deployment.setFinishedAt(Instant.now());

                // Compute and store access URL
                if (deployment.getAccessUrl() == null || deployment.getAccessUrl().isBlank()) {
                    String accessUrl = computeAccessUrl(deployment);
                    if (accessUrl != null) {
                        deployment.setAccessUrl(accessUrl);
                    }
                }

                deploymentRepository.save(deployment);

                // Update environment status
                environmentRepository.findById(deployment.getEnvironmentId()).ifPresent(env -> {
                    env.setStatus("active");
                    env.setCurrentDeploymentId(deploymentId);
                    if (env.getUrl() == null || env.getUrl().isBlank()) {
                        if (deployment.getAccessUrl() != null) {
                            env.setUrl(deployment.getAccessUrl());
                        } else if ("local".equals(env.getDeployMode())) {
                            env.setUrl("http://localhost:" + effectivePort(env));
                        }
                    }
                    environmentRepository.save(env);
                });
            });
        }
    }

    /**
     * Compose the access URL from deploy target host and effective port.
     */
    private String computeAccessUrl(Deployment deployment) {
        int port = 3000;
        Environment env = environmentRepository.findById(deployment.getEnvironmentId()).orElse(null);
        if (env != null) {
            port = effectivePort(env);
        }

        String host = null;
        if (deployment.getDeployTargetId() != null && !deployment.getDeployTargetId().isBlank()) {
            DeployTarget target = deployTargetRepository.findById(deployment.getDeployTargetId()).orElse(null);
            if (target != null) {
                host = target.getHost();
            }
        }

        if (host != null && !host.isBlank()) {
            return "http://" + host + ":" + port;
        }
        return "http://localhost:" + port;
    }

    static int effectivePort(Environment env) {
        if (env.getExternalPort() != null && env.getExternalPort() > 0) {
            return env.getExternalPort();
        }
        return switch (env.getType()) {
            case "TEST" -> 3001;
            case "STAGING" -> 3002;
            case "PRODUCTION" -> 3003;
            default -> 3000;
        };
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
