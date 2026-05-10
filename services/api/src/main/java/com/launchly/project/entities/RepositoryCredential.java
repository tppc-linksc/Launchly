package com.launchly.project.entities;

import com.launchly.project.enums.CredentialType;
import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "repository_credentials")
public class RepositoryCredential {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(name = "project_id", nullable = false, unique = true)
    private String projectId;

    @Enumerated(EnumType.STRING)
    @Column(name = "credential_type", nullable = false)
    private CredentialType credentialType = CredentialType.PERSONAL_ACCESS_TOKEN;

    @Column(name = "encrypted_value", nullable = false)
    private String encryptedValue;

    @Column(name = "masked_preview", nullable = false)
    private String maskedPreview;

    @Column(nullable = false, updatable = false)
    private Instant createdAt = Instant.now();

    @Column(nullable = false)
    private Instant updatedAt = Instant.now();

    public RepositoryCredential() {}

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getProjectId() { return projectId; }
    public void setProjectId(String projectId) { this.projectId = projectId; }
    public CredentialType getCredentialType() { return credentialType; }
    public void setCredentialType(CredentialType credentialType) { this.credentialType = credentialType; }
    public String getEncryptedValue() { return encryptedValue; }
    public void setEncryptedValue(String encryptedValue) { this.encryptedValue = encryptedValue; }
    public String getMaskedPreview() { return maskedPreview; }
    public void setMaskedPreview(String maskedPreview) { this.maskedPreview = maskedPreview; }
    public Instant getCreatedAt() { return createdAt; }
    public void setCreatedAt(Instant createdAt) { this.createdAt = createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(Instant updatedAt) { this.updatedAt = updatedAt; }
}
