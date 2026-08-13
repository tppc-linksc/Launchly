<p align="center">
  <img alt="status" src="https://img.shields.io/badge/status-rebooting-orange">
  <img alt="license" src="https://img.shields.io/badge/license-AGPL--3.0-blue">
  <img alt="web" src="https://img.shields.io/badge/web-Vue%203%20%2B%20TypeScript-42b883">
  <img alt="api" src="https://img.shields.io/badge/api-NestJS%20%2B%20PostgreSQL-e0234e">
  <img alt="runtime" src="https://img.shields.io/badge/runtime-BYOS-0d9488">
</p>

<h1 align="center">Launchly</h1>

<p align="center">
  <strong>Move every CI-approved commit to your own servers clearly, reliably, and reversibly.</strong>
</p>

<p align="center">
  A Chinese-first BYOS release control plane for individual developers and teams of 5–20
</p>

<p align="center">
  <a href="README.md">中文文档</a>
</p>

> **Current status (2026-08-13)**: Launchly is being rebooted from baseline `a2f7b5b` and is in **R0 trusted-baseline repair**, not Beta. The current code is reusable groundwork, but production image, startup, authorization, and real deployment paths remain blocked. No capability is complete without a reproducible acceptance record.

## What Launchly is

Launchly connects Git providers and existing CI systems, deploys code or immutable OCI artifacts to user-owned Linux/NAS servers, and manages the following in one release context:

- Applications, services, long-lived environments, and PR previews.
- Push/PR triggers, CI gates, and deployment concurrency policies.
- Build plans, immutable artifacts, and environment promotion.
- BYOS nodes, domains, HTTPS, health, and traffic.
- Deployment logs, configuration diffs, rollback, and runtime status.
- Tests, security checks, approvals, blockers, release evidence, and audit events.

Target flow:

```text
Push / PR
  → signed and deduplicated webhook
  → branch / path / CI / concurrency policies
  → detection or launchly.yaml
  → one isolated build
  → OCI image@sha256
  → BYOS candidate deployment
  → release phase / health / tests / approval
  → traffic switch
  → runtime evidence, notification, or real rollback
```

## Product boundary

Launchly is not a replacement for GitHub Actions. Actions/GitLab CI continue to own code checks, unit tests, and scans; Launchly owns **CD, BYOS runtime, and release governance**.

It does not currently target:

- A general-purpose CI DSL, arbitrary jobs, or plugin marketplace.
- A Kubernetes control plane.
- A complete issue tracker.
- A Launchly-hosted application runtime by default.
- A browser host terminal.
- Cloud billing or multitenancy before the Self-Host loop is proven.

## Core product experiences

### Release command center

The home screen prioritizes active deployments, approvals, failures/rollbacks, unhealthy nodes, disk/certificate risk, and actionable next steps—not decorative project counts.

### Application environment lanes

Test, staging, and production show the active Artifact, ConfigRevision, domain, node, and health. The exact same digest is promoted; production does not rebuild tested source.

### Deployment workbench

One screen combines the real stage graph, live logs, CI/Test/Security gates, Artifact, configuration diff, traffic status, failure explanation, and rollback point. Restart, redeploy, rebuild, and rollback have distinct semantics.

### BYOS infrastructure center

A node is more than an SSH address: Launchly targets Agent/SSH status, Docker/Compose and CPU architecture, capacity, proxy, running applications, diagnostics, and drain state.

### PR previews

PRs receive isolated environments and URLs with labels, path filters, quotas, TTL, commit updates, and automatic cleanup. External forks do not receive trusted secrets by default.

### Release evidence

A Release aggregates commit/PR, Artifact, Config, CI, tests, security, approval, exemption, deployment, and rollback evidence. Built-in Issues narrow to release blockers and deployment incidents.

## Target architecture

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

Core invariants:

- The API does not mount the Docker socket or run builds/SSH directly.
- API, Worker, Build Worker, and runtime nodes have separate duties.
- Deployments reference OCI digests, never `latest` as release identity.
- Every project child resource validates Workspace, Project, ownership, and role.
- Failed health, migration, or gates cannot switch traffic.
- Secrets are short-lived at execution and never returned by ordinary APIs, logs, or audit exports.

## Honest current state

Baseline `a2f7b5b` includes Vue/NestJS/Prisma/CLI and project, environment, deployment, test, issue, release, and audit modules, plus partial Webhook, Worker, BuildKit, OCI, and SSH paths.

Independently verified:

- 570 existing API unit tests pass.
- 22 existing Web unit tests pass.
- 15 existing CLI unit tests pass.
- API, Web, and CLI compile.
- TEST-000 has passed independent Codex review: API, Web, and CLI now emit text and JSON summaries using a full-production-source denominator.
- TEST-API-01 passed independent Codex review with 30 new tests for SecretValue, EditionConfig, and GlobalExceptionFilter.
- TEST-API-02 passed independent Codex review with 43 new tests for EnvironmentService and EnvironmentVariableService.
- TEST-API-03 passed independent Codex review with 120 new tests for ProjectAccessService, RepositoryHintsService, and ResourceCatalogService.
- TEST-API-04 passed independent Codex review with 58 new tests for ReleaseService, NotificationService, and TestService.
- TEST-API-05 passed independent Codex review with 91 tests for DeployTargetService and no real SSH connection.
- TEST-API-06 passed independent Codex review with 87 tests for WorkerService and no real Schedule, database, process, network, or SSH execution.
- TEST-API-07A passed independent Codex review with 89 tests for RunnerFactory, CommandExecutor, DockerRunner, and OciImageRunner; TEST-API-07 as a whole remains in progress.
- API coverage is 46.59% statements, 45.98% branches, 46.27% functions, and 45.86% lines.
- Web coverage is 5.65% statements, 39.13% branches, 5.61% functions, and 5.65% lines.
- CLI coverage is 10.13% statements, 87.50% branches, 83.33% functions, and 10.13% lines.

