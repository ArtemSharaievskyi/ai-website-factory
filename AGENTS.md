<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AI Website Factory

This repository contains the Factory application and its typed workflow runtime.
Keep Factory infrastructure separate from generated customer projects and from
transient local artifacts.

## Technical language policy

- Use English for technical communication, reports, documentation, plans, commit messages, and new code comments.
- Preserve customer-facing content in its specified language.

## Codex execution invariants

- Execution may use `SINGLE`, `BOUNDED_PARALLEL`, or `READ_ONLY_SWARM` agent
  policy within an envelope; max four, one integration authority, and never
  parallel canonical writes. The Lead owns all integration and canonical work.
- `CanonicalBriefV3.current` is the current V3 requirements authority. Legacy
  requirements are compatibility-only, and canonical requirements stay lossless.
- Never manually mutate canonical persistence. Preserve semantic versus document
  checksum domains, CAS/currentness, immutable history, and idempotency.
- Never self-approve an artifact requiring explicit user approval or selection.
- Provider calls have no automatic retry, correction, or fallback unless the task
  envelope explicitly authorizes it; failed calls cannot partially persist.
- Project Memory is a derived projection, never canonical authority.
- Source repair and real-lifecycle mutation are separate modes by default.
- Deterministic guards and canonical services take precedence over prose or
  browser assumptions.

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
- Establish the real baseline first: inspect `git status --short`, the current
  HEAD, the named source contracts, and the applicable current-state documents.
  Treat dated `docs/admin/**` reports and session snapshots as evidence, not as
  live canonical state.
- Inspect the actual files and imports named by the task. Do not rely on an
  architecture diagram when source contracts disagree with it.
- For code changes, read the relevant guide in
  `node_modules/next/dist/docs/` before writing Next.js code.
- Check `git status --short` and preserve unrelated user changes, especially
  untracked evidence under `docs/admin/`.
- For a bug fix, reproduce the failure at the production-reachable boundary
  first. A unit test around a lower helper is evidence, not proof of a fix.

## Task framing and documentation

- Frame authorized work as `Milestone -> Task -> optional subtask checklist`.
  Use the smallest proportional specification: observed/expected behavior and
  a regression scenario for a defect; compatibility and failure semantics for
  a contract change; scope, non-goals, and acceptance criteria for a feature;
  and alternatives, choice, and consequences for an architectural decision.
- State the affected Factory boundary, explicit exclusions, acceptance
  evidence, and remaining uncertainty. Distinguish Factory product
  requirements, generated-website requirements, engineering workflow, live
  project state, and verification evidence.
- Prefer the existing authority for the change: `docs/codex/` indexes
  procedure, `docs/architecture/` describes product and architecture,
  `docs/contracts/` defines cross-boundary contracts, `docs/operations/`
  describes runbooks, and `docs/adr/` records durable decisions. Correct a
  specification when evidence disproves it; do not weaken its acceptance
  criteria to fit an implementation.
- Update documentation when behavior, an authority boundary, an invariant,
  workflow, or the next milestone changes. Keep dated incident and session
  records as dated evidence rather than copying them into current guidance.
- A neighboring issue enters the task only when it is necessary for the stated
  acceptance criteria. Otherwise record it through the repository's existing
  backlog or roadmap and continue the authorized task.

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

## Agent authority

- `src/domain/agents/schema.ts` defines the shared typed agent contract and
  `src/agents/catalog.ts` is the sole runtime assignment authority. This file
  does not grant capabilities or skills.
- Tools are typed permissions; approved skills are separate, checksum-bound
  procedural context. Neither grants workflow authority or canonical write
  ownership. Reviewer roles and their read-only boundaries are documented in
  `docs/architecture/agent-architecture.md` and `docs/codex/ARCHITECTURE.md`.

## Independent implementation review

For production bugs, provider or persistence changes, workflow changes, and broad
refactors, use this handoff sequence: implementation -> codex:verify -> commit
-> independent read-only review -> repair if needed -> codex:verify again. Start
the review from a fresh context or /review and use the repository
review-implementation skill. The reviewer receives bounded structural context,
does not edit source or run arbitrary commands, and must report severity,
evidence, and repair guidance for each finding.

The active catalog and Approved Skills Registry are authoritative. Dated skill
portfolio snapshots under `docs/admin/` are evidence only; they do not grant
runtime eligibility, tools, workflow authority, or canonical write access.

## Bounded delegation

- Delegate only when independent investigation, review, or clearly separate
  file ownership improves the result. Record the assignment, expected output,
  and exact edited-file or read-only scope.
- The Lead owns integration and canonical work. Delegation may not create
  concurrent canonical mutations, hidden approval, or a second source of
  truth. Review findings must cite evidence, severity, and repair guidance.
