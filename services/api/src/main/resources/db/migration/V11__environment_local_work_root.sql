-- Parent directory on the worker host for git clone / build / local docker compose (per environment).
-- Distinct from deploy_dir, which RemoteSshRunner uses as the target path on the remote BYOS host.
ALTER TABLE environments
  ADD COLUMN IF NOT EXISTS local_work_root VARCHAR(500);
