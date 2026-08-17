# Historical design record: Brief Revision V3 E1 deterministic acceptance evidence

> E1 is a completed historical evidence plan. Its references to V2 mutation
> seams and tripwire instrumentation describe the state at E1 time; Phase 4C
> removed those mutation seams. Current Brief mutations enter only
> `BriefV3TransactionService`, while V1/V2 support remains read/migrate only.
> Use the current architecture and runbook documents for implementation
> guidance.

## Goal

Rebuild the Phase 3C acceptance evidence boundary so deterministic certification
is produced by a separate verifier from immutable executor observations. This
phase makes no live provider call, opens no Window #4, and does not change
production routing, V3 core semantics, the protected pilot, or `docs/admin/**`.

## Existing architecture

The V3 transaction path is owned by `src/runtime/brief-revision-v3/service.ts`
and persists through `PersistenceDatabase`. Project Memory is a filesystem
projection. The current Phase 3C evidence helpers under
`src/runtime/brief-revision-v3/` mix executor observations with verdict fields,
use a two-file finalization marker, and read legacy reachability from a
CommonJS cache. Legacy V2 mutation seams remain in the Lead provider/merge,
Trial Entry idempotency, and document persistence paths.

## Files likely involved

- `src/runtime/brief-revision-v3/acceptance-window.ts`
- `src/runtime/brief-revision-v3/certification-evidence.ts`
- new verifier, observation, and deterministic acceptance tests under
  `src/runtime/brief-revision-v3/`
- `src/runtime/brief-revision-v3/source-fingerprint.ts`
- `src/runtime/brief-revision-v3/v2-tripwire.ts`
- `src/runtime/brief-revision-v3/cleanup-policy.ts`
- read-only persistence methods in `src/persistence/database/types.ts`,
  `fake.ts`, and `postgres.ts`
- actual V2 seam instrumentation in the legacy provider/merge/Trial Entry and
  document persistence boundaries
- `scripts/brief-v3-live-acceptance.ts`, `package.json`, and one concise
  engineering-principle/scoped-guidance update

No production route or V3 semantic module is in scope.

## Invariants

- Executor records facts; verifier derives truth from fresh authoritative reads.
- PASS is derived from verified facts and cannot be supplied by a caller.
- Finalized evidence is one immutable atomically renamed artifact.
- Window, run, source manifest, attempt, committed document, and observation
  identities are bound together.
- V2 mutation absence requires both graph-derived static non-reachability and
  real seam instrumentation with zero invocations.
- Canonical Brief state is verified independently from the expected fixture
  intent, including locality and history/workflow/projection relationships.
- Cleanup is ownership-based, includes the generic idempotency artifact when
  applicable, and is checked through a fresh verifier session.
- Historical Windows #1/#2/#3 remain inconclusive; Window #4 is not opened.

## Steps

1. Replace the two-authority evidence finalizer and define raw observation and
   verified-fact boundaries.
2. Add fresh authoritative persistence reads and implement the independent
   verifier/verdict pipeline.
3. Replace self-asserted source/V2/cleanup evidence with auditable manifests,
   real seam instrumentation, and ownership-complete cleanup checks.
4. Add deterministic end-to-end, negative, concurrency, and fault-injection
   tests and wire them into `test:brief-revision:certify` as the EVIDENCE group.
5. Update the future live harness to consume the same verifier boundary without
   running it in E1.
6. Run only no-network validation, protect-state checks, and a same-agent
   read-only adversarial second pass. Commit once only if every E1 criterion is
   met.

## Validation

- `npm run test:brief-revision:certify`
- `npm run codex:provider-contracts`
- `npm run codex:affected -- --run`
- `npm run codex:verify`
- `npm run check:architecture`
- `npm run typecheck`
- `npm run lint`
- `git diff --check`
- relevant local persistence/concurrency/cleanup tests

No OpenAI, real provider network, live acceptance command, or Window #4.

## Completion criteria

The EVIDENCE group passes with executor/verifier separation, atomic immutable
finalization, strict binding, auditable source coverage, real V2 zero-call
instrumentation, committed semantic/locality/history/workflow/projection
verification, ownership-complete independent cleanup verification, and
fail-closed negative coverage. The handoff explicitly states that the evidence
subsystem is deterministically certified, Phase 3C is not complete, and the
next action is a separately scoped E2 live certification.
