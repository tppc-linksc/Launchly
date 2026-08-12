-- Resource catalog: a project can represent an application, static site, OCI image,
-- Compose stack, database/cache, or an opinionated template without overloading project_type.
ALTER TABLE "projects"
  ADD COLUMN "resource_kind" VARCHAR(50) NOT NULL DEFAULT 'APPLICATION',
  ADD COLUMN "source_type" VARCHAR(50) NOT NULL DEFAULT 'GIT_PUBLIC',
  ADD COLUMN "runtime_mode" VARCHAR(50) NOT NULL DEFAULT 'BUILDKIT',
  ADD COLUMN "template_id" VARCHAR(100),
  ADD COLUMN "image_reference" VARCHAR(1024),
  ADD COLUMN "resource_config" JSONB;

ALTER TABLE "repository_credentials" ADD COLUMN "host_key" TEXT;

CREATE INDEX "projects_resource_kind_source_type_idx" ON "projects"("resource_kind", "source_type");
