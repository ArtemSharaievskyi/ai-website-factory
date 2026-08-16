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
`action: "request-brief-changes"`. Replace one production route, then run the
V3 application service end to end. Do not introduce independent provider,
persistence, history, or feature flags. There is no dual-write and no V2
fallback. Keep the V2 mutation code temporarily unreachable only as a
code-level rollback option before the first V3 canonical commit. Once any V3
commit exists, do not restore the old route globally; Phase 4 must enforce that
per-project authority boundary or hold traffic while fixing forward.

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

Before any V3 canonical commit, routing may be restored to the old path if the
switch is not healthy.

After a successful V3 canonical commit, do not rewrite that project through V2
mutation semantics and do not globally restore the old route. If deployment
rollback is needed after the first V3 commit, hold or isolate new revision
traffic and fix forward in V3; the committed V3 database state remains
authoritative.

**Routing rollback is NOT canonical-state rollback.** Restoring a route does not
undo or translate a committed V3 state.

## DELETION GATE

After synthetic and one controlled pilot acceptance pass, delete the obsolete
V2 mutation architecture only after a separate review confirms no route still
depends on it. Delete:

- the V2 mutation call in `LeadAgentService.requestBriefRevision` and its
  `mergeRevisionRequirements` path;
- preservation and text-target mutation helpers: `addMissingPreserved`,
  `removeTarget`, `resolveTargetValues`, `requirementDimensionForText`,
  `isSimulationProhibitionRequirement`, and
  `getEffectiveBriefRequirements` where they serve revision mutation;
- the full-candidate V2 revision contract and diagnostics, including
  `BriefRevisionStructuredOutputSchema`, `BriefRevisionOperation`, and the
  `reviseBrief` adapter;
- obsolete V2 revision idempotency, including
  `REQUEST_BRIEF_CHANGES_OPERATION` and `briefRevisionOperationKey`.

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
- V2 idempotency: `src/runtime/trial-entry/idempotency.ts`,
  `REQUEST_BRIEF_CHANGES_OPERATION` and `briefRevisionOperationKey`;
- V2 Lead: `src/agents/lead/service.ts`,
  `LeadAgentService.requestBriefRevision` and `mergeRevisionRequirements`;
- V2 provider: `src/integrations/openai/adapters.ts`, `reviseBrief` and
  `BriefRevisionStructuredOutputSchema`;
- V2 persistence/workflow and response mapping: the existing TrialEntry and
  Lead service repository boundaries;
- V3 application boundary: `src/runtime/brief-revision-v3/service.ts`,
  `BriefV3TransactionService.execute`;
- V3 provider boundary: `src/integrations/openai-v3/provider.ts`,
  `OpenAiBriefV3RevisionProvider.proposeChanges`;
- V3 atomic persistence: `commitBriefRevision`.

Phase 4 changes one coherent capability at the TrialEntry boundary. It does
not split the switch into flags and it does not modify routing during Phase 3C.
