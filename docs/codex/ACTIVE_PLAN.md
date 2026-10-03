# Active reference-project plan

Status: `ACTIVE`

Source baseline at authoring: `ee38a6614d37d70568f368bf8ff31c712788334f`

## Goal

Move one protected reference project through the supported Factory lifecycle to
a verified local preview and release-ready evidence. Use the real pilot to
discover only concrete blockers. Do not substitute infrastructure hardening,
new agent frameworks, context tooling, or broad refactors for progress through
the end-to-end path.

Explicit exclusions:

- no customer identifiers, checksums, prompts, provider payloads, or secrets in
  tracked files;
- no direct database edits or manual canonical-document rewrites;
- no provider retry, fallback, or additional provider call without a bounded
  task envelope and explicit authority;
- no new MCP, memory, context, orchestration, or observability subsystem unless
  a reproduced reference-project blocker proves it necessary;
- no cleanup of unrelated baseline failures during the pilot path.

## Operating rules

1. There is one active milestone and one active Codex assignment at a time.
2. Canonical persistence and supported Workbench actions are authoritative.
   Lifecycle labels, historical chat summaries, and CLI fallback projections
   are not sufficient evidence by themselves.
3. Separate `READ_ONLY_AUDIT`, `SOURCE_REPAIR`, and `REAL_LIFECYCLE` tasks.
   Never combine a source commit with a protected customer mutation.
4. Reproduce a source defect before changing production code. If the supported
   path already exists, use it instead of adding another path.
5. A source repair requires synthetic certification before a later, separately
   authorized real-project operation.
6. Stop at genuine user gates, provider failures, semantic review findings,
   exhausted budgets, unresolved currentness, or indeterminate outcomes.
7. Infrastructure work is allowed only when it is the first failing boundary
   on the active reference-project path.

## Current evidence

Confirmed from the current repository:

- Workbench exposes `CORRECT_CONTRACT_AUDIT`,
  `REASSESS_CONTRACT_AUDIT`, `APPROVE_PHASE7C`, and
  `START_IMPLEMENTATION`.
- The repository-owned Phase 7C regression covers correction, synthetic
  reassessment, Phase 7C approval, and eligibility for
  `START_IMPLEMENTATION` through the serialized Workbench route.
- `START_IMPLEMENTATION` reloads and validates the current Brief, Planning,
  Architecture Review, selected Design, Phase 7C package, TaskGraph, and
  Contract Audit before transitioning to `IMPLEMENTING`.
- Bounded TaskGraph execution, repair, validation, QA, and workspace services
  exist under `src/orchestration/execution/`, `src/agents/implementation/`,
  `src/runtime/validation/`, and `src/runtime/qa/`.

Not yet confirmed in this environment:

- the protected reference project's current canonical state;
- the exact Workbench action currently allowed for that project;
- whether an active or terminal operation owns the current frontier;
- a supported public Workbench action that executes the ready TaskGraph after
  the project reaches `IMPLEMENTING`;
- a real generated-site QA, preview, and release readback for this pilot.

The live project state must be re-read in the authorized local environment. Do
not commit that readback or its protected identifiers.

## Milestone 1 - Re-establish the canonical pilot frontier

Outcome: a read-only, current, bounded status report identifies exactly one
safe next action without changing source or customer state.

Tasks:

- run repository and production-provenance preflight;
- verify database status, migration integrity, and protected-session baseline;
- read Workbench status through the supported production route;
- read only the minimum canonical artifacts and operation records needed to
  explain the allowed action;
- classify the frontier as one of:
  `CORRECT_CONTRACT_AUDIT`, `REASSESS_CONTRACT_AUDIT`, `APPROVE_PHASE7C`,
  `START_IMPLEMENTATION`, active-operation reconciliation, or a typed blocker;
- report facts separately from inferences and perform no mutation.

Completion criteria:

- source/build identity is exact;
- canonical row version, lifecycle, current artifact bindings, allowed action,
  and relevant operation ownership are verified;
- provider calls, canonical writes, and source changes are zero;
- the next real operation can be authorized as a separate task.

## Milestone 2 - Reach `IMPLEMENTING` through supported actions

Outcome: the reference project enters `IMPLEMENTING` with a current approved
Contract Audit, approved Phase 7C package, and a ready persisted TaskGraph.

Execution order is determined by Milestone 1 evidence:

1. run provider-free TaskGraph correction when it is the advertised action;
2. run Contract Audit reassessment only when required and explicitly
   authorized with a one-call, zero-retry provider budget;
3. approve Phase 7C only when the current approved audit and all checksum
   bindings pass;
