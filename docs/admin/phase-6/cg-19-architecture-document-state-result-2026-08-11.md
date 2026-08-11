# Phase 6R / cg-19 Architecture Document State — COMPLETE

Baseline: `b9984bea7849b6960e213573e6c0c19760a8d3ca` (`b9984be`)

Correction commit: `98efe3edc2cdfca01d8ddb9957d3b478a29cb95c` (`98efe3e`) — `docs: mark current architecture document state`

Source plan: `docs/admin/phase-6/factory-findings-currentness-plan-2026-08-10.json`

Plan identity: `819b825a599793b3bcf3b82ec48df40e13fb1dfc7f1f632585f8ce83b36dfd00`

## Finding and dependency

| Field | Result |
|---|---|
| Group | `cg-19-architecture-document-state` — Mark current and planned architecture documentation |
| Root cause | Add explicit current/planned/supersession markers so implemented capability is distinguishable from roadmap intent. |
| Root-cause confidence | HIGH |
| Finding | `finding-5f4cd4a958172b921dfd` |
| Reviewer/category/severity | Architecture Reviewer / `SOURCE_OF_TRUTH` / WARNING |
| Highest severity | WARNING |
| Dependency | `cg-18-skill-portfolio-source-of-truth` — COMPLETE |
| Production conflict classification | `DOCUMENT_STALE` plus `MISSING_ARCHITECTURE_STATE`; production architecture was current, while affected documentation was ambiguous/stale. |

The exact finding was that `product-specification.md`, `implementation-roadmap.md`, `repository-structure.md`, and `agent-architecture.md` mixed current and planned descriptions without explicit state markers. The key contradiction was that the product specification said the repository contained only the foundation application and documentation, and the repository structure said reviewer directories were future work, while the current catalog and source tree already contained the nine-agent portfolio and five reviewer implementations.

## Canonical architecture facts

Production source and typed contracts were treated as canonical because they are the code that enforces current behavior. Markdown remains descriptive evidence and does not grant runtime permissions, agent eligibility, skills, tools, workflow transitions, or deployment authority.

| Architectural fact | Production authority | Documentation role | Before conflict | After |
|---|---|---|---|---|
| Current agent identities and assignments | `src/agents/catalog.ts` | Describe the nine current definitions | Agent architecture had no explicit current/non-runtime state | Current catalog authority is named explicitly |
| Reviewer implementation presence | `src/agents/reviewers/<role>/` plus catalog definitions | Describe repository placement | Repository structure called reviewer directories future work | Five current reviewer directories are listed |
| Current Factory capability | Typed contracts and implementations under `src/agents/`, `src/orchestration/`, and `src/runtime/` | Describe current product boundary | Product specification said only foundation/documentation existed | Implemented workflow, reviewer, execution, validation, and evidence infrastructure is named |
| Future/deferred capabilities | No current runtime owner because they are not implemented | Roadmap/product boundary only | Current and future language was interleaved | Magic Patterns and Dependency Authority are `PLANNED_FUTURE`; Preview and Deployment are `DEFERRED_WORK` |

## Document classification and state

| Document | Classification | Current authority? | Runtime input? | Action |
|---|---|---:|---:|---|
| `docs/architecture/product-specification.md` | `CURRENT_ARCHITECTURE` | No | No | Added status/authority markers; corrected foundation-only wording; separated current, planned, and deferred sections |
| `docs/architecture/implementation-roadmap.md` | `ROADMAP` | No | No | Added roadmap state convention and explicit current/planned/deferred markers |
| `docs/architecture/repository-structure.md` | `CURRENT_ARCHITECTURE` | No | No | Added current status and the implemented reviewer tree; removed the stale future/no-directories claim |
| `docs/architecture/agent-architecture.md` | `CURRENT_ARCHITECTURE` | No | No | Added current status and explicit catalog/typed-contract authority |

Historical Phase 4, Phase 5, and prior Phase 6 reports were not rewritten. Admin snapshots remain historical/derived and no architecture document is parsed by production runtime.

## Current versus planned/deferred state

