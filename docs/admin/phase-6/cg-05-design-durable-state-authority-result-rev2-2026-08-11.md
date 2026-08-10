# cg-05 Design Durable State Authority — Revision 2 Result

Status: **COMPLETE**
Group: `cg-05-design-durable-state-authority`
Plan revision: `2`
Baseline: `df3ab5c`
Production correction commit: `93bd092` (`fix: reject stale design selection commands`)

## Outcome

Revision 1's Architecture-approved durable Design-state candidate was preserved. Revision 2 consumed its single permitted implementation cycle and added the missing current-project-version guard at `DesignAgentService.selectDesignDirection`.

Immediately after parsing a selection request, the service now loads `ProjectRepository.getWithVersion(request.projectId)` and rejects when the durable `FactoryProject.currentVersion` does not equal `request.projectVersion`. The existing typed `DESIGN_SELECTION_STALE` error is reused. The guard precedes review/document reads, selected-design replay, persistence, Project Memory writes, workflow transition, and decision append.

The Code / Integration Reviewer returned **RESOLVED** with valid evidence in one real GPT call. The Architecture Reviewer was not rerun because the durable authority boundary was unchanged; its inherited **APPROVED** result remains valid.

## Version and authority contract

| State/value | Canonical source | Trusted? | Validation at write boundary |
| --- | --- | --- | --- |
| `request.projectId` | Typed selection command | No | Resolves the durable project and remains bound to artifact lookups |
| `request.projectVersion` | Typed selection command | No | Must equal durable `FactoryProject.currentVersion` |
| Current project ID | `ProjectRepository.getWithVersion(request.projectId)` | Yes | Project must exist and remain the addressed identity |
| Current project version | Durable `FactoryProject.currentVersion` | Yes | Mismatch fails with `DESIGN_SELECTION_STALE` |
| Current Design artifact | Durable `design-directions` document keyed by project/version | Yes after validation | Set checksum, direction membership, and direction checksum remain required |
| Selected Design | `DesignRepository.select` durable document | Yes | Written only after all guards pass |
| Selection history | `DecisionRepository.append`; Project Memory is projection | Yes / projected | No successful decision on stale rejection |

## Stale-command behavior

| Effect | Before revision 2 | After revision 2 | Regression proof |
| --- | --- | --- | --- |
| Selection mutation | Could reach replay/mutation with stale version | Rejected before mutation | Stale v1 request after durable advance to v2 |
| Decision append | Not reached only if later checks failed | Forbidden on stale request | Decision list unchanged |
| Project Memory update | Not reached only if later checks failed | Forbidden on stale request | Memory snapshot unchanged |
| Workflow advance | Not reached only if later checks failed | Forbidden on stale request | State and row version unchanged |
| Successful idempotent replay | Could bypass current-version check | Guard precedes replay | Stale replay returns `DESIGN_SELECTION_STALE` |

Same-current-version idempotent replay remains supported. Project identity, direction membership, direction-set checksum, and selected-direction checksum checks remain intact.

## Changes

| File | Revision-1 role | Revision-2 change | Final role |
| --- | --- | --- | --- |
| `src/agents/design/service.ts` | Durable Design authority and mutation path | Added current durable-version guard before replay/mutation | Canonical currentness boundary |
| `src/agents/design/design.test.ts` | Durable/restart/idempotency tests | Added stale version advance and no-side-effect regression | Currentness evidence |
| `scripts/phase-6c-cg02-verification.ts` | Shared verifier infrastructure | Scoped cg-05 rev2 to Code / Integration and added currentness evidence | Approved admin verifier |
| `src/agents/design/memory.ts` | Database authority / Project Memory projection wiring | Preserved | Durable projection boundary |
| `src/agents/design/server.ts` | Production adapter wiring | Preserved | Composition boundary |
| `src/domain/design/schema.ts` | Durable idempotency fields | Preserved | Persisted contract |
| `src/runtime/production-factory-runtime-core.ts` | Production composition wiring | Preserved | Runtime composition |

No database schema change, migration, new durable store, Project Memory authority change, new agent, framework, MCP, or orchestrator was introduced.

## Tests and verification

- Targeted Design tests: 16 passed.
- New regression: durable project advances v1 → v2; replayed v1 selection fails with `DESIGN_SELECTION_STALE` and leaves selected-design, decision history, events, workflow, row version, and Project Memory unchanged.
- Existing current-version selection and same-version idempotent replay tests remain passing.
- Full tests: 67 files / 823 tests passed after running build first. The first parallel validation attempt had a build/test race; it was not used as closure evidence.
- Build: passed.
- Typecheck: passed.
- Lint: passed with the three known pre-existing warnings in implementation files.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- Database validation, status, verify, and integrity: passed.
- `docker compose config`: passed.
- TaskGraph smoke: passed with `releaseEligible=true`.
- `git diff --check`: passed.

The normal test suite includes an existing local QA-browser scenario; it passed after the sequential build. No intentional customer website-generation E2E was added or run. QA directories were not cleaned; the run produced one additional ignored test fixture, leaving 14 `.qa-foundation-*` directories.

## Finding closure

| Finding | Severity | Architecture | Code / Integration | Final state |
| --- | --- | --- | --- | --- |
| `finding-1540c99220f633245955` | WARNING | Inherited APPROVED | RESOLVED | RESOLVED |
| `finding-efa4502938176a741e32` | ERROR | Inherited APPROVED | RESOLVED | RESOLVED |

Both cg-05 findings resolved. Remaining global counts are total 18: CRITICAL 0, ERROR 6, WARNING 11, INFO 1.

## Phase 6 DAG

No unrelated group was modified. cg-05 closure newly unblocks:

- `cg-09-project-memory-durability`
- `cg-10-design-request-isolation`
- `cg-17-design-gate-evidence`

The next recommended group by the authoritative DAG order is `cg-06-database-error-propagation`. It was not started by this task.

Machine result: `docs/admin/phase-6/cg-05-design-durable-state-authority-result-rev2-2026-08-11.json`
Verification: `docs/admin/phase-6/cg-05-design-durable-state-authority-verification-2026-08-10.json`
