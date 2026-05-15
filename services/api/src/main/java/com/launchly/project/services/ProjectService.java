package com.launchly.project.services;

import com.launchly.audit.enums.AuditAction;
import com.launchly.audit.services.AuditService;
import com.launchly.environment.entities.Environment;
import com.launchly.environment.enums.EnvironmentType;
import com.launchly.environment.repositories.EnvironmentRepository;
import com.launchly.project.dto.CreateProjectRequest;
import com.launchly.project.dto.ProjectResponse;
import com.launchly.project.entities.Project;
import com.launchly.project.enums.GitProvider;
import com.launchly.project.enums.ProjectType;
import com.launchly.project.repositories.ProjectRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
public class ProjectService {
    private final ProjectRepository projectRepository;
    private final EnvironmentRepository environmentRepository;
    private final AuditService auditService;
    private final RepositoryHintsService repositoryHintsService;

    public ProjectService(ProjectRepository projectRepository,
                          EnvironmentRepository environmentRepository,
                          AuditService auditService,
                          RepositoryHintsService repositoryHintsService) {
        this.projectRepository = projectRepository;
        this.environmentRepository = environmentRepository;
        this.auditService = auditService;
        this.repositoryHintsService = repositoryHintsService;
    }

    @Transactional
    public ProjectResponse create(CreateProjectRequest request, String workspaceId, String userId) {
        Project project = new Project();
        project.setWorkspaceId(workspaceId);
        project.setName(request.name());
        project.setDescription(request.description());
        project.setProjectType(request.projectType() != null ? request.projectType() : ProjectType.CUSTOM);
        project.setRepositoryUrl(request.repositoryUrl());
        project.setDefaultBranch(request.defaultBranch() != null ? request.defaultBranch() : "main");
        if (request.gitProvider() != null) {
            project.setGitProvider(GitProvider.valueOf(request.gitProvider()));
        }
        project.setInstallCommand(request.installCommand());
        project.setBuildCommand(request.buildCommand());
        project.setStartCommand(request.startCommand());
        project.setTestCommand(request.testCommand());
        project.setHealthCheckPath(request.healthCheckPath());
        project.setDefaultPort(request.defaultPort());
        project.setCreatedBy(userId);

        repositoryHintsService.fillBlanksFromRepository(project);

        project = projectRepository.save(project);

        Environment testEnv = new Environment(project.getId(), "测试环境", EnvironmentType.TEST);
        testEnv.setExternalPort(3001);
        testEnv.setDeployMode("local");
        Environment stagingEnv = new Environment(project.getId(), "预发环境", EnvironmentType.STAGING);
        stagingEnv.setExternalPort(3002);
        stagingEnv.setDeployMode("local");
        Environment prodEnv = new Environment(project.getId(), "生产环境", EnvironmentType.PRODUCTION);
        prodEnv.setExternalPort(3003);
        prodEnv.setDeployMode("local");
        environmentRepository.saveAll(List.of(testEnv, stagingEnv, prodEnv));
        auditService.record(userId, workspaceId, AuditAction.CREATE_PROJECT, "project", project.getId(),
                Map.of("name", project.getName()));

        return ProjectResponse.from(project);
    }

    public List<ProjectResponse> listByWorkspace(String workspaceId) {
        return projectRepository.findByWorkspaceIdOrderByCreatedAtDesc(workspaceId)
                .stream().map(ProjectResponse::from).collect(Collectors.toList());
    }

    public ProjectResponse getById(String id) {
        Project p = projectRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Project not found: " + id));
        return ProjectResponse.from(p);
    }

    public ProjectResponse getById(String id, String workspaceId) {
        Project p = findOwnedProject(id, workspaceId);
        return ProjectResponse.from(p);
    }

    @Transactional
    public ProjectResponse update(String id, CreateProjectRequest request) {
        Project p = projectRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Project not found: " + id));
        return updateProject(p, request);
    }

    @Transactional
    public ProjectResponse update(String id, CreateProjectRequest request, String workspaceId) {
        return update(id, request, workspaceId, null);
    }

    @Transactional
    public ProjectResponse update(String id, CreateProjectRequest request, String workspaceId, String userId) {
        Project p = findOwnedProject(id, workspaceId);
        return updateProject(p, request, userId);
    }

    private ProjectResponse updateProject(Project p, CreateProjectRequest request) {
        return updateProject(p, request, p.getCreatedBy());
    }

    private ProjectResponse updateProject(Project p, CreateProjectRequest request, String userId) {
        if (request.name() != null) p.setName(request.name());
        if (request.description() != null) p.setDescription(request.description());
        if (request.projectType() != null) p.setProjectType(request.projectType());
        if (request.repositoryUrl() != null) p.setRepositoryUrl(request.repositoryUrl());
        if (request.defaultBranch() != null) p.setDefaultBranch(request.defaultBranch());
        if (request.gitProvider() != null) p.setGitProvider(GitProvider.valueOf(request.gitProvider()));
        if (request.installCommand() != null) p.setInstallCommand(request.installCommand());
        if (request.buildCommand() != null) p.setBuildCommand(request.buildCommand());
        if (request.startCommand() != null) p.setStartCommand(request.startCommand());
        if (request.testCommand() != null) p.setTestCommand(request.testCommand());
        if (request.healthCheckPath() != null) p.setHealthCheckPath(request.healthCheckPath());
        if (request.defaultPort() != null) p.setDefaultPort(request.defaultPort());
        p = projectRepository.save(p);
        auditService.record(userId != null ? userId : p.getCreatedBy(), p.getWorkspaceId(), AuditAction.UPDATE_PROJECT, "project", p.getId(),
                Map.of("updated", true));
        return ProjectResponse.from(p);
    }

    private Project findOwnedProject(String id, String workspaceId) {
        Project p = projectRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Project not found: " + id));
        if (!p.getWorkspaceId().equals(workspaceId)) {
            throw new IllegalArgumentException("Project not found: " + id);
        }
        return p;
    }
}
