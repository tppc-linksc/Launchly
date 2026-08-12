-- Deployment runtime foundation: webhook deduplication, leased tasks and runtime metadata.

ALTER TABLE "environments"
  ADD COLUMN "auto_deploy" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "branch_pattern" VARCHAR(255),
  ADD COLUMN "require_ci" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deploy_target_id" VARCHAR(36);
CREATE INDEX "environments_deploy_target_id_idx" ON "environments"("deploy_target_id");

ALTER TABLE "projects" ADD COLUMN "github_installation_id" VARCHAR(36);
ALTER TABLE "projects" ADD COLUMN "registry_repository" VARCHAR(512);

CREATE TABLE "project_members" (
  "id" VARCHAR(36) NOT NULL,
  "project_id" VARCHAR(36) NOT NULL,
  "user_id" VARCHAR(36) NOT NULL,
  "role" VARCHAR(20) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "project_members_project_id_user_id_key" ON "project_members"("project_id", "user_id");
CREATE INDEX "project_members_user_id_idx" ON "project_members"("user_id");
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "deployments"
  ADD COLUMN "trigger_source" VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "idempotency_key" VARCHAR(255),
  ADD COLUMN "artifact_digest" VARCHAR(255);
CREATE INDEX "deployments_idempotency_key_idx" ON "deployments"("idempotency_key");

CREATE TABLE "artifacts" (
  "id" VARCHAR(36) NOT NULL,
  "deployment_id" VARCHAR(36) NOT NULL,
  "project_id" VARCHAR(36) NOT NULL,
  "image_ref" VARCHAR(512) NOT NULL,
  "digest" VARCHAR(255) NOT NULL,
  "commit_sha" VARCHAR(255),
  "sbom_status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "artifacts_deployment_id_key" ON "artifacts"("deployment_id");
CREATE UNIQUE INDEX "artifacts_digest_key" ON "artifacts"("digest");
CREATE INDEX "artifacts_project_id_created_at_idx" ON "artifacts"("project_id", "created_at");
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "deploy_targets" ADD COLUMN "host_key" TEXT;

ALTER TABLE "tasks"
  ADD COLUMN "lease_owner" VARCHAR(255),
  ADD COLUMN "lease_expires_at" TIMESTAMP(3),
  ADD COLUMN "idempotency_key" VARCHAR(255);
CREATE INDEX "tasks_lease_expires_at_idx" ON "tasks"("lease_expires_at");
CREATE UNIQUE INDEX "tasks_task_type_idempotency_key_key" ON "tasks"("task_type", "idempotency_key");

CREATE TABLE "git_webhook_deliveries" (
  "id" VARCHAR(36) NOT NULL,
  "provider" VARCHAR(30) NOT NULL,
  "delivery_id" VARCHAR(255) NOT NULL,
  "event" VARCHAR(100) NOT NULL,
  "project_id" VARCHAR(36),
  "commit_sha" VARCHAR(255),
  "payload_hash" VARCHAR(64) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'RECEIVED',
  "deployment_id" VARCHAR(36),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "git_webhook_deliveries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "git_webhook_deliveries_provider_delivery_id_key" ON "git_webhook_deliveries"("provider", "delivery_id");
CREATE INDEX "git_webhook_deliveries_project_id_created_at_idx" ON "git_webhook_deliveries"("project_id", "created_at");

CREATE TABLE "worker_heartbeats" (
  "worker_id" VARCHAR(255) NOT NULL,
  "status" VARCHAR(30) NOT NULL,
  "details" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("worker_id")
);

-- Audit records are append-only at the database boundary, not only in the API.
CREATE OR REPLACE FUNCTION "launchly_prevent_audit_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "launchly_prevent_audit_mutation"();
