CREATE TABLE IF NOT EXISTS releases (
    id VARCHAR(36) PRIMARY KEY,
    project_id VARCHAR(36) NOT NULL,
    environment_id VARCHAR(36) NOT NULL,
    deployment_id VARCHAR(36),
    version VARCHAR(100) NOT NULL,
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    gate_status VARCHAR(20),
    released_by VARCHAR(36),
    released_at TIMESTAMP,
    rollback_deployment_id VARCHAR(36),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gate_exemptions (
    id VARCHAR(36) PRIMARY KEY,
    release_id VARCHAR(36) NOT NULL,
    gate_name VARCHAR(100) NOT NULL,
    exempted_by VARCHAR(36) NOT NULL,
    reason TEXT NOT NULL,
    exempted_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_releases_project ON releases(project_id);
CREATE INDEX idx_gate_exemptions_release ON gate_exemptions(release_id);
