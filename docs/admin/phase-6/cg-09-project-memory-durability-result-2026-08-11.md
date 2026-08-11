# Phase 6J — cg-09 Project Memory Durability

Status: **COMPLETE**

Baseline: `ff6e090`

Correction commit: `c759a23` — `fix: persist Codebase Memory runtime state`
Exact group: `cg-09-project-memory-durability` — **Persist Project Memory indexes and idempotency state**

## Finding and dependency

| Finding ID | Reviewer | Severity | Before | Correction evidence | Reviewer verification | Final state |
|---|---|---|---|---|---|---|
| `finding-f13df5392f71f7cf58df` | architecture-reviewer | WARNING | Indexes, cache, and idempotency were process-local despite a declared metadata contract. | `src/integrations/codebase-memory/service.ts:115-199`, `metadata.ts:20-137`, 11 targeted tests | Architecture Reviewer and Code / Integration Reviewer: RESOLVED / APPROVED; evidence valid | RESOLVED |

Exact finding count: 1. Highest severity: WARNING. Dependency: `cg-05-design-durable-state-authority` — COMPLETE. No other correction group was modified or auto-resolved.

## Root cause and authority

The validated defect was not a generic missing-`fsync` defect. The service never connected its existing metadata-shaped contract to the lifecycle: READY index state, normalized query cache, and idempotency hashes existed only in process memory. A new service instance therefore returned `NOT_INDEXED` and forgot prior query identity.

| State | Canonical authority | Project Memory role | Independently writable? |
|---|---|---|---|
| Approved workflow and Design state | Existing database-backed Factory workflow authority and canonical `.factory` Project Memory projection | Durable workflow documents and controlled filesystem projection | No second authority introduced |
| Codebase Memory index metadata | Codebase Memory lifecycle for the generated project version | Factory-managed durable projection/cache under `generatedProjectsRoot/.codebase-memory/` | No; read-only structural integration |
| Codebase Memory query cache/idempotency | Codebase Memory service plus its identity-bound state record | Bounded optimization and replay/conflict state | No canonical workflow authority |

Project Memory remains canonical for what the Factory decided to build. Codebase Memory remains supplemental, read-only structural intelligence. No database migration or cross-system transaction was added.

## Reproduction

Before correction, a deterministic fixture called `ensureIndex()` on one `CodebaseMemoryService`, created a second service over the same workspace, and called `getIndexStatus()`. Result:

```json
{"beforeRestart":"READY","afterRestart":"NOT_INDEXED","defect":true}
```

After correction, the same boundary returns `READY`; a repeated query is a cache hit, and changed input under the persisted query ID returns `IDEMPOTENCY_CONFLICT`.

## Guarantees

| Property | Before | After | Deterministic proof |
|---|---|---|---|
| Authority | Metadata contract unused; runtime Maps implicitly owned state | Project Memory/database authority unchanged; Codebase Memory is a projection/cache | Architecture boundary evidence and reviewer approval |
| Atomicity | No durable publication point | One validated JSON state target is atomically replaced; same-process publications are serialized | Concurrent publication regression; reviewer approval |
| Durability | Lost on service restart | File-synced temp write, atomic replace, and supported directory sync before success acknowledgement | Restart reload regression; Windows branch is explicit |
| Integrity | In-memory state only; metadata was not read | Strict schema, index identity, project/version/workspace identity, manifest checksum, and malformed-state rejection | Corruption and identity-tamper tests |
| Recovery | Restart indistinguishable from never indexed | Missing, malformed, mismatched, stale, and temporary states have distinct behavior | Restart, corruption, identity, and staleness tests |
| Project identity | Indexes were keyed in memory only | Persisted state and directory are bound to canonical project/version/workspace identity | Cross-project tamper regression |

Atomicity, durability, integrity, and recovery are separate guarantees. Checksums prove integrity/freshness, not durability. The database and filesystem are not falsely treated as one ACID transaction.

## Write protocol

