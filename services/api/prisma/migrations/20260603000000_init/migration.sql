-- Launchly v0.2 — Baseline migration
-- Generated from Prisma schema. PostgreSQL only.

-- CreateTable
CREATE TABLE "users" (
    "id" VARCHAR(36) NOT NULL,
    "account" VARCHAR(255) NOT NULL,
    "display_name" VARCHAR(255),
    "password_hash" VARCHAR(255) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_account_key" ON "users"("account");

-- CreateTable
CREATE TABLE "workspaces" (
    "id" VARCHAR(36) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_members" (
    "id" VARCHAR(36) NOT NULL,
    "workspace_id" VARCHAR(36) NOT NULL,
    "user_id" VARCHAR(36) NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_members_workspace_id_user_id_key" ON "workspace_members"("workspace_id", "user_id");

-- CreateTable
CREATE TABLE "invitations" (
    "id" VARCHAR(36) NOT NULL,
    "workspace_id" VARCHAR(36) NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "max_uses" INTEGER NOT NULL DEFAULT 1,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_key" ON "invitations"("token");

-- CreateTable
CREATE TABLE "projects" (
    "id" VARCHAR(36) NOT NULL,
    "workspace_id" VARCHAR(36) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "project_type" VARCHAR(50) NOT NULL DEFAULT 'CUSTOM',
    "repository_url" VARCHAR(1024),
    "default_branch" VARCHAR(255) NOT NULL DEFAULT 'main',
    "git_provider" VARCHAR(50),
    "install_command" VARCHAR(500),
    "build_command" VARCHAR(500),
    "start_command" VARCHAR(500),
    "test_command" VARCHAR(500),
    "health_check_path" VARCHAR(500),
    "default_port" INTEGER,
    "created_by" VARCHAR(36),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "components" (
    "id" VARCHAR(36) NOT NULL,
    "project_id" VARCHAR(36) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "repository_url" VARCHAR(1024),
    "build_command" VARCHAR(500),
    "start_command" VARCHAR(500),
    "health_check_path" VARCHAR(500),
    "default_port" INTEGER,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "components_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "components_project_id_idx" ON "components"("project_id");

-- CreateTable
CREATE TABLE "repository_credentials" (
    "id" VARCHAR(36) NOT NULL,
    "project_id" VARCHAR(36) NOT NULL,
    "credential_type" VARCHAR(50) NOT NULL,
    "encrypted_value" TEXT NOT NULL,
    "masked_preview" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repository_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repository_credentials_project_id_key" ON "repository_credentials"("project_id");

-- CreateTable
CREATE TABLE "environments" (
    "id" VARCHAR(36) NOT NULL,
    "project_id" VARCHAR(36) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "url" VARCHAR(1024),
    "status" VARCHAR(50),
    "current_deployment_id" VARCHAR(36),
    "deploy_mode" VARCHAR(50) DEFAULT 'local',
    "host" VARCHAR(255),
    "ssh_user" VARCHAR(255),
    "deploy_dir" VARCHAR(500),
    "external_port" INTEGER,
    "data_strategy" VARCHAR(50),
    "enabled" BOOLEAN DEFAULT true,
    "local_work_root" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "environments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "environments_project_id_type_idx" ON "environments"("project_id", "type");

-- CreateTable
CREATE TABLE "environment_variables" (
    "id" VARCHAR(36) NOT NULL,
    "environment_id" VARCHAR(36) NOT NULL,
    "key" VARCHAR(255) NOT NULL,
    "encrypted_value" TEXT NOT NULL,
    "masked_value" VARCHAR(255),
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "description" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "environment_variables_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "environment_variables_environment_id_idx" ON "environment_variables"("environment_id");

-- CreateTable
CREATE TABLE "deployments" (
    "id" VARCHAR(36) NOT NULL,
    "project_id" VARCHAR(36) NOT NULL,
    "environment_id" VARCHAR(36) NOT NULL,
    "deploy_target_id" VARCHAR(36),
    "branch" VARCHAR(255),
    "commit_sha" VARCHAR(255),
    "status" VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    "triggered_by" VARCHAR(36),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "error_message" TEXT,
    "rollback_from_deployment_id" VARCHAR(36),
    "access_url" VARCHAR(512),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deployments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deployments_project_id_idx" ON "deployments"("project_id");
CREATE INDEX "deployments_environment_id_idx" ON "deployments"("environment_id");
CREATE INDEX "deployments_deploy_target_id_idx" ON "deployments"("deploy_target_id");
CREATE INDEX "deployments_status_idx" ON "deployments"("status");

-- CreateTable
CREATE TABLE "deployment_stage_logs" (
    "id" VARCHAR(36) NOT NULL,
    "deployment_id" VARCHAR(36) NOT NULL,
    "stage" VARCHAR(50) NOT NULL,
    "step_order" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(50) NOT NULL,
    "log" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "deployment_stage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deployment_stage_logs_deployment_id_idx" ON "deployment_stage_logs"("deployment_id");

-- CreateTable
CREATE TABLE "deploy_targets" (
    "id" VARCHAR(36) NOT NULL,
    "project_id" VARCHAR(36) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "type" VARCHAR(50) NOT NULL DEFAULT 'SSH',
    "host" VARCHAR(255) NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 22,
    "username" VARCHAR(255) NOT NULL,
    "auth_method" VARCHAR(20) NOT NULL DEFAULT 'KEY',
    "encrypted_credential" TEXT NOT NULL,
    "status" VARCHAR(50),
    "last_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deploy_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deploy_targets_project_id_idx" ON "deploy_targets"("project_id");

-- CreateTable
CREATE TABLE "tasks" (
    "id" VARCHAR(36) NOT NULL,
    "task_type" VARCHAR(50) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "ref_id" VARCHAR(36) NOT NULL,
    "payload" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_status_created_at_idx" ON "tasks"("status", "created_at");
CREATE INDEX "tasks_ref_id_idx" ON "tasks"("ref_id");

-- CreateTable
CREATE TABLE "test_cases" (
    "id" VARCHAR(36) NOT NULL,
    "project_id" VARCHAR(36) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "priority" VARCHAR(10) NOT NULL DEFAULT 'P2',
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "steps" TEXT,
    "expected_result" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "test_cases_project_id_idx" ON "test_cases"("project_id");

-- CreateTable
CREATE TABLE "test_runs" (
    "id" VARCHAR(36) NOT NULL,
    "deployment_id" VARCHAR(36) NOT NULL,
    "project_id" VARCHAR(36) NOT NULL,
    "environment_id" VARCHAR(36) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "total_cases" INTEGER NOT NULL DEFAULT 0,
    "passed_cases" INTEGER NOT NULL DEFAULT 0,
    "failed_cases" INTEGER NOT NULL DEFAULT 0,
    "skipped_cases" INTEGER NOT NULL DEFAULT 0,
    "triggered_by" VARCHAR(36),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "test_runs_project_id_idx" ON "test_runs"("project_id");
CREATE INDEX "test_runs_deployment_id_idx" ON "test_runs"("deployment_id");

-- CreateTable
CREATE TABLE "test_run_cases" (
    "id" VARCHAR(36) NOT NULL,
    "test_run_id" VARCHAR(36) NOT NULL,
    "test_case_id" VARCHAR(36) NOT NULL,
    "result" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "executed_by" VARCHAR(36),
    "executed_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_run_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "test_run_cases_test_run_id_idx" ON "test_run_cases"("test_run_id");
CREATE INDEX "test_run_cases_test_case_id_idx" ON "test_run_cases"("test_case_id");

-- CreateTable
CREATE TABLE "issues" (
    "id" VARCHAR(36) NOT NULL,
    "project_id" VARCHAR(36) NOT NULL,
    "environment_id" VARCHAR(36),
    "deployment_id" VARCHAR(36),
    "test_case_id" VARCHAR(36),
    "test_run_case_id" VARCHAR(36),
    "title" VARCHAR(500) NOT NULL,
    "description" TEXT,
    "priority" VARCHAR(10) NOT NULL DEFAULT 'P2',
    "status" VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    "reporter_id" VARCHAR(36),
    "assignee_id" VARCHAR(36),
    "fixed_commit_sha" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "issues_project_id_idx" ON "issues"("project_id");
CREATE INDEX "issues_assignee_id_idx" ON "issues"("assignee_id");
CREATE INDEX "issues_status_idx" ON "issues"("status");

-- CreateTable
CREATE TABLE "releases" (
    "id" VARCHAR(36) NOT NULL,
    "project_id" VARCHAR(36) NOT NULL,
    "environment_id" VARCHAR(36) NOT NULL,
    "deployment_id" VARCHAR(36) NOT NULL,
    "version" VARCHAR(255) NOT NULL,
    "notes" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "gate_status" VARCHAR(20),
    "released_by" VARCHAR(36),
    "released_at" TIMESTAMP(3),
    "rollback_deployment_id" VARCHAR(36),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "releases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "releases_project_id_idx" ON "releases"("project_id");

-- CreateTable
CREATE TABLE "gate_exemptions" (
    "id" VARCHAR(36) NOT NULL,
    "release_id" VARCHAR(36) NOT NULL,
    "gate_name" VARCHAR(100) NOT NULL,
    "exempted_by" VARCHAR(36),
    "reason" VARCHAR(500),
    "exempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "gate_exemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gate_exemptions_release_id_idx" ON "gate_exemptions"("release_id");

-- CreateTable
CREATE TABLE "notifications" (
    "id" VARCHAR(36) NOT NULL,
    "user_id" VARCHAR(36) NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "content" TEXT,
    "ref_id" VARCHAR(36),
    "read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");
CREATE INDEX "notifications_user_id_read_idx" ON "notifications"("user_id", "read");

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" VARCHAR(36) NOT NULL,
    "workspace_id" VARCHAR(36),
    "user_id" VARCHAR(36),
    "action" VARCHAR(100) NOT NULL,
    "target_type" VARCHAR(50),
    "target_id" VARCHAR(36),
    "detail" TEXT,
    "ip_address" VARCHAR(45),
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_workspace_id_idx" ON "audit_logs"("workspace_id");
CREATE INDEX "audit_logs_user_id_idx" ON "audit_logs"("user_id");
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs"("target_type", "target_id");

-- AddForeignKey
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "components" ADD CONSTRAINT "components_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repository_credentials" ADD CONSTRAINT "repository_credentials_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "environments" ADD CONSTRAINT "environments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "environment_variables" ADD CONSTRAINT "environment_variables_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_deploy_target_id_fkey" FOREIGN KEY ("deploy_target_id") REFERENCES "deploy_targets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_triggered_by_fkey" FOREIGN KEY ("triggered_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_stage_logs" ADD CONSTRAINT "deployment_stage_logs_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "deployments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deploy_targets" ADD CONSTRAINT "deploy_targets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_run_cases" ADD CONSTRAINT "test_run_cases_test_run_id_fkey" FOREIGN KEY ("test_run_id") REFERENCES "test_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "test_run_cases" ADD CONSTRAINT "test_run_cases_test_case_id_fkey" FOREIGN KEY ("test_case_id") REFERENCES "test_cases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "issues" ADD CONSTRAINT "issues_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "issues" ADD CONSTRAINT "issues_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "releases" ADD CONSTRAINT "releases_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gate_exemptions" ADD CONSTRAINT "gate_exemptions_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
