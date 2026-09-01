-- A deployment references an immutable project artifact. The originating
-- deployment is retained only for backwards compatibility and provenance.
ALTER TABLE "deployments" ADD COLUMN "artifact_id" VARCHAR(36);

UPDATE "deployments" AS d
SET "artifact_id" = a."id"
FROM "artifacts" AS a
WHERE a."deployment_id" = d."id";

ALTER TABLE "artifacts" ALTER COLUMN "deployment_id" DROP NOT NULL;
DROP INDEX "artifacts_digest_key";
CREATE UNIQUE INDEX "artifacts_project_id_digest_key" ON "artifacts"("project_id", "digest");
CREATE INDEX "deployments_artifact_id_idx" ON "deployments"("artifact_id");

ALTER TABLE "artifacts"
  ADD CONSTRAINT "artifacts_deployment_id_fkey"
  FOREIGN KEY ("deployment_id") REFERENCES "deployments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "deployments"
  ADD CONSTRAINT "deployments_artifact_id_fkey"
  FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "revoked_refresh_tokens" (
  "jti" VARCHAR(64) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "revoked_refresh_tokens_pkey" PRIMARY KEY ("jti")
);
CREATE INDEX "revoked_refresh_tokens_expires_at_idx" ON "revoked_refresh_tokens"("expires_at");

ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "deployments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "issues" ADD CONSTRAINT "issues_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "issues" ADD CONSTRAINT "issues_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "deployments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "releases" ADD CONSTRAINT "releases_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "releases" ADD CONSTRAINT "releases_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "deployments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Prisma's @updatedAt owns subsequent writes. Historical migrations created
-- database defaults which are not part of the current datamodel; remove them
-- so a migration replay and schema.prisma describe exactly the same database.
ALTER TABLE "users" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "workspaces" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "invitations" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "projects" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "components" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "repository_credentials" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "environments" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "environment_variables" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "deploy_targets" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "test_cases" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "issues" ALTER COLUMN "updated_at" DROP DEFAULT;