| Step | Before | After | Failure effect |
|---|---|---|---|
| Serialize | Runtime objects stayed in Maps | Strict schema plus stable recursively sorted JSON | Invalid state is rejected before publication |
| Temporary write | None | Unique same-directory `.tmp`, mode 0600 | Temp is uncommitted and removed on failure where possible |
| Flush/sync | None for Codebase Memory state | `handle.sync()` before close | Success is not reported if file sync fails |
| Metadata | Existing contract unused | Full index, cache, and idempotency state record | Previous target remains if replacement has not committed |
| Publish/rename | None | Atomic rename to `codebase-memory.json` | Readers see old complete target or new complete target |
| Directory sync | None | Sync containing directory where supported; Windows explicit no-op | Windows guarantee is file sync plus atomic replacement |
| Acknowledgement | Upstream success could return with no durable local state | Returns only after state publication | Persistence failure is `CODEBASE_MEMORY_PERSISTENCE_FAILED` |

Logical commit/publication point: atomic rename after validated, file-synced temporary state. The manifest remains the source-manifest freshness boundary; the persisted metadata file is not included in customer source indexing and is not a canonical `.factory` document.

## Read and recovery protocol

| On-disk state | Accepted as current? | Result |
|---|---|---|
| No metadata file | Yes, as absence only | `NOT_INDEXED`; explicit indexing may start |
| Valid READY record with matching manifest | Yes | READY index, restored cache, restored idempotency |
| Valid record with changed source manifest | No as query index | Durably marked STALE; refresh required |
| Uncommitted `.tmp` artifact | No | Ignored by target-path load; safe cleanup is bounded to the known temp |
| Malformed JSON/schema | No | `CODEBASE_MEMORY_METADATA_INVALID` |
| Project/version/workspace mismatch | No | `CODEBASE_MEMORY_METADATA_INVALID` |
| Failed upstream indexing | No as READY | Valid FAILED state is recorded; retry remains explicit |

Previous valid state is protected by atomic replacement if a new temporary write, sync, or rename fails. No silent corruption rewrite or hidden rollback was introduced.

## Failure/recovery evidence

| Injected failure point | Visible committed state | Recovery behavior | Proof |
|---|---|---|---|
| Service restart after READY/query | READY metadata, cache, idempotency | Reload without reindex; cache hit; conflicting input rejected | `persists index, cache, and idempotency state across service restart` |
| Malformed metadata | Prior state is not accepted as current | Typed invalid-state error, no null fallback | `rejects corrupted persisted state instead of treating it as current` |
| Project identity tamper | State is not accepted | Typed identity-bound invalid-state error | `rejects persisted state bound to another project` |
| Concurrent query publication | One complete record containing both query IDs | Per-workspace persistence queue prevents lost entries | `serializes concurrent durable state publication without losing query state` |
| Source change after READY | READY is not accepted for old checksum | State becomes STALE and query requires refresh | Existing staleness test |

Retry and upstream timeout/cancellation behavior remains bounded and unchanged. Runtime cache and idempotency maps are deterministically capped at 10,000 entries with oldest-entry eviction. Index work remains serialized per project/version.

## Changes

| File | Change | Why required for cg-09 |
|---|---|---|
| `src/integrations/codebase-memory/service.ts` | Load/persist lifecycle state; bounded maps; per-workspace persistence queue; restart and identity checks | Connects runtime state to durable metadata and prevents concurrent lost updates |
| `src/integrations/codebase-memory/metadata.ts` | Strict persisted-state schema, identity-hashed path, stable JSON, file sync, atomic replacement, supported directory sync | Establishes the durable publication and recovery boundary |
| `src/integrations/codebase-memory/errors.ts` | Typed metadata-invalid and persistence-failed errors | Preserves missing-vs-invalid-vs-persistence failure semantics |
| `src/integrations/codebase-memory/codebase-memory.test.ts` | Four deterministic durability/concurrency/identity regressions and fixture cleanup | Proves the assigned finding at the actual restart/write boundary |
| `scripts/phase-6c-cg02-verification.ts` | Adds bounded cg-09 reviewer configuration/evidence and path validation | Required Phase 6 architecture and code-integration rechecks |
| `docs/integrations/codebase-memory-index-lifecycle.md` | Records durable lifecycle and platform boundary | Documents the selected design |
| `docs/integrations/codebase-memory-security.md` | Records Factory-managed metadata location and identity checks | Documents that customer source and canonical `.factory` state are not mutated |

