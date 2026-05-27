-- V8/V9 used native PostgreSQL UUID; JPA maps String @Id to varchar — Hibernate validate fails.
-- Convert to varchar(36) to match the rest of the schema (V1 style) and entity mappings.
-- Must drop FK from deployments first: cannot ALTER referenced column type while FK exists.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'deploy_targets' AND column_name = 'id'
      AND (data_type = 'uuid' OR udt_name = 'uuid')
  ) THEN
    ALTER TABLE deployments DROP CONSTRAINT IF EXISTS deployments_deploy_target_id_fkey;

    ALTER TABLE deploy_targets ALTER COLUMN id TYPE varchar(36) USING id::text;
    ALTER TABLE deploy_targets ALTER COLUMN organization_id TYPE varchar(36) USING organization_id::text;
    ALTER TABLE deploy_targets ALTER COLUMN project_id TYPE varchar(36) USING project_id::text;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'deployments' AND column_name = 'deploy_target_id'
        AND (data_type = 'uuid' OR udt_name = 'uuid')
    ) THEN
      ALTER TABLE deployments ALTER COLUMN deploy_target_id TYPE varchar(36) USING deploy_target_id::text;
    END IF;

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'deployments' AND column_name = 'deploy_target_id'
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'deployments_deploy_target_id_fkey'
    ) THEN
      ALTER TABLE deployments
        ADD CONSTRAINT deployments_deploy_target_id_fkey
        FOREIGN KEY (deploy_target_id) REFERENCES deploy_targets (id);
    END IF;
  END IF;
END $$;