| Capability | Current | Planned/deferred | Canonical evidence |
|---|---|---|---|
| Nine-agent catalog and five reviewer implementations | Yes | — | `src/agents/catalog.ts`, `src/agents/reviewers/<role>/` |
| Magic Patterns | No | `PLANNED_FUTURE`, design-stage-only | Current roadmap marker; no active production integration |
| Dependency Authority/package allowlist hardening | No | `PLANNED_FUTURE` after Phase 6 | Current roadmap marker; not implemented in cg19 |
| Preview | No | `DEFERRED_WORK` | Product/roadmap exclusion; no Preview Agent or embedded Preview |
| Deployment | No | `DEFERRED_WORK` | Product/roadmap exclusion; no Deployment Agent or deployment stage |
| Complete customer-project generation | No | Planned future work | Product and roadmap current/planned boundary |

The agent statement after correction is: the current catalog contains exactly nine definitions, with five read-only reviewer implementations under `src/agents/reviewers/`; the catalog and typed contracts enforce behavior. The skills statement remains the cg18 contract: the Approved Skills Registry owns approval/content checksums, `src/agents/catalog.ts` owns assignment, the resolver selects the invocation-specific subset, approved local artifacts provide runtime content, admin snapshots are derived/history, and `skills.sh` is discovery/staging only. No skills or assignments changed.

The current workflow, persistence, and release statements were not redesigned. Existing typed workflow/orchestration contracts remain authoritative; database/project-memory ownership remains as established by earlier groups; and `releaseEligible` remains deterministic internal Factory qualification, not deployment.

## Deterministic regression evidence

The focused regression was added to `src/agents/catalog.test.ts`. It verifies that:

- product, repository, and agent architecture documents are marked `CURRENT_ARCHITECTURE`;
- the roadmap is marked `ROADMAP` and contains explicit `CURRENT`, `PLANNED_FUTURE`, and `DEFERRED_WORK` states;
- the stale foundation-only and future-reviewer-directory claims are absent;
- the roadmap keeps Magic Patterns and Dependency Authority non-current, and Preview/Deployment deferred;
- all five reviewer service paths exist under the documented reviewer tree; and
- the catalog still contains five review agents.

The shared verifier was extended in `scripts/phase-6c-cg02-verification.ts` with cg19 constants, bounded document/source evidence slices, a focused Architecture Reviewer question, selected-skill identity capture, and dispatcher wiring. It does not make Markdown a runtime input.

## Correction scope

| File | Change | Why required for cg19 |
|---|---|---|
| `docs/architecture/product-specification.md` | Added `CURRENT_ARCHITECTURE` status, current/planned/deferred sections, and corrected the foundation-only claim | Separates current product boundary from planned customer generation |
| `docs/architecture/implementation-roadmap.md` | Added `ROADMAP` status, current baseline, and planned/deferred markers | Makes roadmap intent distinguishable from implemented capability |
| `docs/architecture/repository-structure.md` | Added current status and listed five reviewer directories | Aligns repository description with the actual current source tree |
| `docs/architecture/agent-architecture.md` | Added current status and explicit non-runtime/catalog authority | Identifies the current architecture description and canonical owner |
| `src/agents/catalog.test.ts` | Added the focused document-state/reviewer-tree regression | Detects recurrence of the exact documentation drift |
| `scripts/phase-6c-cg02-verification.ts` | Added cg19 verification configuration and evidence path | Provides the required bounded reviewer execution evidence |

Files outside the contract's `likelyFiles` are justified: the test is the required deterministic consistency evidence, and the shared verifier is the required cg13-compatible semantic-review wiring. No production source file changed. No new documentation framework, npm dependency, database schema, migration, agent, orchestrator, MCP, or tool was added.

## Reviewer verification

Required reviewer recheck: `architecture-reviewer`.

The existing production verification path made one fresh real GPT call. Resolver-selected skills were:

- `architecture-tradeoff-review`
- `module-boundaries-fb20497b5c35`
- `review-maintainability-d9faf7cb977`

The selected skill identity checksum was recorded as `488df20026a8cdc27a0ea566de496b2de54ab8ce8e047ec9ffa73eb4ad149c59`. The reviewer received only the bounded cg19 finding, four affected-document slices, current catalog/reviewer source, the focused test, and the relevant correction diff. It returned structured-output-valid `APPROVED` with no findings; evidence validation passed.

Machine reviewer evidence: [cg19 verification JSON](cg-19-architecture-document-state-verification-2026-08-11.json) and [cg19 verification report](cg-19-architecture-document-state-verification-2026-08-11.md).

## Finding closure and DAG

