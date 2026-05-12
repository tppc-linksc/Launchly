# AI 开发任务包（AI Vibecoding Playbook）

> 版本：v1.0  
> 日期：2026-05-12  
> 配套文档：[项目重塑计划.md](项目重塑计划.md)、[UI设计与规范.md](UI设计与规范.md)  
> 协作模式：**1 个人类负责人 + AI 编程助手（Claude / Cursor / Codex / DeepSeek 等）**

---

## 0. 文档目的与使用方式

本文件把 [项目重塑计划.md](项目重塑计划.md) 第 6 节的迁移工作，**拆成一个一个可以独立丢给 AI 执行的任务单**。每个任务都遵循统一格式，**边界明确、不可越界**。

### 使用方式

1. 把 [§1 通用前置提示词](#1-通用前置提示词每次任务必带) **完整粘贴**到 AI 对话起手位置
2. 把当前要执行的任务单完整粘贴到提示词后面
3. AI 执行完后，按 [§9 完成提交格式](#9-完成提交格式) 检查
4. 你审核 → 提交 / 退回

### 这份文档要解决的核心问题

- **AI 容易跑偏**：扩展范围、引入不必要的框架、动了不该动的文件
- **AI 容易缺失上下文**：不知道项目历史决策，重复犯过去的错
- **AI 容易过度设计**：把 MVP 任务搞成 v2.0 任务
- **AI 容易遗忘约束**：写完代码不写迁移、不更新文档、不写测试

本文件用"硬约束清单 + 任务单 + 验证命令"三件套强制收敛。

---

## 1. 通用前置提示词（每次任务必带）

> **每次开新 AI 对话开头，把下面这段完整复制粘贴**。AI 必须先回复"已阅读 Launchly 前置约束"后才能开始执行任务。

```text
你正在为 Launchly 项目工作。Launchly 是一个轻量代码自动部署平台，双模式同源交付（SaaS + 开源自托管）。
开始执行任何任务前，必须先确认理解以下硬约束。

============================================================
【硬约束 1：必读文档】
============================================================
1. 项目重塑计划.md - 产品方向、核心决策、迁移路线图（必读）
2. UI设计与规范.md - UI 规范和页面设计（涉及前端时必读）
3. README.md - 当前项目状态（必读）
4. 当前任务单 - 本次具体任务（必读，逐字读完）

============================================================
【硬约束 2：核心决策（不可挑战）】
============================================================
- D-04: MVP 全部走 BYOS（SSH/Docker 远程），不做 Launchly 托管运行时
- D-05: 不做 Git 托管层，用 PAT 拉取外部仓库
- D-06: 用户手动点"发布"才触发部署，不监听 webhook
- D-07: 角色只有 Owner/Member/Viewer 三档
- D-08: Component 数据模型存在，UI 默认折叠（单 component 时隐藏）
- D-11: 测试只做 L0(shell exit code) + L1(JUnit XML 解析)
- D-13: 项目类型只支持 Web 后端 + Web 前端 + Dockerfile
- D-14: License 是 AGPL-3.0
- D-15: 单仓库 + cloud-only/ + selfhost-only/ + 编译时 EDITION 开关
- D-19: Phase 1 = 4 周，目标是自己用 + 拉 star

挑战这些决策属于"超出本任务范围"，需要先和人类负责人讨论，不能自行变更。

============================================================
【硬约束 3：技术栈】
============================================================
- 后端 API：Java 17 + Spring Boot 3 + Spring Data JPA + Flyway + PostgreSQL
- Worker：Java 17 + Spring Boot 3，将通过 SSH 远程执行
- 前端：Vue 3 + TypeScript + Vite + Ant Design Vue + Pinia + axios + vue-router
- CLI：Go（仅 self-host 模式用）
- 不引入新语言、新框架、新数据库
- 不引入 Kotlin、Rust、Python、Node 后端、Redis、Kafka、Elasticsearch
- 不引入 React、Svelte、Solid、Nuxt
- 不重写已有模块为新框架

============================================================
【硬约束 4：必须做的事】
============================================================
- 任何 SQL schema 变更必须新增 Flyway 迁移脚本（V<n>__<desc>.sql）
- 所有 API 响应必须遵循现有 ApiResponse / Result 包装格式（如不存在，使用 Spring Boot 默认 JSON）
- 所有敏感字段（凭据、token、密码）必须加密存储 + 脱敏返回
- 修改产品行为时必须同步更新对应文档（README / Launchly-design.md）
- 任何用户输入必须做参数校验（jakarta.validation.constraints）
- 任何远程命令执行必须有超时和日志
- 前端文案必须中文，代码标识符必须英文
- 新建 Vue 页面必须按 UI设计与规范.md 实现，包括 loading / empty / error 状态

============================================================
【硬约束 5：不准做的事（红线）】
============================================================
- 不准引入新的顶层依赖（pom.xml / package.json / go.mod）除非任务单明示允许
- 不准 git commit --amend 改写已 push 的历史
- 不准动 docs/dev-tasks/ 目录（被 .gitignore 忽略，是旧规划文件）
- 不准删除 testcase / issue / release / audit / notification 模块的代码（只能调整入口）
- 不准在代码里写明文凭据 / 测试 token
- 不准把 /var/run/docker.sock 挂到任何容器（除非是用户的 BYOS 目标机器自己挂的）
- 不准写"TODO 后面再做"的占位代码到主分支（要么做完要么不交付）
- 不准修改 LICENSE 文件（除非任务单明示）
- 不准修改 .gitignore（除非任务单明示）
- 不准 force push
- 不准引入 emoji 到代码或文档（除非任务单明示）

============================================================
【硬约束 6：完成时必须输出】
============================================================
1. 变更文件清单（按 `git status` 实际状态列）
2. 对应任务 ID（T-Wx-yy）
3. 验证命令（能让人类一行 shell 复现你的验证）
4. 未完成项 / 阻塞点（如果有）
5. 是否触发了任何红线 / 边界争议（必须诚实报告）

============================================================
【硬约束 7：触发暂停的红线】
============================================================
遇到以下情况必须停止编码，立即报告并等待人类回答：
- 任务和【硬约束】之一冲突
- 需要新建顶层依赖 / 数据库表 / 模块包
- 需要修改数据模型中已有字段的语义（例如改名、改类型、改 null 性）
- 需要重写 > 200 行的现有代码
- 发现现有代码有 bug 但修复超出任务范围
- 任务描述含糊到你需要做 > 1 个产品决策
- 任务执行后会破坏现有 API 的兼容性
- 涉及安全（凭据 / 加密 / 权限）的边界

============================================================
我已阅读上述约束。请告诉我你要执行的任务（贴入任务单）。
============================================================
```

---

## 2. 任务单统一格式

每个任务单遵循下列结构：

```text
### T-Wx-yy: <任务标题>

**对应重塑计划**：D-<编号> 或 第 6 节具体子项

**背景**：1-2 句话，解释为什么这个任务存在。

**输入**：
- 依赖任务：T-Wx-yy 已完成
- 现有代码位置：[file](file) 或 包名
- 现有数据：表名、字段名

**输出**：
- 新文件：列清单
- 修改文件：列清单
- 新增 API：HTTP 方法 + 路径 + 字段
- 数据库迁移：Flyway 脚本路径

**约束**：
- 哪些必须做（特定字段、特定加密方式、特定校验）
- 哪些禁止做（不引入哪些依赖、不动哪些代码）

**完成标准**（可勾选 checkbox）：
- [ ] 标准 1
- [ ] 标准 2
- [ ] 标准 3

**验证命令**：
```bash
# 一段可以一行运行的 shell，验证任务完成
```

**预计代码量**：~XX 行 / ~XX 文件

**风险点**：可能踩坑的地方
```

---

## 3. W0 任务包：仓库整顿

> **目标**：3 个工作日内完成所有"非业务代码"的整顿，建立新方向的可信文档底盘。
> **本周不动 services/ apps/ cli/ 下面任何业务代码**。

### T-W0-01: 创建长 feature 分支

**对应重塑计划**：D-17 / R-01

**背景**：重塑工作量大，会让 main 分支长期处于不稳定状态。开一个长 feature 分支，等稳定再合 main。

**输入**：当前 git 在 main 分支（或同等主分支）。

**输出**：
- 新分支 `refactor/dual-mode-deploy`，本地已切换过去

**约束**：
- 不准 force push
- 不准动现有 main 分支
- 远程分支建在 origin 上

**完成标准**：
- [ ] `git branch --show-current` 输出 `refactor/dual-mode-deploy`
- [ ] `git push -u origin refactor/dual-mode-deploy` 成功
- [ ] GitHub web 界面可见新分支

**验证命令**：
```bash
git branch --show-current
git ls-remote --heads origin refactor/dual-mode-deploy
```

**预计代码量**：0 行（仅 git 操作）

---

### T-W0-02: 替换 LICENSE 为 AGPL-3.0

**对应重塑计划**：D-14 / R-02

**背景**：当前 [LICENSE](LICENSE) 是 MIT，允许他人 fork 你代码搭 SaaS 卖钱。双模式商业化需要换 AGPL-3.0。

**输入**：当前 [LICENSE](LICENSE) 文件（MIT 全文，21 行）。

**输出**：
- 替换 [LICENSE](LICENSE) 全文为 AGPL-3.0 官方文本（来自 <https://www.gnu.org/licenses/agpl-3.0.txt>）
- 版权署名行格式：`Copyright (C) 2026 linksc`（保留现有版权人名字 linksc）

**约束**：
- 必须用 AGPL-3.0 **完整官方原文**，不准截取片段
- 不准在 LICENSE 文件里加任何自定义条款
- 不动其他文件（README 的 license 部分另外的任务处理）

**完成标准**：
- [ ] [LICENSE](LICENSE) 第一行是 `                    GNU AFFERO GENERAL PUBLIC LICENSE`
- [ ] 包含完整 14 节正文（"TERMS AND CONDITIONS"）
- [ ] 末尾包含 "How to Apply These Terms to Your New Programs" 附录
- [ ] 末尾署名年份为 2026，持有人为 linksc

**验证命令**：
```bash
head -3 LICENSE
wc -l LICENSE  # AGPL-3.0 原文约 661 行
grep -c "GNU AFFERO GENERAL PUBLIC LICENSE" LICENSE  # >= 2
```

**预计代码量**：~661 行 LICENSE 文件全替换

**风险点**：从网上抓取 AGPL-3.0 原文时不要漏掉 ASCII art 标题或附录。如果环境无法访问 gnu.org，请暂停并报告。

---

### T-W0-03: 重写 README.md 顶部到「为什么是 Launchly」

**对应重塑计划**：R-03 / R-04 / 6.2.1

**背景**：当前 [README.md](README.md) 顶部 strong 标语和"为什么是 Launchly"章节仍是旧定位。需要按新方向重写并加 pivot banner。

**输入**：
- 当前 [README.md](README.md) 全文
- [项目重塑计划.md](项目重塑计划.md) 第 2-4 节（新定位与功能边界）

**输出**：
- 修改 [README.md](README.md) 以下部分：
  1. 顶部 `<h1>` 下面的 `<p>` 标语：替换为「轻量代码自动部署平台 · 双模式交付（SaaS + 开源自托管同源）」
  2. 紧接着的描述段：替换为新版本（参考 [项目重塑计划.md](项目重塑计划.md) §2）
  3. 在标语段后面、目录前面插入 pivot banner（详见下方）
  4. "为什么是 Launchly" 章节：替换为新版本（参考 [项目重塑计划.md](项目重塑计划.md) §1.2）

**Pivot banner 文本**（原样插入，前后各空一行）：

```markdown
> **🔄 2026-05 项目方向重塑**：Launchly 已从「自托管部署测试协作平台」收敛为「**双模式同源的轻量代码自动部署平台**」。详细决策见 [项目重塑计划.md](项目重塑计划.md)。当前主分支仍为旧版本骨架，新方向在 `refactor/dual-mode-deploy` 分支下开发。
```

**约束**：
- 必须**仅修改**上述 4 处，不动目录、快速开始、开发指南章节
- "项目状态"和"功能规划"章节由后续任务 T-W0-04 处理
- 顶部 badge（status / license / web / api / cli / database / deploy）保留，但 license badge 颜色改为绿色或保持灰色待人工确认
- 不引入 emoji 除了 banner 里的 🔄

**完成标准**：
- [ ] 标语含「轻量代码自动部署」字样
- [ ] 标语含「双模式」字样
- [ ] pivot banner 出现在描述段后面
- [ ] "为什么是 Launchly" 章节描述"从代码到运行环境的低成本、可重复、可追踪通路"
- [ ] 没有修改"目录"和"快速开始"两个章节

**验证命令**：
```bash
grep -c "轻量代码自动部署" README.md  # >= 1
grep -c "双模式" README.md  # >= 2
grep -c "2026-05 项目方向重塑" README.md  # == 1
```

**预计代码量**：README.md 约 20-40 行修改

**风险点**：误删 quick-start 章节。修改前先 `git diff README.md` 自查。

---

### T-W0-04: 重写 README.md「项目状态」与「功能规划」

**对应重塑计划**：6.2.1

**背景**：旧版「项目状态」按"第 1-13 周已完成"叙述，现在要切到"已完成 / 改造中 / 未开始"三段式；「功能规划」要切到"核心引擎 / 协作（基础）/ SaaS 控制面 / Self-Host 运维 / 付费增值"五块。

**输入**：[项目重塑计划.md](项目重塑计划.md) §4（功能边界表）和 §6.4（项目进展）

**输出**：
- 修改 [README.md](README.md) 的「项目状态」「功能规划」「项目进展」三个章节

**约束**：
- 不准承诺时间表（例如"X 月 X 日上线"）
- 不准把"未实现"写成"即将上线"
- 必须如实标注"已完成 / 改造中 / 未开始"
- 「功能规划」要按 Free / Pro / Self-Host 三档对照（参考 §4 表格）

**完成标准**：
- [ ] 「项目状态」含「pre-alpha / 方向修正中」字样
- [ ] 「功能规划」分四个子标题：核心引擎、协作（基础）、SaaS 控制面、付费增值
- [ ] 「项目进展」表格至少 12 行，按"已完成 / 改造中 / 未开始"分组

**验证命令**：
```bash
grep "pre-alpha / 方向修正" README.md
grep "核心引擎" README.md
grep "改造中" README.md
```

**预计代码量**：README.md 约 60-100 行修改

---

### T-W0-05: 同步重写 README.en.md

**对应重塑计划**：6.2.2

**背景**：英文 README 必须与中文 README 完全对应。

**输入**：T-W0-03、T-W0-04 完成后的 [README.md](README.md)

**输出**：[README.en.md](README.en.md) 的对应位置同步修改

**约束**：
- 英文翻译要自然，不准机翻
- 标语固定英文："Lightweight code auto-deployment platform · Dual delivery (SaaS + open-source self-host, same codebase)"
- pivot banner 英文版：
  ```markdown
  > **🔄 2026-05 Direction Pivot**: Launchly has been refocused from a "self-hosted deployment & test collaboration platform" to a **dual-delivery lightweight code auto-deployment platform**. See [项目重塑计划.md](项目重塑计划.md) for full decision record. Main branch remains old skeleton; new direction is developed under `refactor/dual-mode-deploy` branch.
  ```

**完成标准**：
- [ ] [README.en.md](README.en.md) 含 "Lightweight code auto-deployment platform" 字样
- [ ] 含 "Dual delivery" 字样
- [ ] 含 "2026-05 Direction Pivot" banner

**验证命令**：
```bash
grep "Lightweight code auto-deployment" README.en.md
grep "Dual delivery" README.en.md
grep "Direction Pivot" README.en.md
```

**预计代码量**：[README.en.md](README.en.md) 约 80-120 行修改

---

### T-W0-06: 新建 docs/product/direction-pivot-2026-05.md

**对应重塑计划**：R-06

**背景**：单独一份简短的 pivot 决策记录，方便未来人类 / AI 复盘。

**输入**：[项目重塑计划.md](项目重塑计划.md) §1-§5

**输出**：新文件 [docs/product/direction-pivot-2026-05.md](docs/product/direction-pivot-2026-05.md)

**约束**：
- 字数控制在 800-1500 字
- 必须包含：背景、新定位、5 个核心决策摘要、新旧能力对照、影响范围、时间表
- 引用 [项目重塑计划.md](项目重塑计划.md) 作为完整版

**完成标准**：
- [ ] 文件存在
- [ ] 含 "新旧能力对照" 章节
- [ ] 引用了 [项目重塑计划.md](项目重塑计划.md)

**验证命令**：
```bash
test -f docs/product/direction-pivot-2026-05.md && echo OK
wc -w docs/product/direction-pivot-2026-05.md  # 期望 800-2000 词左右
```

**预计代码量**：~150 行 markdown

---

### T-W0-07: 修订 docs/product/Launchly-design.md 第 1-2 章

**对应重塑计划**：R-07 / 6.2.3

**背景**：[docs/product/Launchly-design.md](docs/product/Launchly-design.md) 是设计 PRD，第 1 章「项目概述」和第 2 章「用户与组织模型」按旧定位写，必须修订。

**输入**：
- [docs/product/Launchly-design.md](docs/product/Launchly-design.md) 第 1-2 章原文
- [项目重塑计划.md](项目重塑计划.md) §2-§5

**输出**：
- 修改 [docs/product/Launchly-design.md](docs/product/Launchly-design.md) 第 1 章：替换产品定位、部署形态、核心价值、产品边界
- 修改第 2 章：把 Workspace 改为 Organization；角色精简为 Owner / Member / Viewer + Component 级权限（远期）
- 在第 2 章新增 §2.5 子章节「Component 与发布单元」（介绍数据模型）
- 在文档目录后面新增「Edition 与双模式」总章节（放在第 3 章之前）

**约束**：
- 不准删除第 3 章及以后章节（业务流程详细描述仍然有参考价值）
- 不准动 mermaid 图（除非任务单明示）
- 必须保留"测试用例、Issue、Release、门禁"作为基础功能描述，仅调整定位语为"基础协作能力，非主线"

**完成标准**：
- [ ] §1.2 产品定位含「轻量代码自动部署平台」「双模式同源」字样
- [ ] §1.3 部署形态含「Cloud」「Self-Host」二字
- [ ] §2 章引入 Organization 概念
- [ ] §2.5 介绍 Component
- [ ] 「Edition 与双模式」章节存在

**验证命令**：
```bash
grep "轻量代码自动部署" docs/product/Launchly-design.md
grep "Organization" docs/product/Launchly-design.md
grep "Component" docs/product/Launchly-design.md
grep "Edition" docs/product/Launchly-design.md
```

**预计代码量**：~200-400 行 markdown 修改

**风险点**：第 1-2 章中提到的"Workspace"在第 3-9 章还会被引用。本任务**只改 1-2 章**，第 3 章之后的"Workspace"留给后续任务统一处理（或者保持向后兼容："Workspace" = "Organization"）。

---

### T-W0-08: 提交 W0 全部成果并推送

**对应重塑计划**：R-11 / R-12

**背景**：W0 文档工作完成后一次性提交，commit 消息清晰记录这次方向重塑。

**输入**：T-W0-01 ~ T-W0-07 全部完成

**输出**：
- 一个清晰的 commit，消息：
  ```text
  docs: pivot from collab platform to lightweight auto-deployment platform

  - Replace LICENSE with AGPL-3.0
  - Rewrite README.md / README.en.md with dual-mode positioning
  - Add pivot banner to both READMEs
  - Add docs/product/direction-pivot-2026-05.md decision record
  - Revise Launchly-design.md chapter 1-2 (Organization, Component, Edition)
  - Add 项目重塑计划.md / AI开发任务包.md / UI设计与规范.md to root

  Refs: 项目重塑计划.md §6.1
  ```
- 推送到 `origin/refactor/dual-mode-deploy`

**约束**：
- 不准把 .DS_Store、target/、node_modules/ 等加入提交
- 不准 amend 已 push 的历史
- 必须用 HEREDOC 方式传入 commit 消息保证格式

**完成标准**：
- [ ] `git log -1 --oneline` 显示新 commit
- [ ] `git status` 显示 working tree clean
- [ ] `git ls-remote origin refactor/dual-mode-deploy` 与本地一致

**验证命令**：
```bash
git log -1 --format='%s'
git status --short
git ls-remote origin refactor/dual-mode-deploy
```

**预计代码量**：0（仅提交）

---

## 4. W1 任务包：BYOS Worker 改造

> **目标**：让 Launchly 能通过 SSH 在用户自带的服务器上执行 `git clone / docker build / docker run` 全链路。
> **本周开始动 services/api 和 services/worker 业务代码**。

### T-W1-01: 新建 DeployTarget 实体

**对应重塑计划**：6.3 W1 / D-04

**背景**：当前部署任务直接挂宿主机 docker.sock，必须抽象出"部署目标"概念，支持远程 SSH/Docker context。

**输入**：现有 [services/api/src/main/java/com/launchly/](services/api/src/main/java/com/launchly/) 模块结构，参考 `deployment` 包写法。

**输出**：

- 新包 `com.launchly.target`，含子包 `controller / service / entity / repository / dto`
- 新实体 `DeployTarget`，字段：
  - `id`（UUID）
  - `organizationId`（多租户预留）
  - `projectId`（外键）
  - `name`（用户可读名称，例如 "生产服务器-上海"）
  - `type`（枚举：`BYOS_SSH` / `BYOS_DOCKER_CONTEXT` / `BYOS_K8S`，MVP 只实现 `BYOS_SSH`）
  - `host`（域名或 IP）
  - `port`（默认 22）
  - `username`（SSH 用户名）
  - `authMethod`（枚举：`KEY` / `PASSWORD`，MVP 只实现 `KEY`）
  - `encryptedCredential`（加密后的私钥或密码）
  - `status`（枚举：`UNVERIFIED` / `CONNECTED` / `FAILED`）
  - `lastVerifiedAt`（时间戳）
  - `createdAt` / `updatedAt`
- 新 Flyway 迁移 `services/api/src/main/resources/db/migration/V<n>__create_deploy_target.sql`
- 新 JPA Repository `DeployTargetRepository`

**约束**：
- `encryptedCredential` 必须使用现有 `common/crypto` 加密工具（与 `environment_variable` 同款）
- 实体必须实现 `@EntityListeners(AuditingEntityListener.class)` 自动维护 createdAt / updatedAt
- 不准在实体 toString() 中泄露 `encryptedCredential`
- 索引：`(project_id)`，方便按项目查询

**完成标准**：
- [ ] `services/api/src/main/java/com/launchly/target/entity/DeployTarget.java` 存在
- [ ] Flyway 迁移文件存在且 SQL 合法
- [ ] 项目能 `mvn compile` 通过

**验证命令**：
```bash
cd services/api && mvn compile
```

**预计代码量**：~150 行 Java + ~30 行 SQL

**风险点**：迁移文件版本号必须比现有最高版本 +1，跑一下 `ls services/api/src/main/resources/db/migration/` 确认。

---

### T-W1-02: DeployTarget CRUD API + 凭据加密

**对应重塑计划**：6.3 W1-02

**背景**：用户在 UI 里要能 list / create / update / delete 部署目标。凭据加密入库，脱敏返回。

**输入**：T-W1-01 完成

**输出**：
- `DeployTargetController`：
  - `GET /api/projects/{projectId}/deploy-targets` 列表
  - `POST /api/projects/{projectId}/deploy-targets` 创建
  - `GET /api/deploy-targets/{id}` 详情
  - `PATCH /api/deploy-targets/{id}` 更新
  - `DELETE /api/deploy-targets/{id}` 删除
- `DeployTargetDto` / `DeployTargetCreateRequest` / `DeployTargetUpdateRequest`
- `DeployTargetService` 实现 + 凭据加密
- 返回 DTO 时 `encryptedCredential` 字段输出为 `maskedCredential`（仅显示前 4 后 4 + 中间 `***`）
- 创建时 `privateKey` 用 `@JsonProperty(access = WRITE_ONLY)` 只允许写不允许读

**约束**：
- 所有接口必须做 JWT 鉴权（沿用现有 `auth` 模块）
- 必须做参数校验（host 必填、port 1-65535、username 必填）
- 删除接口必须先检查有无未完成的 deployment 引用，有则返回 409
- 不准在日志里打印 `privateKey` 或 `password` 字段

**完成标准**：
- [ ] 5 个接口可通过 curl 调用并返回正确 JSON
- [ ] 创建时上传 privateKey，GET 详情时 privateKey 不返回，maskedCredential 显示脱敏值
- [ ] 删除受 deployment 引用的 target 返回 409

**验证命令**：
```bash
cd services/api && mvn test -Dtest=DeployTargetControllerTest
# 或手动 curl 测试（需先获 JWT token）
```

**预计代码量**：~400 行 Java

**风险点**：DTO 字段方向（read/write）容易搞错，必须用 `@JsonProperty(access = ...)` 显式控制。

---

### T-W1-03: SSH 凭据连通性测试接口

**对应重塑计划**：6.3 W1-03

**背景**：用户填完 SSH 凭据，UI 上应该能"测试连接"按钮，验证 Launchly 能 SSH 上去并能执行 `docker version`。

**输入**：T-W1-02 完成

**输出**：
- 新接口 `POST /api/deploy-targets/{id}/verify`
- 实现使用 [JSch](https://github.com/mwiede/jsch) 或 SSHJ 库（任选一个，MVP 推荐 mwiede/jsch 因为持续维护）
- 步骤：
  1. 解密 `encryptedCredential` 获得私钥
  2. SSH 连接到 `host:port` with `username`
  3. 远程执行 `docker version`
  4. 解析输出确认是有效 Docker
  5. 更新 `status = CONNECTED` / `FAILED`，`lastVerifiedAt = now`
- 超时 10 秒，失败返回详细错误信息（不泄露凭据）

**约束**：
- **必须新增** maven 依赖 `com.github.mwiede:jsch:0.2.x`（这条任务**明示允许**新增）
- SSH 连接必须显式设置 `StrictHostKeyChecking=no` 但记录 `host_key_fingerprint`（未来加 known_hosts 校验，本任务先不做）
- 不准把私钥写到磁盘临时文件，必须用 in-memory 方式加载
- 错误信息脱敏：不包含 host name 之外的内部信息

**完成标准**：
- [ ] 接口能正常返回 `{status: "CONNECTED", dockerVersion: "..."}` 或 `{status: "FAILED", error: "..."}`
- [ ] 连一个错误的 host，10 秒内超时返回 FAILED
- [ ] 日志里不出现私钥内容

**验证命令**：
```bash
# 先准备一台测试 SSH 服务器（你的开发机本地 SSH 也行）
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/deploy-targets/{id}/verify
```

**预计代码量**：~200 行 Java + 1 行 pom.xml

**风险点**：jsch 各种 fork，必须用 mwiede 这个 fork。旧的 com.jcraft 已不维护，有安全问题。

---

### T-W1-04: Deployment 关联 DeployTarget

**对应重塑计划**：6.3 W1-04

**背景**：现有 `Deployment` 实体没有目标概念，必须加外键 `deploy_target_id`。

**输入**：T-W1-01 + 现有 `deployment` 模块

**输出**：
- Flyway 迁移：给 `deployment` 表加列 `deploy_target_id UUID REFERENCES deploy_target(id)`
- `Deployment` 实体新增 `@ManyToOne DeployTarget deployTarget` 关联
- 部署创建接口（`POST /api/projects/{id}/deploy`）必须接受 `deployTargetId` 参数
- 部署列表 DTO 输出 `deployTarget: { id, name, host }` 嵌套对象

**约束**：
- 现有未关联 deploy_target 的 deployment 数据保留（迁移时 `deploy_target_id` 允许 NULL）
- 新建 deployment 必须传 `deployTargetId`，否则 400
- 不准动 `Deployment` 其他字段

**完成标准**：
- [ ] `deployment` 表多了 `deploy_target_id` 列
- [ ] 创建 deployment 时不传 deployTargetId 返回 400
- [ ] 列表 DTO 含 deployTarget 嵌套对象

**验证命令**：
```bash
cd services/api && mvn flyway:info
mvn test -Dtest=DeploymentControllerTest
```

**预计代码量**：~80 行 Java + 1 个 SQL 迁移

---

### T-W1-05: Worker Runner 抽象层

**对应重塑计划**：6.3 W1-05

**背景**：当前 Worker 直接调本机 docker 命令。要把执行抽象成接口，将来支持本地 + 远程 SSH + 未来 K8s。

**输入**：现有 [services/worker/src/main/java/com/launchly/worker/](services/worker/src/main/java/com/launchly/worker/) 实现

**输出**：
- 新接口 `Runner`：
  ```java
  public interface Runner {
      RunnerResult exec(String command, RunnerContext ctx);
      void uploadFile(byte[] content, String remotePath, RunnerContext ctx);
      InputStream streamLogs(String execId);
      void close();
  }
  ```
- 实现 1：`LocalDockerRunner`（保留兼容现有行为，仅 selfhost 单机模式下使用）
- 实现 2：`RemoteSshRunner`（新，本周核心）
- `RunnerFactory` 按 `DeployTarget.type` 返回对应实现
- `RunnerContext` 包含 `targetId`, `deploymentId`, `workingDir` 等元数据

**约束**：
- LocalDockerRunner 必须保持现有 deployment 接口的行为不变
- RemoteSshRunner 必须复用 T-W1-03 引入的 jsch
- 所有命令执行都必须有超时（默认 30 分钟，可配）
- 所有命令输出必须以行为单位流式回传
- 不准用 `Runtime.getRuntime().exec()`（用 ProcessBuilder）

**完成标准**：
- [ ] Runner 接口和两个实现编译通过
- [ ] 单元测试：mock RemoteSshRunner 模拟 exec 返回
- [ ] 单元测试：LocalDockerRunner 在测试环境跑 `echo hello`

**验证命令**：
```bash
cd services/worker && mvn test -Dtest=RunnerTest
```

**预计代码量**：~500 行 Java

**风险点**：流式日志的线程模型容易写错，建议用 `CompletableFuture` 或 Project Reactor。如果引入 Reactor 必须停下来请示。

---

### T-W1-06: 移除 docker-compose.yml 的 docker.sock 挂载

**对应重塑计划**：6.3 W1-06 / 6.1 安全红线

**背景**：[deploy/compose/docker-compose.yml](deploy/compose/docker-compose.yml) 第 53 行把宿主 `/var/run/docker.sock` 挂到 worker 容器，是严重的逃逸漏洞。BYOS 模式下不需要这条挂载。

**输入**：[deploy/compose/docker-compose.yml](deploy/compose/docker-compose.yml)

**输出**：
- 删除 worker service 的 `- /var/run/docker.sock:/var/run/docker.sock` 这一行
- 在 compose 文件头部加注释说明
- 同步检查 [services/worker/Dockerfile](services/worker/Dockerfile) 不需要 docker CLI（如果当前有 `apt install docker.io`，删除）

**约束**：
- 仅删除挂载，不删 worker service 本身
- 不准添加 dind（docker-in-docker）补回
- 必须等 T-W1-05 完成后再做（否则 worker 直接挂掉）

**完成标准**：
- [ ] [deploy/compose/docker-compose.yml](deploy/compose/docker-compose.yml) 不再含 `docker.sock` 字符串
- [ ] `docker compose -f deploy/compose/docker-compose.yml config` 通过

**验证命令**：
```bash
grep "docker.sock" deploy/compose/docker-compose.yml
docker compose -f deploy/compose/docker-compose.yml config > /dev/null
```

**预计代码量**：~5 行 yml 修改

---

### T-W1-07: RemoteSshRunner 完整跑通端到端

**对应重塑计划**：6.3 W1-07

**背景**：T-W1-05 实现的 RemoteSshRunner 必须能跑完一个真实部署：`git clone` → `docker build` → `docker run` → 健康检查。

**输入**：T-W1-05 完成的 RemoteSshRunner

**输出**：
- 部署流水线 `DeploymentPipeline` 串行 5 个阶段：
  1. `prepare`：远程创建工作目录 `/var/lib/launchly/deployments/{deploymentId}`
  2. `clone`：远程执行 `git clone --depth 1 -b <branch> <repo-url-with-PAT> .`
  3. `build`：远程执行 `<build_command>`（如 `docker build -t <component>:<commit_sha> .`）
  4. `deploy`：远程执行 `<start_command>`（如 `docker run -d --name <component> ...`）
  5. `health_check`：远程 `curl -fsS http://localhost:<port>/health` 重试 30 次
- 每阶段失败时记录错误并停止
- 凭据（Git PAT）通过 env var 注入到远程进程，不留盘

**约束**：
- Git PAT 必须用 `https://x-access-token:<pat>@github.com/...` 形式注入（GitHub 推荐）
- 远程工作目录每次部署独立，结束后清理（保留最近 5 次以便回滚）
- 健康检查超时单次 5 秒，总重试 30 次 × 2 秒间隔 = 60 秒
- 部署失败时**不准**自动重试（避免破坏环境）
- 日志必须按阶段分段存储

**完成标准**：
- [ ] 能用一个真实 GitHub 公开仓库（如 `dockersamples/example-voting-app`）部署成功
- [ ] 部署详情页能看到 5 个阶段的日志
- [ ] 部署失败（如健康检查不通过）有清晰错误信息

**验证命令**：
```bash
# 准备：一台 SSH 可达的服务器，Docker 已装
# 在 Launchly UI 或通过 API 创建 deploy target → 创建项目（绑定示例仓库）→ 发布
# 验证：
ssh user@target "docker ps | grep <component-name>"
curl http://<target-host>:<port>/health
```

**预计代码量**：~400 行 Java

**风险点**：远程命令的 escaping。所有用户提供的字符串（命令、路径、变量）必须做 shell escape，禁用反引号 / `$(...)` 注入。

---

### T-W1-08: 部署日志实时回流

**对应重塑计划**：6.3 W1-08 / W4-04

**背景**：用户在部署详情页应该能像看 GitHub Actions 一样实时看日志滚动。

**输入**：T-W1-07 完成

**输出**：
- Worker 把每行日志通过 `deployment_log` 表写入（已有表）+ 同时通过 Redis Pub/Sub 或简单的 内存 EventBus 推送给 API
- API 提供 SSE 端点 `GET /api/deployments/{id}/logs/stream`
- 前端用 EventSource 订阅

**约束**：
- **不引入 Redis**（D-硬约束 3 禁止）。用 Java 内存 EventBus（Spring 自带 ApplicationEventPublisher 或 Guava EventBus）
- API 和 Worker 在同一 JVM 里通信不需要 broker；如果分两个 JVM，用 PostgreSQL LISTEN/NOTIFY
- SSE 必须有 keep-alive ping（每 15 秒）防止 nginx 超时断开
- 日志最长保留 30 天（超期清理由后台任务做，本任务不实现）

**完成标准**：
- [ ] curl SSE 端点能看到流式输出
- [ ] 前端能在部署进行中看到日志逐行刷新
- [ ] 部署完成后日志能完整查看（不只是实时部分）

**验证命令**：
```bash
curl -N -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/deployments/{id}/logs/stream
```

**预计代码量**：~200 行 Java + ~100 行 Vue

---

### T-W1-09: Web 端「部署目标管理」页面

**对应重塑计划**：6.3 W1-09

**背景**：T-W1-02 提供了 API，UI 上要有页面 list/create/edit/test connectivity。

**输入**：T-W1-02、T-W1-03 完成的 API

**输出**：
- 新页面 `apps/web/src/pages/DeployTargetListPage.vue`（按 [UI设计与规范.md](UI设计与规范.md) §3.7 实现）
- 新页面 `apps/web/src/pages/DeployTargetEditPage.vue`（创建/编辑共用）
- 添加到 `apps/web/src/router/index.ts`：
  - `/deploy-targets` → 列表
  - `/deploy-targets/create` → 创建
  - `/deploy-targets/:id` → 编辑
- 导航增加 "部署目标" 入口

**约束**：
- 严格按 [UI设计与规范.md](UI设计与规范.md) 实现，包括色板、间距、组件
- 私钥输入框必须用 textarea，placeholder 提示「粘贴 PEM 格式私钥」
- 私钥不准在前端 console.log 或保留在 store
- 测试连通性按钮要有 loading 状态和结果提示

**完成标准**：
- [ ] 列表页能渲染（含空态）
- [ ] 创建表单能提交并返回成功
- [ ] 编辑表单能加载已有数据（私钥字段显示「已设置，重置请重新粘贴」而不是返回原值）
- [ ] 测试连通性按钮能调用 API 并显示结果

**验证命令**：
```bash
cd apps/web && pnpm build
# 在浏览器手动验证
```

**预计代码量**：~600 行 Vue/TS

**风险点**：私钥安全性。必须用 password input + autocomplete="off"。

---

## 5. W2 任务包：UI 收敛 + Component 数据模型

### T-W2-01: 新建 Component 实体

**对应重塑计划**：D-08 / D-09 / 6.3 W2-01

**背景**：一个 project 可能有多个发布单元（前端 / 后端 / admin），需要 Component 概念。

**输出**：
- 新实体 `Component`，字段：
  - `id` / `projectId` / `organizationId`
  - `name`（项目内唯一）
  - `repoBindingId`（外键到现有 `repository` 表）
  - `rootDir`（默认 `/`）
  - `buildCommand`
  - `startCommand`
  - `port`
  - `testCommand`（W3 使用，本任务先建字段）
  - `testReportPath`（W3 使用）
  - `createdAt` / `updatedAt`
- Flyway 迁移
- JPA Repository + Service + Controller

**约束**：
- `(project_id, name)` 唯一索引
- 删除最后一个 component 时返回 409（项目必须至少有 1 个 component）
- Component 删除时级联清理关联的 deployment？不，**禁止级联删除 deployment**（部署历史必须保留）

**完成标准**：
- [ ] `component` 表创建
- [ ] CRUD API 可用
- [ ] 单元测试覆盖关键路径

**预计代码量**：~400 行 Java + 1 个迁移

---

### T-W2-02: 把现有 Repository 绑定从 Project 下移到 Component

**对应重塑计划**：6.3 W2-02

**背景**：现有 `repository_binding` 表外键到 `project`。新模型应该外键到 `component`。

**输入**：现有 `repository_binding` 表 schema 和数据

**输出**：
- Flyway 迁移脚本：
  1. 给所有现有 project 自动创建一个名为 `default` 的 component（继承 project 的 build/start 配置）
  2. 把现有 `repository_binding.project_id` 改为 `repository_binding.component_id`，数据迁移过去
  3. 删除老的 `project_id` 外键和列（**保留一个备份列 `legacy_project_id` 给 30 天观察期**）
- Java 实体 `RepositoryBinding` 改为 `@ManyToOne Component`
- API：旧 `GET /api/projects/{id}/repository` 兼容（返回 default component 的 repository）

**约束**：
- **必须**在迁移开始前对现有数据做 backup（`pg_dump`）
- 迁移脚本必须幂等（重跑不爆）
- 不准在生产环境直接跑（先在 dev/staging 验证）
- legacy_project_id 保留 30 天后由人工删除（不在本任务删）

**完成标准**：
- [ ] 旧数据全部有对应的 default component
- [ ] 所有 repository_binding 都关联到 component
- [ ] 旧 API 仍能返回正确数据
- [ ] 单元测试覆盖迁移逻辑

**验证命令**：
```bash
# 在 dev 数据库上：
cd services/api && mvn flyway:migrate
# 验证：
psql -c "SELECT COUNT(*) FROM component;"  # 应等于原 project 数
psql -c "SELECT COUNT(*) FROM repository_binding WHERE component_id IS NULL;"  # 应为 0
```

**预计代码量**：~100 行 Java + ~80 行 SQL 迁移

**风险点**：数据迁移最危险。**必须先 backup 数据库再跑**。如果环境是空数据库可以跳过 backup 但要在 commit 注释说明。

---

### T-W2-03 / T-W2-04 / T-W2-05 / T-W2-06 / T-W2-07 / T-W2-08

省略式详细任务单 — 按 T-W2-01 / 02 同样格式撰写。具体每个任务的标题已在 [项目重塑计划.md](项目重塑计划.md) §6.3 W2 节列出。

**通用约束**（适用 W2 全部任务）：
- UI 必须严格对照 [UI设计与规范.md](UI设计与规范.md) §3 各页面
- 不准删除现有 TestCase / Issue / Release / Audit / Notification 页面
- 导航降级 = 把"测试 / Issue / Release / 审计 / 通知"五项移到二级菜单（"更多"或"协作工具" 折叠组）
- 主导航顶部只保留：Dashboard / 项目 / 部署 / 部署目标 / 设置

---

## 6. W3 任务包：测试集成 L0 + L1

按 W1 / W2 同样格式撰写。任务清单见 [项目重塑计划.md](项目重塑计划.md) §6.3 W3 节。

**关键约束**：
- L0 = 用户配置 `test_command`，部署后跑一次，只看 exit code，不做 XML 解析
- L1 = 在 L0 基础上，从 `test_report_path` 读 JUnit XML，解析后写入现有 `test_run_case` 表
- 不引入 JUnit XML 解析的新依赖，用 JDK 自带 `javax.xml.parsers` 或现有 `jackson-dataformat-xml`（如果已有）
- 测试失败时可一键转 Issue（复用现有 issue 模块的 `POST /api/issues`）

---

## 7. W4 任务包：门禁 L1 + 自动回滚 + 体验

按同样格式撰写。任务清单见 [项目重塑计划.md](项目重塑计划.md) §6.3 W4 节。

**关键约束**：
- 门禁 L1 = `Environment.order` 字段，发布到 `env[n]` 前校验 `env[n-1]` 至少有过一次 `SUCCESS` 状态的 deployment
- 自动回滚 = 部署失败时记录 `last_successful_deployment_id`，UI 提供按钮"回滚到 abc123"
- 不做"自动触发回滚"（必须用户手动点击，避免破坏稳态）

---

## 8. 长期开发规范

### 8.1 数据模型变更规范

- **必须 Flyway**：任何 schema 变更（建表、加列、改类型、加索引）必须新增迁移脚本
- **不准 hibernate.ddl-auto=update**：当前 `application.yml` 已设为 `validate`，AI 不准改
- **迁移幂等**：用 `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- **不删列只标记**：删列前必须先标记 `deprecated_*` 30 天，确认无引用再删
- **多租户字段保留**：所有业务表必须有 `organization_id` 列（即使 MVP 单租户也保留）

### 8.2 API 设计规范

- **路径风格**：`/api/<resource-plural>/{id}`，子资源 `/api/<parent-plural>/{pid}/<child-plural>`
- **方法**：GET 查 / POST 创建 / PATCH 部分更新 / PUT 整体替换 / DELETE 删除
- **状态码**：
  - 200 成功
  - 201 创建成功
  - 204 删除成功无内容
  - 400 参数错误
  - 401 未鉴权
  - 403 已鉴权但无权限
  - 404 资源不存在
  - 409 冲突（重名 / 引用计数非零等）
  - 422 业务规则不通过（如门禁未通过）
  - 500 服务端错误（必须打日志）
- **错误响应**：`{ "code": "ERR_DEPLOY_GATE_BLOCKED", "message": "前一环境未成功部署", "details": {...} }`
- **分页**：`?page=0&size=20&sort=createdAt,desc`，响应 `{ content: [], totalElements, totalPages, page, size }`

### 8.3 前端开发规范

- **页面位置**：所有页面放 `apps/web/src/pages/`，文件名 PascalCase 加 `Page.vue` 后缀
- **组件位置**：可复用组件放 `apps/web/src/components/`（当前没有，AI 可建）
- **状态管理**：用 Pinia，store 文件放 `apps/web/src/stores/`
- **API 调用**：用 axios 实例（已存在 `apps/web/src/api/client.ts`），不准每页面单独 fetch
- **类型**：API 返回类型必须用 TypeScript interface 定义，放 `apps/web/src/types/`（如不存在 AI 可建）
- **样式**：优先用 Ant Design Vue 组件 + scoped CSS；不准引入 Tailwind / UnoCSS
- **加载 / 空态 / 错误**：每个数据驱动页面必须显式实现三态
- **文案**：UI 文案中文，但 placeholder / button 文本要简洁（参考 [UI设计与规范.md](UI设计与规范.md)）

### 8.4 Worker / 后台任务规范

- **任务隔离**：每个 deployment 任务必须在独立线程或独立 SSH session 跑
- **超时强制**：所有远程命令必须有超时（默认 30 分钟）
- **取消支持**：任务必须支持中途取消（用户点"停止部署"按钮）
- **重试策略**：默认**不重试**。需要重试的场景必须任务单明确说明
- **幂等**：任务可能因 Worker 重启被重新调度，必须能识别"已经执行过"并跳过

### 8.5 安全规范（红线）

- **凭据**：所有凭据（私钥 / Token / 密码）必须加密入库；明文绝不能出现在 log / response / git
- **远程命令注入**：所有拼到 shell 的字符串必须 escape
- **CSRF**：所有写接口必须 JWT 鉴权（已有），不需要额外 CSRF token（因为不用 cookie）
- **CORS**：开发环境放开，生产环境只允许 launchly 自己的域名
- **依赖审计**：每周跑一次 `mvn dependency-check:aggregate`（如未配置，本任务范围外不强制）
- **Secret 扫描**：commit 前用 gitleaks 扫，AI 提交前必须自查

### 8.6 测试规范

- **后端**：每个 Service 类必须有单元测试，每个 Controller 必须有 MockMvc 测试
- **前端**：MVP 阶段**不强制写单元测试**（节省工程量），但关键页面必须人工过一遍空/loading/error 三态
- **集成测试**：W4 收尾时做一次完整的端到端测试（手动跑一遍主链路）
- **测试不能写明文凭据**：用 `@Value("${test.target.ssh-key}")` 或 testcontainers

### 8.7 文档更新规范

- 改动产品行为（新增/删除功能、改变流程）：必须同步更新 [README.md](README.md) 和 [README.en.md](README.en.md)
- 改动 API 路径或字段：必须更新 [docs/product/Launchly-design.md](docs/product/Launchly-design.md) 对应章节
- 完成一个里程碑：必须在 [项目重塑计划.md](项目重塑计划.md) §9 验收清单勾掉

### 8.8 Commit 规范

- 格式：`<type>(<scope>): <summary>`
- type：`feat` / `fix` / `refactor` / `docs` / `chore` / `test` / `style`
- scope：`api` / `worker` / `web` / `cli` / `deploy` / `docs` / `root`
- summary：祈使句，小写开头，不加句号
- 例子：
  - `feat(api): add DeployTarget CRUD endpoints`
  - `refactor(worker): replace local docker exec with SSH runner`
  - `fix(web): correct deployment status badge color`
  - `docs(root): update README with dual-mode positioning`
- Commit body：可选，用来描述"为什么"
- 不准 emoji 在 commit message

### 8.9 PR / Merge 规范

- MVP 阶段单人开发，**不强制 PR**
- 但每完成一个 W（W0/W1/W2/W3/W4）末尾做一次"自我 code review"：跑 build、跑测试、回读 diff
- 长 feature 分支 `refactor/dual-mode-deploy` 合 main 前必须：
  - 跑通端到端主链路
  - 文档全部更新
  - 打 tag `v0.2.0-pivot`
  - 写 release notes

---

## 9. 完成提交格式

AI 完成任务后必须按下列模板回复人类负责人：

```text
============================================================
任务 ID：T-Wx-yy
任务标题：<标题>
============================================================

【变更文件】
+ apps/web/src/pages/NewPage.vue
+ services/api/src/main/java/com/launchly/xxx/Xxx.java
M README.md
- deploy/compose/docker-compose.yml (删除了 3 行)

【对应完成标准】
- [x] 标准 1
- [x] 标准 2
- [ ] 标准 3（未完成，原因：...）

【验证命令】
（一段可直接复制粘贴运行的 shell）

【未完成项 / 阻塞】
- 阻塞点：xxx，需要人类确认 yyy

【触发的红线 / 边界争议】
- 无 / 有（说明）

【建议下一步】
- T-Wx-yy+1 可以开始 / 需要先做 T-Wx-zz
```

---

## 10. AI 防跑偏机制总结

| 风险 | 防护机制 |
| --- | --- |
| AI 扩大任务范围 | §1 硬约束 5 红线清单 + 任务单的"约束"字段 |
| AI 引入新依赖 | §1 硬约束 3 技术栈锁定 |
| AI 改动不该动的代码 | §1 硬约束 5 + 任务单"输入"字段精确指明 |
| AI 跳过测试 | §8.6 测试规范 + 任务单"完成标准"含测试要求 |
| AI 不更新文档 | §8.7 文档更新规范 + 完成提交格式 §9 |
| AI 改写历史 | §1 硬约束 5 禁止 force push 和 amend pushed |
| AI 做产品决策 | §1 硬约束 7 触发暂停的红线 |
| AI 写占位代码 | §1 硬约束 5 + §8 长期规范 |
| AI 提交带密钥 | §8.5 安全规范 + commit 前自查 |
| AI 把 W2 任务当 W4 做 | §1 必读文档 + 任务单 ID 严格匹配 |

---

## 11. 给人类负责人的使用建议

1. **每周一开始时**，把当周任务包（W1 / W2 / W3 / W4）整段塞给 AI 让它读
2. **每次新对话开始**，必须粘贴 §1 通用前置提示词，不要省略
3. **AI 完成任务**，先看 §9 完成提交格式是否齐全，再看 git diff
4. **不接受**「我先做到 70%，剩下 30% 之后做」—— 任务要么完成要么明确阻塞
5. **AI 提出红线时**，**绝对不要**催它"先做着试试"。停下来讨论，决策后再继续
6. **每个 W 结束时**做一次完整跑通，不到 W 末尾不合并 commit 到 refactor 分支以外的地方

---

**附：本文件由 [项目重塑计划.md](项目重塑计划.md) 衍生。两份文件冲突时以重塑计划为准。**
