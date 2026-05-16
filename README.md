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

> **2026-05 项目方向重塑**：Launchly 已从「自托管部署测试协作平台」收敛为「**双模式同源的轻量代码自动部署平台**」。决策与历史材料已归档；**当前以 [产品设计规范](docs/basic/产品设计规范.md) 为产品权威**。归档索引：[docs/archive/v1-2026-05/README.md](docs/archive/v1-2026-05/README.md)。新方向在 `refactor/dual-mode-deploy` 分支下开发。
>
> **文档上传说明**：仓库只上传 `docs/basic/` 下三份基线规范；`docs/work/`、`docs/archive/`、`docs/prototypes/` 属于本地协作文档和原型资料，已加入 `.gitignore`，README 中相关链接仅在维护者本地工作区可用。

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
- [权威文档](#权威文档)
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
- **省心默认路径**：少填表、多推断；命令与容器细节默认对用户不可见，高级能力渐进披露（详见 [产品设计规范](docs/basic/产品设计规范.md) 第 4 节与归档 zero-config 全文）。
- **部署工具型壳层**：默认首屏突出运行中部署与下一步；目标布局见 [系统设计mock.html](docs/prototypes/系统设计mock.html)；信息架构见 [UI与交互规范](docs/basic/UI与交互规范.md) 第 2 节、[产品设计规范](docs/basic/产品设计规范.md) 第 6 节；实现任务见归档 [AI开发任务包 §15](docs/archive/v1-2026-05/root/AI开发任务包.md)（T-IA）。
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
docs/basic               产品设计规范 / 技术架构规范 / UI与交互规范（权威）
docs/work                [planning.md](docs/work/planning.md)（全局 16 周）；`phase1|phase2|phase3/weekNN/` 各含 week-N-plan/test/log/review 四件套
docs/archive             历史文档 v1 归档
docs/prototypes          静态 HTML 交互原型
# （可选）本地自建目录名任意；若在仓库根 .gitignore 中配置了忽略规则，则不进远端——不是协作拆解的一部分
scripts                  工具脚本目录
```

## 快速开始

当前还不是可用产品，以下命令仅用于验证开发骨架。

前置条件（必须）：

- 已安装 Docker，且 Docker 引擎正在运行。
- **能稳定访问 Docker Hub**（`docker compose --build` 会拉取 `maven`、`node`、`eclipse-temurin`、`postgres` 等镜像）。若构建阶段出现 `failed to do request ... EOF` 或访问 `registry-1.docker.io` 超时，多为网络/代理/镜像站问题：在 Docker Desktop 配置 **Registry mirrors** 或 **HTTP/HTTPS 代理**、稍后重试、或先单独执行 `docker pull maven:3.9-eclipse-temurin-17` 等预热镜像。
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

**类型检查 / 生产构建（二选一执行，不要把中文说明粘进同一行命令）**

在仓库根目录：

```bash
pnpm install
pnpm --filter @launchly/web exec vue-tsc --noEmit
```

或（含类型检查 + Vite 打包，与 CI 更接近）：

```bash
pnpm install
pnpm --filter @launchly/web build
```

若已在 `apps/web` 目录下：

```bash
pnpm install
pnpm exec vue-tsc --noEmit
```

或：

```bash
pnpm install
pnpm build
```

说明：`pnpm build` 在 `apps/web` 里等价于 `vue-tsc --noEmit && vite build`（见 `apps/web/package.json`）。若把 `（或 …）` 等说明和 `--noEmit` 写在同一行，会出现 `TS5025: Unknown compiler option '--noEmit（或'`。

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
- 产品决策写入 **`docs/basic/`** 三份规范；**先改文档再改代码**。
- **协作拆解**：唯一入口为 [`docs/work/planning.md`](docs/work/planning.md) → `docs/work/phase*/weekNN/week-N-plan.md`（含 DeepSeek「命簿」）。DeepSeek **单次会话只推进一个工作日**；收工按 [`DeepSeek日志结构.md`](docs/work/DeepSeek日志结构.md) **追加写入** 当周的 `week-N-log.md`。**禁止**平行会话目录或其它第二份日志。
- 若个人仍要随手记：可在本地自建任意草稿目录并自行 gitignore；**不得**当作 `week-*-plan.md` 的替代品。
- 人主要负责审核边界和关键决策，AI 尽量执行可落地的代码、文档和验证任务。
- 实现应与 **[产品设计规范](docs/basic/产品设计规范.md) + [技术架构规范](docs/basic/技术架构规范.md) + [UI与交互规范](docs/basic/UI与交互规范.md)** 保持一致。

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
| UI 导航全面收敛（协作入口二级化） | 改造中；目标见 [UI与交互规范](docs/basic/UI与交互规范.md) 与 [`系统设计mock.html`](docs/prototypes/系统设计mock.html)；任务 T-IA 见 [归档任务包 §15](docs/archive/v1-2026-05/root/AI开发任务包.md) |
| **未开始** | |
| SaaS 控制面（注册 / 计费 / 多租户） | 未开始 |
| AI 增值功能 | 未开始 |
| Self-Host CLI（install / backup / restore） | 未开始 |
| 端到端联调与发布 | 未开始 |

## 权威文档

公开仓库只保留以下 **三份基线规范**。总体规划、工作日志、历史归档和静态原型为本地协作文档，README 保留链接是为了维护者本地跳转；这些目录默认不上传远端。

| 文档 | 路径 | 说明 |
| --- | --- | --- |
| **产品设计规范** | [docs/basic/产品设计规范.md](docs/basic/产品设计规范.md) | 定位、模型、权限、流程 |
| **技术架构规范** | [docs/basic/技术架构规范.md](docs/basic/技术架构规范.md) | 技术栈、架构、模块、安全 |
| **UI 与交互规范** | [docs/basic/UI与交互规范.md](docs/basic/UI与交互规范.md) | 页面、交互、原型索引 |
| **总体规划（本地）** | [docs/work/planning.md](docs/work/planning.md) | 本地协作入口；不随仓库上传 |

**工作日志（本地）**：仅当周目录下的 `week-N-log.md`。AI 按 [`DeepSeek日志结构.md`](docs/work/DeepSeek日志结构.md) **追加写入**，不要在其它平行路径克隆一份。

**静态原型（本地）**：[流程示意图](docs/prototypes/流程示意图.html)、[系统设计mock](docs/prototypes/系统设计mock.html)、[环境页面mock](docs/prototypes/环境页面mock.html)。

## 参与贡献

项目尚未进入正式开源协作阶段。当前更适合围绕产品设计、架构边界、MVP 任务拆分和基础实现进行小范围迭代。

后续正式开放贡献前，建议补充：

- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- Issue / PR 模板

## 开源协议

本项目以 **GNU Affero General Public License v3.0（AGPL-3.0）** 授权，完整条款见仓库根目录 [LICENSE](LICENSE) 文件。
