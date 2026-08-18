-- KI-016：每个环境变量 key 在同一环境内必须唯一，防止部署时发生静默覆盖。
-- R0-05 验收项 BASE-08。
CREATE UNIQUE INDEX "environment_variables_environment_id_key_key"
  ON "environment_variables" ("environment_id", "key");
