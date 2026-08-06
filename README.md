# AI Website Factory

AI Website Factory is a local, single-user foundation for a future agent-assisted workflow that creates standalone, versioned professional websites and moderately complex web applications.

## Current status

The current implementation is only the technical foundation: one Next.js App Router application, npm tooling, a minimal initialized-state screen, Docker packaging, domain contracts, filesystem Project Memory, and server-only Supabase workflow persistence. Agent orchestration, website generation, Preview, Workspace Manager, external skills, MCP integrations, GitHub automation, and deployment are not implemented.

The old `ai-website-factory-preview-prototype` repository is a separate legacy reference and is intentionally not imported or modified. This repository contains no customer-site Preview system.

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
