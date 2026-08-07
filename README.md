# AI Website Factory

AI Website Factory is a local, single-user foundation for a future agent-assisted workflow that creates standalone, versioned professional websites and moderately complex web applications.

## Current status

The current implementation includes the Lead Agent intake, clarification, deterministic Project Brief approval boundary, Planner / Architect planning package acceptance, deterministic Design Agent direction-selection boundary, deterministic Orchestrator TaskGraph planning, and a controlled deterministic single-task Implementation Agent foundation. Full website generation, complete TaskGraph execution, real Implementation Agent providers, QA/Release execution, image generation, Preview, external skills, MCP integrations, GitHub automation, and deployment are not implemented.
The Workspace Manager now creates safe, versioned project roots and `.factory` memory only; it does not generate website source or execute customer projects. The Approved Skills Registry is currently empty; future imports require static review and manual checksum-bound approval.

The old `ai-website-factory-preview-prototype` repository is a separate legacy reference and is intentionally not imported or modified. This repository contains no customer-site Preview system.

See [AI provider architecture](docs/ai-provider.md), [security](docs/ai-provider-security.md), and [manual smoke test](docs/ai-smoke-test.md) for the production OpenAI foundation. Real AI is opt-in and deterministic tests remain network-free.

## Development

```bash
npm install
npm run dev
```

Quality checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Docker:

```bash
docker compose config
docker compose build --no-cache
docker compose up -d
docker compose ps
docker compose down
```

The optional `FACTORY_PORT` environment variable changes the host port. Copy `.env.example` to a local `.env` only when needed; never commit credentials.

## Server-only database verification

Set `DATABASE_URL` in an ignored local `.env` file. Never paste credentials into prompts or commit them. Apply and inspect the migration with:

```bash
npm run db:validate
npm run db:migrate
npm run db:status
npm run db:verify
npm run db:smoke
```

The smoke test uses unique disposable data and removes it on completion. It never resets the database. If a credential is exposed, revoke or rotate it in Supabase immediately and replace the local value. Factory persistence is server-only; generated source and `.factory` Project Memory are not stored only in Supabase.

The minimal Factory health contract is available at `GET /api/health` and returns `{ "status": "ok", "service": "ai-website-factory" }`.

## Repository conventions

- npm is the only package manager.
- Customer projects will eventually be written outside this repository under `D:\Visual Studio Code\save\<project-slug>\v1`, `v2`, and so on.
- No deployment is performed by the Factory MVP.
- Architecture decisions and scope boundaries live under [`docs/`](docs/).
# Context7 is optional and disabled by default. It provides bounded, read-only, server-side documentation references only; see `docs/context7-integration.md`.

The shadcn Registry is optional and read-only; see `docs/shadcn-registry-integration.md`.

Backend task handlers are plan-bound and static-validation-only; see `docs/backend-implementation.md`.

Generated project runtime validation is npm-only, bounded, secret-stripped, and opt-in for real smoke execution; see [`docs/generated-runtime-validation.md`](docs/generated-runtime-validation.md).

Playwright is reserved for functional localhost QA only; screenshot and visual review are explicitly excluded. See [`docs/playwright-functional-qa.md`](docs/playwright-functional-qa.md).

Controlled full TaskGraph execution is fake-smoke tested and stops at pre-release eligibility; see [`docs/full-taskgraph-execution.md`](docs/full-taskgraph-execution.md).

The real Factory chain is an explicit opt-in smoke only: set `ALLOW_REAL_FACTORY_E2E=true` and run `npm run factory:e2e-smoke`. Without opt-in it prints `REAL_FACTORY_E2E_PENDING`; see [`docs/real-factory-e2e-smoke.md`](docs/real-factory-e2e-smoke.md).
