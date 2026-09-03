# Post-pilot hardening plan — 2026-09-03

This plan is intentionally measured and non-blocking for the certified first
pilot. It does not authorize a release, publication, deployment, provider call,
or broad implementation pass.

## P0 — pilot-threatening defects

None observed. The protected pilot has no failed TaskGraph task, no failed
generated-project quality gate, no failed functional QA scenario, and no
unexpected external request.

## P1 — next repair task

Investigate the shared PostgreSQL boundary around
`brief_revision_projection_sync` and synthetic-suite cleanup.

Evidence points to `DATABASE_CONTENTION` with a `REAL_RACE` mechanism:

- `BriefV3ProjectionService.processPending()` selects pending rows from a
  global queue before any claim is made.
- PostgreSQL settlement uses a status compare-and-set, so overlapping workers
  can observe the same `PENDING` row and one receives “projection sync status is
  stale.”
- Parallel repository execution also reproduced a deadlock at synthetic
  `factory_projects` cleanup and the test timed out.
- The downstream lifecycle test, Brief V3 production route, and Postgres
  concurrency certification each pass in isolation.

The repair should choose one host-owned boundary: an atomic `FOR UPDATE SKIP
LOCKED`/claim state machine for production queue work, or an explicit isolated
database/schema ownership strategy for tests where production semantics do not
need to change. It must add a deterministic parallel regression and preserve
CAS/currentness semantics. Increasing the timeout alone is not an acceptable
repair.

## P2 — evidence and hygiene

The Phase 7D frozen manifest mismatch for `src/agents/catalog.ts` and the Phase
7E frozen manifest mismatch for `src/runtime/qa/qa.test.ts` are classified as
`STALE_BASELINE`, not `AUTHORIZED_PILOT_DELTA` and not `REAL_REGRESSION`. Both
files are already at the current source state; each focused evidence test
fails only because its historical expected checksum is older. Refresh them in
a separate, authorized evidence-recognition change after the P1 investigation.

The current lint result has two warnings: an unused `safePattern` in the
implementation policy and an unused `matches` helper in implementation
validators. Remove or justify them in a small hygiene change.

## P3 — deferred measurement

Do not activate backend or database specialists for this static/no-persistence
pilot. Re-measure frontend task context, orchestrator task-slice size, and QA
evidence size only after a topology or lifecycle change. Preserve the three
profile checksums and the approved-skill resolver bindings until an explicit
policy decision changes them.

## Exit criteria for the next task

The next hardening task is complete when the parallel Postgres classification
has a deterministic passing regression, the protected pilot remains unchanged,
the two historical manifests are either deliberately recertified or retained
with an explicit currentness record, and the normal typecheck/lint/test/build,
database, provider-contract, TaskGraph, Codex verification, and diff gates are
re-run. The release boundary remains deferred until separately authorized.
