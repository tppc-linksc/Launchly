package com.launchly.worker.services;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.launchly.worker.entities.Task;
import com.launchly.worker.enums.TaskStatus;
import com.launchly.worker.enums.TaskType;
import com.launchly.worker.repositories.TaskRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;
import java.util.Optional;

@Service
public class TaskService {
    private final TaskRepository taskRepository;
    private final ObjectMapper objectMapper;

    public TaskService(TaskRepository taskRepository, ObjectMapper objectMapper) {
        this.taskRepository = taskRepository;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public Task createTask(TaskType type, String refId, Map<String, Object> payloadMap) {
        Task task = new Task();
        task.setTaskType(type);
        task.setRefId(refId);
        task.setStatus(TaskStatus.PENDING);
        try {
            task.setPayload(objectMapper.writeValueAsString(payloadMap));
        } catch (JsonProcessingException e) {
            task.setPayload("{}");
        }
        return taskRepository.save(task);
    }

    @Transactional
    public Optional<Task> claimNextPending() {
        return taskRepository.findNextPendingForUpdate().map(task -> {
            task.setStatus(TaskStatus.RUNNING);
            task.setStartedAt(java.time.Instant.now());
            task.setAttempts(task.getAttempts() + 1);
            return taskRepository.save(task);
        });
    }

    @Transactional
    public void updateStatus(String taskId, TaskStatus status, String errorMessage) {
        taskRepository.findById(taskId).ifPresent(task -> {
            task.setStatus(status);
            if (errorMessage != null) {
                task.setErrorMessage(errorMessage);
            }
            if (status == TaskStatus.SUCCEEDED || status == TaskStatus.FAILED || status == TaskStatus.CANCELED) {
                task.setFinishedAt(java.time.Instant.now());
            }
            taskRepository.save(task);
        });
    }
}