4. run `START_IMPLEMENTATION` as a separate supported operation;
5. independently read back project state, TaskGraph checkpoint, initial ready
   tasks, operation evidence, and provider usage.

Do not add another recovery path when an existing supported action owns the
frontier.

## Milestone 3 - Execute the real TaskGraph

Outcome: all implementation tasks run through one supported, resumable,
currentness-bound production entry point.

First inspect before editing:

- determine whether a production entry point already composes
  `FullTaskGraphExecutor` with the production execution adapters;
- if it exists, expose or use it with bounded Workbench/CLI transport rather
  than creating a second executor;
- if it does not exist, implement the smallest orchestration boundary that
  reserves one execution run, executes ready tasks, persists task/run evidence,
  fences late writes, and supports safe resume.

Required invariants:

- one logical execution frontier and one active writer;
- immutable upstream checksum bindings;
- task-level file scopes and tool policy remain enforced;
- retries remain task-bounded and never become hidden provider retries;
- failed or indeterminate tasks retain durable evidence;
- generated-project writes remain isolated from Factory source;
- no transition to QA or release eligibility without persisted validation
  evidence.

## Milestone 4 - QA, targeted repair, and preview

Outcome: the generated site is usable and visually faithful to the selected
Design, with reproducible evidence.

Tasks:

- run generated-project lint, typecheck, tests, build, and security checks;
- run controlled functional QA for `/`, `/datenschutz`, and `/impressum`;
- verify responsive behavior, keyboard use, reduced motion, direct phone/email
  actions, no form, no active WhatsApp action, and protected logo usage;
- repair only diagnostics mapped to an owning implementation task;
- re-run the minimum invalidated checks;
- launch a bounded local preview and capture final readback evidence.

The absence of real project photography is non-blocking and must not be
replaced with fabricated project evidence.

## Milestone 5 - Release readiness and post-pilot hardening

Outcome: the pilot has a release-ready evidence package. Deployment remains a
separate explicit user decision.

Only after the real pilot reaches this point:

- update stale repository documentation from observed behavior;
- rank recurring defects by frequency and impact;
- remove duplicate recovery paths or accidental complexity;
- decide whether additional context/memory tooling is justified by measured
  token or retrieval failures;
- address baseline architecture debt in a separate plan.

## Active Codex assignment

Mode: `READ_ONLY_AUDIT`

Goal: complete Milestone 1 and identify the exact current canonical frontier of
the protected reference project.

Instructions:

1. Read `AGENTS.md`, `PLANS.md`, `docs/codex/CODEMAP.md`,
   `docs/codex/FAST_PILOT.md`, `docs/codex/TESTING.md`, this file, and any
   narrower `AGENTS.md` governing inspected source.
2. Start a protected Codex session for the operator-supplied project ID. Keep
   the ID and all customer evidence out of tracked files and command output
   summaries where the repository policy requires redaction.
3. Verify exact HEAD, tracked worktree state, production build provenance,
   database status, migration integrity, and the protected baseline.
4. Start the supported production runtime only if all read-only prerequisites
   pass. Read Workbench status through `/api/workbench` using the strict status
   DTO.
5. Inspect only the canonical Phase 7C package, TaskGraph, Contract Audit,
   selected Design binding, and relevant operation ledger records needed to
   explain the projected action.
6. Compare the status projection with the guards in
   `src/runtime/workbench/application.ts` and
   `src/runtime/workbench/contracts.ts`.
7. Stop without mutation. Do not call a provider, do not POST a lifecycle
   action, do not edit source, and do not create a committed evidence file.

Required result:

- verdict;
- exact verified source/build provenance;
- canonical lifecycle and row version;
- current Phase 7C, TaskGraph, Contract Audit, and selected-Design status with
  bounded checksum references;
- allowed Workbench action and the guard that produced it;
- active/terminal operation ownership relevant to that action;
- provider/source/canonical mutation counters, all zero;
- one recommended next operation, or one precisely localized blocker.

## Validation policy for future assignments

Every source task must declare its affected boundary and run focused tests
first. Before handoff, run the applicable subset of:

```text
npm run typecheck
npm run lint
npm run codex:provider-contracts
npm run build
npm run db:status
npm run db:verify
npm run codex:verify
git diff --check
```

Known baseline failures may be reported only when unchanged and outside the
task boundary. A green synthetic path never substitutes for the required real
pilot readback.

## Plan update protocol

- Update `Source baseline at authoring` when this plan is revised against a new
  `main` commit.
- Replace only the `Active Codex assignment` after its evidence is reviewed.
- Move to the next milestone only after its completion criteria are proven.
- Record durable architecture decisions in `docs/adr/`, not in this active
  plan.
- Keep execution reports outside tracked files when they contain protected
  project data.
