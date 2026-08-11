# Phase 6S / cg-10 Design Request Isolation — COMPLETE

Baseline: `8e0864bc1295fcf82966570e703f564fd7a45e3b` (`8e0864b`)

Correction commits:

- `d814853880a610077277414a8f5f3bda6bfa7499` (`d814853`) — `fix: isolate deterministic design generation state`
- `b2b7cfebe31bdafdf86e6013a2a32d9c9e03e613` (`b2b7cfe`) — `test: prove design generation reentrancy isolation`

Source plan: `docs/admin/phase-6/factory-findings-currentness-plan-2026-08-10.json`

Plan identity: `819b825a599793b3bcf3b82ec48df40e13fb1dfc7f1f632585f8ce83b36dfd00`

## Finding and dependency

| Field | Result |
|---|---|
| Group | `cg-10-design-request-isolation` — Remove module-global Design request state |
| Root cause | Make generation salt and timestamps request-local and deterministic without shared mutable module state. |
| Confidence | HIGH |
| Finding | `finding-4bba2d52b86f240393fc` |
| Reviewer/category/severity | Architecture Reviewer / `DEPENDENCY_ARCHITECTURE` / WARNING |
| Dependency | `cg-05-design-durable-state-authority` — COMPLETE |
| Classification | Deterministic Design provider shared state; existing Design service remains durable/currentness authority. |

The deterministic provider previously stored `generationSalt` in module state and captured `now` at module load. The correction keeps semantic request identity in the existing `input.idempotencyKey`, derives UUIDs from a request-local salt, and captures a per-generation timestamp. No Design policy or persistence authority changed.

## Correction and regression evidence

| Concern | Result |
|---|---|
| Module-global `generationSalt` | Removed; UUID derivation receives the local request salt. |
| Module-load timestamp | Removed; `generatedAt` is captured per generation operation. |
| Deterministic tests | Fixed timestamp injection proves repeatability for the same semantic request. |
| Request isolation | Distinct requests have distinct timestamps and direction IDs. |
| Re-entrant isolation | A controlled nested request cannot overwrite the outer request's IDs or timestamp. |
| ID disjointness | Complete generated-ID sets for the two nested requests are disjoint. |
| Direction contract | Both requests produce exactly three directions. |
| Durable/currentness authority | Existing Design service, cg05 authority, and cg17 gate remain unchanged. |

The first reviewer cycle correctly requested stronger interleaving evidence. The second bounded cycle added the controlled generation-start seam and nested-request regression; both required reviewers then approved with no findings.

Changed files:

| File | Scope |
|---|---|
| `src/agents/design/deterministic.ts` | Request-local salt/timestamp generation and controlled test injection. |
| `src/agents/design/design.test.ts` | Fixed-time determinism, request-local identity, and nested-request isolation tests. |
| `scripts/phase-6c-cg02-verification.ts` | cg10 constants, evidence slices, reviewer allowlist/question, and dispatcher wiring. |

No new agent, reviewer, tool, MCP, framework, dependency, database migration, persistence redesign, or customer website-generation E2E was added.

## Reviewer verification

Required reviewer rechecks were exactly `architecture-reviewer` and `test-quality-reviewer`. The production verification path made 2 fresh real GPT calls, one per reviewer, with no reused execution. Evidence validation passed for both.

| Reviewer | Result | Evidence | Fresh calls |
|---|---|---|---:|
| Architecture Reviewer | `RESOLVED` / `APPROVED` | Valid bounded Design provider, request contract, service boundary, and isolation-test slices | 1 |
| Test / Quality Reviewer | `RESOLVED` / `APPROVED` | Valid bounded Design provider, request contract, service boundary, and isolation-test slices | 1 |

Resolver-selected skills and identity checksums are recorded in the machine result and verification artifact. The selected Test / Quality skills were `behavioral-test-quality-review` and `requirements-evidence-traceability`; the Architecture Reviewer received the normal architecture/module-boundary/maintainability selection.

Reviewer evidence: [verification JSON](cg-10-design-request-isolation-verification-2026-08-11.json) and [verification report](cg-10-design-request-isolation-verification-2026-08-11.md).

## Validation

| Check | Result |
|---|---|
| Targeted Design deterministic tests | PASS — 1 file / 19 tests |
| Reviewer rechecks | PASS — 2 required reviewers, 2 fresh GPT calls |
| Full Vitest | PASS — 70 files / 849 tests |
| Reviewer suite | PASS — 7 files / 77 tests |
| TypeScript | PASS |
| ESLint | PASS — 0 errors, 3 known pre-existing warnings |
| Production build | PASS — Next.js 16.2.12 |
| `npm audit --audit-level=high` | PASS — 0 vulnerabilities |
| Database validation | PASS — 2 migrations |
| Database status | PASS — 2 migrations applied with expected checksums |
| Database verification | PASS — 17 tables, 84 constraints, 4 indexes, RLS 17/17, public policies 0 |
| Database integrity | PASS |
| Docker Compose config | PASS |
| TaskGraph smoke | PASS — `releaseEligible=true`, 6 tasks, 0 repairs |
| `git diff --check` | PASS |
| Customer website-generation E2E | Not intentionally run |
| Deployment/customer DB changes | None |

`.qa-foundation-*` count remained 16 before targeted checks, after targeted checks, and after the full suite. `.context7-cache/` remains untracked and unstaged; it is not part of the correction or evidence.

## Invariants and DAG

- Production source changed only in the bounded deterministic Design provider correction.
- Design policy, cg05 durable authority, cg17 gate, agent/reviewer catalog, skills, assignments, and external boundaries were preserved.
- Approved external skills: **4**; approved internal skills: **13**; unique approved artifacts: **17**; assignment references: **18**; agents: **9**; deferred runtime usage: **0**.
- Historical reports and prior correction artifacts were not rewritten.
- The DAG is unchanged and acyclic.
- Remaining findings: `1 total / 0 CRITICAL / 0 ERROR / 1 WARNING / 0 INFO`.
- `cg-11-codebase-index-identity` is the actual next recommended correction group. It was not executed.

## Closure artifacts

- Machine result: [cg10 result JSON](cg-10-design-request-isolation-result-2026-08-11.json)
- Human report: this file
- Reviewer evidence: [cg10 verification JSON](cg-10-design-request-isolation-verification-2026-08-11.json)
- Reviewer report: [cg10 verification report](cg-10-design-request-isolation-verification-2026-08-11.md)
- Successor execution state: [cg10 successor state](phase-6-execution-state-2026-08-11-cg10-result.json)

PHASE 6S / cg-10: COMPLETE
NEXT: cg-11-codebase-index-identity
