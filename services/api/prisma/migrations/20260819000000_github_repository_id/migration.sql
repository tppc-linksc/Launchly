-- KI-012：项目表增加 github_repository_id 字段，用于与 installation_id 联合唯一定位 GitHub 仓库。
ALTER TABLE "projects" ADD COLUMN "github_repository_id" VARCHAR(36);
CREATE INDEX "projects_github_installation_repo_idx" ON "projects" ("github_installation_id", "github_repository_id");
