# Phase 6P / cg-17 Design Gate Evidence — COMPLETE

Baseline: `f3622d5`
Correction commit: `ba5bbc0` — `test: cover Design gate contract failures`
Source plan: `docs/admin/phase-6/factory-findings-currentness-plan-2026-08-10.json`
Plan identity: `819b825a599793b3bcf3b82ec48df40e13fb1dfc7f1f632585f8ce83b36dfd00`

## Finding and scope

| Field | Result |
|---|---|
| Correction group | `cg-17-design-gate-evidence` — Cover Design gate and contract failure paths |
| Finding | `finding-bf13a0c6f16bf4702e9e` |
| Severity/category | WARNING / `REQUIREMENT_NOT_VERIFIED` |
| Root cause | Add direct meaningful quality evidence for the implemented Design gate and contract failure paths. |
| Confidence | HIGH |
| Dependency | `cg-05-design-durable-state-authority` COMPLETE |
| Affected owner | `DesignAgentService.validateInput`; downstream `OrchestratorService.input/startImplementation` |
| Gate stage | Approved Brief, accepted Planning, Architecture Review, workflow and requirement-change validation before Design provider/persistence; current Contract Audit and TaskGraph validation before implementation start |
| Non-goals | No Design behavior redesign, automatic selection, new reviewer/gate agent, Project Memory authority change, deployment/customer E2E, or unrelated correction group |

The defect was an evidence gap, not a missing Design gate. Before cg17, the service already rejected stale currentness, invalid state, absent approval, and unapproved requirement changes, but the direct Design test file did not prove those paths through the service boundary.

## Design Gate evidence

| Requirement | Canonical evidence | Failure behavior | Evidence status |
|---|---|---|---|
| Current approved Brief checksum | `src/agents/design/service.ts:107-136`; persisted requirements document | `DESIGN_BRIEF_STALE` before provider or persistence | Newly direct-tested |
| Current accepted Planning checksum | `src/agents/design/service.ts:107-136`; persisted planning package | `DESIGN_PLANNING_STALE` before provider or persistence | Newly direct-tested |
| Current approved Architecture Review | `src/agents/design/service.ts:145-167` | `DESIGN_ARCHITECTURE_REVIEW_REQUIRED` when absent; stale binding is rejected | Newly direct-tested for missing review; existing stale-binding guard retained |
| Valid Design workflow state | `src/agents/design/service.ts:137-144`, `210-223` | `DESIGN_WORKFLOW_STATE_INVALID` outside `AWAITING_DESIGN_SELECTION` | Newly direct-tested |
| No unapproved requirement change | `src/agents/design/service.ts:187-202` | `UNAPPROVED_REQUIREMENT_CHANGE` | Newly direct-tested |
| Exactly three meaningful directions | `src/agents/design/deterministic.ts:22-33`; existing Design tests | Readiness/schema rejection for two, four, duplicate, or insufficiently different directions | Existing evidence retained |
| Explicit selection of a current member | `src/agents/design/service.ts:390-558`; existing restart/selection tests | Wrong set/direction/checksum or no selection cannot advance workflow | Existing evidence retained |
| Downstream implementation-start gate | `src/orchestration/orchestrator/service.ts:31-42` | Current READY state, Contract Audit, bound checksums, and graph readiness are required | Current verifier evidence |

The new regression asserts that every newly covered failure leaves provider calls at zero, does not persist `design-directions`, and does not write the Project Memory `design-directions.json` projection.

## Design content and selection behavior

The correction did not alter Design content generation. The existing deterministic provider yields exactly three direction variants: Precision, Editorial, and Dynamic. The persisted set identity includes `projectId`, `projectVersion`, `setId`, Brief/Planning checksums, and the direction-set checksum. Each direction has its own ID and checksum, requirement/planning references, and membership in the set.

Existing evidence covers:

- exactly three meaningfully different directions and rejection of two/four or superficial variants;
- deterministic set and direction checksums;
- explicit user selection, current set membership, and selected direction checksum;
- restart/idempotency recovery and stale selection rejection;
- regeneration superseding the prior set and invalidating the prior selection.

No direction was auto-selected. Without selection, the workflow remains `AWAITING_DESIGN_SELECTION`; selection transitions it to `READY_FOR_IMPLEMENTATION` only after currentness and membership checks.

## Currentness and persistence

