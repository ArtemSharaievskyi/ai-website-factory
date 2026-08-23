# Production workflows

These paths describe the current code, not a proposed redesign.

## Create a project

1. The Workbench submits `action: "create"` to
   `src/app/api/workbench/route.ts`.
2. `src/runtime/workbench/application.ts` delegates to
   `TrialEntryService.createProject`.
3. `src/runtime/trial-entry/service.ts` preserves the initial request, creates
   the project, builds server-owned Lead input, analyzes the prompt, plans
   clarifications, and builds a Brief draft when no blocking question remains.
4. The application returns a safe projection from current repositories. The
   browser does not become the owner of the Brief or Lead context.

The CLI equivalent is `npm run factory:new`, implemented by
`scripts/factory-new.ts` through the Node Trial Entry composition.

## Answer clarifications

The Workbench uses `action: "respond"`; the CLI uses `npm run factory:respond`.
The canonical path is `TrialEntryService.respond`:

- reserve an operation using the answer-round identity and payload hash;
- reject stale, resolved, unknown, or invalid blocking answers;
- reconstruct the current project and server-owned asset context;
- continue the Lead clarification round;
- persist the new session and build the Brief when all blocking questions are
  resolved;
- complete the operation or mark it failed so a legitimate retry remains
  possible.

`src/runtime/trial-entry/sequential-clarification-idempotency.test.ts` protects
the distinction between a replay and a new clarification round.

## Request Brief changes

The Workbench action `request-brief-changes` enters
`TrialEntryService.requestBriefChanges`, reconstructs currentness from the
authoritative project/document rows, and delegates the complete mutation to
`BriefV3TransactionService`. The V3 provider emits a bounded ChangeSet; the V3
reducer, effective delta, history, workflow event, idempotency, and atomic
persistence transaction remain host-owned. Legacy V1/V2 documents are read and
migrated in memory only.

When diagnosing a revision failure, trace the real path from Workbench action
to Trial Entry to the V3 provider/mapper/reducer and transaction boundary. A
domain-only test does not establish that the production provider response and
host mapping are correct.

## Approve the Brief

`action: "approve-brief"` reaches `TrialEntryService.approveBrief`. It reloads
the current Brief and clarification session, consumes the canonical V3 readiness
evaluator, checks the supplied checksum and expected row version, and delegates
to `BriefApprovalService`. The service owns the explicit approval envelope,
currentness/CAS validation, audit record, and one transition to
`AWAITING_DESIGN_SELECTION`. Approval is a host/workflow decision; Lead and the
provider can propose a Brief but cannot approve it.

For V3 Briefs, `evaluateBriefReadiness` is the single deterministic authority
behind the server status and Workbench projection. An explicit legal
placeholder policy can make a Brief approval-ready while leaving publication
blocked until final legal facts replace those placeholders. This distinction
does not approve a Brief, advance workflow state, or authorize publication.
Workflow state remains a lifecycle guard, not a competing definition of V3
readiness; a ready V3 Brief may be approved from `CLARIFYING`, while unrelated
states remain ineligible. Legacy requirements remain readable for compatibility,
but approval of a current V3 Brief never writes or approves a legacy document.

## Upload and use assets

- `GET`, `POST`, and `DELETE` requests go to
  `src/app/api/workbench/assets/route.ts`.
- `src/runtime/assets/service.ts` validates category and file metadata,
  deduplicates and persists project-scoped metadata, and marks readiness.
- `ProjectAssetRepository` is the persistence seam.
- Lead input is rebuilt by `TrialEntryService.inputForProject` from current
  ready asset references. Client-supplied metadata is never canonical.

## Planning and Design

After Brief approval, Workbench action `approve-planning` calls the configured
workflow scope in `src/runtime/workbench/application.ts`:

1. Planner creates a planning package from the approved Brief.
2. The host evaluates Planning Acceptance readiness. Technical blockers prevent
   acceptance; explicitly permitted publication-only legal facts and future
   photography selection remain visible as deferred obligations.
3. Planner accepts and persists it only after `blockingItems` is empty.
4. Architecture review validates and routes the package.
5. Design generates exactly three structured directions.

Planning Acceptance does not mean publication readiness. Final legal facts and
verified image rights remain mandatory before public release. The Workbench
projection shows both blocking and deferred items, while downstream guards use
the same host-owned readiness evaluator.

The user may request planning changes, make the database/dependency decisions,
and select one current Design Direction. Selection is explicit and checksum
bound; Design does not select autonomously.

## Start implementation

`action: "start-implementation"` reloads the approved Brief, accepted planning
package, selected Design, and Phase 7C package. The Orchestrator creates and
validates the TaskGraph, then transitions the project to `IMPLEMENTING`.
The Implementation Agent is later invoked for one ready task at a time through
its existing bounded contract. Full execution, repair, reconciliation, and
validation remain in `src/orchestration/execution/` and `src/runtime/`.

## Codex verification workflow

Level 2.5 adds four repository procedures under .agents/skills:
debug-production-bug, modify-openai-contract, review-implementation, and
finish-task. Production implementation work follows verification, bounded
commit, independent read-only review, repair, and re-verification.

The optional codex:review-context command gives a fresh reviewer only the
baseline/current heads, changed paths, affected checks, architecture status,
guard classifications, and diff hygiene. It does not include prompts,
answers, provider payloads, customer content, or protected identifiers.

For a protected implementation task, run `npm run codex:start -- --protect
<project-id>` before editing, `npm run codex:affected` while scoping the work,
and `npm run codex:verify` before committing. Provider/OpenAI path changes
automatically select `codex:provider-contracts`; the command uses the actual
production response-format builders and makes no network request. The session
snapshot is read-only and contains no prompt, answer, provider, asset, or
secret content.
