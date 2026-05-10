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
  <strong>Self-hosted deployment and testing collaboration platform</strong>
</p>

<p align="center">
  Built for individuals and small teams to manage Git project onboarding, test deployments, staging validation, production releases, test cases, issue assignment, and release records in one lightweight system.
</p>

<p align="center">
  <a href="README.md">中文文档</a>
</p>

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
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

---

## Why Launchly

Many personal projects and small-team products already have Git repositories, but still lack a clear, low-cost, traceable release and testing workflow:

- Code is often deployed to test environments manually.
- Testers may not know which commit is currently running.
- Test cases, screenshots, fix tasks, and retest results are scattered across tools.
- Staging and production releases often lack gates, records, and rollback points.
- Small teams may not need a full enterprise DevOps platform, but they do need a local-first collaboration tool that works out of the box.

Launchly aims to fill that gap.

## Project Status

Launchly is currently in **pre-alpha / MVP integration-ready stage**.

Completed:

- Product design and architecture documentation.
- Base monorepo layout.
- Core Web/API/Worker/CLI modules (Weeks 1-13).
- JWT-authenticated Owner initialization flow.
- Deployment task pipeline (clone/build/deploy/health check) with stage logs.
- Test case, issue, release, gate, and rollback baseline flow.
- Docker Compose local-build deployment template.

Not implemented yet:

- Member management page `/members` (currently placeholder).
- Fine-grained RBAC policy (currently MVP-level authentication/authorization).
- Remote image publish pipeline for `launchly install` (local compose build path is available).

## Design Principles

- **Local-first**: users should not manually prepare internal dependencies such as database, queue, or object storage.
- **One-command deployment**: `launchly install` should initialize PostgreSQL, App, Worker, default storage, and the first Owner setup.
- **Small-team friendly**: focus on project onboarding, deployment, testing, fixing, retesting, and release flow instead of a heavy enterprise platform.
- **Traceable workflow**: every deployment, test result, issue, release, and rollback should leave a record.
- **Human-AI collaboration**: tasks should be understandable, executable, and verifiable by both humans and AI agents.

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

Launchly is planned to support:

- One-command local or server installation through `launchly install`.
- First-run Owner account and default Workspace setup.
- Workspace invitations and role-based permissions.
- GitHub, GitLab, and private Git repository binding.
- Deployments to Test, Staging, and Production environments.
- Environment variables and sensitive configuration management.
- Test cases, test execution records, screenshots, and logs.
- Assignment of failed test items to specific members for fixes and retesting.
- Production release gate checks.
- Release records, deployment logs, audit logs, and rollback points.

## Directory Structure

```text
apps/web                 Vue 3 Web UI scaffold
services/api             Spring Boot API Server scaffold
services/worker          Spring Boot Worker scaffold
cli                      launchly CLI scaffold
deploy/compose           Self-hosted Docker Compose template
docs/product             Product requirements, flows, architecture, and technical plan
docs/dev-tasks           Local development task docs, ignored by git
scripts                  Utility scripts
```

## Quick Start

Launchly is not usable as a product yet. The commands below only validate the current development scaffold.

### CLI Scaffold

```bash
cd cli
go test ./...
go run ./cmd/launchly doctor
```

### Web Scaffold

```bash
pnpm install
pnpm dev:web
```

### API Scaffold

```bash
cd services/api
mvn spring-boot:run
```

Health check:

```bash
curl http://localhost:8080/api/health
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
- Product decisions live in `docs/product`.
- Local development plans live in `docs/dev-tasks`, which is ignored by git.
- Weekly task docs use an AI-primary execution format: goals, prerequisites, human review points, files, inputs, outputs, constraints, and completion criteria.
- Humans mainly review boundaries and key decisions; AI should execute concrete code, documentation, and verification tasks whenever possible.
- Implementation should stay aligned with the current product design.

## Project Progress

| Item | Status |
| --- | --- |
| Product design document | Done v0.4 |
| Base directory structure | Done |
| Web UI scaffold | Done |
| API Server scaffold | Done |
| Worker scaffold | Done |
| CLI scaffold | Done |
| Docker Compose template | Done |
| Week 1: Foundation & baseline | Done |
| Weeks 2-13 core modules | Done (MVP integration can start) |
| Auth and Workspace | Basic flow implemented |
| Project onboarding and repository binding | Basic flow implemented |
| Deployment execution and environment management | Basic flow implemented |
| Tests, issues, and release gates | Basic flow implemented |
| Members page `/members` | Placeholder, pending implementation |
| CLI one-click install via remote images | Pending image publish pipeline |

## Documentation

- [Launchly product requirements, flows, architecture, and technical plan](docs/product/Launchly-design.md)
- Local development roadmap and weekly plans live under `docs/dev-tasks/`, which is ignored by `.gitignore`.

## Contributing

Launchly is not yet in a formal open-source collaboration phase. At this stage, the project is better suited for focused iteration on product design, architecture boundaries, MVP task planning, and foundational implementation.

Before opening broader contribution, the project should add:

- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- Issue / PR templates
- LICENSE

## License

The license has not been decided yet. A `LICENSE` file should be added before the project is formally open sourced.
