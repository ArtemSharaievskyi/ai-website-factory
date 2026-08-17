# Brief Revision V3 production switch

This runbook is for Phase 4 only. Phase 3C certifies readiness; it does not
change production routing or mutate the protected pilot.

## PRECONDITIONS

- V3 Core certification: PASS.
- V3 Provider certification: PASS.
- V3 Transaction certification: PASS.
- Live synthetic provider -> transaction E2E: PASS, with exactly one live
  provider call and zero replay calls.
- Migration verification: PASS for fresh schema, upgrade, constraints, FKs,
  checks, partial indexes, RLS, CAS behavior, and revision references.
- Protected real-pilot snapshot: confirmed read-only.
- `npm run codex:verify`, affected checks, provider-contract checks, typecheck,
  lint, and architecture guards have no new blocking result.

## SWITCH

Make one coherent capability switch at the TrialEntry application boundary:

`TrialEntryService.requestBriefChanges` ->
`BriefV3TransactionService.execute`

The public Workbench envelope and action remain
`action: "request-brief-changes"`. The production route now enters the V3
transaction service directly. There is no independent provider, persistence,
history, or feature-flag authority, no dual-write, and no V2 fallback.

## POST-SWITCH SYNTHETIC ACCEPTANCE

Phase 3C's opt-in live harness intentionally starts at the real V3 application
boundary with synthetic persisted state; it does not claim that production
Workbench routing has switched. After the switch, run one production-shaped
synthetic request through Workbench -> TrialEntry -> V3 transaction. Verify the
strict provider contract, host mapping, reducer,
invariants, atomic commit, history, workflow transition, projection checksum,
typed error mapping, exact committed replay, and reconstructed-service replay.
Use synthetic data only. Do not use the pilot for iterative debugging.

## REAL PILOT ACCEPTANCE

Only after synthetic production-path acceptance passes, perform exactly one
controlled revision against the protected pilot. Verify persisted V3 state,
history, workflow/readiness, projection, and exact replay. Do not submit
additional revisions, approve the Brief, or use the pilot to tune the provider.

## ROLLBACK

After a V3 canonical commit, do not rewrite that project through legacy mutation
semantics or restore a legacy revision route. If deployment rollback is needed,
hold or isolate new revision traffic and fix forward in V3; the committed V3
database state remains authoritative.

## DELETION GATE

Phase 4C closes this gate after synthetic and controlled pilot acceptance. The
obsolete full-candidate V2 provider, merge/preservation semantics, Lead mutation
service branch, mutation-only diagnostics, and V2 revision idempotency are
removed. The architecture guard prevents production Brief mutation areas from
importing those modules again.

Keep legacy V1/V2 readers and the deterministic V2 -> V3 migration adapter.
Do not globally rewrite legacy rows and do not delete compatibility reads.

## ROUTING READINESS MAP

The current production path is:

- public entry: `src/app/api/workbench/route.ts`,
  `request-brief-changes` action;
- application dispatch: `src/runtime/workbench/application.ts`,
  `REQUEST_BRIEF_CHANGES` case;
- TrialEntry boundary: `src/runtime/trial-entry/service.ts`,
  `TrialEntryService.requestBriefChanges`;
- V3 application boundary: `src/runtime/brief-revision-v3/service.ts`,
  `BriefV3TransactionService.execute`;
- V3 provider boundary: `src/integrations/openai-v3/provider.ts`,
  `OpenAiBriefV3RevisionProvider.proposeChanges`;
- V3 atomic persistence: `commitBriefRevision`.

Phase 4 changes one coherent capability at the TrialEntry boundary. It does
not split the switch into flags and it does not modify routing during Phase 3C.
