package com.launchly.worker.entities;

import jakarta.persistence.*;

@Entity
@Table(name = "environment_variables")
public class EnvironmentVariable {
    @Id
    private String id;

    @Column(name = "environment_id", nullable = false)
    private String environmentId;

    @Column(nullable = false)
    private String key;

    @Column(name = "encrypted_value", columnDefinition = "TEXT")
    private String encryptedValue;

    @Column(name = "masked_value")
    private String maskedValue;

    @Column(nullable = false)
    private boolean sensitive = false;

    @Column
    private String description;

    public EnvironmentVariable() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getEnvironmentId() { return environmentId; }
    public void setEnvironmentId(String environmentId) { this.environmentId = environmentId; }
    public String getKey() { return key; }
    public void setKey(String key) { this.key = key; }
    public String getEncryptedValue() { return encryptedValue; }
    public void setEncryptedValue(String encryptedValue) { this.encryptedValue = encryptedValue; }
    public String getMaskedValue() { return maskedValue; }
    public void setMaskedValue(String maskedValue) { this.maskedValue = maskedValue; }
    public boolean isSensitive() { return sensitive; }
    public void setSensitive(boolean sensitive) { this.sensitive = sensitive; }
    public String getDescription() { return description; }
    public void setDescription(String description) { this.description = description; }
}
