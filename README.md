<p align="center">
  <img alt="status" src="https://img.shields.io/badge/status-pre--alpha-d9534f">
  <img alt="license" src="https://img.shields.io/badge/license-AGPL--3.0-blue">
  <img alt="web" src="https://img.shields.io/badge/web-Vue%203%20%2B%20TypeScript-42b883">
  <img alt="api" src="https://img.shields.io/badge/api-Spring%20Boot%203-6db33f">
  <img alt="cli" src="https://img.shields.io/badge/cli-Go-00add8">
  <img alt="database" src="https://img.shields.io/badge/database-PostgreSQL-4169e1">
  <img alt="deploy" src="https://img.shields.io/badge/deploy-Docker%20Compose-2496ed">
</p>

<h1 align="center">Launchly</h1>

<p align="center">
  <strong>轻量代码自动部署平台 · 双模式交付（SaaS + 开源自托管同源）</strong>
</p>

<p align="center">
  面向 5-20 人小团队及个人开发者，围绕"接入仓库 → 构建 → 部署 → 健康检查 → 回滚"主线，提供双模式同源交付：Launchly Cloud（SaaS，账号注册即用）与 Launchly Self-Host（开源版，用户自部署）。
</p>

<p align="center">
  <a href="README.en.md">English Documentation</a>
</p>

> **2026-05 项目方向重塑**：Launchly 已从「自托管部署测试协作平台」收敛为「**双模式同源的轻量代码自动部署平台**」。详细决策见 [项目重塑计划.md](项目重塑计划.md)。当前主分支仍为旧版本骨架，新方向在 `refactor/dual-mode-deploy` 分支下开发。

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

很多个人项目和小团队项目不是缺少 Git 仓库，而是缺少一条从代码到运行环境的低成本、可重复、可追踪通路：

- 代码提交后，测试环境经常靠人工部署，出了问题不知道上次部署的是哪个 commit。
- 每次部署都要手动 SSH 上去敲 `git pull && docker build && docker run`，烦琐且容易出错。
- 测试用例、失败截图、修复任务、复测结果分散在聊天记录和文档里，没有统一入口。
- 预发和生产发布缺少门禁和回滚保护，一次误操作就可能导致线上事故。
- 小团队不需要完整企业 DevOps 平台，但需要一个能本地部署或 SaaS 即用的轻量工具。

Launchly 的目标是补上这条链路：**接入仓库 → 构建 → 部署 → 健康检查 → 回滚**，并内置测试集成、Issue 跟踪、Release 门禁、审计和通知作为基础功能。

## 项目状态

Launchly 当前处于 **pre-alpha / 方向修正中**。项目正在从旧骨架重构为双模式同源的轻量代码自动部署平台。

**已完成**：

- 产品设计文档归档与架构设计
- 基础 monorepo 目录结构
- Web/API/Worker/CLI 核心模块骨架（第 1-13 周）
- JWT 鉴权与 Owner 初始化主流程
- 部署任务链路（clone/build/deploy/health check）与阶段日志
- 测试用例、Issue、Release、门禁、回滚基础链路
- Docker Compose 本地构建部署模板

**改造中**：

- Worker：从本机 docker.sock 改为 SSH 远程执行（BYOS）
- 数据模型：引入 DeployTarget、Component 实体
- UI：收敛导航，主推部署 / 项目 / 部署目标
- README 与文档：同步新方向

**未开始**：

- SaaS 控制面（注册、计费、多租户）
- AI 增值功能（报告、异常归因、安全监控）
- 第三方通知绑定
- Self-Host CLI 安装器（`launchly install`）

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

### 核心引擎

| 功能 | Cloud Free | Cloud Pro | Self-Host |
| --- | :---: | :---: | :---: |
| 创建项目 | 1-2 个 | 不限 | 不限 |
| 绑定 Git 仓库（GitHub / GitLab / 通用 PAT） | ✓ | ✓ | ✓ |
| 多 Component（一项目多服务） | ✓（UI 默认折叠） | ✓ | ✓ |
| 部署到 BYOS 服务器（SSH / Docker context） | ✓ | ✓ | ✓ |
| 构建 + 部署 + 健康检查 | ✓ | ✓ | ✓ |
| 部署日志实时流 | ✓ | ✓ | ✓ |
| 自动回滚（失败回到上一成功版本） | ✓ | ✓ | ✓ |
| 手动触发部署（用户点击发布） | ✓ | ✓ | ✓ |
| 多环境配置 | 固定 2 层 | 自定义 N 层 | 自定义 N 层 |
| 顺序门禁 L1 | ✓ | ✓ | ✓ |
| 进阶门禁 L2/L3/L4 | ✗ | ✓ | ✓ |
| L0 测试（shell exit code） | ✓ | ✓ | ✓ |
| L1 测试（JUnit XML 解析） | ✓ | ✓ | ✓ |

