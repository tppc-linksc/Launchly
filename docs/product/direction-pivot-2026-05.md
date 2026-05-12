# Launchly Direction Pivot Decision Record (2026-05)

> This is a condensed decision record. The full plan is in [项目重塑计划.md](../../项目重塑计划.md).

## 1. Background

Launchly was originally positioned as a "self-hosted deployment and test collaboration platform." Over Weeks 1-13, the project built module scaffolds across 12+ domains (deployment, test cases, issue tracking, release gates, audit logging, notifications, CLI installer, etc.), but several problems emerged:

- **Scope sprawl**: 12+ domain modules in 13 weeks, each only ~1 week — broad but shallow.
- **Wrong positioning**: Calling itself "lightweight" while carrying a three-language stack (Vue 3 + Spring Boot x2 + Go CLI + Postgres + Docker Compose) and trying to compete with Jira, TestRail, and CI/CD platforms simultaneously.
- **No sharp entry point**: No single killer feature to differentiate from existing tools.
- **Closed delivery model**: Self-hosted only, blocking any SaaS path to monetization.
- **Zero real-user validation**: Pure waterfall planning, no design partner feedback.
- **MIT license conflict**: Allowing anyone to fork and run a commercial SaaS without contributing back.

## 2. New Positioning (One Sentence)

Launchly is a **lightweight code auto-deployment platform** providing **dual delivery from a single codebase**:

- **Launchly Cloud**: Official SaaS deployment, register and use immediately.
- **Launchly Self-Host**: Open-source edition, users deploy themselves.

The core loop is: **connect repo → build → deploy → health check → rollback**. Testing integration (L0 + L1), issue tracking, release gates, audit logging, and notifications come built-in as foundational features. AI reports, third-party notification bindings, security monitoring, and managed runtime are reserved as premium/Pro features.

## 3. Five Core Decisions

| # | Decision | Summary |
| --- | --- | --- |
| D-01 | Primary focus | Code auto-deployment, not "collaboration platform." Test/Issue/Release are baseline features, not the main selling point. |
| D-02 | Business model | Side project that pays for itself — cover server costs and earn stars, not ARR growth. |
| D-03 | Dual mode | SaaS + open-source self-host from one codebase (`cloud-only/` + `selfhost-only/` directories + compile-time EDITION toggle). |
| D-04 | Deployment target | MVP uses BYOS exclusively (users bring their own SSH/Docker servers). Managed runtime deferred to Pro. |
| D-05 | Git strategy | No Git hosting layer. Users push to GitHub/GitLab; Launchly pulls via PAT. Deployment triggered manually (no webhooks). |

For the full 20-item decision list, see [项目重塑计划.md §5](../../项目重塑计划.md).

## 4. 新旧能力对照（Old vs. New Capability Map）

| Area | Old State (Weeks 1-13) | New Direction (Post-Pivot) |
| --- | --- | --- |
| **Deployment** | Deploy to local docker.sock | Deploy to remote BYOS servers via SSH |
| **CI model** | Webhook-triggered | Manual "Publish" button in UI |
| **Test integration** | Test case management module | L0 (shell exit code) + L1 (JUnit XML parsing) in deployment pipeline |
| **Issue tracking** | Standalone module | Preserved as baseline, demoted in navigation |
| **Release gates** | Multi-tier gate model | Simplified to L1 sequential gate (Free), L2/L3/L4 (Pro) |
| **Navigation** | Flat: all modules equal | Deployment / Projects / Deploy Targets primary; Test / Issue / Release / Audit / Notifications in secondary menu |
| **Data model** | Project → Repository binding | Component entity between Project and Repository (UI collapsed by default when single) |
| **User model** | Workspace-based | Organization-based; roles limited to Owner / Member / Viewer |
| **CLI** | `launchly install` with built-in PostgreSQL | Self-Host-only feature; Cloud edition uses SaaS control plane |
| **License** | MIT | AGPL-3.0 |

## 5. Impact Scope

### What stays (no structural changes)

- All existing entity modules: testcase, issue, release, audit, notification — code preserved, only UI navigation demoted.
- Directory layout: `apps/web`, `services/api`, `services/worker`, `cli`, `deploy/compose` remain unchanged at top level.
- Technology stack: Vue 3 + Spring Boot 3 + Go + PostgreSQL — no new languages, frameworks, or databases introduced.

### What changes

- **W1**: Worker refactored from local Docker execution to remote SSH runner. New `DeployTarget` entity + CRUD API. Remove docker.sock mount from docker-compose.yml.
- **W2**: `Component` entity introduced. UI navigation converged — deployment and deploy targets become primary, test/issue/release demoted to secondary menu.
- **W3**: Test integration L0 + L1 added to deployment pipeline. JUnit XML parsing and visualization on deployment detail page.
- **W4**: Sequential gate L1, auto-rollback on failure, real-time deployment log streaming via SSE.

### What is deleted

- Nothing. All existing code is preserved; modules are only restructured or demoted in UI.

## 6. Timeline

| Phase | Duration | Scope |
| --- | --- | --- |
| W0 (Current) | ~3 days | Repository cleanup: LICENSE, README, docs, pivot record |
| W1 | ~1 week | BYOS Worker: SSH remote execution, DeployTarget CRUD |
| W2 | ~1 week | UI convergence + Component data model |
| W3 | ~1 week | Test integration L0 + L1 |
| W4 | ~1 week | Gate L1 + auto-rollback + polish |
| Phase 2 | ~2 months | AI reports, custom domains, cron deployments, advanced gates (driven by star/issue feedback) |
| Phase 3 | ~3 months | Small team adoption push, Pro plan with Stripe billing |

Phase 1 (W0-W4) target: dogfood Launchly oneself + gather GitHub stars. No revenue target.

---

*Full plan and detailed task breakdown: [项目重塑计划.md](../../项目重塑计划.md).*