| Change | Result |
|---|---|
| Brief content/checksum changes | Old Design input is stale and rejected; Architecture Review bindings must also remain current. |
| Planning content/checksum changes | Old Design input is stale and rejected; Architecture Review bindings must remain current. |
| Design set regeneration | Prior set is superseded, selected design is removed, and a new explicit selection is required. |
| Selected direction checksum changes | Selection is rejected as stale or not current. |
| Project/version/row version changes | Design and selection requests are rejected before an invalid state becomes authoritative. |
| Unrelated cache/admin/QA history | Not part of the Design authority and unchanged by cg17. |

Database-backed Design and Document repositories remain canonical. Project Memory is a restart/context projection only. The downstream `startImplementation` path additionally requires `READY_FOR_IMPLEMENTATION`, a current approved Contract Audit bound to Brief/Planning/Design/TaskGraph checksums, and a ready TaskGraph before entering `IMPLEMENTING`.

## Correction and review evidence

Changed files:

- `src/agents/design/design.test.ts`: one focused service-level regression with five contract-failure scenarios and no-side-effect assertions.
- `scripts/phase-6c-cg02-verification.ts`: cg17 configuration, current source/test slices, reviewer question, and dispatcher wiring.

No production source, schema, migration, persistence authority, orchestrator architecture, provider architecture, skill portfolio, agent catalog, or MCP surface changed.

Required rechecks completed with two fresh calls total:

| Reviewer | State | Evidence |
|---|---|---|
| `test-quality-reviewer` | RESOLVED / APPROVED | Current contracts, Design gate, implementation-start gate, and direct failure tests |
| `contract-auditor` | RESOLVED / APPROVED | Same, plus direct contract-failure, currentness, and selection boundary refs |

The machine verification artifact is [cg-17-design-gate-evidence-verification-2026-08-11.json](cg-17-design-gate-evidence-verification-2026-08-11.json). It records selected approved skills and checksums, structured-output validity, evidence validity, and two fresh reviewer executions.

## Validation and state

| Check | Result |
|---|---|
| Targeted Design Vitest | PASS — 17 tests |
| Full Vitest | PASS — 70 files / 845 tests |
| Reviewer suite | PASS — 7 files / 75 tests |
| Typecheck | PASS |
| Lint | PASS — 3 known pre-existing warnings, 0 errors |
| Production build | PASS |
| High-severity audit | PASS — 0 vulnerabilities |
| Database validate/status/verify/integrity | PASS — 2 migrations, current history, 17 tables, 84 constraints, 4 indexes, RLS 17/17, public policies 0 |
| Docker Compose config | PASS |
| TaskGraph smoke | PASS — releaseEligible=true, 6 tasks, 0 repairs |
| Intentional customer website-generation E2E | Not run |
| Deployment/customer database changes | None |

Finding counts changed arithmetically from `5 total / 0 CRITICAL / 0 ERROR / 5 WARNING / 0 INFO` to `4 total / 0 CRITICAL / 0 ERROR / 4 WARNING / 0 INFO`; one WARNING was resolved and no regression or partial resolution was introduced. No other correction group was modified.

The DAG remains acyclic and unchanged. No new group became unblocked because cg18 was already unblocked after cg13. The actual next recommended group is `cg-18-skill-portfolio-source-of-truth`.

QA foundation directories were 16 before targeted checks and remained 16 after the targeted and full suites. The untracked `.context7-cache/` remains untracked and unstaged; historical `.qa-foundation-*` directories were preserved.

## Invariants

The Phase 6 invariants remain unchanged: 4 approved external skills, 13 approved internal skills, 17 unique approved artifacts, 18 assignment references, 0 deferred skill usage, and 9 agents. No deployment or customer generation flow was run.

## Closure artifacts

- [cg-17 result JSON](cg-17-design-gate-evidence-result-2026-08-11.json)
- [cg-17 result report](cg-17-design-gate-evidence-result-2026-08-11.md)
- [cg-17 verifier JSON](cg-17-design-gate-evidence-verification-2026-08-11.json)
- [cg-17 verifier report](cg-17-design-gate-evidence-verification-2026-08-11.md)
- Successor state: `docs/admin/phase-6/phase-6-execution-state-2026-08-11-cg17-result.json`

PHASE 6P / cg-17: COMPLETE
NEXT: cg-18-skill-portfolio-source-of-truth
