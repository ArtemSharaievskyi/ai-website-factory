# cg-05 Design Durable State Authority — Revision 2 Replan

Status: **REPLAN_COMPLETE — IMPLEMENTATION_PENDING**
Group: `cg-05-design-durable-state-authority`
Baseline and current HEAD before planning: `0098e66`
Plan revision: `2`

This document records Phase 6F.1 replanning only. No revision-2 implementation was performed, no third revision-1 cycle was started, and the existing dirty candidate was preserved.

## Findings and revision-1 outcome

The two active findings remain unchanged:

| Finding | Reviewer | Severity | Category | Current state |
| --- | --- | --- | --- | --- |
| `finding-1540c99220f633245955` | Architecture Reviewer | WARNING | `SOURCE_OF_TRUTH` | ACTIVE |
| `finding-efa4502938176a741e32` | Architecture Reviewer | ERROR | `DATA_ARCHITECTURE` | ACTIVE |

Revision 1 removed DesignAgentService's process-local Maps as an authority, made durable database documents the source for generated directions and selections, reconstructed validation/regeneration context after restart, persisted generation and selection idempotency identities, and kept Project Memory as a synchronized filesystem projection. It also retained checksum-bound direction membership and the existing workflow/decision write paths.

Cycle 1 was deterministic-test passing but reviewers still found missing durable idempotency-key identity and incomplete current-artifact replay validation. Cycle 2 persisted idempotency keys and strengthened direction-set/direction checksum validation. The Architecture Reviewer then approved the durable-state design. The Code / Integration Reviewer remained active because the selection boundary still did not explicitly compare `request.projectVersion` with the current durable project version.

No revision-1 finding was resolved. The authoritative counts remain 20 total: CRITICAL 0, ERROR 7, WARNING 12, INFO 1.

## Exact remaining blocker

`DesignSelectionRequestSchema` already requires `projectVersion` (`src/agents/design/contracts.ts:17-18`). `selectDesignDirection` parses that request, loads documents using `(request.projectId, request.projectVersion)`, and eventually calls the durable selection path. It does not first load the current project and enforce:

```text
request.projectId === currentProjectId
AND
request.projectVersion === currentProjectVersion
```

The trusted current version already exists. `ProjectRepository.getWithVersion(request.projectId)` returns the durable `FactoryProject`, whose `currentVersion` is mapped from the project metadata row (`src/persistence/database/repositories.ts:19-24`, `src/persistence/database/mapping.ts:30-38`). The missing invariant is therefore a local guard, not a missing typed contract or a second state store.

The guard must run immediately after request parsing and before selection replay is accepted or any selection-specific work occurs. A stale request must fail with the existing typed `DESIGN_SELECTION_STALE` error. It must not be upgraded to the latest version, retried against current state, or silently accepted because a selected-design document already exists.

## Authority and identity

| Value | Canonical source | Trusted? | Role | Failure behavior |
| --- | --- | --- | --- | --- |
| `request.projectId` | `DesignSelectionRequest.projectId` | No; command input | Lookup key for the project the caller intends to mutate | Durable project/artifact identity checks reject mismatch |
| `request.projectVersion` | `DesignSelectionRequest.projectVersion` | No; command input | Exact version the caller intends to select against | Reject unless equal to current durable version |
| `currentProjectId` | `ProjectRepository.getWithVersion(request.projectId)` / mapped `FactoryProject.projectId` | Yes | Canonical project identity | Reject if project is absent or identity does not match |
| `currentProjectVersion` | `FactoryProject.currentVersion` from durable project metadata | Yes | Canonical currentness authority | `DESIGN_SELECTION_STALE` before replay or mutation |
| `directionId` | Request plus current persisted `design-directions` document | No by itself | Candidate selection identity | Reject if not a member of current set |
| Current Design artifact version/checksum | Durable `design-directions` document keyed by project/version and its checksums | Yes after validation | Proves the direction belongs to the current artifact | Reject stale checksum, set, or membership |
| Persisted selected direction | Durable `selected-design` through `DesignRepository.select` | Yes | Current selection authority | Never overwrite through stale request |
| Selection history | `DecisionRepository.append`; Project Memory is a projection | Yes / projected | Durable audit record | No successful decision on stale rejection |

