ALTER TABLE deployments ADD COLUMN IF NOT EXISTS deploy_target_id UUID REFERENCES deploy_targets(id);

CREATE INDEX IF NOT EXISTS idx_deployments_deploy_target_id ON deployments(deploy_target_id);
