# Phase 6N — cg-15 Persistence and Migration Evidence

Status: **COMPLETE**

Baseline: `968ae33`
Correction commit: `5cde3da` (`fix: bind migration evidence to current set`)

## Exact finding

| Finding ID | Reviewer | Severity | Category | Claim | Final state |
|---|---|---:|---|---|---|
| `finding-cec06a12d17a2b103135` | Test / Quality Reviewer | ERROR | `DATA_FLOW_NOT_VERIFIED` | Persistence and migration assertions were defined but not evidenced as executed. | RESOLVED |

Root cause: **Make migration and persistence checks demonstrably executed and bound to the current source state.** Confidence: **HIGH**.

Dependency `cg-06-database-error-propagation` is complete. Migration domain: **FACTORY_PERSISTENCE**. No generated-project or customer database migration was performed.

## Migration evidence model

| Stage | Required? | Evidence | Candidate-bound? | Currentness rule |
|---|---:|---|---:|---|
| Canonical migration requirement | Yes | Ordered non-empty `supabase/migrations` manifest plus `factory_schema_migrations` | Factory repository/database boundary | Empty set fails closed |
| Migration artifact | Yes | Filename plus SHA-256 content checksum for both migrations | Yes, through ordered manifest | Same filename with changed SQL changes set identity |
| Migration set identity | Yes | `12f468133347ad10a8820c58e6662d25560ea2f66f890ba952707b0fc832413f` | Yes | Added/removed/reordered/changed migration invalidates old set evidence |
| Migration execution | Yes | `db:migrate` JSON result; both rows already applied with matching checksums | Factory persistence only | History/checksum mismatch fails closed |
| Schema verification | Yes | `db:verify` matches current manifest; 17 tables, 17/17 RLS, 0 public policies | Yes, by same set checksum | Schema proof without current history is insufficient |
| Persistence assertions | Yes | `db:smoke` run `459cfdb8-3d54-4bba-adfb-a852b37f0463`, 8 assertions, cleanup passed | Factory persistence only | Smoke result does not authorize release by itself |
| Release evidence | Bounded interaction | Recorded artifact consumed as supporting evidence | No independent authority | cg-14 remains the only `releaseEligible` authority |

## Before and after

Before cg-15, the scripts had meaningful assertions, per-file migration checksums, and schema checks, but no recorded machine result connecting their successful execution to the current source/migration set. `db:migrate` printed `already applied`, `db:verify` printed schema counts, and `db:smoke` printed `SMOKE_OK`.

After cg-15:

- `db:migrate` emits ordered migration checksums, set checksum, execution status, and transaction status.
- `db:verify` requires the database history to exactly match the current ordered manifest before reporting schema success.
- `db:smoke` emits a Factory-bound smoke run ID, migration-set checksum, eight passed assertions, cleanup status, and `customerDatabaseMutation: false`.
- Empty Factory migration sets, checksum drift, stale history, incomplete history, failed transactions, and schema verification failures fail closed.

## Migration state table

| Scenario | Requirement satisfied? | Release contribution | Reason | Proof |
|---|---:|---|---|---|
| Current ordered set executed and verified | Yes | Supporting evidence only | History, checksums, schema, RLS, and persistence smoke agree | `cg-15-database-execution-results-2026-08-11.json` |
| Required migration missing | No | None | `db:validate`, `db:migrate`, and `db:verify` fail closed for empty Factory set | `MIGRATION_SET_EMPTY` behavior |
| Artifact valid but not executed | No | None | Artifact existence is not execution proof | No matching history row |
| Execution failed | No | None | Transaction rolls back; no success evidence emitted | Existing `BEGIN`/`ROLLBACK` path |
| Partial migration set | No | None | Exact ordered history/manifest comparison fails | `migrationHistoryMatches` |
| Execution passed but schema invalid | No | None | Schema, RLS, and policy checks remain mandatory | `db:verify` |
| Same filename, changed SQL | No reuse | None | Per-file checksum and set checksum change | Migration identity test |
| New migration added | No reuse | None | Set checksum and completeness change | Migration identity test |
| No-migration-required | Not applicable | None | Factory persistence requires its migration set; generated-project semantics are separate | Explicit fail-closed guard |

