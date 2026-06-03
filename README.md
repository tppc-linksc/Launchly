<p align="center">
  <img alt="status" src="https://img.shields.io/badge/status-beta-yellow">
  <img alt="license" src="https://img.shields.io/badge/license-AGPL--3.0-blue">
  <img alt="web" src="https://img.shields.io/badge/web-Vue%203%20%2B%20TypeScript-42b883">
  <img alt="api" src="https://img.shields.io/badge/api-NestJS%20+%20TypeScript-e0234e">
  <img alt="cli" src="https://img.shields.io/badge/cli-TypeScript-3178c6">
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

> **2026-05 项目方向重塑**：Launchly 已从「自托管部署测试协作平台」收敛为「**双模式同源的轻量代码自动部署平台**」。决策与历史材料已归档；**当前以 [产品设计规范](docs/basic/产品设计规范.md) 为产品权威**。归档索引：`docs/archive/v1-2026-05/README.md`（本地归档，未随仓库上传）。新方向在 `refactor/dual-mode-deploy` 分支下开发。
>
> **文档上传说明**：仓库只上传 `docs/basic/` 下三份基线规范；`docs/work/`、`docs/archive/`、`docs/prototypes/` 属于本地协作文档和原型资料，已加入 `.gitignore`，README 中相关链接仅在维护者本地工作区可用。

---

## 目录

