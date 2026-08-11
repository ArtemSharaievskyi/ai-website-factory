# Phase 6M — cg-14 Runtime Release Evidence

Status: **COMPLETE**
Correction commit: `7d27523` (`fix: record runtime release evidence`)
Baseline commit: `a7b0131`

## Finding resolution

| Finding | Severity | Category | Resolution | State |
|---|---:|---|---|---|
| `finding-4970556ab704416b2bf8` | ERROR | `CRITICAL_FLOW_NOT_VERIFIED` | Canonical release evaluation now fails closed with explicit missing/incomplete quality-gate blockers. Browser evidence remains explicitly incomplete and non-eligible because the validated QA workspace lacks the required production build; customer website generation E2E was not run. | RESOLVED |
| `finding-191200ccc58b25e3fd0c` | WARNING | `FUNCTIONAL_SCENARIO_INCOMPLETE` | Opt-in AI, Context7, Codebase Memory, and Factory E2E commands emit structured not-run/non-release evidence unless authorized. Generated-runtime smoke records validation identity, checksums, command results, and policy version. | RESOLVED |
| `finding-601d85f09cdb45d46400` | WARNING | `FALSE_CONFIDENCE_TEST` | Backend smoke now executes a temporary local migration/server-action boundary fixture in addition to proposal validation; it makes no network or production database claim. | RESOLVED |

## Canonical release decision path

| Stage | Canonical owner | Evidence requirement | cg-14 result |
|---|---|---|---|
| Quality aggregation | `FullTaskGraphExecutor.applyOutcome` | Bind only the current outcome’s quality checks to project/version/TaskGraph/source identity and its runtime or QA reference. | PASS |
| Release evaluation | `FullTaskGraphExecutor.finishSummary` | Every mandatory gate must be present, passed, current-candidate bound, command-backed, and execution-referenced. | PASS |
| Missing evidence | Same executor | Add explicit `QUALITY_GATE_MISSING_*` or `QUALITY_GATE_EVIDENCE_INCOMPLETE_*` blockers; never infer release eligibility from an empty filtered set. | PASS |
| Standalone smoke | Smoke scripts | Produce bounded evidence only; standalone `status: passed` never grants release authority. | PASS |
| Browser scope | Factory E2E / Playwright wrapper | Customer website generation E2E remains out of scope; blocked wrapper is recorded as incomplete/non-eligible. | PASS / NON-ELIGIBLE |

## Runtime evidence

| Evidence | Command | Result | Release authority |
|---|---|---|---|
| Backend boundary | `npm run backend:smoke` | PASS; proposal validation plus executed local migration and server-action fixture; network false | None; `releaseEligible: false` |
| Generated runtime | `npm run generated:runtime-smoke` | PASS; 5/5 commands, validation/package/lock identities recorded, `runtime-v1` | None; `releaseEligible: false` |
| TaskGraph | `npm run taskgraph:smoke` | PASS; completed with all five mandatory gates and matching runtime/QA references | Synthetic executor smoke only; no customer release claim |
| AI opt-in | `npm run ai:smoke` | NOT RUN without explicit opt-in and API key | None; non-release |
| Context7 opt-in | `npm run context7:smoke` | NOT RUN without explicit opt-in | None; non-release |
| Codebase Memory opt-in | `npm run codebase-memory:smoke` | NOT RUN without explicit opt-in | None; non-release |
| Factory E2E | `npm run factory:e2e-smoke` | NOT RUN without explicit preflight opt-in; customer website generation E2E not run | None; non-release |
| Repository Playwright wrapper | `npm run playwright:smoke` | BLOCKED by validated QA workspace missing Next.js production build | None; incomplete |

Artifacts: [`backend`](cg-14-backend-runtime-smoke-results-2026-08-11.json), [`generated runtime`](cg-14-generated-runtime-smoke-results-2026-08-11.json), [`opt-in boundaries`](cg-14-opt-in-smoke-results-2026-08-11.json), [`browser state`](cg-14-browser-evidence-results-2026-08-11.json), and [review verification](cg-14-runtime-release-evidence-verification-2026-08-11.json).

## Validation

| Check | Result |
|---|---|
| `npm run lint` | PASS; 3 pre-existing warnings |
| `npm run typecheck` | PASS |
| `npm test` | PASS; 69 files, 839 tests |
| `npm run build` | PASS |
| `npm audit --audit-level=high` | PASS; 0 vulnerabilities |
| Database validation/status/verify/integrity | PASS; 17 tables, 84 constraints, 4 indexes, RLS 17/17, public policies 0 |
| `docker compose config` | PASS |
| `git diff --check` | PASS |
| `npm run test:reviewers` | PASS; 75 tests across 7 files |
| TaskGraph smoke | PASS; `releaseEligible=true` only with complete execution evidence |

## Required reviewer rechecks

| Reviewer | Verdict | Structured output | Evidence validation | Provider calls |
|---|---|---:|---:|---:|
| Test / Quality Reviewer | APPROVED / RESOLVED | PASS | PASS | 1 |
| Code / Integration Reviewer | APPROVED / RESOLVED | PASS | PASS | 1 |

No other reviewer was called. No new agent, tool, MCP, permission, deployment, or customer website generation E2E was added.

## State and invariants

The updated Phase 6 DAG has 7 correction-ready findings remaining: 0 CRITICAL, 1 ERROR, 7 WARNING, 0 INFO. The next eligible correction group by updated order is `cg-15-persistence-migration-evidence`.

QA foundation directories remained at 15 before and after. Historical `.qa-foundation-*` directories were not cleaned. `.context7-cache/` is untracked and unstaged. The portfolio remains 4 approved external skills, 13 approved internal skills, 17 unique approved artifacts, 18 assignment references, 9 agents, and zero deferred skill usage.

Successor state: [`phase-6-execution-state-2026-08-11-cg14-result.json`](phase-6-execution-state-2026-08-11-cg14-result.json)

NEXT: `cg-15-persistence-migration-evidence`