## Currentness table

| Change | Old evidence reusable? | Before | After | Proof |
|---|---:|---|---|---|
| Migration SQL content changes under same filename | No | Filename/history could not be represented as a recorded set result | Per-file checksum and set checksum mismatch | `migration-evidence.test.ts` |
| New migration added | No | No set-level completeness artifact | Ordered set checksum changes; old history fails | `migration-evidence.test.ts` |
| Factory schema verification without current history | No | Schema counts alone could pass | `db:verify` requires current history first | `db-verify.mjs` |
| Unrelated admin or Context7 cache change | Yes | Not part of migration manifest | Set checksum unchanged | Manifest scope is migration SQL only |

## Execution and environment semantics

The live command run was against the configured Factory persistence database boundary. It was not represented as customer production execution. The persistence smoke used disposable Factory rows and cleaned them up. No customer/generated database, deployment, hosting, DNS, or production Supabase push occurred.

Factory schema change: **No**. Generated schema fixture change: **No**. New Factory migration: **No**. Historical applied migration edited: **No**.

Migration evidence cannot independently set `releaseEligible`; it is supporting evidence only and remains subordinate to cg-14’s canonical release evaluator.

## Required reviewer recheck

| Reviewer | Verdict | Structured output | Evidence validation | Fresh provider calls |
|---|---|---:|---:|---:|
| Test / Quality Reviewer | APPROVED / RESOLVED | PASS | PASS | 1 |

The recheck used the existing cg-13-compatible shared verifier, bounded current source slices, and one resolver-selected reviewer skill context. No other reviewer was called.

## Validation

| Check | Result |
|---|---|
| cg-15 reproduction | PASS; prior command outputs had no machine evidence artifact; corrected outputs now bind execution and schema checks to the set checksum |
| Migration identity regression | PASS; 1 test for changed content and added migration invalidation |
| Database error propagation | PASS; 5 tests |
| `npm run db:validate` | PASS; 2 migrations |
| `npm run db:migrate` | PASS; both migrations already applied with matching checksums |
| `npm run db:status` | PASS |
| `npm run db:verify` | PASS; 17 tables, 84 constraints, 4 indexes, RLS 17/17, public policies 0 |
| `npm run db:smoke` | PASS; 8 assertions, cleanup passed |
| `npm run db:test-integrity` | PASS |
| `npm run lint` | PASS; 3 known pre-existing warnings |
| `npm run typecheck` | PASS |
| `npm test` | PASS; 70 files, 840 tests |
| `npm run build` | PASS |
| `npm audit --audit-level=high` | PASS; 0 vulnerabilities |
| `npm run test:reviewers` | PASS; 75 tests across 7 files |
| `docker compose config` | PASS |
| `npm run taskgraph:smoke` | PASS; `releaseEligible=true` |
| `git diff --check` | PASS |

## State and invariants

The latest cg-14 machine state reported pre-cg-15 counts as total 7 / CRITICAL 0 / ERROR 1 / WARNING 7 / INFO 0. This is historically inconsistent because `1 + 7 != 7`; the historical cg-14 artifacts were not rewritten. The exact Phase 6A active finding set contains one cg-15 ERROR and six remaining WARNINGs. After resolving cg-15, the derived counts are:

`TOTAL 6 = CRITICAL 0 + ERROR 0 + WARNING 6 + INFO 0` — arithmetic valid.

The next recommended group from the updated order/dependency DAG is `cg-16-implementation-error-recovery-evidence`. No other correction group was modified or auto-resolved.

QA foundation directories: **15 before / 15 after**. Historical QA directories were not cleaned. `.context7-cache/` remains untracked and unstaged. Invariants remain: 4 approved external skills, 13 approved internal skills, 17 unique approved artifacts, 18 assignments, 9 agents, 0 deferred skill usage.

Artifacts: [machine result](cg-15-persistence-migration-evidence-result-2026-08-11.json), [execution evidence](cg-15-database-execution-results-2026-08-11.json), [review verification](cg-15-persistence-migration-evidence-verification-2026-08-11.json), and [successor state](phase-6-execution-state-2026-08-11-cg15-result.json).
