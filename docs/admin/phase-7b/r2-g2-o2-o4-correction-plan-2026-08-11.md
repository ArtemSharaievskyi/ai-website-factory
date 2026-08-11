# Phase 7B — R2-G2 O2/O4 Frozen Obligation Reconciliation

Status: **FROZEN_O2_O4_CORRECTION_READY**
Execution in this turn: **none**
Baseline HEAD: `38ac6e5`
Machine plan: [`r2-g2-o2-o4-correction-plan-2026-08-11.json`](./r2-g2-o2-o4-correction-plan-2026-08-11.json)

## Decision

The frozen seven-obligation contract remains unchanged. O1, O3, O5, O6, and O7 remain frozen PASS. Only O2 and O4 are active correction targets. R2-G2 remains blocked, R2-G3 remains not executed, and no source, test, reviewer, or correction action was performed in this reconciliation.

The exact inherited candidate is `r2-g2.5-candidate-2026-08-11`, with 16 files and aggregate SHA-256 `81b59dce2a78da2317759f0d6258e57bce650637803999de0a53a022cd342a97`. Its byte identity is preserved. The inherited source/test candidate remains uncommitted and is not part of this plan commit.

## Frozen contract disposition

| Obligation | Disposition | Action in this plan |
|---|---|---|
| O1 — inert serialized external result | PASS, frozen | Regression guard only |
| O2 — integration raw-result bound | FAILED, active | One Codebase Memory service-boundary correction |
| O3 — child trust/terminal lifecycle | PASS, frozen | Regression guard only |
| O4 — redacted untrusted persistence | FAILED, active | One Codebase Memory persistence-redaction correction |
| O5 — cancellation isolation | PASS, frozen | Regression guard only |
| O6 — UTF-8-safe normalization | PASS, frozen | Regression guard only |
| O7 — composed closure evidence | PASS, frozen | Regression guard only |

No O8 or O9 exists in the contract.

## O2 — exact root cause and correction

The production path is:

`codebase-memory-read:ensure-index` → `executeBoundToolOperation` → `CodebaseMemoryService.ensureIndex` → `index/indexInternal` → `UpstreamTransport("index_repository")` → child-process JSON-RPC transport → service completion → registered serialization.

The process transport already bounds its stdout line at 200,000 UTF-8 bytes. The service also has the canonical `CODEBASE_MEMORY_RAW_RESULT_MAX_BYTES = 200_000` authority and the shared `parseUpstreamResult` validator. Query operations use that validator before normalization, cache, and persistence.

The defect is specific and reproducible: `indexInternal` awaits the serialized `index_repository` response at `src/integrations/codebase-memory/service.ts:120`, discards it, and proceeds directly to host-built READY state and metadata persistence at lines 121–123. It therefore bypasses `parseUpstreamResult`. The downstream 200,000-byte executor prevalidation and 16,000-byte ToolResult policy cannot repair this upstream service-boundary gap.

The single future correction will retain the serialized response and invoke the existing validator before READY construction or publication. The bounded-result rejection must propagate as the existing `CODEBASE_MEMORY_UNAVAILABLE` error before the failure-persistence branch can publish an index state. Ordinary transport failures retain their existing failure handling. No second size authority or transport redesign is authorized.

The future test must use a direct service `index_repository` transport fixture whose serialized JSON exceeds the existing byte bound. Before correction, the frozen implementation reaches READY; after correction, it must reject, leave metadata unchanged, emit no READY continuation, and reach no downstream result. A bounded valid result remains a positive control.

## O4 — exact root cause and correction

Codebase Memory persists metadata through `writeCodebaseMemoryMetadata` at:

`.codebase-memory/<workspace-identity-hash>/codebase-memory.json`

The unsafe boundary is the `cache[].result` value assembled in `persistStateSnapshot` immediately before that write. `redactPersistedResult` currently redacts only `excerpts[].text` with the existing `redactToolText` authority and recomputes excerpt bytes/checksum/totalBytes. Symbols and relationships are passed through unchanged.

Externally sourced textual fields that can currently reach persistence include symbol name/label/file/signature and relationship source/target, plus nested source-location text where present. Excerpt text is already covered. Host-controlled IDs, enums, timestamps, checksums, line/byte counts, workspace/index metadata, and host-generated provenance remain technical metadata and must not be indiscriminately redacted.

The single future correction will expand the existing `redactPersistedResult` boundary to sanitize every externally sourced string field in persisted symbol and relationship data, including nested locations when present, while retaining the current excerpt handling and schema validation. It will reuse `redactToolText`; it will not add a second redaction engine. The future test will assert that synthetic markers do not reach the metadata file or restart/cache-hit result, while ordinary safe symbol, relationship, file, signature, and excerpt values remain available.

## Authorized future correction scope

| Role | Path |
|---|---|
| Shared mutable production file | `src/integrations/codebase-memory/service.ts` |
| Shared mutable test file | `src/integrations/codebase-memory/codebase-memory.test.ts` |
| Immutable regression guards | Existing Codebase Memory transport, Context7, shadcn, and tooling files in the machine plan |

The plan authorizes no new files during correction, no dependency changes, no agent/skill/MCP changes, and no generic tooling or transport redesign.

## Future execution and evidence

Exactly one future correction cycle is authorized: reproduce O2/O4, apply one coherent service/test correction, run O2/O4 plus all frozen regression guards, run typecheck/lint/build/diff check, freeze a new candidate and evidence-pack identity, and rerun all four required reviewers on that same new identity. Architecture review is not required unless the correction changes architecture.

The old candidate checksum must never be reused after source/test correction. A new candidate ID, per-file hashes, aggregate checksum, and shared evidence-pack identity are mandatory. A regression in any frozen PASS obligation blocks acceptance; it is not waived and does not create a new obligation.

## State and next action

| State | Value |
|---|---|
| Phase 7B | BLOCKED |
| R2-G2 | BLOCKED — FROZEN O2/O4 CORRECTION READY |
| R2-G3 | NOT EXECUTED |
| Next action | `R2-G2 FROZEN O2/O4 CORRECTION — EXECUTE` |
| Fresh GPT calls in this reconciliation | 0 |

The state pointer is updated separately in `phase-7b-revision-2-state-2026-08-11.json`; historical verification artifacts and inherited candidate files remain untouched.

## Reconciliation gates

| Gate | This reconciliation |
|---|---|
| Authoritative contract and verification loaded | PASS |
| Exact 16-file frozen candidate preserved | PASS |
| Source/test candidate mutation | NO |
| Correction execution | NOT RUN |
| Focused tests | NOT RUN |
| Typecheck/lint/build | NOT RUN |
| Semantic reviewers | NOT RUN |
| Plan JSON parse | REQUIRED before commit |
| `git diff --check` | REQUIRED before commit |

This is a plan-only handoff. It does not claim R2-G2 closure.
