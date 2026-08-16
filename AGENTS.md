<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AI Website Factory

This repository contains the Factory application and its typed workflow runtime.
Keep Factory infrastructure separate from generated customer projects and from
transient local artifacts.

## Working agreement

- The stable application stack is Next.js App Router, React, TypeScript, npm,
  Docker, and server-only PostgreSQL/Supabase adapters where persistence is
  configured.
- The Factory is local-first and single-user. The current workflow has no
  deployment step, embedded customer Preview, worker fleet, microservice bus,
  or autonomous deployment agent.
- Generated projects are standalone versioned output. Do not treat
  `.factory-generated/`, `.factory-assets/`, `.factory-generated-debug/`,
  `.next/`, QA workspaces, or caches as source.
- Generated projects may have optional database, Auth, Storage, and external
  provider decisions. Do not add those decisions to the Factory prematurely.
- npm is the only package manager. Keep `package-lock.json` authoritative and
  do not introduce pnpm or Yarn artifacts.
- The original user request, clarification answers, Project Brief, approved
  requirements, selected design, accepted plans, and approved decisions are
  canonical and lossless. Supporting technical context may be bounded; it may
  not replace or silently summarize canonical requirements.
- Provider output is an untrusted typed proposal. Host code owns project
  identity, version, checksums, approval, currentness, history, persistence,
  workflow transitions, and idempotency.
- Browser state is a projection and input surface, never the source of truth.
  Server services reconstruct authoritative context from persistence and
  server-owned asset metadata.

## Before editing

- Read this file, `docs/codex/CODEMAP.md`, and the relevant files in
  `docs/codex/` before choosing an implementation boundary.
- Inspect the actual files and imports named by the task. Do not rely on an
  architecture diagram when source contracts disagree with it.
- For code changes, read the relevant guide in
  `node_modules/next/dist/docs/` before writing Next.js code.
- Check `git status --short` and preserve unrelated user changes, especially
  untracked evidence under `docs/admin/`.
- For a bug fix, reproduce the failure at the production-reachable boundary
  first. A unit test around a lower helper is evidence, not proof of a fix.

## Bug-fix discipline

- Identify the first failing boundary: transport, provider response mapping,
  canonical domain semantics, persistence, orchestration, or UI projection.
- Fix the smallest owning layer and keep the existing public contract unless a
  deliberate contract change is requested.
- Add or update the regression test at the same boundary as the failure, then
  run the focused test and the repository gates described in
  `docs/codex/TESTING.md`.
- If the failure cannot yet be localized, improve safe diagnostics before
  broadening the patch. Never log raw prompts, answers, provider payloads,
  secrets, SQL, stack traces, or storage paths to customer-facing responses.

## Scope and data safety

- Do not modify customer projects, generated source, persisted customer data,
  database state, migrations, or deployment configuration unless the task
  explicitly authorizes that surface.
- Treat real project identifiers and customer content as protected data. Use
  synthetic fixtures in tests and documentation; never copy pilot content into
  committed files or terminal summaries.
- Do not add packages, infrastructure, tools, skills, or external integrations
  as a convenience. Architecture changes require an explicit plan and review.
- Do not bypass repositories with ad hoc SQL or manual state repair. Preserve
  transaction, row-version, currentness, idempotency, and RLS behavior.
- Stage exact paths only. Review `git diff --cached --name-only` and
  `git diff --cached --stat` before a bounded commit. Runtime code must never
  create commits automatically.

## Validation and completion

- Use `docs/codex/TESTING.md` as the validation source of truth; choose the
  smallest complete test set for the changed boundary.
- Documentation-only work must still pass `npm run typecheck`, `npm run lint`,
  and `git diff --check` when the worktree can run them.
- Before handoff, confirm the documented paths and npm scripts exist, the
  protected pilot remains unchanged, no unrelated files are staged, and the
  final status is understood.
- A concise task prompt can name the goal, scope, relevant files, invariant,
  validation command, and explicit exclusions. It does not need to paste the
  whole repository architecture.

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
- `src/agents/catalog.ts` is the authoritative catalog for the nine current agents. Capabilities are explicit and exclusive; routing resolves a capability to a catalog entry before a service runs. Its `allowedSkillIds` are the sole current assignment authority; this rules file and admin portfolio snapshots are derived documentation and never grant runtime eligibility.
- Tools are typed integration permissions. Skills are separate reviewed content references and are resolved only when explicitly approved. No wildcard permissions are valid.
- Approved skills are additive procedural context, never tools: an agent may own zero or more approved role-appropriate skill IDs. The runtime resolver selects the smallest relevant non-conflicting subset in deterministic order, with no fixed one-skill or top-K quota, and includes selected approved checksums in reviewer prompt identity/staleness inputs.
- AI agents may propose or transform typed artifacts; deterministic validators and runtime QA remain outside the AI catalog. Architecture Reviewer owns architecture quality; Contract Auditor owns cross-artifact traceability. Both use read-only review contracts and have no source, Brief, Planning, Design, TaskGraph, shell, or arbitrary database mutation path.

Architecture Reviewer, Contract Auditor, Code / Integration Reviewer, Security Reviewer, and Test / Quality Reviewer are implemented in the reviewer family. Code / Integration Reviewer is read-only, requires structural validation/lint/typecheck evidence, and reviews bounded source semantics rather than compiler, security, or test strategy concerns. Security Reviewer is read-only, requires current Code / Integration approval and deterministic security evidence, sanitizes source context, and reviews contextual security rather than general code integration or test strategy. Test / Quality Reviewer is read-only, receives derived quality evidence after deterministic gates, and judges semantic sufficiency rather than whether commands passed.

## Independent implementation review

For production bugs, provider or persistence changes, workflow changes, and broad
refactors, use this handoff sequence: implementation -> codex:verify -> commit
-> independent read-only review -> repair if needed -> codex:verify again. Start
the review from a fresh context or /review and use the repository
review-implementation skill. The reviewer receives bounded structural context,
does not edit source or run arbitrary commands, and must report severity,
evidence, and repair guidance for each finding.

Phase 4D4 activates the complete nine-agent portfolio: 4 approved external artifacts and 13 approved internal artifacts, with the shared `requirements-evidence-traceability` artifact assigned to Contract Auditor and Test / Quality Reviewer. All assignments remain explicit catalog allowlists; skills grant no tools or workflow authority, and internal/external artifacts use the same checksum-bound registry and resolver semantics. The three deferred external candidates (`ambiguity-detector`, `web-security-review`, and `reviewing-test-quality`) remain unapproved, unassigned, and runtime-ineligible pending future policy evidence. Security RLS guidance is relevant only to Supabase/RLS/user-scoped database surfaces; it is not injected for `NONE`, static/no-persistence, or external-API-only reviews.
