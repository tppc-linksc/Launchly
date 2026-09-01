-- Webhook retries with different delivery IDs can race. Make the business
-- idempotency key authoritative at the database boundary.
-- Preserve every historical deployment while clearing duplicate keys from all
-- but the earliest row, so upgrades from an already-raced database can proceed.
WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "idempotency_key"
           ORDER BY "created_at" ASC, "id" ASC
         ) AS row_number
  FROM "deployments"
  WHERE "idempotency_key" IS NOT NULL
)
UPDATE "deployments" AS deployment
SET "idempotency_key" = NULL
FROM ranked
WHERE deployment."id" = ranked."id"
  AND ranked.row_number > 1;

DROP INDEX IF EXISTS "deployments_idempotency_key_idx";
CREATE UNIQUE INDEX "deployments_idempotency_key_key" ON "deployments"("idempotency_key");