### 协作（基础）

| 功能 | Cloud Free | Cloud Pro | Self-Host |
| --- | :---: | :---: | :---: |
| Issue 指派 + 复测闭环 | ✓ | ✓ | ✓ |
| Release 记录 | ✓ | ✓ | ✓ |
| 角色：Owner / Member / Viewer | ✓ | ✓ | ✓ |
| 项目级权限（人 x Component x 操作） | ✗ | ✓ | ✓ |
| Webhook 通知 | ✓ | ✓ | ✓ |
| 审计日志 | ✗ | ✓ | ✓ |

### SaaS 控制面

| 功能 | Cloud Free | Cloud Pro | Self-Host |
| --- | :---: | :---: | :---: |
| 邮箱注册 + 邀请加入 | ✓ | ✓ | ✗ |
| 计费门户 + 订阅管理 | – | ✓ | ✗ |

### Self-Host 运维

| 功能 | Cloud Free | Cloud Pro | Self-Host |
| --- | :---: | :---: | :---: |
| CLI install / up / down / status / logs / doctor | ✗ | ✗ | ✓ |
| 备份 / 恢复 | ✗ | ✗ | ✓ |

### 付费增值（Pro 专属 / 远期）

| 功能 | Cloud Free | Cloud Pro | Self-Host |
| --- | :---: | :---: | :---: |
| AI 日报 / 周报 / 月报 | ✗ | ✓ | ✗ |
| AI 异常归因 | ✗ | ✓ | ✗ |
| 项目安全监控 | ✗ | ✓ | ✗ |
| 第三方通知（飞书 / 钉钉 / Slack） | ✗ | ✓ | ✗ |
| Launchly 托管运行时 | ✗ | 远期 | ✗ |

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
| **已完成** | |
| 产品设计文档 | 已完成 |
| 基础 monorepo 目录结构 | 已完成 |
| Web / API / Worker / CLI 核心骨架 | 已完成 |
| JWT 鉴权与 Owner 初始化 | 已完成 |
| 部署任务链路（clone / build / deploy / health check） | 已完成 |
| Docker Compose 本地构建模板 | 已完成 |
| LICENSE 替换为 AGPL-3.0 | 已完成 |
| **改造中** | |
| README / 双模式文档与徽章同步 | 已完成 |
| DeployTarget API、删除 409 校验、前端部署目标页 | 已完成 |
| Worker BYOS（本机构建镜像 + SSH 下发远端 compose） | 已完成（Compose 中 worker 需挂载宿主 `docker.sock`，见 `deploy/compose/docker-compose.yml` 注释） |
| 数据模型 Component（多发布单元） | 未开始 |
| UI 导航全面收敛（协作入口二级化） | 改造中 |
| **未开始** | |
| SaaS 控制面（注册 / 计费 / 多租户） | 未开始 |
| AI 增值功能 | 未开始 |
| Self-Host CLI（install / backup / restore） | 未开始 |
| 端到端联调与发布 | 未开始 |

## 文档

- [Launchly 产品需求、流程图、架构与技术方案](docs/product/Launchly-design.md)
- 本地开发路线和周计划位于 `docs/dev-tasks/`，该目录已被 `.gitignore` 忽略。

## 参与贡献

项目尚未进入正式开源协作阶段。当前更适合围绕产品设计、架构边界、MVP 任务拆分和基础实现进行小范围迭代。

后续正式开放贡献前，建议补充：

- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- Issue / PR 模板

## 开源协议

本项目以 **GNU Affero General Public License v3.0（AGPL-3.0）** 授权，完整条款见仓库根目录 [LICENSE](LICENSE) 文件。
