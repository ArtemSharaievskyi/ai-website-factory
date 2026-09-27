# Phase 7C recovery regression

This repository-owned regression exercises the Contract Audit recovery boundary through the supported standalone Workbench process and a disposable PostgreSQL database. It uses only synthetic identities and synthetic documents.

## Command

Prerequisites:

1. Docker Desktop or another disposable PostgreSQL 16 instance is available on loopback.
2. The repository has a provenance-bound production build (`npm run build`).
3. The isolated database has the current migrations (`npm run db:migrate`, `npm run db:status`, and `npm run db:verify`) and is reachable through a loopback-only `PHASE7C_ISOLATED_DATABASE_URL`.

PowerShell example:

```powershell
$env:PHASE7C_CONFIRM_ISOLATED = "true"
$env:PHASE7C_ISOLATED_DATABASE_URL = "postgresql://synthetic:synthetic@127.0.0.1:55432/factory_phase7c"
npm run phase7c:recovery:standalone
```

The runner refuses a non-loopback database, requires the explicit isolation confirmation, launches `npm run start` through the supported standalone launcher, and discards no production data. After the run, destroy the disposable PostgreSQL database/container as cleanup. The runner creates no repository files and places generated-runtime scratch output under the operating-system temporary directory.

## Covered sequence and boundaries

The runner seeds a synthetic `CONTRACT_AUDIT` project through the repository persistence adapter. The fixture contains a stale TaskGraph criterion and a `CHANGES_REQUIRED` Contract Audit. It then performs actual HTTP requests in this order:

1. read-only status;
2. `CORRECT_CONTRACT_AUDIT` (provider-free);
3. read-only status;
4. `REASSESS_CONTRACT_AUDIT` (one synthetic Contract Audit response);
5. `APPROVE_PHASE7C` (provider-free);
6. read-only status and independent PostgreSQL document readback.

The positive readback intentionally expects `selected-design` to be present,
Phase 7C to be `APPROVED`, and `START_IMPLEMENTATION` to be the next action.
The pre-selection `design-directions` document is absent after selection; that
absence does not mean Design selection is absent. Phase 7C and the
implementation gate bind to the selected-design document checksum and its
upstream bindings.

Only the external AI transport is intercepted. The test-only preload returns a strict Chat Completions wire envelope with `verdict`, `findings`, `reviewedArtifactRefs`, and `blockedReason`; it does not call an AI or image provider and never receives customer content. The installed OpenAI SDK and the production strict Zod contract still parse the envelope. The runner stops at the `START_IMPLEMENTATION` pending action and never dispatches it.

The permanent SDK contract fixture is `src/integrations/openai/contract-audit-transport.test.ts`. It also proves that the host-owned `policyVersion` field is rejected by the installed SDK parser. The existing in-memory serialized-route regression remains in `src/runtime/workbench/phase7c-http-recovery.test.ts`.

That route regression also covers two invalid approval frontiers: a missing
`selected-design` document and a selected-design checksum that no longer
matches the Phase 7C/audit frontier. Both are rejected through the public
Workbench action, leave Phase 7C pending, do not expose
`START_IMPLEMENTATION`, and add no provider call beyond the one used to prepare
the valid audit fixture. The stale-binding rejection
is surfaced as the typed `PLANNING_ACCEPTANCE_STALE` validation response with
the bounded `Phase7CContractError` class. The tests use repository fixtures
only; they do not mutate a customer project or call an external provider.
