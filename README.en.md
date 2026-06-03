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
  <strong>Lightweight code auto-deployment platform · Dual delivery (SaaS + open-source self-host, same codebase)</strong>
</p>

<p align="center">
  Built for 5-20 person teams and individual developers, centered on a single pipeline: "connect repo → build → deploy → health check → rollback". Dual delivery: Launchly Cloud (SaaS, sign up and go) and Launchly Self-Host (open-source, deploy yourself).
</p>

<p align="center">
  <a href="README.md">中文文档</a>
</p>

> **2026-05 Direction Pivot**: Launchly has been refocused to a **dual-delivery lightweight code auto-deployment platform**. Decisions and historical materials have been archived; **the current product authority is the [Product Design Spec](docs/basic/产品设计规范.md)**. Archive index: [docs/archive/v1-2026-05/README.md](docs/archive/v1-2026-05/README.md). New direction is being developed on the `refactor/dual-mode-deploy` branch.
>
> **Documentation upload note**: only the three baseline specs under `docs/basic/` are tracked in the public repository. `docs/work/`, `docs/archive/`, and `docs/prototypes/` are local collaboration docs and prototypes, added to `.gitignore`; README links to those paths are kept for maintainer-local navigation and are not guaranteed to resolve on GitHub.

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
- [Authoritative Documentation](#authoritative-documentation)
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

Launchly is currently in **Beta**. The core deployment pipeline, CLI installer, and web workstation are usable, and early trial rollout is being prepared.

**Completed**:

- Product design documentation and architecture docs
- Base monorepo layout
- Web / API / Worker / CLI core module scaffolds
- JWT-authenticated Owner initialization flow
- Deployment task pipeline (clone / build / deploy / health check) with stage logs
- Test case, issue, release, gate, and rollback baseline flow
- Docker Compose local-build deployment template
- DeployTarget API and frontend deploy target management page
- Worker BYOS (SSH remote execution, local image build + SSH deploy to remote compose)
- CLI installer (install / up / down / status / logs / doctor / backup / restore / upgrade / uninstall)
- UI navigation convergence (top bar + horizontal capsule navigation, runtime Dashboard)
- Global error toasts, empty-state CTAs, responsive layout
- `triggeredByName` trigger person display
- Viewer permission control (hide write-action buttons)
- Project list card layout (cards + latest deploy status)
- Member management page (list, role change, remove)
- Component multi-deployable-unit data model
- Audit log CSV export
- Design system token landing (Element Plus primary color #0D9488)
- EDITION switch (cloud / selfhost mode)
- Zero-Config Node inference (auto-detect package.json)
- Complete test suite (API Jest 42 tests + Frontend Vitest 22 tests + CLI Vitest 15 tests)

**Not Started**:

- SaaS control plane (registration, billing, multi-tenancy)
- AI-powered features (reports, anomaly attribution, security monitoring)
- Third-party notification integrations

## Design Principles

- **Local-first**: users should not manually prepare internal dependencies such as database, queue, or object storage.
- **One-command deployment**: `launchly install` should initialize PostgreSQL, App, Worker, default storage, and the first Owner setup.
- **Small-team friendly**: focus on project onboarding, deployment, testing, fixing, retesting, and release flow instead of a heavy enterprise platform.
- **Sensible defaults**: fewer forms, more inference; commands and container details are hidden by default, with advanced capabilities disclosed progressively (see [Product Design Spec](docs/basic/产品设计规范.md) Section 4 and the archived zero-config full text).
- **Deployment-tool shell**: default home screen highlights running deployments and next steps; target layout in [Launchly-prototype.html](docs/prototypes/Launchly-prototype.html); information architecture in [UI & Interaction Spec](docs/basic/UI与交互规范.md) Section 2, [Product Design Spec](docs/basic/产品设计规范.md) Section 6; implementation tasks in archived [AI task pack Section 15](docs/archive/v1-2026-05/root/AI开发任务包.md) (T-IA).
- **Traceable workflow**: every deployment, test, issue, release, and rollback should leave a record.
- **Human-AI collaborative development**: development tasks should be understandable, divisible, executable, and verifiable by both humans and AI.

## System Architecture

Launchly first phase uses a "modular monolith (NestJS) + built-in background task executor + CLI one-click deployment" architecture. Since v0.2, API and Worker are merged into a single NestJS process.

```text
launchly CLI
  -> Docker Compose
      -> launchly-app      Web UI + API + Worker (single process)
      -> launchly-postgres Built-in PostgreSQL
      -> launchly-data     Local files, logs, attachments, and screenshots
```

Core modules:

| Module | Description |
| --- | --- |
| Web UI | Dashboard, projects, deployments, tests, issues, and releases |
| API Server | Auth, Workspace, project, environment, deployment, test, and permission APIs (NestJS) |
| Worker | Background task executor (embedded in API process, PostgreSQL polling) |
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
apps/web                 Vue 3 + Element Plus Web UI
services/api             NestJS API Server + Worker (single process)
cli                      TypeScript CLI (commander.js)
deploy/compose           Self-hosted Docker Compose template
examples                 Example projects (for verifying deployment flow)
docs/basic               Product Design Spec / Technical Architecture Spec / UI & Interaction Spec (authoritative)
docs/work                [planning.md](docs/work/planning.md) (16-week map); `phase1|phase2|phase3/weekNN/` each with week-N-plan/test/log/review quad
docs/archive             Archived v1 documentation
docs/prototypes          Static HTML interactive prototypes
# (optional) local scratch folders with any name; if added to .gitignore, they won't be pushed — not part of collaboration breakdown
```

## Quick Start

**Prerequisites**:

- Docker is installed and the Docker engine is running.
- Local `8080` and `5432` ports are available (or override via env).

### One-Click Install (Recommended)

```bash
# Install dependencies and build CLI
cd cli && pnpm install && pnpm build

# Preview install (dry run, no changes)
node dist/index.js install --dry-run

# Run install
node dist/index.js install
```

After installation:

1. Open `http://localhost:8080/setup`
2. Create an admin account and default Workspace
3. Log in and start using

### Common Commands

The CLI binary is at `cli/dist/index.js` after build, invoke via `node`:

```bash
node dist/index.js doctor      # Check system environment (Docker, ports, disk)
node dist/index.js status      # View service status
node dist/index.js logs -f     # Stream logs in real time
node dist/index.js up          # Start services
node dist/index.js down        # Stop services
node dist/index.js backup      # Backup database and data
node dist/index.js restore <file>  # Restore from backup
```

### Verify Deployment

After installation, use the `examples/node-hello` example project to verify the deployment flow:

1. Push `examples/node-hello` to a Git repository
2. Create a project in Launchly and connect the repository
3. Add a deploy target (SSH server address, port, username, authentication method)
4. Configure environment variables (optional)
5. Trigger a deployment and observe the staged pipeline (clone → build → deploy → health check)

### Development Mode

For local development and debugging, there are two modes:

**Mode A: Local minimal dev mode**

```bash
# Start PostgreSQL
docker run -d --name launchly-postgres-dev \
  -e POSTGRES_USER=launchly \
  -e POSTGRES_PASSWORD=launchly_dev_password \
  -e POSTGRES_DB=launchly \
  -p 5432:5432 \
  postgres:16-alpine

# Start API + Worker
cd services/api
set -a && source ../../.env && set +a
pnpm run start:dev
```

**Mode B: Full compose stack (2 containers: postgres + app)**

```bash
set -a && source ./.env && set +a
docker compose -f deploy/compose/docker-compose.yml up -d --build
```

**Web development**

```bash
# Install all dependencies (including workspaces) from root
pnpm install

# Start frontend dev server (http://localhost:5173)
pnpm dev:web
```

### Troubleshooting

| Problem | How to diagnose |
| --- | --- |
| Port in use | `node dist/index.js doctor` checks 8080/5173/5432 ports |
| Docker not running | `node dist/index.js doctor` reports Docker status |
| Cannot access after install | Check `node dist/index.js status` to confirm services are running |
| Deployment failed | View `node dist/index.js logs -f` |
| Database connection failed | Confirm PostgreSQL container is running: `docker ps` |
| Data issues after key change | Changing `LAUNCHLY_ENCRYPTION_KEY` makes previously encrypted data unreadable; keep it consistent |

## Development Guide

Recommended local tools:

| Tool | Purpose |
| --- | --- |
| Node.js 20+ + pnpm | Frontend, API, and CLI development |
| Docker + Docker Compose | Self-hosted deployment and local integration |
| PostgreSQL | Local database debugging; the final product will include it |

API development conventions:

- Backend framework: NestJS 10.x, via `@nestjs/platform-express` for REST APIs.
- ORM: Prisma, with `prisma migrate` for database migrations.
- Security: Custom JWT Guard + RBAC Role Guard; protected APIs require authentication.
- API modules are organized into `auth`, `workspace`, `project`, `environment`, `deployment`, `target`, `testcase`, `issue`, `release`, `notification`, `audit`, and `worker` packages, matching the core modules in the product design.
- Worker background tasks are embedded in the API process, polling the PostgreSQL task queue via `@nestjs/schedule`.
- Deployment pipeline runs staged tasks in sequence (clone -> build -> deploy -> health check) with stage logs.
- Sensitive environment variables are encrypted at rest (AES-256-GCM) and decrypted by Worker at deployment time.

Testing:

```bash
pnpm test          # Run all tests (API + Frontend + CLI)
pnpm test:api      # API tests only (Jest)
pnpm test:web      # Frontend tests only (Vitest)
pnpm test:cli      # CLI tests only (Vitest)
```

Development principles:

- Public README files should describe the real project state and avoid presenting planned features as completed.
- Product decisions live in **`docs/basic/`** three specs; **update docs before code** when behavior changes.
- **Collaboration breakdown**: the sole entry point is [`docs/work/planning.md`](docs/work/planning.md) → `docs/work/phase*/weekNN/week-N-plan.md` (includes the DeepSeek "contract" section). Feed DeepSeek **one weekday slice per session**; append to that week's `week-N-log.md` per [DeepSeek日志结构.md](docs/work/DeepSeek日志结构.md). **Do not** maintain parallel session directories or duplicate logs.
- Optional personal notes: use any local ignored folder you like; it **must not** replace `week-*-plan.md`.
- Humans mainly review boundaries and key decisions; AI should execute concrete code, documentation, and verification tasks whenever possible.
- Implementation should stay aligned with **[Product Design Spec](docs/basic/产品设计规范.md) + [Technical Architecture Spec](docs/basic/技术架构规范.md) + [UI & Interaction Spec](docs/basic/UI与交互规范.md)**.

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
| DeployTarget API, delete 409 guard, deploy-target UI | Completed |
| Worker BYOS (local image build + SSH to remote compose) | Completed |
| Self-Host CLI (install / up / down / status / logs / doctor / backup / restore) | Completed |
| UI navigation convergence (top bar + horizontal capsule navigation, runtime Dashboard) | Completed |
| Global error toasts, empty-state CTAs, responsive layout | Completed |
| Viewer permission control (hide write-action buttons) | Completed |
| Project list card layout | Completed |
| Member management page | Completed |
| Component multi-deployable-unit data model | Completed |
| Audit log CSV export | Completed |
| Design system token landing | Completed |
| EDITION switch (cloud / selfhost) | Completed |
| Zero-Config Node inference | Completed |
| Complete test suite (79 tests, all passing) | Completed |
| **Not Started** | |
| SaaS control plane (registration / billing / multi-tenancy) | Not Started |
| AI-powered features | Not Started |
| End-to-end integration and release | Not Started |

## Authoritative Documentation

Only the three **Chinese baseline specs** below are tracked in the public repository. The master plan, work logs, archived notes, and static prototypes are local collaboration documents; README links are kept for maintainer-local navigation and are not guaranteed to resolve on GitHub.

| Doc | Path | Notes |
| --- | --- | --- |
| Product spec | [docs/basic/产品设计规范.md](docs/basic/产品设计规范.md) | Positioning, models, permissions, flows |
| Technical spec | [docs/basic/技术架构规范.md](docs/basic/技术架构规范.md) | Stack, architecture, modules, security |
| UI & interaction spec | [docs/basic/UI与交互规范.md](docs/basic/UI与交互规范.md) | Pages, interactions, prototype index |
| Master plan (local) | [docs/work/planning.md](docs/work/planning.md) | Local collaboration entry; not uploaded to the public repository |

**Work logs (local)**: Append **only** to that week's `week-N-log.md` using [DeepSeek日志结构.md](docs/work/DeepSeek日志结构.md); do not fork extra log locations.

**Static prototypes (local)**: [Launchly-prototype.html](docs/prototypes/Launchly-prototype.html).

## Contributing

Launchly is not yet in a formal open-source collaboration phase. At this stage, the project is better suited for focused iteration on product design, architecture boundaries, MVP task planning, and foundational implementation.

Before opening broader contribution, the project should add:

- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- Issue / PR templates

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See [LICENSE](LICENSE) for the full text.
