CREATE TABLE IF NOT EXISTS deploy_targets (
    id UUID PRIMARY KEY,
    organization_id UUID NOT NULL,
    project_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'BYOS_SSH',
    host VARCHAR(500) NOT NULL,
    port INTEGER NOT NULL DEFAULT 22,
    username VARCHAR(255) NOT NULL,
    auth_method VARCHAR(50) NOT NULL DEFAULT 'KEY',
    encrypted_credential TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'UNVERIFIED',
    last_verified_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deploy_targets_project_id ON deploy_targets(project_id);
CREATE INDEX IF NOT EXISTS idx_deploy_targets_org_id ON deploy_targets(organization_id);
