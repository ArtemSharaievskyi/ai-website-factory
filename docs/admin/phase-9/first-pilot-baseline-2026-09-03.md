# First pilot baseline — 2026-09-03

Status: `FIRST_PILOT_BASELINE_CERTIFIED` with bounded post-pilot repository debt.

This is the first-pilot closure artifact. It reuses the Factory’s existing
checksum-and-reference admin evidence convention. The JSON records the source
HEAD, canonical artifact bindings, current TaskGraph identity, approved
specialist and skill checksums, generated coverage, deterministic QA evidence,
and validation results without copying protected customer content or a real
project identifier.

## Lifecycle closure

The existing workflow has no separate “implementation complete, publication
deferred” state. The production path therefore remains in `IMPLEMENTING` after
the completed implementation and validation run. The executor’s run records
`VALIDATING`, and `releaseEligible` is true, but the persisted project row is
not advanced to `PROJECT_READY` because that transition belongs to the release
boundary.

`prepare-release` is explicitly listed in `releaseBoundaryTaskTypes` and is
excluded from full execution. It remains `READY`, attempt `0`, and resumable.
No release preparation, publication, deployment, or customer-data mutation was
performed.

## Frozen pilot result

- TaskGraph: 104 total; 81 passed; 22 cancelled by inactive topology; 0 failed; 1 `prepare-release` task ready.
- Topology: frontend active; backend `NONE` and database `NONE`, therefore backend/database implementation was not required.
- Coverage: 11 generated routes, including `/impressum` and `/datenschutz`; 31 service inventory entries; Möbeltransport coverage present; client form boundary verified.
- Functional QA: 12 passed, 0 failed, 0 skipped; loopback-only network interception observed 0 unexpected external requests.
- Full-execution quality gates: lint, typecheck, build, unit-tests, and e2e all passed for the generated pilot.
- Specialist architecture: the three approved implementation profiles, conditional routing, least-privilege capability policy, AST patch boundary, existing executor/workspace/skill layers, and QA handoff are frozen.

## Measured efficiency

The representative frontend task slice was 2,361 bytes and the selected
approved skill content was 2,627 bytes, for 4,988 bounded context bytes against
the 120,000-byte frontend profile limit. The persisted graph is approximately
1.09 MB, but the executor uses bounded task slices rather than sending the
whole graph as provider context. The five-gate QA evidence slice measured 875
bytes for the persisted quality-gate evidence. No provider call was made during
closure.

## Post-pilot hardening backlog

P0: none.

P1: repair the shared PostgreSQL projection/cleanup contention boundary. The
parallel suite can reproduce a cleanup deadlock/timeout, and a prior parallel
run reproduced a projection-status stale CAS; the isolated downstream route,
Brief V3 production route, and Postgres concurrency suite pass. The next repair
must atomically claim queue rows or isolate test database ownership, add a
deterministic concurrency regression, and avoid timeout-only changes.

P2: separately recertify the Phase 7D catalog manifest and Phase 7E QA-test
manifest after classifying both mismatches as `STALE_BASELINE`; do not blindly
refresh them. Remove or justify the two existing lint warnings.

P3: repeat context measurements only when the lifecycle or topology changes;
keep backend/database specialists inactive until their approved decisions are
required.

The complete machine-readable record, including exact checksums and validation
results, is in the accompanying [baseline JSON](first-pilot-baseline-2026-09-03.json).
