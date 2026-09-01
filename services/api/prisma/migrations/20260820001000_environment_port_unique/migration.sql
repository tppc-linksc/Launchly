-- Reserve each external port at most once per deployment target. PostgreSQL
-- permits multiple NULL values, so unbound environments remain unaffected.
-- Existing duplicate assignments are released (port=NULL) rather than deleting
-- an environment; the next deployment will reserve a conflict-free fallback.
WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "deploy_target_id", "external_port"
           ORDER BY "created_at" ASC, "id" ASC
         ) AS row_number
  FROM "environments"
  WHERE "deploy_target_id" IS NOT NULL
    AND "external_port" IS NOT NULL
)
UPDATE "environments" AS environment
SET "external_port" = NULL
FROM ranked
WHERE environment."id" = ranked."id"
  AND ranked.row_number > 1;

DROP INDEX IF EXISTS "environments_deploy_target_id_idx";
CREATE UNIQUE INDEX "environments_deploy_target_id_external_port_key"
  ON "environments"("deploy_target_id", "external_port");
