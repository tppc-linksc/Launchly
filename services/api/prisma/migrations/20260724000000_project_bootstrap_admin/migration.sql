-- Per-project bootstrap configuration and per-environment idempotency records.
ALTER TABLE "projects"
  ADD COLUMN "bootstrap_admin_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "bootstrap_admin_command" VARCHAR(500),
  ADD COLUMN "bootstrap_admin_username" VARCHAR(255),
  ADD COLUMN "bootstrap_admin_email" VARCHAR(255);

CREATE TABLE "project_bootstrap_secrets" (
  "project_id" VARCHAR(36) NOT NULL,
  "encrypted_password" TEXT NOT NULL,
  "masked_preview" VARCHAR(255),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "project_bootstrap_secrets_pkey" PRIMARY KEY ("project_id")
);
ALTER TABLE "project_bootstrap_secrets" ADD CONSTRAINT "project_bootstrap_secrets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "project_bootstrap_runs" (
  "id" VARCHAR(36) NOT NULL,
  "project_id" VARCHAR(36) NOT NULL,
  "environment_id" VARCHAR(36) NOT NULL,
  "deployment_id" VARCHAR(36),
  "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  "completed_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "project_bootstrap_runs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "project_bootstrap_runs_project_id_environment_id_key" ON "project_bootstrap_runs"("project_id", "environment_id");
CREATE INDEX "project_bootstrap_runs_deployment_id_idx" ON "project_bootstrap_runs"("deployment_id");
ALTER TABLE "project_bootstrap_runs" ADD CONSTRAINT "project_bootstrap_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
