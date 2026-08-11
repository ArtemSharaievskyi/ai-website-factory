# Phase 7B — R2-G2 Revision 3 Reconciliation Plan

Status: **READY_FOR_ONE_NEW_CORRECTION_CYCLE**

This is a planning and reconciliation artifact only. Revision 3 is **not implemented in this run**. The existing dirty Revision 2 candidate remains untouched and must be preserved byte-for-byte until a separately authorized implementation cycle.

## 1. Current state and decision

| Item | State |
|---|---|
| Baseline/reconciliation HEAD | `82f0487803b817b11089f714fc4f6ab14bff9e60` (`82f0487`) |
| Phase 6 | COMPLETE; 0 findings |
| Phase 7A | COMPLETE |
| R2-G1 | COMPLETE; `7b-sec-001` resolved; Architecture and Security approved |
| R2-G2 Revision 2 | BLOCKED after its one implementation cycle |
| R2-G3 | NOT EXECUTED; independent active findings remain |
| Phase 7B | BLOCKED |
| New authorization | One bounded R2-G2 Revision 3 implementation cycle, future only |
| Current run implementation | None |
| Fresh GPT calls in this reconciliation | 0 |
| Next action | `R2-G2 REVISION 3 — EXECUTE TRANSPORT-SAFE EXTERNAL RESULT BOUNDARY` |

Revision 2 had Security **APPROVED**, Code/Integration **CHANGES_REQUIRED**, and Test/Quality **CHANGES_REQUIRED**. Its generic string boundary and redaction behavior are retained; its adapter bridge and missing integration-specific oversize evidence are the blockers.

## 2. Dirty candidate preservation

The preflight classification found no unexpected dirty path.

| Classification | Count | Disposition |
|---|---:|---|
| `R2_G2_FAILED_CANDIDATE` | 14 | Preserve exactly; do not stage or edit in this run |
| `R2_G2_RESULT_ARTIFACT` | 4 | Preserve as historical/admin evidence; do not rewrite |
| `KNOWN_TRANSIENT` | 1 directory | `.context7-cache/`; leave untracked and unstaged |
| `UNRELATED_UNEXPECTED` | 0 | No stop condition |

Candidate files and starting SHA-256 values:

| File | Role | Starting SHA-256 |
|---|---|---|
| `src/integrations/codebase-memory/codebase-memory.test.ts` | test | `1655e6a1a00e23c2ef74f42f61d7e564ac7bab2c681ffd3c469ad347c408421a` |
| `src/integrations/codebase-memory/service.ts` | production | `23c792483dd9bd617276593c3d44fd3c80d2ad7e1b9aef3fc006491993aaf4b7` |
| `src/integrations/codebase-memory/transport.ts` | production | `0072ec2a3a0debe60a45f479cb70a19c8bce88548e98168931f7ad5f873e4e53` |
| `src/integrations/context7/context7.test.ts` | test | `08251e810de07be9958ee20a23fce7ad0cb3dc4384a21e3c33f375cfa3345fc7` |
| `src/integrations/context7/contracts.ts` | production | `af8442cd5368902188779d478dad5f78c7dcea1e727c7873ad26ae52b5bab238` |
| `src/integrations/context7/normalize.ts` | production | `c683488ec7c3275c749790cd085f98aa01295efbe81749f0d3ab52db1b5dd10d` |
| `src/integrations/context7/service.ts` | production | `a1d78e068129ccc7a4d04ece9f329c45746cc4f46ab80bd61a1fe0c116135f59` |
| `src/integrations/shadcn/contracts.ts` | production | `d0fb0a5d72cf7cc7fcea4557f012353d140325bea50c0aa374519b2d82403355` |
| `src/integrations/shadcn/server.ts` | production | `681e9f97b84c6cadf93754ce4d47600325f35368899a3c4c28bfd125336ee5f6` |
| `src/integrations/shadcn/service.ts` | production | `ddf416b08a56b5c3964294c5be24ef2cf8c22d10a3f8bd4db7e3936d0df71069` |
| `src/integrations/shadcn/shadcn-registry.test.ts` | test | `135cf8f744e9cb531719d74a1b65e10ff0dfcdbf7a958104072b390b405400e7` |
| `src/orchestration/tooling/adapters.ts` | production | `4d150b8eb6d02b90c5996cc52e4e42b8dfcfa996bf30ea14f2ce4bfaa7c523e7` |
| `src/orchestration/tooling/executors.ts` | production | `11f9f8660b60a28e0f012c674669b4b94378097cf3d904bb5e52dda750d4a3b5` |
| `src/orchestration/tooling/tooling.test.ts` | test | `90209e0a13f978268f62678e124317fb7b71f80a9ea95760af09fc115a9d51b8` |