- [目录](#目录)
- [Launchly](#launchly)
- [项目状态](#项目状态)
- [设计理念](#设计理念)
- [系统架构](#系统架构)
- [功能规划](#功能规划)
  - [核心引擎](#核心引擎)
  - [协作（基础）](#协作基础)
  - [SaaS 控制面](#saas-控制面)
  - [Self-Host 运维](#self-host-运维)
  - [付费增值（Pro 专属 / 远期）](#付费增值pro-专属--远期)
- [目录结构](#目录结构)
- [快速开始](#快速开始)
  - [一键安装（推荐）](#一键安装推荐)
  - [常用命令](#常用命令)
  - [验证部署](#验证部署)
  - [开发模式](#开发模式)
  - [故障排查](#故障排查)
- [开发指南](#开发指南)
- [项目进展](#项目进展)
- [权威文档](#权威文档)
- [参与贡献](#参与贡献)
- [开源协议](#开源协议)

---

## Launchly

很多个人项目和小团队项目不是缺少 Git 仓库，而是缺少一条从代码到运行环境的低成本、可重复、可追踪通路：

- 代码提交后，测试环境经常靠人工部署，出了问题不知道上次部署的是哪个 commit。
- 每次部署都要手动 SSH 上去敲 `git pull && docker build && docker run`，烦琐且容易出错。
- 测试用例、失败截图、修复任务、复测结果分散在聊天记录和文档里，没有统一入口。
- 预发和生产发布缺少门禁和回滚保护，一次误操作就可能导致线上事故。
- 小团队不需要完整企业 DevOps 平台，但需要一个能本地部署或 SaaS 即用的轻量工具。

Launchly 的目标是补上这条链路：**接入仓库 → 构建 → 部署 → 健康检查 → 回滚**，并内置测试集成、Issue 跟踪、Release 门禁、审计和通知作为基础功能。

## 项目状态

Launchly 当前处于 **Beta 阶段**。核心部署链路、CLI 安装器、Web 工作台已可用，正在准备小范围早期试用。

**已完成**：

- 产品设计文档归档与架构设计
- 基础 monorepo 目录结构
- Web/API/Worker/CLI 核心模块骨架
- JWT 鉴权与 Owner 初始化主流程
- 部署任务链路（clone/build/deploy/health check）与阶段日志
- 测试用例、Issue、Release、门禁、回滚基础链路
- Docker Compose 本地构建部署模板
- DeployTarget API 与前端部署目标管理页
- Worker BYOS（SSH 远程执行，本机构建镜像 + SSH 下发远端 compose）
- CLI 安装器（install/up/down/status/logs/doctor/backup/restore/upgrade/uninstall）
- UI 导航收敛（顶栏 + 水平胶囊导航，运行态 Dashboard）
- 全局错误提示、空状态 CTA、响应式适配
- `triggeredByName` 触发人展示
- Viewer 权限控制（隐藏写操作按钮）
- 项目列表卡片化（卡片+最近部署状态）
- 成员管理页面（列表、角色变更、移除）
- Component 多发布单元数据模型
- 审计日志 CSV 导出
- 设计系统 token 落地（Element Plus 主色 #0D9488）
- EDITION 开关（cloud/selfhost 模式）
- Zero-Config Node 推断（自动检测 package.json）
- 完整测试体系（API Jest 42 测试 + 前端 Vitest 22 测试 + CLI Vitest 15 测试）

**未开始**：

- SaaS 控制面（注册、计费、多租户）
- AI 增值功能（报告、异常归因、安全监控）
- 第三方通知绑定

## 设计理念

- **本地优先**：最终用户不应手动准备数据库、队列、对象存储等内部依赖。
- **一键部署**：通过 `launchly install` 初始化内置 PostgreSQL、App、Worker、默认存储和最高权限管理员。
- **小团队友好**：不做复杂企业平台，优先解决项目接入、部署、测试、修复、复测和上线闭环。
- **省心默认路径**：少填表、多推断；命令与容器细节默认对用户不可见，高级能力渐进披露（详见 [产品设计规范](docs/basic/产品设计规范.md) 第 4 节与归档 zero-config 全文）。
- **部署工具型壳层**：默认首屏突出运行中部署与下一步；目标布局见 `docs/prototypes/Launchly-prototype.html`（本地原型，未随仓库上传）；信息架构见 [UI与交互规范](docs/basic/UI与交互规范.md) 第 2 节、[产品设计规范](docs/basic/产品设计规范.md) 第 6 节；实现任务见归档 `docs/archive/v1-2026-05/root/AI开发任务包.md` §15（T-IA，本地归档）。
- **流程可追踪**：每次部署、测试、Issue、Release、回滚都应留下记录。
- **人和 AI 协同开发**：开发任务要能被人和 AI 同时理解、拆分、执行和验收。

## 系统架构

Launchly 第一阶段采用"模块化单体（NestJS）+ 内置后台任务执行器 + CLI 一键部署"的架构。v0.2 起 API 与 Worker 合并为单一 NestJS 进程。

```text
launchly CLI
  -> Docker Compose
      -> launchly-app      Web UI + API + Worker（单进程）
      -> launchly-postgres 内置 PostgreSQL
      -> launchly-data     本地文件、日志、附件和截图
```

核心模块：

| 模块 | 说明 |
| --- | --- |
| Web UI | 工作台、项目、部署、测试、Issue、Release 页面 |
| API Server | 认证、Workspace、项目、环境、部署、测试、权限等业务接口（NestJS） |
| Worker | 后台任务执行器（内嵌于 API 进程，基于 PostgreSQL 轮询） |
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
apps/web                 Vue 3 + Element Plus Web UI
services/api             NestJS API Server + Worker（单进程）
cli                      TypeScript CLI（commander.js）
deploy/compose           自托管 Docker Compose 模板
examples                 示例项目（用于验证部署流程）
docs/basic               产品设计规范 / 技术架构规范 / UI与交互规范（权威）
docs/work                planning.md（全局 16 周，本地协作，未随仓库上传）
docs/archive             历史文档 v1 归档（本地，未随仓库上传）
docs/prototypes          静态 HTML 交互原型（本地，未随仓库上传）
# （可选）本地自建目录名任意；若在仓库根 .gitignore 中配置了忽略规则，则不进远端——不是协作拆解的一部分
```

## 快速开始

**前置条件**：

- Docker 已安装且正在运行
- 本地 `8080`、`5432` 端口可用（或通过环境变量自定义）

### 一键安装（推荐）

```bash
# 安装依赖并编译 CLI
cd cli && pnpm install && pnpm build

# 预览安装（不实际执行）
node dist/index.js install --dry-run

# 正式安装
node dist/index.js install
```

安装完成后：

1. 打开 `http://localhost:8080/setup`
2. 创建管理员账号和默认 Workspace
3. 登录后即可开始使用

### 常用命令

安装后 CLI 二进制位于 `cli/dist/index.js`，可通过 `node` 调用：

```bash
node dist/index.js doctor      # 检查系统环境（Docker、端口、磁盘）
node dist/index.js status      # 查看服务状态
node dist/index.js logs -f     # 实时查看日志
node dist/index.js up          # 启动服务
node dist/index.js down        # 停止服务
node dist/index.js backup      # 备份数据库和数据
node dist/index.js restore <file>  # 从备份恢复
```

### 验证部署

安装完成后，可以用 `examples/node-hello` 示例项目验证部署流程：

1. 将 `examples/node-hello` 推送到 Git 仓库
2. 在 Launchly 中创建项目，连接该仓库
3. 添加部署目标（SSH 服务器地址、端口、用户名、认证方式）
4. 配置环境变量（可选）
5. 触发部署，观察阶段管线（克隆 → 构建 → 部署 → 健康检查）

### 开发模式

如果需要本地开发调试，有两种模式：

**模式 A：本地开发最小模式**

```bash
# 启动 PostgreSQL
docker run -d --name launchly-postgres-dev \
  -e POSTGRES_USER=launchly \
  -e POSTGRES_PASSWORD=launchly_dev_password \
  -e POSTGRES_DB=launchly \
  -p 5432:5432 \
  postgres:16-alpine

# 启动 API + Worker
cd services/api
set -a && source ../../.env && set +a
pnpm run start:dev
```

**模式 B：Compose 全栈模式**

```bash
set -a && source ./.env && set +a
docker compose -f deploy/compose/docker-compose.yml up -d --build
```

**Web 开发**

```bash
# 根目录安装所有依赖（含 workspaces）
pnpm install

# 启动前端开发服务器（http://localhost:5173）
pnpm dev:web
```

### 故障排查

| 问题 | 排查方式 |
| --- | --- |
| 端口被占用 | `node dist/index.js doctor` 会检测 8080/5173/5432 端口 |
| Docker 未运行 | `node dist/index.js doctor` 会提示 Docker 状态 |
| 安装后无法访问 | 检查 `node dist/index.js status` 确认服务是否启动 |
| 部署失败 | 查看 `node dist/index.js logs -f` |
| 数据库连接失败 | 确认 PostgreSQL 容器运行中：`docker ps` |
| 密钥变更后数据异常 | `LAUNCHLY_ENCRYPTION_KEY` 变化会导致已加密数据无法解密，需保持一致 |

## 开发指南

推荐本地工具：

| 工具 | 用途 |
| --- | --- |
| Node.js 20+ + pnpm | 前端、API 和 CLI 开发 |
| Docker + Docker Compose | 自托管部署和本地集成 |
| PostgreSQL | 本地调试数据库，最终产品会内置 |

API 开发约定：

- 后端框架：NestJS 10.x，通过 `@nestjs/platform-express` 提供 REST API。
- ORM：Prisma，通过 `prisma migrate` 管理数据库迁移。
- 安全：自定义 JWT Guard + RBAC Role Guard，受保护接口需要登录态。
- API 模块按 `auth`、`workspace`、`project`、`environment`、`deployment`、`target`、`testcase`、`issue`、`release`、`notification`、`audit`、`worker` 分包，对应产品设计中的核心模块。
- Worker 后台任务内嵌于 API 进程，通过 `@nestjs/schedule` 定时轮询 PostgreSQL 任务队列。
- 部署流水线已接入任务串行执行（clone -> build -> deploy -> health check）和阶段日志。
- 环境变量敏感值已启用加密存储（AES-256-GCM），部署时在 Worker 侧解密注入。

测试：

```bash
pnpm test          # 运行全部测试（API + 前端 + CLI）
pnpm test:api      # 仅运行 API 测试（Jest）
pnpm test:web      # 仅运行前端测试（Vitest）
pnpm test:cli      # 仅运行 CLI 测试（Vitest）
```

开发原则：

- 对外 README 只描述真实状态，不把计划能力写成已完成能力。
- 产品决策写入 **`docs/basic/`** 三份规范；**先改文档再改代码**。
- **协作拆解**：唯一入口为 `docs/work/planning.md` → `docs/work/phase*/weekNN/week-N-plan.md`（含 DeepSeek「命簿」，本地协作，未随仓库上传）。DeepSeek **单次会话只推进一个工作日**；收工按 `DeepSeek日志结构.md` **追加写入** 当周的 `week-N-log.md`。**禁止**平行会话目录或其它第二份日志。
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
| DeployTarget API、删除 409 校验、前端部署目标页 | 已完成 |
| Worker BYOS（本机构建镜像 + SSH 下发远端 compose） | 已完成 |
| Self-Host CLI（install / up / down / status / logs / doctor / backup / restore） | 已完成 |
| UI 导航收敛（顶栏 + 水平胶囊导航，运行态 Dashboard） | 已完成 |
| 全局错误提示、空状态 CTA、响应式适配 | 已完成 |
| Viewer 权限控制（隐藏写操作按钮） | 已完成 |
| 项目列表卡片化 | 已完成 |
| 成员管理页面 | 已完成 |
| 数据模型 Component（多发布单元） | 已完成 |
| 审计日志 CSV 导出 | 已完成 |
| 设计系统 token 落地 | 已完成 |
| EDITION 开关（cloud/selfhost） | 已完成 |
| Zero-Config Node 推断 | 已完成 |
| 完整测试体系（79 个测试用例，全部通过） | 已完成 |
| **未开始** | |
| SaaS 控制面（注册 / 计费 / 多租户） | 未开始 |
| AI 增值功能 | 未开始 |
| 端到端联调与发布 | 未开始 |

## 权威文档

公开仓库只保留以下 **三份基线规范**。总体规划、工作日志、历史归档和静态原型为本地协作文档，README 保留链接是为了维护者本地跳转；这些目录默认不上传远端。

| 文档 | 路径 | 说明 |
| --- | --- | --- |
| **产品设计规范** | [docs/basic/产品设计规范.md](docs/basic/产品设计规范.md) | 定位、模型、权限、流程 |
| **技术架构规范** | [docs/basic/技术架构规范.md](docs/basic/技术架构规范.md) | 技术栈、架构、模块、安全 |
| **UI 与交互规范** | [docs/basic/UI与交互规范.md](docs/basic/UI与交互规范.md) | 页面、交互、原型索引 |
| **总体规划（本地）** | `docs/work/planning.md` | 本地协作入口；未随仓库上传 |

**工作日志（本地）**：仅当周目录下的 `week-N-log.md`。AI 按 `DeepSeek日志结构.md` **追加写入**，不要在其它平行路径克隆一份。

**静态原型（本地）**：`docs/prototypes/Launchly-prototype.html`（未随仓库上传）。

## 参与贡献

项目尚未进入正式开源协作阶段。当前更适合围绕产品设计、架构边界、MVP 任务拆分和基础实现进行小范围迭代。

后续正式开放贡献前，建议补充：

- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- Issue / PR 模板

## 开源协议

本项目以 **GNU Affero General Public License v3.0（AGPL-3.0）** 授权，完整条款见仓库根目录 [LICENSE](LICENSE) 文件。
