# JSK CRM

A standalone web CRM replacing handwritten sales books at a building-materials retail business
(tiles, marble, granite, sanitaryware, CP fittings). Mobile-first for salespeople,
desktop-oriented for management.

> **Status: specification audited, implementation planned. No application code has been written
> yet.** Implementation begins after the open items in `/docs/SPEC_AUDIT.md` and
> `/docs/DECISIONS.md` are answered.

---

## The source of truth

[`CLAUDE_CODE_BUILD_SPEC.md`](./CLAUDE_CODE_BUILD_SPEC.md) is the implementation specification and
the source of truth. **If behaviour is not described there, it is not in Version 1.** It is never
edited; issues with it are recorded in `/docs/SPEC_AUDIT.md`.

[`CLAUDE.md`](./CLAUDE.md) holds the engineering rules for this repository — read it before
writing code.

## Documentation

| Document | What it covers |
|---|---|
| [`docs/IMPLEMENTATION_PLAN.md`](./docs/IMPLEMENTATION_PLAN.md) | 21 phases: objective, dependencies, files, database changes, tests, acceptance criteria, risks |
| [`docs/SPEC_AUDIT.md`](./docs/SPEC_AUDIT.md) | 53 open findings against the specification — 10 blockers |
| [`docs/DECISIONS.md`](./docs/DECISIONS.md) | The 12 open business decisions (`TODO-BD`) and the architecture decision record |
| [`docs/PRODUCT_REQUIREMENTS.md`](./docs/PRODUCT_REQUIREMENTS.md) | Scope, users, business rules, lifecycle, screens, dashboards |
| [`docs/DATABASE.md`](./docs/DATABASE.md) | Eleven tables, constraints, triggers, migration order |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Stack, layering, rendering strategy, invariants |
| [`docs/PERMISSIONS.md`](./docs/PERMISSIONS.md) | Roles, capability matrix, RLS policies |
| [`docs/API.md`](./docs/API.md) | Service contract, error codes, transactional RPCs, cron routes |
| [`docs/TESTING.md`](./docs/TESTING.md) | Unit, integration/RLS, the 15 E2E scenarios, security suite |
| [`docs/SETUP.md`](./docs/SETUP.md) | Local development environment |
| [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) | Environments, migrations, cron, backups, launch checklist |

## Stack

Next.js 15 (App Router) + TypeScript strict · Supabase (Postgres, Auth, Storage) · Tailwind +
shadcn/ui · Zod · TanStack Query · Recharts · Resend · Vercel · Vitest + Playwright.

The stack is frozen (§17.1). Any addition requires a `/docs/DECISIONS.md` entry **before** it is
installed.

## Principles

- RLS is the authorization boundary — frontend filtering is not a control
- The database enforces critical business rules through check constraints
- Nothing is ever hard-deleted; history is append-only
- Money is bigint paise; timestamps are UTC, displayed `Asia/Kolkata`
- Business logic lives in services; mutations go through Server Actions
- No unresolved business decision is ever hard-coded — it lives in `system_settings`

## Getting started

See [`docs/SETUP.md`](./docs/SETUP.md).
