<p align="center">
  <img alt="status" src="https://img.shields.io/badge/status-rebooting-orange">
  <img alt="license" src="https://img.shields.io/badge/license-AGPL--3.0-blue">
  <img alt="web" src="https://img.shields.io/badge/web-Vue%203%20%2B%20TypeScript-42b883">
  <img alt="api" src="https://img.shields.io/badge/api-NestJS%20%2B%20PostgreSQL-e0234e">
  <img alt="runtime" src="https://img.shields.io/badge/runtime-BYOS-0d9488">
</p>

<h1 align="center">Launchly</h1>

<p align="center">
  <strong>把通过 CI 的每个提交，清楚、可靠、可回滚地送到自己的服务器。</strong>
</p>

<p align="center">
  中文优先的 BYOS 发布控制面 · 面向个人开发者与 5–20 人小团队
</p>

<p align="center">
  <a href="README.en.md">English Documentation</a>
</p>

> **当前状态（2026-08-13）**：项目正在以 `6add2b9` 为基线重启，处于 **R0 可信基线修复**，不是 Beta。现有代码可作为复用基础，但生产镜像、启动、权限隔离和真实部署仍有阻断；没有对应真实验收记录的能力不得对外称为完成。

## Launchly 是什么

Launchly 连接 Git 提供方与现有 CI，把代码或不可变 OCI 制品部署到用户自己的 Linux/NAS 服务器，并在一个中文控制面中管理：

- 应用、服务、环境和 PR Preview。
- Git Push/PR、CI 门禁和部署并发策略。
- 构建计划、不可变 Artifact 和环境晋级。
- BYOS 节点、域名、HTTPS、健康和流量。
- 部署日志、配置差异、回滚和运行状态。
- 测试、安全、审批、阻断项、发布证据和审计。

目标闭环：

```text
Push / PR
  → Webhook 验签与去重
  → 分支 / 路径 / CI / 并发策略
  → 检测或读取 launchly.yaml
  → 隔离构建一次
  → OCI image@sha256
  → BYOS 候选部署
  → Release Phase / 健康 / 测试 / 审批
  → 流量切换
  → 运行、证据、通知或真实回滚
```

## 产品边界

Launchly 不是 GitHub Actions 的替代品。Actions/GitLab CI 继续负责代码检查、单测和扫描；Launchly 专注于 **CD、BYOS 运行和发布治理**。

当前不建设：

- 通用 CI DSL、任意 Job 和插件市场。
- Kubernetes 控制台。
- 完整 Issue Tracker。
- 默认托管应用运行时。
- 浏览器宿主终端。
- 在 Self-Host 闭环稳定前的 Cloud 计费和多租户。

## 核心产品体验

### 发布指挥中心

首屏展示运行中的部署、等待审批、失败/回滚、异常节点、磁盘/证书风险和可执行下一步，而不是用项目总数填充 Dashboard。

### 应用环境泳道

测试、预发和生产展示当前 Artifact、ConfigRevision、域名、节点和健康；同一个 digest 逐级晋级，不在生产重新构建。

### 部署工作台

在一个页面查看真实阶段图、实时日志、CI/Test/Security Gate、Artifact、配置差异、流量状态、失败原因和回滚点，并明确区分重启、重部署、重建和回滚。

### BYOS 基础设施中心

节点不仅是 SSH 地址：必须展示 Agent/SSH、Docker/Compose、CPU 架构、CPU/内存/磁盘、代理、运行应用、诊断和排空状态。

### PR Preview

按 PR 创建隔离环境和动态 URL，支持标签、路径过滤、数量上限、TTL、新提交更新及关闭后自动回收；外部 fork 默认不接触受信秘密。

### 发布证据

Release 聚合 commit/PR、Artifact、Config、CI、测试、安全、审批、豁免、部署和回滚证据。内置 Issue 收敛为发布阻断项/部署事故，不复制通用项目管理工具。

## 目标架构

```text
GitHub / GitLab + CI Checks
  → Vue Web + NestJS API
      → PostgreSQL + durable task queue
      → Worker / Scheduler
      → isolated Build Worker + BuildKit → OCI Registry
      → Agent / hardened SSH → isolated Compose runtime
      → managed reverse proxy + ACME HTTPS
      → evidence / audit / notification
```

关键不变量：

- API 不挂 Docker Socket，不直接构建或 SSH。
- API、Worker、Build Worker 和运行节点职责隔离。
- 部署输入只接受 OCI digest，不用 `latest` 作为发布依据。
- 所有项目子资源同时验证 Workspace、Project、资源归属和角色。
- 健康、迁移、门禁失败不切流量。
- 密钥只在任务执行时短时使用，不进入普通 API、日志和审计导出。

## 当前真实状态

基线 `6add2b9` 已包含 Vue/NestJS/Prisma/CLI、项目/环境/部署/Test/Issue/Release/审计模块，以及部分 Webhook、Worker、BuildKit、OCI 和 SSH 代码路径。

独立验证结果：

