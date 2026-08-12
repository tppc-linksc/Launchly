-- A domain is an environment-level route. It is intentionally separate from the
-- resolved access URL so the deploy runner can own the Nginx configuration.
ALTER TABLE "environments" ADD COLUMN "domain" VARCHAR(255);
CREATE INDEX "environments_domain_idx" ON "environments"("domain");
