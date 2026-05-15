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
  <strong>Lightweight code auto-deployment platform · Dual delivery (SaaS + open-source self-host, same codebase)</strong>
</p>

<p align="center">
  Built for 5-20 person teams and individual developers, centered on a single pipeline: "connect repo → build → deploy → health check → rollback". Dual delivery: Launchly Cloud (SaaS, sign up and go) and Launchly Self-Host (open-source, deploy yourself).
</p>

<p align="center">
  <a href="README.md">中文文档</a>
</p>

> **2026-05 Direction Pivot**: Launchly has been refocused to a **dual-delivery lightweight code auto-deployment platform**. **Authoritative product spec**: [Product Handbook 2.0 (ZH)](docs/basic/产品设计规范.md). Historical v1 docs: [docs/archive/v1-2026-05/README.md](docs/archive/v1-2026-05/README.md). New work continues on `refactor/dual-mode-deploy`.

---

## Table of Contents

- [Why Launchly](#why-launchly)
- [Project Status](#project-status)
- [Design Principles](#design-principles)
- [System Architecture](#system-architecture)
- [Planned Features](#planned-features)
- [Directory Structure](#directory-structure)
- [Quick Start](#quick-start)
- [Development Guide](#development-guide)
- [Project Progress](#project-progress)
- [Authoritative documentation](#authoritative-documentation)
- [Contributing](#contributing)
- [License](#license)

---

## Why Launchly

Many personal projects and small-team products already have Git repositories, but still lack a low-cost, repeatable, traceable path from code to production:

- Code is often deployed to test environments manually, and nobody remembers which commit is running.
- Every deployment means SSH-ing in and typing `git pull && docker build && docker run` -- tedious and error-prone.
- Test cases, screenshots, fix tasks, and retest results are scattered across chat logs and docs, with no single entry point.
- Staging and production releases lack gates and rollback safety nets; one mistake can cause an outage.
- Small teams don't need a full enterprise DevOps platform, but they do need a lightweight tool that works either as SaaS or self-hosted.

Launchly fills that gap: **connect repo → build → deploy → health check → rollback**, with built-in test integration, issue tracking, release gates, audit logging, and notifications as foundational features.

## Project Status

Launchly is currently in **pre-alpha / undergoing a direction pivot**. The project is being restructured from its old scaffold into a dual-delivery lightweight code auto-deployment platform.

**Completed**:

- Product design documentation and architecture docs
- Base monorepo layout
- Web / API / Worker / CLI core module scaffolds (Weeks 1-13)
- JWT-authenticated Owner initialization flow
- Deployment task pipeline (clone / build / deploy / health check) with stage logs
- Test case, issue, release, gate, and rollback baseline flow
- Docker Compose local-build deployment template

**In Progress**:

- Worker: replacing local docker.sock with remote SSH execution (BYOS)
- Data model: introducing DeployTarget and Component entities
- UI: converging navigation, surfacing deployments / projects / deploy targets
- README and docs: syncing with new direction

**Not Started**:

- SaaS control plane (registration, billing, multi-tenancy)
- AI-powered features (reports, anomaly attribution, security monitoring)
- Third-party notification integrations
- Self-Host CLI installer (`launchly install`)

## Design Principles

- **Local-first**: users should not manually prepare internal dependencies such as database, queue, or object storage.
- **One-command deployment**: `launchly install` should initialize PostgreSQL, App, Worker, default storage, and the first Owner setup.
- **Small-team friendly**: focus on project onboarding, deployment, testing, fixing, retesting, and release flow instead of a heavy enterprise platform.
- **Traceable workflow**: every deployment, test result, issue, release, and rollback should leave a record.
- **Zero-config first** (summary in [Product Handbook 2.0 §4](docs/basic/产品设计规范.md)); full archived text: `docs/archive/v1-2026-05/product/zero-config-ux-principles.md`.
- **Deployment-tool shell**: run-first home and horizontal work domains; see [UI Handbook 2.0 §2](docs/basic/UI与交互规范.md) and `docs/prototypes/系统设计mock.html`; implementation tasks **T-IA** in [archived AI task pack §15](docs/archive/v1-2026-05/root/AI开发任务包.md).

## System Architecture

Launchly starts with a modular monolith, a background worker, and a CLI-driven self-hosted installation flow.

```text
launchly CLI
  -> Docker Compose
      -> launchly-app      Web UI + API
      -> launchly-worker   Background task executor
      -> launchly-postgres Built-in PostgreSQL
      -> launchly-data     Local files, logs, attachments, and screenshots
```

Core modules:

| Module | Description |
| --- | --- |
| Web UI | Dashboard, projects, deployments, tests, issues, and releases |
| API Server | Auth, Workspace, project, environment, deployment, test, and permission APIs |
| Worker | Runs clone, build, deploy, automated test, and notification jobs |
| CLI | Manages install, start, stop, upgrade, backup, restore, and diagnostics |
| PostgreSQL | Built-in database started by default |
| Docker Compose | First-stage self-hosted delivery method |

## Planned Features

### Core Engine

| Feature | Cloud Free | Cloud Pro | Self-Host |
| --- | :---: | :---: | :---: |
| Create projects | 1-2 | Unlimited | Unlimited |
| Bind Git repos (GitHub / GitLab / PAT) | ✓ | ✓ | ✓ |
| Multi-Component (multiple services per project) | ✓ (UI collapsed by default) | ✓ | ✓ |
| Deploy to BYOS servers (SSH / Docker context) | ✓ | ✓ | ✓ |
| Build + deploy + health check | ✓ | ✓ | ✓ |
| Real-time deployment log streaming | ✓ | ✓ | ✓ |
| Auto-rollback on failure | ✓ | ✓ | ✓ |
| Manual deploy trigger (click to publish) | ✓ | ✓ | ✓ |
| Multi-environment | Fixed 2 tiers | Custom N tiers | Custom N tiers |
| Sequential gate L1 | ✓ | ✓ | ✓ |
| Advanced gates L2/L3/L4 | ✗ | ✓ | ✓ |
| L0 testing (shell exit code) | ✓ | ✓ | ✓ |
| L1 testing (JUnit XML parsing) | ✓ | ✓ | ✓ |

### Collaboration (Baseline)

| Feature | Cloud Free | Cloud Pro | Self-Host |
| --- | :---: | :---: | :---: |
| Issue assignment + retest loop | ✓ | ✓ | ✓ |
| Release records | ✓ | ✓ | ✓ |
| Roles: Owner / Member / Viewer | ✓ | ✓ | ✓ |
| Project-level permissions (person x Component x action) | ✗ | ✓ | ✓ |
| Webhook notifications | ✓ | ✓ | ✓ |
| Audit logs | ✗ | ✓ | ✓ |

### SaaS Control Plane

| Feature | Cloud Free | Cloud Pro | Self-Host |
| --- | :---: | :---: | :---: |
| Email sign-up + invite members | ✓ | ✓ | ✗ |
| Billing portal + subscription management | – | ✓ | ✗ |

### Self-Host Operations

| Feature | Cloud Free | Cloud Pro | Self-Host |
| --- | :---: | :---: | :---: |
| CLI install / up / down / status / logs / doctor | ✗ | ✗ | ✓ |
| Backup / restore | ✗ | ✗ | ✓ |

### Premium Add-ons (Pro / Future)

| Feature | Cloud Free | Cloud Pro | Self-Host |
| --- | :---: | :---: | :---: |
| AI daily / weekly / monthly reports | ✗ | ✓ | ✗ |
| AI anomaly attribution | ✗ | ✓ | ✗ |
| Project security monitoring | ✗ | ✓ | ✗ |
| Third-party notifications (Slack / Lark / Discord) | ✗ | ✓ | ✗ |
| Launchly managed runtime | ✗ | Future | ✗ |

## Directory Structure

```text
apps/web                 Vue 3 Web UI scaffold
services/api             Spring Boot API Server scaffold
services/worker          Spring Boot Worker scaffold
cli                      launchly CLI scaffold
deploy/compose           Self-hosted Docker Compose template
docs/basic               Three baseline specs (ZH): product / technical / UI
docs/work                [planning.md](docs/work/planning.md) (16-week map); `phase1|phase2|phase3/weekNN/` each with `week-N-{plan,test,log,review}.md`; [DeepSeek log schema](docs/work/DeepSeek日志结构.md)
docs/archive             Archived v1 documentation
docs/prototypes          Static HTML prototypes
# optional local scratch: create any ignored folder yourself — never substitutes week-*-plan.md
scripts                  Utility scripts
```

## Quick Start

Launchly is not usable as a product yet. The commands below only validate the current development scaffold.

Mandatory prerequisites:

- Docker is installed and the Docker engine is running.
- Local port `5432` is available (or set another port via env, for example `LAUNCHLY_DB_PORT=55432`).
- If you skip the database step and start the API directly, startup will fail (`Connection refused` / `Failed to configure a DataSource`).

### 1. CLI Scaffold

```bash
cd cli
go test ./...
go run ./cmd/launchly doctor
```

### 2. Start PostgreSQL (API dependency)

The API requires a running PostgreSQL instance. For local development, start one with Docker:

```bash
docker run -d --name launchly-postgres-dev \
  -e POSTGRES_USER=launchly \
  -e POSTGRES_PASSWORD=launchly_dev_password \
  -e POSTGRES_DB=launchly \
  -p 5432:5432 \
  postgres:16-alpine
```

> One-click deployment (`launchly install`) starts PostgreSQL automatically via docker-compose. This manual step is only needed for local development.

### 3. API Scaffold

```bash
cd services/api
mvn spring-boot:run
```

Flyway migrations run automatically on startup.

If your PostgreSQL does not use `5432`, set the port explicitly:

```bash
cd services/api
LAUNCHLY_DB_PORT=55432 mvn spring-boot:run
```

Health check:

```bash
curl http://localhost:8080/api/health
```

### 4. Web Scaffold

```bash
pnpm install
pnpm dev:web
```

## Development Guide

Recommended local tools:

| Tool | Purpose |
| --- | --- |
| Node.js + pnpm | Web development |
| Java 17 + Maven | API and Worker development |
| Go | CLI development |
| Docker + Docker Compose | Self-hosted deployment and local integration |
| PostgreSQL | Local database debugging; the final product will include it |

API development conventions:

- Backend framework: Spring Boot 3.x with `spring-boot-starter-web` for REST APIs.
- Database: PostgreSQL with Flyway migrations enabled.
- Security: Spring Security + JWT (Bearer Token) is integrated for protected APIs; fine-grained RBAC is still in progress.
- API modules are organized into `auth`, `workspace`, `project`, `environment`, `deployment`, `testcase`, `issue`, `release`, `notification`, `audit`, and `common` packages, matching the core modules in the product design.
- Worker pipeline runs staged tasks in sequence (clone -> build -> deploy -> health check) with stage logs.
- Sensitive environment variables are encrypted at rest and decrypted by Worker at deployment time.

Development principles:

- Public README files should describe the real project state and avoid presenting planned features as completed.
- Product decisions live in **docs 2.0 handbooks**; **update docs before code** when behavior changes.
- Collaborative breakdown lives only in **[planning.md](docs/work/planning.md)** → **`docs/work/phase*/weekNN/week-N-plan.md`** (includes the DeepSeek “contract” section). Feed DeepSeek **one weekday slice per session**; append to that week's **`week-N-log.md`** via **[DeepSeek日志结构.md](docs/work/DeepSeek日志结构.md)**. **Do not** maintain parallel “session” trees or duplicate logs.
- Optional personal notes: use any local ignored folder you like; it **must not** replace `week-*-plan.md`.
- Humans mainly review boundaries and key decisions; AI should execute concrete code, documentation, and verification tasks whenever possible.
- Implementation should stay aligned with **[Product 2.0](docs/basic/产品设计规范.md) + [Technical 2.0](docs/basic/技术架构规范.md) + [UI 2.0](docs/basic/UI与交互规范.md)**.

## Project Progress

| Item | Status |
| --- | --- |
| **Completed** | |
| Product design document | Completed |
| Base monorepo layout | Completed |
| Web / API / Worker / CLI core scaffolds | Completed |
| JWT auth and Owner initialization | Completed |
| Deployment pipeline (clone / build / deploy / health check) | Completed |
| Docker Compose local-build template | Completed |
| LICENSE replaced with AGPL-3.0 | Completed |
| **In Progress** | |
| README / dual-mode docs and badges | Completed |
| DeployTarget API, delete 409 guard, deploy-target UI | Completed |
| Worker BYOS (local image build + SSH to remote compose) | Completed (worker service mounts host `docker.sock` in `deploy/compose/docker-compose.yml`; see comments there) |
| Component data model (multi deployable units per project) | Not started |
| Full navigation convergence | In Progress; see [UI Handbook 2.0](docs/basic/UI与交互规范.md) and [T-IA in archived task pack](docs/archive/v1-2026-05/root/AI开发任务包.md) |
| **Not Started** | |
| SaaS control plane (registration / billing / multi-tenancy) | Not Started |
| AI-powered features | Not Started |
| Self-Host CLI (install / backup / restore) | Not Started |
| End-to-end integration and release | Not Started |

## Authoritative documentation

The **Chinese** specs below are authoritative (v1 is under [docs/archive/v1-2026-05](docs/archive/v1-2026-05/README.md)). **Master plan & weekly breakdown**: [docs/work/planning.md](docs/work/planning.md).

| Doc | Path | Notes |
| --- | --- | --- |
| Product spec | [docs/basic/产品设计规范.md](docs/basic/产品设计规范.md) | Positioning, models, permissions, flows |
| Technical spec | [docs/basic/技术架构规范.md](docs/basic/技术架构规范.md) | Stack, architecture, modules, security |
| UI & interaction spec | [docs/basic/UI与交互规范.md](docs/basic/UI与交互规范.md) | Pages, interactions, prototype index |
| Master plan | [docs/work/planning.md](docs/work/planning.md) | Global weeks 1–16 ↔ `phase1` (1–5) / `phase2` (6–11) / `phase3` (12–16); weekly **plan / test / log / review** |

**Work logs**: Append **only** to that week's `week-N-log.md` using [DeepSeek日志结构.md](docs/work/DeepSeek日志结构.md); do not fork extra log locations.

**Static prototypes**: [流程示意图](docs/prototypes/流程示意图.html), [系统设计mock](docs/prototypes/系统设计mock.html), [环境页面mock](docs/prototypes/环境页面mock.html).

## Contributing

Launchly is not yet in a formal open-source collaboration phase. At this stage, the project is better suited for focused iteration on product design, architecture boundaries, MVP task planning, and foundational implementation.

Before opening broader contribution, the project should add:

- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- Issue / PR templates

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See [LICENSE](LICENSE) for the full text.