The current candidate already verifies current direction-set checksum, selected-direction checksum, direction membership, and durable repository membership. Revision 2 preserves those checks. It does not introduce another Design store or make Project Memory the current-version authority.

## Side-effect policy

| Scenario | Selection mutation | Decision history | Workflow advance | Result |
| --- | --- | --- | --- | --- |
| Current version and valid current direction | Allowed | Append successful selection decision | Allowed to `READY_FOR_IMPLEMENTATION` | Success and durable selected-design |
| Stale project version | Forbidden | No successful append | Forbidden | `DESIGN_SELECTION_STALE` |
| Wrong project identity | Forbidden | No successful append | Forbidden | Typed identity/artifact rejection |
| Invalid or stale direction/checksum | Forbidden | No successful append | Forbidden | Existing direction/checksum error |
| Same current version, same valid idempotent replay | No second mutation required | No duplicate success history | No duplicate transition | Existing persisted selection returned |

The stale guard must precede the existing selected-design replay branch. This is necessary so a v1 request cannot receive a successful replay after the project has advanced to v2.

## Dirty candidate decisions

| File | Current candidate purpose | Reviewer status relevance | Decision | Revision-2 role |
| --- | --- | --- | --- | --- |
| `scripts/phase-6c-cg02-verification.ts` | Shared verifier with cg-05 evidence and reviewer setup | Admin evidence only | `ADMIN_VERIFICATION_INFRA_ONLY` | Reuse for the future bounded Code / Integration recheck; no broad verifier redesign |
| `src/agents/design/design.test.ts` | Design behavior and restart/durable-state regression | Required behavioral evidence | `KEEP_BUT_MODIFY` | Add current-version, stale-version, and no-side-effect regressions; preserve existing 15 tests |
| `src/agents/design/memory.ts` | Removes unused DecisionRepository injection; keeps projection adapter | Part of Architecture-approved wiring | `KEEP` | Preserve unchanged |
| `src/agents/design/server.ts` | Production adapter composition after constructor correction | Composition only | `KEEP` | Preserve unchanged |
| `src/agents/design/service.ts` | Durable Design reads, idempotency, checksum validation, and selection mutation | Exact Code Reviewer blocker | `KEEP_BUT_MODIFY` | Add the current durable-version guard immediately after request parsing |
| `src/domain/design/schema.ts` | Optional persisted generation/selection idempotency identity | Supports durable authority | `KEEP` | Preserve; no migration or new version field |
| `src/runtime/production-factory-runtime-core.ts` | Production constructor wiring | Required composition outside machine likelyFiles | `KEEP` | Preserve unchanged |

No candidate control is discarded. The controls retained are durable repository authority, restart recovery, persisted idempotency, checksum/membership validation, the DesignRepository write boundary, workflow row-version control, decision persistence, and Project Memory projection. Only the missing current-version guard and its regression evidence require modification.

## Revised root cause and goal

Failure classification:

- `WRITE_BOUNDARY_CURRENTNESS_GAP`
- `PROJECT_VERSION_NOT_VALIDATED`
- `STALE_COMMAND_ACCEPTANCE`
- `SELECTION_MUTATION_GUARD_INCOMPLETE`
- `CROSS_VERSION_DESIGN_SELECTION_RISK`

Revised root cause confidence is **HIGH**. Revision 1 established the correct durable authority but omitted one explicit currentness comparison at the canonical selection write boundary. This is **LOCAL_GUARD**, not `TYPED_CONTRACT_GAP` or `DEEPER_AUTHORITY_GAP`.

Revised correction goal:

> Only an explicit Design selection command bound to the trusted current projectId and current projectVersion, targeting a direction from the current durable Design artifact, may establish durable selection authority.

## Revision-2 scope

Required files:

- `src/agents/design/service.ts`: load the trusted current project immediately after parsing; reject absent/mismatched `currentVersion` with `DESIGN_SELECTION_STALE` before replay and mutation.
- `src/agents/design/design.test.ts`: add current-version success, version-advance stale rejection, no-side-effect assertions, and preserve existing restart/idempotency coverage.

Possible files only if deterministic inspection requires them:

