-- Each BYOS target may use a writable NAS/shared directory instead of /var/lib.
ALTER TABLE "deploy_targets"
  ADD COLUMN "work_root" VARCHAR(500) NOT NULL DEFAULT '/var/lib/launchly';