- API 现有 394 个单元测试通过。
- Web 现有 22 个单元测试通过。
- CLI 现有 15 个单元测试通过。
- API/Web/CLI 编译通过。
- TEST-000 已经 Codex 独立复核：API/Web/CLI 均能按全量生产源码口径输出 text 与 JSON summary。
- TEST-API-01 已经 Codex 独立复核，SecretValue、EditionConfig 和 GlobalExceptionFilter 的 30 个新增测试通过。
- TEST-API-02 已经 Codex 独立复核，EnvironmentService 和 EnvironmentVariableService 的 43 个新增测试通过。
- TEST-API-03 已经 Codex 独立复核，ProjectAccessService、RepositoryHintsService 和 ResourceCatalogService 的 120 个新增测试通过。
- TEST-API-04 已经 Codex 独立复核，ReleaseService、NotificationService 和 TestService 的 58 个新增测试通过。
- TEST-API-05 已经 Codex 独立复核，DeployTargetService 的 91 个测试通过，未连接真实 SSH。
- API 覆盖率为 Statements 34.54%、Branches 37.34%、Functions 35.10%、Lines 33.47%。
- Web 覆盖率为 Statements 5.65%、Branches 39.13%、Functions 5.61%、Lines 5.65%。
- CLI 覆盖率为 Statements 10.13%、Branches 87.50%、Functions 83.33%、Lines 10.13%。

但 R0 尚未通过：

- 生产构建输出与 `dist/main` 启动入口不一致。
- Dockerfile 的 Web/BuildKit 构建阶段需要修复。
- `EnvironmentService` 注入缺失会阻止 Nest 启动。
- 多个项目子资源接口缺少完整 Workspace/Project 授权。
- 没有真实 Docker 镜像启动、空库/升级库、GitHub、Registry、BuildKit、SSH、HTTPS 和回滚 E2E。

因此当前没有可对外承诺的部署路径，历史“Beta”“核心流水线可用”“完整测试体系”等表述全部失效。

## 项目路线图

| 阶段 | 结果 | 状态 |
| --- | --- | --- |
| R0 可信基线 | 构建、启动、权限隔离、迁移与交付配置可信 | 进行中 |
| R1 首次部署 | 空白机安装、节点诊断、已有 OCI digest 上线 | 未验收 |
| R2 持续交付 | GitHub App、Webhook、CI/分支/路径/并发、状态回写 | 未验收 |
| R3 安全生产 | 隔离构建、制品晋级、HTTPS、切流、真实回滚 | 未验收 |
| R4 Preview/Monorepo | PR 环境、TTL/配额/回收、受影响服务部署 | 未验收 |
| R5 发布治理 | 发布证据、阻断项、审批、通知、轻量观测 | 未验收 |
| R6 多节点/Cloud | Agent、多节点；Self-Host 稳定后再评估 Cloud | 未开始 |

任务、依赖与验收映射见[项目重启路线图](docs/basic/项目重启路线图.md)。

## 仓库结构

```text
apps/web                 Vue 3 + Element Plus Web UI
services/api             NestJS API + Worker 基线
cli                      TypeScript Self-Host CLI
deploy/compose           Self-Host Compose 模板
examples                 真实验收用示例应用
docs/basic               权威产品、架构、UI、验收与路线图
docs/prototypes          本地原型（默认不上传）
```

## 当前开发命令

以下命令仅证明静态检查/单元测试，不代表 Self-Host 或部署可用：

```bash
pnpm test
pnpm --dir services/api build
pnpm --dir apps/web build
pnpm --dir cli build
```

历史 `launchly install` 和 Compose 快速开始在 R0/R1 验收前不作为有效安装指南。NAS/极空间文档也只作为待复核环境说明，不能视为安装成功证明。

## 项目文档

完整分类、阅读顺序和编号规则见[文档索引](docs/basic/文档索引.md)。

| 文档 | 说明 |
| --- | --- |
| [文档索引](docs/basic/文档索引.md) | 规范、问题、任务、验收和环境说明的分类与链接 |
| [产品设计规范](docs/basic/产品设计规范.md) | 定位、用户、领域模型、功能范围和优先级 |
| [技术架构规范](docs/basic/技术架构规范.md) | 拓扑、状态机、数据、安全和执行边界 |
| [UI 与交互规范](docs/basic/UI与交互规范.md) | 信息架构、核心页面和设计系统 |
| [交付验收规范](docs/basic/交付验收规范.md) | 证据等级、阻断 E2E 和阶段退出条件 |
| [已知问题清单](docs/basic/已知问题清单.md) | 已确认问题、证据、影响和关联任务，不作为排期 |
| [项目重启路线图](docs/basic/项目重启路线图.md) | 当前基线、任务依赖、进度和下一批工作 |
| [测试补全任务书](docs/basic/测试补全任务书.md) | 覆盖率基线、完整测试矩阵、MiniMax 工作包和 Codex 复核规则 |
| [NAS 部署兼容性](docs/basic/NAS%20部署兼容性.md) | R1 兼容性目标，当前不是安装承诺 |
| [极空间 Z4 Pro 计划稿](docs/basic/极空间Z4Pro从GitHub部署Launchly.md) | 暂停执行，待 R0/R1 真实 E2E 后升级为 Runbook |

`KI-###` 是问题、`R#-##` 是实施待办、`TEST-*` 是测试工作包、`BASE/E2E` 是验收证据，四者不得互相代替。文档中的“必须/目标”不等于已实现；路线图状态只能由交付验收证据改变。

## 开发原则

- 先更新权威文档，再实施范围变化。
- 每个任务只覆盖一个可验收目标，并给出 diff、命令、原始结果和未覆盖边界。
- 安全、权限、migration、状态机和生产配置必须独立复核。
- 自动生成代码或审计报告不能自行改变完成状态。
- R0 完成前不并行实现 Cloud、AI、Canary 或模板市场。

## 贡献

项目尚未进入正式开源协作阶段。当前优先恢复可信基线、完成真实 BYOS 闭环并重做核心产品体验。正式开放贡献前将补充 `CONTRIBUTING.md`、行为准则和 Issue/PR 模板。

## License

Launchly 使用 [GNU AGPL-3.0](LICENSE) 许可证。