The `.qa-foundation-*` historical directories are not cleanup targets. The candidate must not be reset, restored, checked out, stashed, cleaned, discarded, or rewritten during this reconciliation.

## 3. Findings and blocker analysis

| Finding | Reviewer | Severity | State | Exact blocker |
|---|---|---|---|---|
| `7b-sec-002` / `r2-g2-002` | Code/Integration | ERROR | VALID_ACTIVE_BLOCKING | `adapters.ts` calls `JSON.stringify` on executor output before the generic serialized-text boundary; live getter/Proxy/cyclic traversal remains possible. |
| `7b-sec-004` / `r2-g2-tq-001` | Test/Quality | WARNING in result, ERROR in reviewer verification | VALID_ACTIVE_BLOCKING | Context7, shadcn, and Codebase Memory lack meaningful integration-specific oversized-response assertions proving rejection before parse/normalization and side effects. |

Security approved Revision 2. The earlier `7b-sec-001` host-context authenticity finding is resolved by R2-G1 and is not reopened. No authority, dependency scope, file scope, content-trust, or cache-ownership regression was found.

Root cause confidence is **HIGH**: Revision 2 successfully made `registeredOutputToToolResult` require a string and check UTF-8 size before `JSON.parse`, but the exported bound-operation dispatcher still contains this earlier bridge:

```text
executor result -> JSON.stringify(value) -> registeredOutputToToolResult(string)
```

The correction must make the boundary:

```text
host serialized executor -> primitive string -> UTF-8 bound -> JSON.parse -> schema/redaction -> ToolResult
```

The official/current integration transport paths do not expose arbitrary live network objects under the candidate contracts. The remaining limited reachability is the exported internal `executeBoundToolOperation` API, which accepts a caller-supplied executor at runtime and currently serializes its return value.

## 4. Complete `JSON.stringify` inventory

| Location | Origin/trust layer | Reachability and earliest boundary | Revision 3 decision |
|---|---|---|---|
| `adapters.ts:36` | caller-supplied executor result; host boundary before inert check | Limited production-reachable internal API; currently before string rejection | **REMOVE** from generic adapter path; executor returns `Promise<string>` directly |
| `executors.ts:45` | bounded `JSON.parse` result; adapter-validated inert JSON | After serialized UTF-8 check and parse | **KEEP** for redaction/data shaping |
| `executors.ts:52` | redacted data envelope made from inert parsed JSON | After generic boundary | **KEEP** as defense-in-depth |
| `codebase-memory/transport.ts:13` | host-created JSON-RPC request | Outbound host input, not an external result | **KEEP** |
| `codebase-memory/transport.ts:18` | `value.result` from bounded child stdout `JSON.parse` | After line bound and parse; not arbitrary caller Proxy | **KEEP** bounded re-encoding; test its line guard |
| `context7/service.ts:23` | validated host query plan | Idempotency key, not external result | **KEEP** |
| `context7/service.ts:55` | synthetic host fixture | Test/smoke only | **KEEP** |
| `context7/cache.ts:8,10` | query plan and normalized result | Cache key/write after normalization | **KEEP**; raw transport is never cached |
| `shadcn/service.ts:25` | validated plan/design metadata | Idempotency key, not external result | **KEEP** |
| `shadcn/service.ts:31` | synthetic host fixture | Test/smoke only | **KEEP** |
| `shadcn/normalize.ts:13` | explicit normalized DTO fields | After extraction and bounds | **KEEP** |
| `shadcn/cache.ts:5,10` | validated plan and normalized result | Cache key/write after normalization | **KEEP** |
| `codebase-memory/service.ts:137` | validated query plan | Idempotency key, not external result | **KEEP** |
| `codebase-memory/policy.ts:22` | host-derived file manifest | Manifest checksum, not external result | **KEEP** |
| `codebase-memory/metadata.ts:112` | validated persisted metadata | Persistence after validation; outside candidate | **KEEP** |
| `tooling/authority.ts:46-47` | host-authorized request input | Host input-size/URL policy, not external result | **KEEP**; unrelated to R2-G2 |
| `tooling.test.ts:38` | test fixture | Test only | **KEEP/adjust fixture** |
| `context7.test.ts:13` | test fixture | Test only | **KEEP/add oversize fixture** |
| `shadcn-registry.test.ts:15` | test fixture | Test only | **KEEP/add oversize fixture** |
| `codebase-memory.test.ts:15,27` | test fixture and test metadata | Test only | **KEEP/add service/process oversize proof** |

