package com.launchly.release.services;

import com.launchly.audit.enums.AuditAction;
import com.launchly.audit.services.AuditService;
import com.launchly.project.entities.Project;
import com.launchly.project.repositories.ProjectRepository;
import com.launchly.release.dto.GateExemptionRequest;
import com.launchly.release.dto.ReleaseRequest;
import com.launchly.release.dto.ReleaseResponse;
import com.launchly.release.entities.GateExemption;
import com.launchly.release.entities.Release;
import com.launchly.release.enums.ReleaseStatus;
import com.launchly.release.repositories.GateExemptionRepository;
import com.launchly.release.repositories.ReleaseRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;
import java.util.stream.Collectors;

@Service
public class ReleaseService {
    private final ReleaseRepository releaseRepository;
    private final GateExemptionRepository exemptionRepository;
    private final GateCheckService gateCheckService;
    private final ProjectRepository projectRepository;
    private final AuditService auditService;

    public ReleaseService(ReleaseRepository releaseRepository,
                          GateExemptionRepository exemptionRepository,
                          GateCheckService gateCheckService,
                          ProjectRepository projectRepository,
                          AuditService auditService) {
        this.releaseRepository = releaseRepository;
        this.exemptionRepository = exemptionRepository;
        this.gateCheckService = gateCheckService;
        this.projectRepository = projectRepository;
        this.auditService = auditService;
    }

    @Transactional
    public ReleaseResponse createRelease(String projectId, ReleaseRequest request, String userId) {
        Release release = new Release();
        release.setProjectId(projectId);
        release.setEnvironmentId(request.environmentId());
        release.setDeploymentId(request.deploymentId());
        release.setVersion(request.version() != null ? request.version() : generateVersion());
        release.setNotes(request.notes());
        release.setStatus(ReleaseStatus.DRAFT);

        release = releaseRepository.save(release);

        // Auto-check gates
        checkAndUpdateGates(release);

        return ReleaseResponse.from(release);
    }

    public List<ReleaseResponse> listReleases(String projectId) {
        return releaseRepository.findByProjectIdOrderByCreatedAtDesc(projectId)
                .stream().map(ReleaseResponse::from).collect(Collectors.toList());
    }

    public ReleaseResponse getRelease(String id) {
        Release r = releaseRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Release not found: " + id));
        return ReleaseResponse.from(r);
    }

    public GateCheckResult getGateStatus(String id) {
        Release r = releaseRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Release not found: " + id));
        return gateCheckService.checkGates(r.getProjectId(), r.getEnvironmentId(), r.getDeploymentId());
    }

    @Transactional
    public ReleaseResponse publish(String id, String userId) {
        Release r = releaseRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Release not found: " + id));

        // Check gates before publishing
        GateCheckResult gates = gateCheckService.checkGates(
            r.getProjectId(), r.getEnvironmentId(), r.getDeploymentId());

        // Count exemptions
        List<GateExemption> exemptions = exemptionRepository.findByReleaseId(r.getId());
        boolean allGatesPassed = gates.getResults().stream()
            .allMatch(g -> g.isPassed() || exemptions.stream().anyMatch(e -> e.getGateName().equals(g.getGateName())));

        if (!allGatesPassed) {
            throw new IllegalStateException("Not all gates passed or exempted. Cannot publish.");
        }

        r.setStatus(ReleaseStatus.PUBLISHED);
        r.setGateStatus("PASSED");
        r.setReleasedBy(userId);
        r.setReleasedAt(Instant.now());
        Release saved = releaseRepository.save(r);
        auditService.record(userId, workspaceId(saved.getProjectId()), AuditAction.PUBLISH_PRODUCTION, "release", saved.getId(),
                java.util.Map.of("projectId", saved.getProjectId(), "version", saved.getVersion()));
        return ReleaseResponse.from(saved);
    }

    @Transactional
    public GateExemption exemptGate(String releaseId, String gateName, GateExemptionRequest request, String userId) {
        Release r = releaseRepository.findById(releaseId)
                .orElseThrow(() -> new IllegalArgumentException("Release not found: " + releaseId));

        GateExemption exemption = new GateExemption();
        exemption.setReleaseId(releaseId);
        exemption.setGateName(gateName);
        exemption.setExemptedBy(userId);
        exemption.setReason(request.reason());
        exemption = exemptionRepository.save(exemption);
        auditService.record(userId, workspaceId(r.getProjectId()), AuditAction.GATE_EXEMPT, "release", r.getId(),
                java.util.Map.of("gateName", gateName));

        // Re-check gates
        checkAndUpdateGates(r);

        return exemption;
    }

    public List<GateExemption> getExemptions(String releaseId) {
        return exemptionRepository.findByReleaseId(releaseId);
    }

    private void checkAndUpdateGates(Release release) {
        GateCheckResult result = gateCheckService.checkGates(
            release.getProjectId(), release.getEnvironmentId(), release.getDeploymentId());

        List<GateExemption> exemptions = exemptionRepository.findByReleaseId(release.getId());
        boolean allPassed = result.getResults().stream()
            .allMatch(g -> g.isPassed() || exemptions.stream().anyMatch(e -> e.getGateName().equals(g.getGateName())));

        if (allPassed) {
            release.setStatus(ReleaseStatus.READY);
            release.setGateStatus("PASSED");
        } else {
            release.setStatus(ReleaseStatus.PENDING_GATES);
            release.setGateStatus("FAILED");
        }
        releaseRepository.save(release);
    }

    private String generateVersion() {
        java.time.LocalDate now = java.time.LocalDate.now();
        return "v" + now.getYear() + "." + now.getMonthValue() + "." +
               String.format("%03d", releaseRepository.count() + 1);
    }

    private String workspaceId(String projectId) {
        return projectRepository.findById(projectId).map(Project::getWorkspaceId).orElse(null);
    }
}
