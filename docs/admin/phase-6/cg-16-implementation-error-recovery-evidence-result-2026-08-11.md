# Phase 6O — cg-16 Atomic Implementation Failure and Recovery Evidence

Status: **COMPLETE**

Baseline HEAD: `0fbe532`
Correction commit: `067ccb7` — `test: cover atomic implementation recovery`

## Exact finding

| Finding ID | Reviewer | Severity | Category | Claim | Final state |
|---|---|---:|---|---|---|
| `finding-0ec8a840d7bf928fec42` | Test / Quality Reviewer | WARNING | `ERROR_PATH_NOT_VERIFIED` | Proposal validation was tested, but atomic file-application failure and recovery had no supplied test evidence. | RESOLVED |

Title: **Test atomic implementation failure and recovery**. Root cause: **Exercise and record failure/recovery behavior for atomic file application, not only proposal validation.** Root-cause confidence: **HIGH**.

Dependency `cg-13-reviewer-execution-evidence`: **COMPLETE**. Affected path: **Implementation Agent → ChangeProposal validation → AtomicChangeApplier → bounded file mutation/rollback**. No provider-generation, TaskGraph redesign, or new repair authority was required.

## Defect reproduction and correction

Before cg-16, the existing implementation tests passed, but the reviewed backend test evidence did not exercise or assert the missing atomic cases. The pre-correction targeted baseline passed 22 tests across the two implementation test files while leaving these behaviors unproven:

- a later operation failure restores an earlier write;
- cancellation between operations restores the partial candidate;
- unsafe and symlink targets cannot mutate the workspace;
- stale prior checksums cannot mutate the workspace.

The correction added four focused deterministic regressions to `src/agents/implementation/backend.test.ts`. One regression also applies a fresh valid proposal after rollback, proving that a new candidate can be accepted after the failed candidate is removed from authority. The shared cg-13-compatible verifier was extended for the exact cg-16 evidence pack and reviewer question.

## Implementation recovery table

| Stage | Before | After | Host-derived evidence | May task advance? |
|---|---|---|---|---:|
| ChangeProposal validation | Existing policy validation was tested. | Validation remains before transaction creation. | `validateProposal` and targeted unsafe-path test | No if rejected |
| Atomic apply | No focused later-operation recovery proof. | Prior file bytes are captured before each operation and restored on failure. | Later-operation checksum-failure test | No on failure |
| Cancellation | Cancellation code existed without partial-apply assertions. | Cancellation between operations restores earlier writes. | Cancellation regression | No |
| Target safety | Unsafe policy was tested; symlink/junction target behavior was not. | Traversal and symlink/junction targets are rejected without mutation. | Path and workspace-tamper assertions | No |
| Recovery candidate | No focused proof of a fresh candidate after rollback. | A distinct valid proposal applies after rollback. | Fresh recovery proposal and resulting file contents | Only after its own apply evidence |
| Task completion | Existing service owns TaskGraph transitions. | No task-completion authority moved into the applier. | No service/orchestrator architecture change | Only existing service gates apply |

## Failure and recovery table

| Failure type | Mutation state | Recovery allowed? | Required recovery evidence | Result |
|---|---|---:|---|---|
| `IMPLEMENTATION_RESULT_CHECKSUM_MISMATCH` on later operation | Earlier operation may have applied; current candidate is rolled back. | A fresh bounded proposal may be attempted. | Earlier files equal their pre-attempt contents; new proposal has its own checksums. | PASS |
| `IMPLEMENTATION_CANCELLED` between operations | Earlier operation applied transiently; rollback restores it. | Explicit retry/cancel policy remains outside the applier. | All touched files equal pre-attempt contents. | PASS |
| `IMPLEMENTATION_PATH_INVALID` | No mutation; rejected before transaction creation. | No rollback claim; caller must correct the proposal. | Workspace remains unchanged. | PASS |
| `IMPLEMENTATION_WORKSPACE_TAMPERED` for symlink/junction target | No target mutation. | No silent broadening or target replacement. | Linked target marker remains unchanged. | PASS |
| `IMPLEMENTATION_CHECKSUM_MISMATCH` for stale prior checksum | No mutation. | Only a current proposal may proceed. | Existing file remains unchanged. | PASS |

## Attempt, task, and candidate identity

| Identity | Before | After |
|---|---|---|
| Implementation attempt | Existing service run identity uses `executionId`, project/version, task ID, attempt, execution policy, and idempotency key. | No new identity field; regression proposals use distinct `proposalId` values and preserve the authorized task identity. |
| Task | `projectId`, `projectVersion`, `taskId`, and `taskAttempt` are checked by `validateProposal`. | Cross-task/project/version/attempt proposals remain rejected; no TaskGraph identity change. |
| Candidate | Staging workspace files and prior checksums existed, but failure recovery was not asserted. | Failure restores the pre-attempt workspace; the fresh proposal returns its own changed files and after-state. |
| Attempt history | No focused atomic history proof. | Failed proposal is not treated as successful; no persisted execution-run overwrite or new history mechanism was introduced. |

The correction does not claim a new formal candidate-ID field. It proves the existing candidate boundary through the authorized task, proposal identity, staging workspace, and before/after file state.

## Repair, retry, and currentness semantics

Provider transport retry remains distinct from implementation repair. No implementation provider retry, repair task, Repair Agent, or retry-budget policy changed. This cg-16 correction tests the atomic application boundary only; existing orchestration owns task-level repair cycles and release gating.