No Project Memory format change, no historical `.factory` migration, no database schema change, and no migration were required. Files outside the plan’s `likelyFiles` were limited to the required tests, reviewer verification infrastructure, and bounded integration/security documentation.

## Reviewer verification

Required and completed: `architecture-reviewer`, `code-integration-reviewer`.

- Architecture Reviewer: RESOLVED / APPROVED, 1 real GPT call.
- Code / Integration Reviewer: RESOLVED / APPROVED, 1 real GPT call.
- Provider: `gpt-5.6-luna`; total real GPT calls: 2.
- Selected skills: Architecture Reviewer selected `architecture-tradeoff-review`, `module-boundaries-fb20497b5c35`, and `review-maintainability-d9faf7cb9775`; Code / Integration Reviewer selected none. Catalog/skill invariants remain unchanged.
- Evidence: valid, structured output valid, invalid evidence none. See [`cg-09-project-memory-durability-verification-2026-08-11.json`](cg-09-project-memory-durability-verification-2026-08-11.json).

## Validation

| Check | Result |
|---|---|
| cg-09 reproduction before/after | PASS: READY → NOT_INDEXED before; READY after restart |
| Project Memory targeted tests | 9 passed |
| Codebase Memory targeted tests | 11 passed |
| Workspace sync targeted tests | 2 passed |
| Full tests | 69 files, 835 tests passed |
| TypeScript | PASS |
| ESLint | PASS; 3 known pre-existing warnings only |
| Build | PASS |
| npm audit | 0 vulnerabilities |
| DB validation | PASS |
| DB status | PASS; 2 migrations applied |
| DB verify | PASS; 17 tables, 84 constraints, 4 indexes, 17/17 RLS |
| DB integrity | PASS |
| Docker Compose | PASS |
| TaskGraph | PASS; `releaseEligible=true` |
| `git diff --check` | PASS |
| `.qa-foundation-*` | 14 before/after; historical cleanup: **NO** |
| `.context7-cache` committed | **NO**; transient file count after validation: 0 |
| Customer website-generation E2E | **NO**, intentionally not run |

## Phase 6 state

Before cg-09: 15 findings — 0 CRITICAL, 5 ERROR, 9 WARNING, 1 INFO.

After cg-09: 14 findings — 0 CRITICAL, 5 ERROR, 8 WARNING, 1 INFO.
Resolved: 1. Partial: 0. Still active: 0. Regression found: 0.

Newly unblocked groups: `cg-12-architecture-review-context`, `cg-15-persistence-migration-evidence`, `cg-10-design-request-isolation`, `cg-11-codebase-index-identity`, `cg-17-design-gate-evidence`. The actual next recommended group is `cg-12-architecture-review-context` because it is the highest-severity eligible group. No next group was executed.

Machine result: [`cg-09-project-memory-durability-result-2026-08-11.json`](cg-09-project-memory-durability-result-2026-08-11.json)

Successor execution state: [`phase-6-execution-state-2026-08-11-cg09-result.json`](phase-6-execution-state-2026-08-11-cg09-result.json)

## Invariants and final Git state

- Approved external skills: 4.
- Approved internal skills: 13.
- Unique approved skill artifacts: 17.
- Assignment references: 18.
- Agents: 9.
- Deferred skill usage: 0.
- Other correction groups intentionally modified: none.
- New agent/orchestrator/MCP: none.
- Final tracked worktree: clean after the separate closure commit.

PHASE 6J / cg-09: COMPLETE

NEXT: cg-12-architecture-review-context
