<p align="center">
  <img alt="status" src="https://img.shields.io/badge/status-pre--alpha-d9534f">
  <img alt="license" src="https://img.shields.io/badge/license-TBD-6c757d">
  <img alt="web" src="https://img.shields.io/badge/web-Vue%203%20%2B%20TypeScript-42b883">
  <img alt="api" src="https://img.shields.io/badge/api-Spring%20Boot%203-6db33f">
  <img alt="cli" src="https://img.shields.io/badge/cli-Go-00add8">
  <img alt="database" src="https://img.shields.io/badge/database-PostgreSQL-4169e1">
  <img alt="deploy" src="https://img.shields.io/badge/deploy-Docker%20Compose-2496ed">
</p>

<h1 align="center">Launchly</h1>

<p align="center">
  <strong>自托管部署测试协作平台</strong>
</p>

<p align="center">
  面向个人开发者和小团队，把 Git 项目接入、测试环境部署、预发验证、生产发布、测试用例、问题指派和发布记录放到一个轻量系统里管理。
</p>

<p align="center">
  <a href="README.en.md">English Documentation</a>
</p>

---

## 目录

- [为什么是 Launchly](#为什么是-launchly)
- [项目状态](#项目状态)
- [设计理念](#设计理念)
- [系统架构](#系统架构)
- [功能规划](#功能规划)
- [目录结构](#目录结构)
- [快速开始](#快速开始)
- [开发指南](#开发指南)
- [项目进展](#项目进展)
- [文档](#文档)
- [参与贡献](#参与贡献)
- [开源协议](#开源协议)

---

## 为什么是 Launchly

很多个人项目和小团队项目不是缺少 Git 仓库，而是缺少一条清晰、低成本、可追踪的发布测试链路：

- 代码提交后，测试环境经常靠人工部署。
- 测试人员不知道当前环境部署的是哪个 commit。
- 测试用例、失败截图、修复任务、复测结果分散在不同地方。
- 预发和生产发布缺少统一门禁、记录和回滚点。
- 小团队不一定需要完整企业 DevOps 平台，但需要一个能本地部署、开箱即用的协作工具。

Launchly 的目标是补上这条轻量链路。

## 项目状态

Launchly 当前处于 **pre-alpha / MVP 联调准备阶段**。

已经完成：

- 产品设计文档归档与架构设计。
- 基础 monorepo 目录结构。
- Web/API/Worker/CLI 核心模块（第 1-13 周）。
- JWT 鉴权与 Owner 初始化主流程。
- 部署任务链路（clone/build/deploy/health check）与阶段日志。
- 测试用例、Issue、Release、门禁、回滚基础链路。
- Docker Compose 本地构建部署模板。

尚未完成：

- 成员管理页面 `/members`（当前为占位页）。
- 权限系统细粒度 RBAC（当前为 MVP 基础鉴权）。
- `launchly install` 远程镜像发布链路（本地 compose build 已可用）。

## 设计理念

- **本地优先**：最终用户不应手动准备数据库、队列、对象存储等内部依赖。
- **一键部署**：通过 `launchly install` 初始化内置 PostgreSQL、App、Worker、默认存储和最高权限管理员。
- **小团队友好**：不做复杂企业平台，优先解决项目接入、部署、测试、修复、复测和上线闭环。
- **流程可追踪**：每次部署、测试、Issue、Release、回滚都应留下记录。
- **人和 AI 协同开发**：开发任务要能被人和 AI 同时理解、拆分、执行和验收。

## 系统架构

Launchly 第一阶段采用“模块化单体 + 后台任务执行器 + CLI 一键部署”的架构。

```text
launchly CLI
  -> Docker Compose
      -> launchly-app      Web UI + API
      -> launchly-worker   后台任务执行器
      -> launchly-postgres 内置 PostgreSQL
      -> launchly-data     本地文件、日志、附件和截图
```

核心模块：

| 模块 | 说明 |
| --- | --- |
| Web UI | 工作台、项目、部署、测试、Issue、Release 页面 |
| API Server | 认证、Workspace、项目、环境、部署、测试、权限等业务接口 |
| Worker | 执行拉代码、构建、部署、自动测试、通知等后台任务 |
| CLI | 管理安装、启动、停止、升级、备份、恢复和诊断 |
| PostgreSQL | 内置数据库，默认随安装启动 |
| Docker Compose | 第一阶段自托管交付方式 |

## 功能规划

Launchly 最终计划支持：

- `launchly install` 一键部署本地或服务器实例。
- 首次安装后创建 Owner 账号和默认 Workspace。
- 邀请成员加入 Workspace，并按角色授权。
- 绑定 GitHub、GitLab 或私有 Git 仓库。
- 将项目发布到 Test、Staging、Production 环境。
- 管理环境变量和敏感配置。
- 记录测试用例、测试执行结果、失败截图和日志。
- 将测试失败项指派给具体成员修复，并支持复测关闭。
- 在生产发布前执行发布门禁检查。
- 记录 Release、部署日志、审计日志和回滚点。

## 目录结构

```text
apps/web                 Vue 3 Web UI 骨架
services/api             Spring Boot API Server 骨架
services/worker          Spring Boot Worker 骨架
cli                      launchly CLI 骨架
deploy/compose           自托管 Docker Compose 模板
docs/product             产品需求、流程图、架构和技术方案
docs/dev-tasks           本地开发任务文档，已被 git 忽略
scripts                  工具脚本目录
```

## 快速开始

当前还不是可用产品，以下命令仅用于验证开发骨架。

前置条件（必须）：

- 已安装 Docker，且 Docker 引擎正在运行。
- 本地 `5432` 端口可用（或通过环境变量改用其他端口，例如 `LAUNCHLY_DB_PORT=55432`）。
- 如果跳过数据库步骤直接启动 API，启动会失败（`Connection refused` / `Failed to configure a DataSource`）。

### 1. CLI 骨架

```bash
cd cli
go test ./...
go run ./cmd/launchly doctor
```

### 2. 启动 PostgreSQL（API 依赖）

API 需要 PostgreSQL 才能启动。本地开发时用 Docker 快速起一个：

```bash
docker run -d --name launchly-postgres-dev \
  -e POSTGRES_USER=launchly \
  -e POSTGRES_PASSWORD=launchly_dev_password \
  -e POSTGRES_DB=launchly \
  -p 5432:5432 \
  postgres:16-alpine
```

> 一键部署（`launchly install`）会通过 docker-compose 自动启动 PostgreSQL，不需要手动执行这一步。这个手动启动仅用于本地开发。

### 3. API 骨架

```bash
cd services/api
mvn spring-boot:run
```

启动后 API 会自动执行 Flyway 数据库迁移。

如果你本地 PostgreSQL 不在 `5432`，启动时显式指定端口：

```bash
cd services/api
LAUNCHLY_DB_PORT=55432 mvn spring-boot:run
```

健康检查：

```bash
curl http://localhost:8080/api/health
```

### 4. Web 骨架

```bash
pnpm install
pnpm dev:web
```

## 开发指南

推荐本地工具：

| 工具 | 用途 |
| --- | --- |
| Node.js + pnpm | 前端开发 |
| Java 17 + Maven | API 和 Worker 开发 |
| Go | CLI 开发 |
| Docker + Docker Compose | 自托管部署和本地集成 |
| PostgreSQL | 本地调试数据库，最终产品会内置 |

API 开发约定：

- 后端框架：Spring Boot 3.x，通过 `spring-boot-starter-web` 提供 REST API。
- 数据库：PostgreSQL，通过 Flyway 管理数据库迁移。
- 安全：Spring Security + JWT（Bearer Token）已接入，受保护接口需要登录态；RBAC 细粒度权限仍在后续迭代。
- API 模块按 `auth`、`workspace`、`project`、`environment`、`deployment`、`testcase`、`issue`、`release`、`notification`、`audit`、`common` 分包，对应产品设计中的核心模块。
- Worker 部署流水线已接入任务串行执行（clone -> build -> deploy -> health check）和阶段日志。
- 环境变量敏感值已启用加密存储，部署时在 Worker 侧解密注入。

开发原则：

- 对外 README 只描述真实状态，不把计划能力写成已完成能力。
- 产品决策写入 `docs/product`。
- 本地开发计划写入 `docs/dev-tasks`，该目录不会上传。
- 周任务文档采用 AI 主执行格式：写清楚目标、前置条件、人工审核点、任务文件、输入、输出、约束和完成标准。
- 人主要负责审核边界和关键决策，AI 尽量执行可落地的代码、文档和验证任务。
- 实现应和当前产品设计保持一致。

## 项目进展

| 项目 | 状态 |
| --- | --- |
| 产品设计文档 | 已完成 v0.4 |
| 基础目录结构 | 已完成 |
| Web UI 骨架 | 已完成 |
| API Server 骨架 | 已完成 |
| Worker 骨架 | 已完成 |
| CLI 骨架 | 已完成 |
| Docker Compose 模板 | 已完成 |
| 第 1 周：基础与开发基线 | 已完成 |
| 第 2-13 周核心模块 | 已完成（已可进入 MVP 联调） |
| 账号与 Workspace | 已实现基础流程 |
| 项目接入与仓库绑定 | 已实现基础流程 |
| 部署执行与环境管理 | 已实现基础流程 |
| 测试、Issue、Release 门禁 | 已实现基础流程 |
| 成员管理页面 `/members` | 占位，待实现 |
| CLI 远程镜像一键安装 | 依赖镜像发布，待补齐发布链路 |

## 文档

- [Launchly 产品需求、流程图、架构与技术方案](docs/product/Launchly-design.md)
- 本地开发路线和周计划位于 `docs/dev-tasks/`，该目录已被 `.gitignore` 忽略。

## 参与贡献

项目尚未进入正式开源协作阶段。当前更适合围绕产品设计、架构边界、MVP 任务拆分和基础实现进行小范围迭代。

后续正式开放贡献前，需要补充：

- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- Issue / PR 模板
- LICENSE

## 开源协议

许可证尚未确定。正式开源前需要补充 `LICENSE` 文件。
