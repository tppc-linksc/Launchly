package com.launchly.release.entities;

import jakarta.persistence.*;
import java.time.Instant;

@Entity
@Table(name = "gate_exemptions")
public class GateExemption {
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(name = "release_id", nullable = false)
    private String releaseId;

    @Column(name = "gate_name", nullable = false)
    private String gateName;

    @Column(name = "exempted_by", nullable = false)
    private String exemptedBy;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String reason;

    @Column(name = "exempted_at", nullable = false)
    private Instant exemptedAt = Instant.now();

    public GateExemption() {}

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getReleaseId() { return releaseId; }
    public void setReleaseId(String releaseId) { this.releaseId = releaseId; }
    public String getGateName() { return gateName; }
    public void setGateName(String gateName) { this.gateName = gateName; }
    public String getExemptedBy() { return exemptedBy; }
    public void setExemptedBy(String exemptedBy) { this.exemptedBy = exemptedBy; }
    public String getReason() { return reason; }
    public void setReason(String reason) { this.reason = reason; }
    public Instant getExemptedAt() { return exemptedAt; }
    public void setExemptedAt(Instant exemptedAt) { this.exemptedAt = exemptedAt; }
}