| Scenario | Old recovery evidence reusable? | Expected behavior | Proof |
|---|---:|---|---|
| Later operation fails | No | Roll back earlier writes; do not authorize failed candidate. | Later-operation checksum regression |
| Cancellation occurs between operations | No | Roll back transient earlier write. | Cancellation regression |
| Same target has changed since proposal creation | No | Reject stale `expectedPriorChecksum` before mutation. | Checksum regression |
| Unsafe traversal target | No | Reject before transaction/mutation. | Path regression |
| Symlink/junction target | No | Reject as workspace tampering. | Junction regression |
| Fresh valid proposal after rollback | No old result reuse | Apply only with its own current checksums. | Successful recovery assertion |

Pre-apply rejection is `REJECTED_BEFORE_APPLY`, not `APPLIED_THEN_ROLLED_BACK`. For failures after an earlier operation, the existing atomic rollback path is exercised and verified. Existing restart reconciliation remains explicit: a RUNNING task without a live owner is `IMPLEMENTATION_INTERRUPTED` and is not auto-promoted to success. Cancellation remains non-success. Existing max-attempt and repair-cycle bounds are unchanged.

Full lint/typecheck/build/test evidence is not reused as proof of the failed candidate; the targeted atomic regression reruns the relevant current checks. Atomic recovery evidence cannot independently set `releaseEligible`; cg-14 remains the release authority.

## Change table

| File | Change | Why required |
|---|---|---|
| `src/agents/implementation/backend.test.ts` | Added rollback, cancellation, target-safety, stale-checksum, and fresh-candidate regressions. | Supplies the missing deterministic atomic failure/recovery evidence. |
| `scripts/phase-6c-cg02-verification.ts` | Added cg-16 contract, bounded evidence slices, exact reviewer question, and dispatcher. | Preserves the cg-13 reviewer execution/evidence contract. |

Production source files changed: **none**. The existing `applier.ts` and service failure boundary were reviewed and included as current evidence slices. No schema, migration, Project Memory, TaskGraph, orchestrator, provider, skill portfolio, agent catalog, or dependency-authority change was made.

## Reviewer verification

| Reviewer | Verdict | Structured output | Evidence validation | Fresh GPT calls | Selected skills |
|---|---|---:|---:|---:|---|
| Test / Quality Reviewer | APPROVED / RESOLVED | PASS | PASS | 1 | `behavioral-test-quality-review`, `requirements-evidence-traceability` |

The verifier used current slices of `applier.ts`, the service failure boundary, and the focused recovery tests. It reported no invalid evidence references and no unrelated findings.

## Validation

| Check | Result |
|---|---|
| cg-16 baseline reproduction | PASS; missing atomic recovery assertions identified before correction |
| Focused implementation tests | PASS; 26 tests across 2 files |
| `npm run lint` | PASS; 3 known pre-existing warnings |
| `npm run typecheck` | PASS |
| `npm test` | PASS; 70 files, 844 tests |
| `npm run build` | PASS |
| `npm audit --audit-level=high` | PASS; 0 vulnerabilities |
| `npm run test:reviewers` | PASS; 75 tests across 7 files |
| `npm run db:validate` | PASS; 2 migrations |
| `npm run db:status` | PASS; both Factory migrations applied |
| `npm run db:verify` | PASS; 17 tables, 84 constraints, 4 indexes, RLS 17/17, public policies 0 |
| `npm run db:test-integrity` | PASS |
| `docker compose config` | PASS |
| `npm run taskgraph:smoke` | PASS; `releaseEligible=true`, 6 passed tasks, 0 repairs |
| Required reviewer recheck | PASS; exact `test-quality-reviewer`, 1 fresh call |
| `git diff --check` | PASS |

An initial parallel full-test/build attempt produced a shared `.next` race and two missing-build QA failures. The build was then run first and `npm test` was rerun sequentially; the final full suite passed.

## State, invariants, and boundaries

Pre-cg-16 machine counts were:

`TOTAL 6 / CRITICAL 0 / ERROR 0 / WARNING 6 / INFO 0`

Arithmetic was valid: `6 = 0 + 0 + 6 + 0`.

After resolving only cg-16:

`TOTAL 5 / CRITICAL 0 / ERROR 0 / WARNING 5 / INFO 0`

Arithmetic remains valid: `5 = 0 + 0 + 5 + 0`.

Resolved: **1**. Partial: **0**. Still active: **0**. Regression found: **0**. Potentially impacted groups: **none**. Newly unblocked groups: **none**; `cg-17` and `cg-18` were already dependency-unblocked. Actual next group: **cg-17-design-gate-evidence**.

QA foundation directories: **15 before / 15 after targeted tests / 16 after full suite**. The additional `.qa-foundation-v7JqG6` directory was created during the failed parallel QA attempt and remains intentionally untouched. Historical QA cleanup: **No**.

`.context7-cache/` remains pre-existing, untracked, and unstaged. It was not committed. Approved external skills remain **4**, approved internal skills **13**, unique approved artifacts **17**, assignment references **18**, agents **9**, deferred skill usage **0**. Dependency Authority remains deferred. No customer website-generation E2E, deployment, production database mutation, new agent, orchestrator, MCP, or other correction group was introduced.

## Artifacts

- Machine result: `cg-16-implementation-error-recovery-evidence-result-2026-08-11.json`
- Human report: `cg-16-implementation-error-recovery-evidence-result-2026-08-11.md`
- Reviewer verification: `cg-16-implementation-error-recovery-evidence-verification-2026-08-11.json`
- Successor execution state: `phase-6-execution-state-2026-08-11-cg16-result.json`