- `scripts/phase-6c-cg02-verification.ts` for bounded evidence configuration reuse;
- `src/agents/design/contracts.ts` only if evidence exposes a contract inconsistency, which is not currently expected;
- `src/agents/design/errors.ts` only if the existing `DESIGN_SELECTION_STALE` contract cannot be reused, which current inspection disproves.

Out of scope: `memory.ts`, `server.ts`, `schema.ts`, and runtime composition wiring, except for an unexpected compile boundary. No migration, persistence redesign, new store, workflow redesign, provider change, auth/storage correction, Design behavior change, new agent/framework/MCP/orchestrator, customer E2E, QA cleanup, or cg-06 start is authorized.

## Future implementation sequence

1. Preserve the Architecture-approved durable-state candidate.
2. Add the current project lookup and `request.projectVersion === current.project.currentVersion` guard at `selectDesignDirection`.
3. Use the existing `DESIGN_SELECTION_STALE` typed error and fail before replay or mutation.
4. Add stale no-mutation and current-version happy-path regressions, including the v1-to-v2 replay scenario.
5. Run targeted Design tests, persistence integrity, typecheck, lint, and the full relevant repository suite.
6. Run the bounded Code / Integration Reviewer recheck. Rerun Architecture only if the authority boundary changes materially.
7. Commit only after deterministic gates and required reviewer closure succeed; otherwise stop and replan.

## Revised tests

| Scenario | Expected result | Mutation allowed? |
| --- | --- | --- |
| Current project v2, request v2, direction belongs to current v2 set | Selection succeeds and workflow reaches READY_FOR_IMPLEMENTATION | Yes |
| Project v1 request created, project advances to v2, stale v1 request replayed | `DESIGN_SELECTION_STALE` | No |
| Stale request when selected-design already exists | Rejected before idempotent replay | No |
| Stale request after service restart/resume | Durable current v2 is read and stale v1 is rejected | No |
| Wrong project with otherwise matching version/direction inputs | Existing durable identity/artifact rejection | No |
| Current direction with matching set and direction checksums | Existing selection succeeds | Yes |
| Direction from an old version presented for current version | Rejected by version-bound artifact/checksum/membership checks | No |

The stale tests must assert that selected-design, DecisionRepository history, Project Memory selection projection, workflow state, and row version are unchanged. Existing 15 targeted Design tests remain the baseline and are not replaced.

## Reviewer rechecks and budget

| Reviewer | Revision-1 result | Required in revision 2? | Reason | Expected evidence |
| --- | --- | --- | --- | --- |
| Architecture Reviewer | APPROVED | No, conditional | The revision is a local guard at the already approved durable boundary | Rerun only if authority or persistence changes |
| Code / Integration Reviewer | CHANGES_REQUIRED / STILL_ACTIVE | Yes | Owns the exact missing `projectVersion` currentness guard | Request contract, trusted source, guard placement, typed error, current success, stale no-mutation, durable write path |
| Test / Quality Reviewer | Not required | No | No independent semantic test-quality finding | Existing deterministic tests are evidence for Code / Integration |
| Contract Auditor | Not required | No | No canonical contract change is planned | ProjectVersion already exists in the typed request contract |

No GPT clarification calls were made during replan. The future bounded verification is expected to use one real GPT reviewer call for Code / Integration. The new correction budget is **maximum 1 implementation cycle** because the trusted source, typed request field, existing error code, and canonical write boundary already exist; reopening a two-cycle architecture budget would be disproportionate.

Implementation capability remains the existing Implementation Agent / trusted implementation executor, bounded to DesignAgentService selection and targeted tests. No new agent is introduced.

## Phase and invariant state

Revision 1 remains BLOCKED after 2/2 consumed cycles. Revision 2 is REPLAN COMPLETE and IMPLEMENTATION PENDING. The DAG is unchanged and acyclic; cg-05 remains the current group and cg-06 has not started.

Approved external skills remain 4, approved internal skills 13, unique approved skills 17, assignments 18, agents 9, and deferred skill usage 0. Twelve pre-existing `.qa-foundation-*` directories remain untouched. No website E2E or QA cleanup was performed.

Machine artifact: `docs/admin/phase-6/cg-05-design-durable-state-authority-replan-2026-08-10.json`
Successor state: `docs/admin/phase-6/phase-6-execution-state-2026-08-10-cg05-replan.json`