| Finding ID | Reviewer | Severity | Before | Architecture/document evidence | Reviewer verification | Final state |
|---|---|---|---|---|---|---|
| `finding-5f4cd4a958172b921dfd` | Architecture Reviewer | WARNING | Mixed current/planned docs and stale reviewer/foundation claims | Explicit document states, corrected claims, catalog/tree regression | `APPROVED`, evidence-valid, one fresh call | RESOLVED |

Only cg19 was resolved. No other finding was auto-closed or changed.

Counts before cg19: `3 total / 0 CRITICAL / 0 ERROR / 3 WARNING / 0 INFO`.

Counts after cg19: `2 total / 0 CRITICAL / 0 ERROR / 2 WARNING / 0 INFO`.

Arithmetic is valid before and after: `3 = 0 + 0 + 3 + 0`; `2 = 0 + 0 + 2 + 0`.

The DAG remains unchanged and acyclic. The remaining ready branches are `cg-10-design-request-isolation` and `cg-11-codebase-index-identity`; the actual lowest-order next recommendation is `cg-10-design-request-isolation`. No next correction group was executed.

## Validation

| Check | Result |
|---|---|
| cg19 reproduction/currentness correction | PASS — stale claims reproduced before correction and absent after correction |
| Canonical architecture fact | PASS — catalog/source tree and typed contracts remain canonical |
| Document classification/state | PASS — four affected documents have explicit roles/statuses |
| Current-versus-planned/deferred state | PASS — current baseline separated from roadmap and deferred exclusions |
| Document non-runtime-authority | PASS — explicit in all four documents and preserved in source direction |
| Focused documentation consistency test | PASS — 1 file / 12 tests |
| Required Architecture Reviewer recheck | PASS — RESOLVED / APPROVED, evidence-valid |
| Full Vitest | PASS — 70 files / 847 tests |
| Reviewer suite | PASS — 7 files / 77 tests |
| TypeScript | PASS |
| ESLint | PASS — 0 errors, 3 known pre-existing warnings |
| Production build | PASS |
| `npm audit --audit-level=high` | PASS — 0 vulnerabilities |
| Database validation | PASS — 2 migrations |
| Database status | PASS — both migrations applied with expected checksums |
| Database verification | PASS — 17 tables, 84 constraints, 4 indexes, RLS 17/17, public policies 0 |
| Database integrity | PASS |
| Docker Compose config | PASS |
| TaskGraph smoke | PASS — `releaseEligible=true`, 6 tasks, 0 repairs |
| `git diff --check` | PASS |
| Customer website-generation E2E | Not intentionally run |
| Deployment/customer DB changes | None |

## Invariants and final state

- Production code changed: **No**.
- Production behavior changed: **No**.
- Historical documents rewritten: **No**; historical facts preserved.
- Active `SKILL.md` files modified: **0**.
- New skill approval: **No**.
- Assignment change: **No**.
- Approved external skills: **4**.
- Approved internal skills: **13**.
- Unique approved artifacts: **17**.
- Assignment references: **18**.
- Agents: **9**.
- Deferred runtime usage: **0**.
- Dependency Authority implemented: **No**.
- Preview added: **No**.
- Deployment added: **No**.
- New agent/orchestrator/MCP: **None**.
- Other correction groups intentionally modified: **None**.

`.qa-foundation-*` count was 16 before targeted checks, 16 after targeted checks, and 16 after the full suite. Historical QA cleanup was not performed. `.context7-cache/` remains the pre-existing untracked, unstaged transient directory and is not part of the correction or any architecture-document currentness evidence.

## Closure artifacts

- Machine result: [cg19 result JSON](cg-19-architecture-document-state-result-2026-08-11.json)
- Human result: this report
- Reviewer evidence: [cg19 verification JSON](cg-19-architecture-document-state-verification-2026-08-11.json)
- Reviewer report: [cg19 verification report](cg-19-architecture-document-state-verification-2026-08-11.md)
- Successor execution state: `docs/admin/phase-6/phase-6-execution-state-2026-08-11-cg19-result.json`

Roadmap/state was updated in the successor artifact with cg19 COMPLETE and the actual next recommendation `cg-10-design-request-isolation`. No push or next-group execution occurred.

PHASE 6R / cg-19: COMPLETE
NEXT: cg-10-design-request-isolation