R0 is still blocked:

- Production output does not match the configured `dist/main` entrypoint.
- Dockerfile Web/BuildKit stages need repair.
- Missing `EnvironmentService` injection prevents Nest startup.
- Multiple project child APIs lack complete Workspace/Project authorization.
- There is no real image startup, empty/upgrade database, GitHub, Registry, BuildKit, SSH, HTTPS, or rollback E2E record.

There is therefore no deploy path that can currently be promised to users. Historical “Beta,” “core pipeline usable,” and “complete test suite” claims are obsolete.

## Roadmap

| Stage | Outcome | Status |
| --- | --- | --- |
| R0 Trusted baseline | Build, startup, authorization, migrations, delivery config | In progress |
| R1 First deployment | Clean install, node doctor, existing OCI digest deployment | Unaccepted |
| R2 Continuous delivery | GitHub App, webhook, CI/branch/path/concurrency, status feedback | Unaccepted |
| R3 Safe production | Isolated build, artifact promotion, HTTPS, traffic switch, real rollback | Unaccepted |
| R4 Preview/Monorepo | PR environments, TTL/quota/cleanup, affected services | Unaccepted |
| R5 Release governance | Evidence, blockers, approvals, notifications, lightweight observability | Unaccepted |
| R6 Multi-node/Cloud | Agent and multi-node first; Cloud reconsidered after stable Self-Host | Not started |

See the Chinese [Project Reboot Roadmap](docs/basic/项目重启路线图.md) for tasks, dependencies, and acceptance mappings.

## Repository structure

```text
apps/web                 Vue 3 + Element Plus Web UI
services/api             NestJS API + Worker baseline
cli                      TypeScript Self-Host CLI
deploy/compose           Self-Host Compose template
examples                 Applications for real acceptance tests
docs/basic               Authoritative product, architecture, UI, acceptance, and roadmap docs
docs/prototypes          Local prototypes (ignored by default)
```

## Current development commands

These commands only prove static checks and unit tests, not Self-Host or deployment readiness:

```bash
pnpm test
pnpm --dir services/api build
pnpm --dir apps/web build
pnpm --dir cli build
```

Historical `launchly install` and Compose quick-start instructions are suspended until R0/R1 acceptance. NAS guides are environment notes, not installation evidence.

## Project documents

See the Chinese [Document Index](docs/basic/文档索引.md) for categories, reading order, and ID rules.

| Document | Scope |
| --- | --- |
| [Document Index](docs/basic/文档索引.md) | Categories and links for specifications, issues, work, acceptance, and environment notes |
| [Product Design](docs/basic/产品设计规范.md) | Positioning, users, domain model, scope, priorities |
| [Technical Architecture](docs/basic/技术架构规范.md) | Topology, state machine, data, security, execution boundaries |
| [UI and Interaction](docs/basic/UI与交互规范.md) | Information architecture, core screens, design system |
| [Delivery Acceptance](docs/basic/交付验收规范.md) | Evidence levels, blocking E2E, stage exits |
| [Known Issues](docs/basic/已知问题清单.md) | Confirmed facts, evidence, impact, and task links; not scheduling |
| [Project Reboot Roadmap](docs/basic/项目重启路线图.md) | Baseline, dependencies, progress, next work |
| [Test Completion Workbook](docs/basic/测试补全任务书.md) | Coverage baseline, scenario matrix, MiniMax work packages, Codex review rules |
| [NAS Compatibility](docs/basic/NAS%20部署兼容性.md) | R1 compatibility target, not a current installation promise |
| [ZSpace Z4 Pro Draft](docs/basic/极空间Z4Pro从GitHub部署Launchly.md) | Suspended until R0/R1 real-environment E2E passes |

`KI-###` means an issue, `R#-##` an implementation task, `TEST-*` a test work package, and `BASE/E2E` acceptance evidence. They are not interchangeable. “Must” and “target” do not mean implemented; only acceptance evidence can change roadmap status.

## Development principles

- Update authoritative docs before implementing scope changes.
- Keep each task to one verifiable outcome and provide diff, commands, raw results, and uncovered boundaries.
- Security, authorization, migrations, state machines, and production configuration require independent review.
- Generated code or audit reports cannot update completion status on their own.
- Do not implement Cloud, AI, canary, or template-market features before R0.

## Contributing

Launchly is not yet in formal open-source collaboration. The current priority is restoring a trusted baseline, proving the BYOS loop, and rebuilding the core product experience. Contribution guidelines, a code of conduct, and issue/PR templates will follow.

## License

Launchly is licensed under [GNU AGPL-3.0](LICENSE).
