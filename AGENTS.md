<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Repository boundaries

- AI agents live under `src/agents/`: Lead, Planner, Design, and Implementation.
- Orchestration lives under `src/orchestration/`; it coordinates lifecycle, TaskGraph execution, retry, repair, and reconciliation.
- Shared domain contracts live under `src/domain/`.
- External adapters live under `src/integrations/`.
- Persistence is under `src/persistence/`; runtime mechanics are under `src/runtime/`.
- Deterministic validators remain with their owning runtime or domain module.
- Approved Skills Registry source is `src/skills/registry/`; imported skill content is stored under root `skills/`.

Future reviewer agents are planned, but are not implemented or represented by placeholder directories.
