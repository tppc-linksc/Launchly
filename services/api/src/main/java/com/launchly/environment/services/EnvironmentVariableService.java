package com.launchly.environment.services;

import com.launchly.audit.enums.AuditAction;
import com.launchly.audit.services.AuditService;
import com.launchly.environment.dto.CreateEnvironmentVariableRequest;
import com.launchly.environment.dto.EnvironmentVariableResponse;
import com.launchly.environment.entities.EnvironmentVariable;
import com.launchly.environment.repositories.EnvironmentVariableRepository;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

@Service
public class EnvironmentVariableService {
    private final EnvironmentVariableRepository variableRepository;
    private final SecretValueService secretValueService;
    private final AuditService auditService;

    public EnvironmentVariableService(EnvironmentVariableRepository variableRepository,
                                      SecretValueService secretValueService,
                                      AuditService auditService) {
        this.variableRepository = variableRepository;
        this.secretValueService = secretValueService;
        this.auditService = auditService;
    }

    public List<EnvironmentVariableResponse> listByEnvironment(String environmentId) {
        return variableRepository.findByEnvironmentIdOrderByKeyAsc(environmentId)
                .stream().map(EnvironmentVariableResponse::from).collect(Collectors.toList());
    }

    public EnvironmentVariableResponse create(String environmentId, CreateEnvironmentVariableRequest request) {
        return create(environmentId, request, null, null);
    }

    public EnvironmentVariableResponse create(String environmentId, CreateEnvironmentVariableRequest request,
                                              String userId, String workspaceId) {
        EnvironmentVariable variable = new EnvironmentVariable();
        variable.setEnvironmentId(environmentId);
        variable.setKey(request.key());
        variable.setSensitive(request.sensitive());
        variable.setDescription(request.description());

        if (request.sensitive()) {
            variable.setEncryptedValue(secretValueService.encrypt(request.value()));
            variable.setMaskedValue(mask(request.value()));
        } else {
            variable.setEncryptedValue(request.value());
            variable.setMaskedValue(request.value());
        }

        variable = variableRepository.save(variable);
        if (userId != null) {
            auditService.record(userId, workspaceId, AuditAction.UPDATE_ENV_VAR, "environment_variable", variable.getId(),
                    java.util.Map.of("environmentId", environmentId, "key", variable.getKey()));
        }
        return EnvironmentVariableResponse.from(variable);
    }

    public void delete(String id) {
        variableRepository.deleteById(id);
    }

    public void delete(String id, String userId, String workspaceId) {
        variableRepository.deleteById(id);
        auditService.record(userId, workspaceId, AuditAction.UPDATE_ENV_VAR, "environment_variable", id,
                java.util.Map.of("deleted", true));
    }

    private String mask(String value) {
        if (value == null || value.length() <= 4) return "****";
        return value.substring(0, 2) + "****" + value.substring(value.length() - 2);
    }
}