No production `response.json()` remains in the cited shadcn path. Context7 has no concrete HTTP client in this repository; it has an injected serialized transport and synthetic smoke transport. Codebase Memory's result re-encoding is classified separately because its input is already the bounded child-process JSON parse result.

## 5. Per-integration boundary and policy

| Integration | Raw source and representation | Earliest size/parse boundary | Revision 3 proof/action |
|---|---|---|---|
| Context7 | Injected `Context7Transport` serialized JSON text; no concrete HTTP implementation in repo | `CONTEXT7_RAW_RESPONSE_MAX_BYTES` = 200,000 UTF-8 bytes, then `JSON.parse`, then normalizer/schema | Keep current production boundary; add service-path over-limit test before normalizer/cache/ToolResult |
| shadcn | Official allowlisted `fetch` → `response.text()` and serialized custom transport | `SHADCN_RAW_RESPONSE_MAX_BYTES` = 200,000 UTF-8 bytes, then parse, normalize, schema | Keep current production boundary; add service-path over-limit test before normalizer/cache/ToolResult |
| Codebase Memory | Bounded child-process newline JSON-RPC plus serialized injected upstream transport | Line/result UTF-8 guards at 200,000 bytes; parse before normalization; bounded result re-encoding | Keep current production boundary; add service injected-result test and process-line test if existing harness supports it |

All three flows remain read-only. Normalized caches contain only bounded DTOs, not raw response text. Raw content remains supplemental, untrusted, redacted where applicable, and unable to modify authority or scope.

## 6. Size and context limits

| Layer | Limit | Meaning |
|---|---:|---|
| Context7 raw transport | 200,000 UTF-8 bytes | Reject before parse/normalization |
| shadcn raw transport | 200,000 UTF-8 bytes | Reject before parse/normalization |
| Codebase Memory raw line/result | 200,000 UTF-8 bytes | Reject before parse/normalization |
| Generic serialized result | 200,000 UTF-8 bytes | Defense-in-depth before `JSON.parse` |
| `ToolResult` data/text | 16,000 UTF-8 bytes | Local model-facing context/output bound; truncation/redaction remains downstream |
| Provider/model context | Provider-specific | Downstream prompt budget; not a transport allowance and not a reason to raise raw limits |

The order is: bounded text read, reject over-limit text, parse, normalize/schema-validate, cache normalized DTO, then generic serialized ToolResult conversion. Oversize failures must happen before cache/persistence, model prompt assembly, and authority decisions.

## 7. Exact Revision 3 correction scope

Production scope:

- `src/orchestration/tooling/adapters.ts`: remove `serializeHostNormalizedResult`; narrow bound host executor operations to return primitive serialized JSON text and pass that text directly to `registeredOutputToToolResult`. Keep operation discriminants, executor identities, authorization sequencing, and typed agent/domain ports intact.
- `src/orchestration/tooling/executors.ts`: preserve the current string-only runtime check, 200,000-byte pre-parse check, redaction, schemas, provenance, and 16,000-byte ToolResult bound. Modify only if needed to align the narrowed binding type.
- `src/integrations/context7/normalize.ts`, `context7/service.ts`: preserve the existing parser and normalizer; expose/use the existing limit only if needed to make the test deterministic.
- `src/integrations/shadcn/service.ts`: preserve response-text parsing and official registry policy; expose/use the existing limit only if needed for the test.
- `src/integrations/codebase-memory/transport.ts`, `service.ts`: preserve bounded process line/result parsing and normalized service behavior; make only the smallest testability adjustment if required.

Test scope:

- `tooling.test.ts`: hostile getter, Proxy, `toJSON`, iterator, and cyclic executor-return tests must show zero protected traps before failure; valid serialized binding must still produce `UNTRUSTED_EXTERNAL` ToolResult with redaction/provenance.
- `context7.test.ts`: 200,001-byte serialized transport fails before normalization/cache/conversion; positive normalized result remains valid.
- `shadcn-registry.test.ts`: 200,001-byte serialized transport fails before parse/normalization/schema/cache/conversion; official allowlist behavior remains valid.
- `codebase-memory.test.ts`: 200,001-byte injected result fails before service normalization/cache/persistence; exercise the existing child-process line guard if the current harness supports it without a new framework.

No production caller was found for `executeBoundToolOperation`. Therefore the plan does not invent a new runtime wiring file. If implementation discovers a real caller, its binding must return serialized text from an integration-owned, schema-normalized boundary; a generic unknown-to-string bridge in `adapters.ts` is prohibited.

## 8. Pre/post proof and deterministic checks

Before implementation, recapture all 14 candidate SHA-256 values and abort on any unexpected dirty path. After implementation, prove:

- no candidate file was changed before the future implementation cycle begins;
- no `executeBoundToolOperation` path calls `JSON.stringify` on caller-supplied output;
- object/Proxy/getter/`toJSON`/iterator/cycle inputs fail without protected traps;
- Context7, shadcn, and Codebase Memory oversize inputs fail before parse/normalization/cache/persistence;
- malformed and schema-invalid serialized text fails closed;
- positive results retain `UNTRUSTED_EXTERNAL`, host-owned `evidenceIdentity`, redaction, output bounds, and supplemental prompt placement;
- existing allowlists, schema/content/path/dependency/workspace/currentness/cache/retry/cancellation behavior passes;
- source/evidence checksums are current before reviewers.

The future implementation cycle must run JSON validation, `git diff --check`, focused tests, repository-required lint/typecheck/full deterministic gates, and the required reviewer evidence checks. This reconciliation run performs no executable test or source validation beyond admin-artifact validation and diff checks.

## 9. Reviewer re-run plan

| Reviewer | Future status | Reason |
|---|---|---|
| Code/Integration | REQUIRED | Host binding and transport boundary behavior materially changes |
| Test/Quality | REQUIRED | New semantic oversize and hostile-object proof is required |
| Security | REQUIRED | The live-object/accessor boundary materially changes and security closure must be re-established |
| Contract Auditor | REQUIRED | `BoundToolOperation` changes from typed DTO-returning executors to serialized-text-returning host bindings; cross-artifact traceability must be checked |
| Architecture | NOT REQUIRED unless escalated | Canonical authority, agents, lifecycle, and persisted architecture do not change |

These are future reviewer calls after implementation, not calls made in this reconciliation. If implementation changes a canonical domain contract or authority model, Architecture and/or Contract scope must be reconsidered before review.

## 10. Budget, rollback, and status transition

| Control | Decision |
|---|---|
| New correction budget | Exactly 1 bounded Revision 3 implementation cycle |
| Automatic retry | No |
| Current run implementation | 0 files |
| Rollback trigger | Any live traversal before primitive rejection, post-parse oversize guard, cache/persistence side effect, authority/trust regression, or scope expansion |
| Success transition | Deterministic gates pass, required reviewers approve, R2-G2 COMPLETE |
| Failure transition | Any required reviewer blocks or evidence is stale; R2-G2 remains BLOCKED and candidate is preserved |
| R2-G3 | Remains NOT EXECUTED and independently active |

## 11. Artifacts and commit scope

This run creates:

- `docs/admin/phase-7b/r2-g2-revision-3-plan-2026-08-11.json`
- `docs/admin/phase-7b/r2-g2-revision-3-plan-2026-08-11.md`

The existing `phase-7b-revision-2-state-2026-08-11.json` is updated only as a successor pointer to `R2-G2 BLOCKED — REVISION 3 READY`; historical Revision 2 result/reviewer artifacts remain unchanged. Only these plan/state artifacts are eligible for staging and commit. The 14 source/test candidate files, `.context7-cache/`, `.qa-foundation-*`, customer projects, and prior result artifacts are not staged.

Expected end-state:

```text
PHASE 7B REVISION 2 / R2-G2.2: RECONCILIATION COMPLETE
R2-G2: BLOCKED — REVISION 3 CORRECTION READY
NEXT: R2-G2 REVISION 3 — EXECUTE TRANSPORT-SAFE EXTERNAL RESULT BOUNDARY
```
