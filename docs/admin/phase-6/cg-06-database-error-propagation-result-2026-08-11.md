# Phase 6G cg-06 result: database error propagation

Status: COMPLETE

## Finding and root cause

Finding `finding-c94e4c6dd19f957eeb40` was an ERROR in the Code / Integration Reviewer review. Database configuration failures bypassed the safe error-propagation path because pool construction happened outside the protected execution boundary in the database CLI scripts.

The affected surface is Factory persistence operational tooling: `db-migrate`, `db-status`, `db-verify`, and `db-smoke`. This is not a customer-generated website database correction.

## Reproduction and correction

Before the correction, running the scripts in an isolated directory without `DATABASE_URL` exited with status 1 but emitted a raw stack trace from `scripts/db-common.mjs`, before the script-specific safe handler could run. A malformed pool URL could likewise expose a raw constructor `TypeError`.

After the correction, pool construction is inside the protected path and cleanup runs only when a pool exists. `DATABASE_CONFIGURATION_MISSING` is preserved by the shared normalizer, and `db-smoke` normalizes constructor/provider failures through `safeDatabaseCode`.

| Case | Before | After |
| --- | --- | --- |
| Valid configured database | Existing success behavior | Unchanged |
| Missing `DATABASE_URL` | Raw stack trace | `DATABASE_CONFIGURATION_MISSING`, exit 1 |
| Malformed pool URL | Raw constructor error possible | `DATABASE_CONNECTION_FAILED`, exit 1 |

No schema, migration, or database data change was made. The failure path does not report success and does not run cleanup against a pool that was never created.

The machine group contract does not represent a `rollbackCriteria` field. The bounded correction is reversible by reverting commit `be84301` if a later validated regression requires it.

## Files and verification

Changed production scripts: `scripts/db-common.mjs`, `scripts/db-migrate.mjs`, `scripts/db-status.mjs`, `scripts/db-verify.mjs`, and `scripts/db-smoke.ts`. Added `src/persistence/database/db-script-error-propagation.test.ts` for the required isolated regressions. Updated `scripts/phase-6c-cg02-verification.ts` with the approved cg-06 verification contract and evidence slices.

Targeted database-script tests passed: 5/5. Full validation passed: build, typecheck, 68 test files and 828 tests, migration validation, database status, database verification, migration integrity, Docker Compose config, taskgraph smoke, diff check, and `npm audit --audit-level=high`. Lint passed with the three known pre-existing unused-variable warnings.

The required Code / Integration Reviewer recheck is valid and APPROVED after two implementation cycles. Verification artifact: `cg-06-database-error-propagation-verification-2026-08-11.json`.

Production correction commit: `be84301` (`fix: preserve database configuration error semantics`).

## Phase state

The resolved finding leaves 17 correction-ready findings: 0 CRITICAL, 5 ERROR, 11 WARNING, and 1 INFO. Newly unblocked groups are `cg-07-runtime-cleanup-lifecycle` and `cg-15-persistence-migration-evidence`; the next recommended group is `cg-07-runtime-cleanup-lifecycle`. No next group was started in this closure.
