package com.launchly.target.services;

import com.launchly.common.security.AuthContext;
import com.launchly.environment.services.SecretValueService;
import com.launchly.target.dto.DeployTargetCreateRequest;
import com.launchly.target.dto.DeployTargetDto;
import com.launchly.target.dto.DeployTargetUpdateRequest;
import com.launchly.target.entities.DeployTarget;
import com.launchly.target.enums.AuthMethod;
import com.launchly.target.enums.TargetType;
import com.launchly.target.repositories.DeployTargetRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class DeployTargetService {

    private static final Logger log = LoggerFactory.getLogger(DeployTargetService.class);

    private final DeployTargetRepository repository;
    private final SecretValueService secretValueService;

    public DeployTargetService(DeployTargetRepository repository,
                               SecretValueService secretValueService) {
        this.repository = repository;
        this.secretValueService = secretValueService;
    }

    public List<DeployTargetDto> listByProject(String projectId) {
        return repository.findByProjectIdOrderByCreatedAtDesc(projectId)
                .stream().map(DeployTargetDto::from).toList();
    }

    public DeployTargetDto getById(String id) {
        DeployTarget entity = repository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Deploy target not found: " + id));
        return DeployTargetDto.from(entity);
    }

    @Transactional
    public DeployTargetDto create(DeployTargetCreateRequest request) {
        DeployTarget entity = new DeployTarget();
        entity.setOrganizationId(AuthContext.current().workspaceId());
        entity.setProjectId(request.getProjectId());
        entity.setName(request.getName());
        entity.setHost(request.getHost());
        entity.setPort(request.getPort() != null ? request.getPort() : 22);
        entity.setUsername(request.getUsername());
        entity.setAuthMethod("PASSWORD".equals(request.getAuthMethod())
                ? AuthMethod.PASSWORD : AuthMethod.KEY);

        if (request.getPrivateKey() != null && !request.getPrivateKey().isBlank()) {
            entity.setEncryptedCredential(secretValueService.encrypt(request.getPrivateKey()));
        }

        log.info("Deploy target created: id={}, name={}, host={}", entity.getId(), entity.getName(), entity.getHost());
        return DeployTargetDto.from(repository.save(entity));
    }

    @Transactional
    public DeployTargetDto update(String id, DeployTargetUpdateRequest request) {
        DeployTarget entity = repository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Deploy target not found: " + id));

        if (request.getName() != null) entity.setName(request.getName());
        if (request.getHost() != null) entity.setHost(request.getHost());
        if (request.getPort() != null) entity.setPort(request.getPort());
        if (request.getUsername() != null) entity.setUsername(request.getUsername());
        if (request.getAuthMethod() != null) {
            entity.setAuthMethod("PASSWORD".equals(request.getAuthMethod())
                    ? AuthMethod.PASSWORD : AuthMethod.KEY);
        }
        if (request.getPrivateKey() != null && !request.getPrivateKey().isBlank()) {
            entity.setEncryptedCredential(secretValueService.encrypt(request.getPrivateKey()));
        }

        return DeployTargetDto.from(repository.save(entity));
    }

    @Transactional
    public void delete(String id) {
        DeployTarget entity = repository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Deploy target not found: " + id));
        // T-W1-04 will add deployment reference check returning 409
        repository.delete(entity);
    }
}
