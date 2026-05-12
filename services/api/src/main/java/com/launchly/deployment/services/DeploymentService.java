package com.launchly.deployment.services;

import com.launchly.audit.enums.AuditAction;
import com.launchly.audit.services.AuditService;
import com.launchly.common.security.AuthContext;
import com.launchly.deployment.dto.CreateDeploymentRequest;
import com.launchly.deployment.dto.DeploymentResponse;
import com.launchly.deployment.entities.Deployment;
import com.launchly.deployment.entities.DeploymentStageLog;
import com.launchly.deployment.enums.DeploymentStage;
import com.launchly.deployment.enums.DeploymentStatus;
import com.launchly.deployment.repositories.DeploymentRepository;
import com.launchly.deployment.repositories.DeploymentStageLogRepository;
import com.launchly.environment.entities.Environment;
import com.launchly.environment.repositories.EnvironmentRepository;
import com.launchly.project.entities.Project;
import com.launchly.project.repositories.ProjectRepository;
import com.launchly.target.entities.DeployTarget;
import com.launchly.target.repositories.DeployTargetRepository;
import com.launchly.worker.enums.TaskType;
import com.launchly.worker.services.TaskService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class DeploymentService {
    private final DeploymentRepository deploymentRepository;
    private final DeploymentStageLogRepository stageLogRepository;
    private final TaskService taskService;
    private final ProjectRepository projectRepository;
    private final EnvironmentRepository environmentRepository;
    private final DeployTargetRepository deployTargetRepository;
    private final AuditService auditService;

    public DeploymentService(DeploymentRepository deploymentRepository,
                             DeploymentStageLogRepository stageLogRepository,
                             TaskService taskService,
                             ProjectRepository projectRepository,
                             EnvironmentRepository environmentRepository,
                             DeployTargetRepository deployTargetRepository,
                             AuditService auditService) {
        this.deploymentRepository = deploymentRepository;
        this.stageLogRepository = stageLogRepository;
        this.taskService = taskService;
        this.projectRepository = projectRepository;
        this.environmentRepository = environmentRepository;
        this.deployTargetRepository = deployTargetRepository;
        this.auditService = auditService;
    }

    @Transactional
    public DeploymentResponse create(CreateDeploymentRequest request, String userId) {
        // Validate environment
        Environment env = environmentRepository.findById(request.environmentId())
                .orElseThrow(() -> new IllegalArgumentException("环境不存在: " + request.environmentId()));
        if (!Boolean.TRUE.equals(env.getEnabled())) {
            throw new IllegalStateException("该环境已禁用，无法部署");
        }
        if (!env.getProjectId().equals(request.projectId())) {
            throw new IllegalArgumentException("环境不属于指定项目");
        }
        if ("remote".equals(env.getDeployMode())) {
            throw new IllegalStateException("远程部署功能开发中，请使用本地模式（local）部署");
        }

        // Validate project belongs to current workspace
        Project project = projectRepository.findById(request.projectId())
                .orElseThrow(() -> new IllegalArgumentException("项目不存在: " + request.projectId()));
        if (!project.getWorkspaceId().equals(AuthContext.workspaceId())) {
            throw new SecurityException("无权在该项目中创建部署");
        }

        // Validate deploy target
        DeployTarget deployTarget = deployTargetRepository.findById(request.deployTargetId())
                .orElseThrow(() -> new IllegalArgumentException("部署目标不存在: " + request.deployTargetId()));
        if (!deployTarget.getProjectId().equals(request.projectId())) {
            throw new IllegalArgumentException("部署目标不属于指定项目");
        }

        Deployment deployment = new Deployment();
        deployment.setProjectId(request.projectId());
        deployment.setEnvironmentId(request.environmentId());
        deployment.setDeployTargetId(request.deployTargetId());
        deployment.setBranch(request.branch());
        deployment.setCommitSha(request.commitSha());
        deployment.setStatus(DeploymentStatus.PENDING);
        deployment.setTriggeredBy(userId);

        deployment = deploymentRepository.save(deployment);

        // Create placeholder stage logs
        for (DeploymentStage stage : DeploymentStage.values()) {
            DeploymentStageLog log = new DeploymentStageLog();
            log.setDeploymentId(deployment.getId());
            log.setStage(stage);
            log.setStatus("PENDING");
            stageLogRepository.save(log);
        }

        // Enqueue the first worker task. The worker enqueues the next stage after each success.
        taskService.createTask(TaskType.REPO_CLONE, deployment.getId(),
                Map.of(
                        "projectId", deployment.getProjectId(),
                        "environmentId", deployment.getEnvironmentId(),
                        "branch", deployment.getBranch() == null ? "" : deployment.getBranch(),
                        "commitSha", deployment.getCommitSha() == null ? "" : deployment.getCommitSha()
                ));
        recordAudit(userId, AuditAction.TRIGGER_DEPLOY, deployment);

        return DeploymentResponse.from(deployment, deployTarget);
    }

    @Transactional
    public DeploymentResponse rollback(String deploymentId, String userId) {
        Deployment source = deploymentRepository.findById(deploymentId)
                .orElseThrow(() -> new IllegalArgumentException("Deployment not found: " + deploymentId));
        if (source.getCommitSha() == null || source.getCommitSha().isBlank()) {
            throw new IllegalStateException("Cannot rollback deployment without commitSha");
        }

        Deployment rollback = new Deployment();
        rollback.setProjectId(source.getProjectId());
        rollback.setEnvironmentId(source.getEnvironmentId());
        rollback.setBranch(source.getBranch());
        rollback.setCommitSha(source.getCommitSha());
        rollback.setRollbackFromDeploymentId(source.getId());
        rollback.setStatus(DeploymentStatus.PENDING);
        rollback.setTriggeredBy(userId);
        rollback = deploymentRepository.save(rollback);

        for (DeploymentStage stage : DeploymentStage.values()) {
            DeploymentStageLog log = new DeploymentStageLog();
            log.setDeploymentId(rollback.getId());
            log.setStage(stage);
            log.setStatus("PENDING");
            stageLogRepository.save(log);
        }

        taskService.createTask(TaskType.REPO_CLONE, rollback.getId(),
                Map.of(
                        "projectId", rollback.getProjectId(),
                        "environmentId", rollback.getEnvironmentId(),
                        "branch", rollback.getBranch() == null ? "" : rollback.getBranch(),
                        "commitSha", rollback.getCommitSha()
                ));
        recordAudit(userId, AuditAction.ROLLBACK, rollback);
        return DeploymentResponse.from(rollback);
    }

    private void recordAudit(String userId, AuditAction action, Deployment deployment) {
        String workspaceId = projectRepository.findById(deployment.getProjectId())
                .map(Project::getWorkspaceId)
                .orElse(null);
        auditService.record(userId, workspaceId, action, "deployment", deployment.getId(),
                Map.of("projectId", deployment.getProjectId(), "environmentId", deployment.getEnvironmentId()));
    }

    public List<DeploymentResponse> listByProject(String projectId) {
        return deploymentRepository.findByProjectIdOrderByCreatedAtDesc(projectId)
                .stream().map(DeploymentResponse::from).collect(Collectors.toList());
    }

    public List<DeploymentResponse> listByEnvironment(String environmentId) {
        return deploymentRepository.findByEnvironmentIdOrderByCreatedAtDesc(environmentId)
                .stream().map(DeploymentResponse::from).collect(Collectors.toList());
    }

    public DeploymentResponse getById(String id) {
        Deployment d = deploymentRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Deployment not found: " + id));
        return DeploymentResponse.from(d);
    }
}
