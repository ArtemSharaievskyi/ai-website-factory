<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Repository boundaries

- AI agents live under `src/agents/`: Lead, Planner, Design, Implementation, the read-only Architecture Reviewer, and the read-only Contract Auditor under `src/agents/reviewers/contracts/`.
- Orchestration lives under `src/orchestration/`; it coordinates lifecycle, TaskGraph execution, retry, repair, and reconciliation.
- Shared domain contracts live under `src/domain/`.
- External adapters live under `src/integrations/`.
- Persistence is under `src/persistence/`; runtime mechanics are under `src/runtime/`.
- Deterministic validators remain with their owning runtime or domain module.
- Approved Skills Registry source is `src/skills/registry/`; imported skill content is stored under root `skills/`.

## Typed agent contracts

- `src/domain/agents/schema.ts` defines the shared `AgentDefinition` contract: identity, role, capabilities, task types, tools, approved skills, bounded context categories, input/output contracts, prompt ownership, policy versions, and execution metadata.
- `src/agents/catalog.ts` is the authoritative catalog for the six current agents. Capabilities are explicit and exclusive; routing resolves a capability to a catalog entry before a service runs.
- Tools are typed integration permissions. Skills are separate reviewed content references and are resolved only when explicitly approved. No wildcard permissions are valid.
- AI agents may propose or transform typed artifacts; deterministic validators and runtime QA remain outside the AI catalog. Architecture Reviewer owns architecture quality; Contract Auditor owns cross-artifact traceability. Both use read-only review contracts and have no source, Brief, Planning, Design, TaskGraph, shell, or arbitrary database mutation path.

Architecture Reviewer and Contract Auditor are implemented in the reviewer family. Code/Integration, Security, and Test/Quality reviewers remain planned and have no placeholder directories.
