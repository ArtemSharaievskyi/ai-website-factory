<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Repository boundaries

- AI agents live under `src/agents/`: Lead, Planner, Design, Implementation, and the read-only Architecture, Contract, Code / Integration, Security, and Test / Quality Reviewers.
- Orchestration lives under `src/orchestration/`; it coordinates lifecycle, TaskGraph execution, retry, repair, and reconciliation.
- Shared domain contracts live under `src/domain/`.
- External adapters live under `src/integrations/`.
- Persistence is under `src/persistence/`; runtime mechanics are under `src/runtime/`.
- Deterministic validators remain with their owning runtime or domain module.
- Approved Skills Registry source is `src/skills/registry/`; imported skill content is stored under root `skills/`.
- The read-only `skills.sh` source adapter lives under `src/integrations/skills-sh/`; it may discover and stage bounded public candidates, but never approves, executes, assigns, or dynamically reloads skills.

## Typed agent contracts

- `src/domain/agents/schema.ts` defines the shared `AgentDefinition` contract: identity, role, capabilities, task types, tools, approved skills, bounded context categories, input/output contracts, prompt ownership, policy versions, and execution metadata.
- `src/agents/catalog.ts` is the authoritative catalog for the nine current agents. Capabilities are explicit and exclusive; routing resolves a capability to a catalog entry before a service runs.
- Tools are typed integration permissions. Skills are separate reviewed content references and are resolved only when explicitly approved. No wildcard permissions are valid.
- Approved skills are additive procedural context, never tools: an agent may own zero or more approved role-appropriate skill IDs. The runtime resolver selects the smallest relevant non-conflicting subset in deterministic order, with no fixed one-skill or top-K quota, and includes selected approved checksums in reviewer prompt identity/staleness inputs.
- AI agents may propose or transform typed artifacts; deterministic validators and runtime QA remain outside the AI catalog. Architecture Reviewer owns architecture quality; Contract Auditor owns cross-artifact traceability. Both use read-only review contracts and have no source, Brief, Planning, Design, TaskGraph, shell, or arbitrary database mutation path.

Architecture Reviewer, Contract Auditor, Code / Integration Reviewer, Security Reviewer, and Test / Quality Reviewer are implemented in the reviewer family. Code / Integration Reviewer is read-only, requires structural validation/lint/typecheck evidence, and reviews bounded source semantics rather than compiler, security, or test strategy concerns. Security Reviewer is read-only, requires current Code / Integration approval and deterministic security evidence, sanitizes source context, and reviews contextual security rather than general code integration or test strategy. Test / Quality Reviewer is read-only, receives derived quality evidence after deterministic gates, and judges semantic sufficiency rather than whether commands passed.

Phase 4D4 activates the complete nine-agent portfolio: 4 approved external artifacts and 13 approved internal artifacts, with the shared `requirements-evidence-traceability` artifact assigned to Contract Auditor and Test / Quality Reviewer. All assignments remain explicit catalog allowlists; skills grant no tools or workflow authority, and internal/external artifacts use the same checksum-bound registry and resolver semantics. The three deferred external candidates (`ambiguity-detector`, `web-security-review`, and `reviewing-test-quality`) remain unapproved, unassigned, and runtime-ineligible pending future policy evidence. Security RLS guidance is relevant only to Supabase/RLS/user-scoped database surfaces; it is not injected for `NONE`, static/no-persistence, or external-API-only reviews.
