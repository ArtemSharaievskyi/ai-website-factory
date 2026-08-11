# R2-G2.3 Final Transport Reconciliation

Status: **RECONCILIATION COMPLETE**
R2-G2 status: **BLOCKED - FINAL TRANSPORT CLOSURE READY**
Baseline: `53806da2fd4b5ade9eaa69f562e368b277b573b5`
Future implementation budget: **exactly one cycle**

This run changed no production or test file. It reconciles the current transport semantics and Revision 3 reviewer evidence, then defines one narrow final closure plan.

## Why Revision 3 failed

Revision 3 removed live-result serialization from `executeBoundToolOperation` and added service-path oversized tests for Context7 and shadcn. Its Codebase Memory oversized test injected a serialized string directly into `CodebaseMemoryService`, so it did not exercise the actual `CodebaseMemoryProcessTransport`.

The process transport still performs `JSON.parse(raw)` followed by `JSON.stringify(value.result)`. That reserialization is real, but the reviewer description of it as traversal of an attacker-supplied live Proxy/getter is too broad for the actual production path: `value` is created exclusively by standard `JSON.parse` without a reviver. The valid remaining defect is the late result-specific contract, incomplete overflow cleanup, and missing production-path evidence.

## Revision 3 reviewer findings

| Reviewer | Finding | Severity | Exact claim | Current classification | Final action |
| --- | --- | --- | --- | --- | --- |
| Code / Integration | `r3-r2-g2-001` | ERROR | Process transport reserializes a live parsed external result; generic serialization was relocated | Partially valid; executable-object wording overstated | Keep parser-created input explicitly inert; correct stdout overflow lifecycle and add process-path proof |
| Test / Quality | `7b-sec-004-codebase-transport` | ERROR | Oversized regression bypasses production process transport | Valid active evidence gap | Add real newline-framed child-process regression |
| Security | `7b-sec-002-r3` | ERROR | Process transport could invoke getters, Proxy traps, `toJSON`, or traversal behavior | Partially valid; runtime reachability overstated | Freshly review corrected lifecycle, provenance, bounds, and cleanup |
| Contract Auditor | `7b-sec-004-transport-verification-gap` | ERROR | Oversized evidence does not cover production process transport | Valid active evidence gap | Reconcile process, service, and serialized-result contracts with direct proof |

All four Revision 3 artifacts were current and evidence-valid. The normalized R2-G2 state is one active root-cause group, preserving all six original reviewer IDs. R2-G3 remains a separate active group.

## Security approval history

Security approved Revision 2 because it reviewed a different candidate. Revision 3 changed the adapter and integration boundary files, and its fresh Security call used current source evidence. The new Security result inherited the concrete transport concern raised by Code / Integration; it did not identify a newly introduced regression. Its claim about executable getters/Proxies is unsupported by the actual JSON.parse provenance, while its request for production-path bounded transport evidence remains material. Security must be rerun after the final correction.

## Codebase Memory process flow

| Stage | Representation | Bounded? | Executable JS semantics possible? | Final action |
| --- | --- | --- | --- | --- |
| Process stdout | Node `Buffer` chunks from `spawn` | Projected 200,000 UTF-8 bytes before append | No; raw bytes/text | Count raw Buffer bytes at this boundary and terminate on overflow |
| Accumulation | UTF-8-decoded newline-delimited string buffer | Yes for the active buffer, but current overflow leaves child alive | No | Stop retaining overflow output and reset process |
| JSON parse | `JSON.parse(raw)` with no reviver | Only after current line guard | Creates ordinary JSON data | Preserve; no live-object claim |
| Response envelope | Parsed `{ id, result, error }` object | Covered by line bound, not a separate result bound | No executable properties from standard JSON | Preserve envelope handling |
| Result | `value.result`, ordinary parsed JSON data | Result-specific service guard occurs later | No Proxy/getter/function/custom iterator from process JSON | Keep string conversion only with proven inert input |
| Generic tooling | `Promise<string>` into registered output boundary when adapter-bound | 200,000-byte serialized guard and 16,000-byte ToolResult bound | No live process object | Preserve existing generic boundary |
| Model context | Bounded `ToolResult` downstream | 16,000-byte local ToolResult policy | Not applicable | No model/provider stage on overflow |

The process API is Node `child_process.spawn(executable, [], { shell: false, stdio: ["pipe", "pipe", "pipe"] })`. There is no `exec`, `execFile`, or `maxBuffer` wrapper. `stderr` is piped but has no listener, collection, redaction, or inclusion in Codebase Memory errors; it is outside this result-boundary closure.

## Runtime semantics of parsed JSON

| Mechanism | Encodable in JSON | Created by standard `JSON.parse` | Other production path reachable | Classification |
| --- | --- | --- | --- | --- |
| Getter | No | No; data property only | No at the transport stringify site | Not production-reachable |
| Proxy | No | No | No | Not production-reachable |
| Callable `toJSON` | No | No; a `toJSON` key is ordinary data | No | Not production-reachable |
| Custom iterator | No | No; no `Symbol.iterator` is created | No | Not production-reachable |
| Function | No | No | No | Not production-reachable |

A safe local probe confirmed that parsed `__proto__` is an own data property, `constructor` and `toJSON` are ordinary object-valued data, the prototype is ordinary `Object.prototype`, and no iterator exists. External content remains untrusted supplemental data; inert parsing does not grant authority.

## Stringify decision

| JSON.stringify location | Input provenance | Actual risk | Needed? | Final disposition |
| --- | --- | --- | --- | --- |
| `src/integrations/codebase-memory/transport.ts:18` | `value.result` from standard `JSON.parse(raw)` | Redundant reserialization and late result-specific enforcement; not arbitrary executable-object traversal | Yes for the existing `UpstreamTransport: Promise<string>` contract unless a new parser architecture is introduced | `KEEP_WITH_PROVEN_INERT_INPUT`; add evidence and do not describe it as a live-object guard |

The final plan deliberately does not introduce a custom JSON parser or broaden the transport contract. The current `CodebaseMemoryService` returns normalized DTOs, while the adapter-layer `SerializedToolExecutor<T>` is only exercised by tests and has no non-test production caller of `executeBoundToolOperation`. The final closure therefore targets the actual process transport rather than inventing a second generic adapter redesign.

## Actual transport defect and final correction

The current process line guard is before `JSON.parse`, but the final result bound is applied after the envelope has been parsed and the result reserialized. On overflow, the current branch rejects pending calls and clears state but does not kill or reset the child, so the process can continue emitting output after the failure.

The future correction is limited to:

- `src/integrations/codebase-memory/transport.ts`
- `src/integrations/codebase-memory/codebase-memory.test.ts`

The future implementation will count raw stdout Buffer bytes at the earliest practical boundary, reject before retaining/parsing over-limit output, kill/reset the child, fail pending calls with the existing bounded `CODEBASE_MEMORY_UNAVAILABLE` error, and preserve cancellation isolation. It will retain the existing parser and inert-input stringify conversion.

## Oversize coverage

| Integration | Production-path oversized test | Status | Final action |
| --- | --- | --- | --- |
| Context7 | `Context7Service.queryDocumentation` with `MAX+1` serialized text | PASS | None |
| shadcn | `ShadcnRegistryService.fetchComponentReference` with `MAX+1` serialized text | PASS | None |
| Codebase Memory | Injected service transport only; no `CodebaseMemoryProcessTransport` fixture | Partial / blocking | Add actual newline-framed child-process test |

The Codebase Memory fixture must generate oversized content programmatically, use UTF-8 byte semantics, prove rejection before parent `JSON.parse`, `value.result`, and result stringify, verify child cleanup and no raw payload persistence/logging, then prove a fresh valid bounded response continues through the service. No large static fixture is allowed.

## Final file table

| File | Current role | Final correction? | Reason |
| --- | --- | --- | --- |
| `src/integrations/codebase-memory/transport.ts` | Dirty Revision 3 candidate; process stdout transport | Yes | Enforce overflow cleanup at the actual process boundary |
| `src/integrations/codebase-memory/codebase-memory.test.ts` | Dirty Revision 3 candidate; injected service regression | Yes | Add real process transport oversized/valid/cleanup evidence |
| Context7 production/tests | Completed Revision 3 boundary work | No | Current oversized service-path proof passes |
| shadcn production/tests | Completed Revision 3 boundary work | No | Current oversized service-path proof passes |
| `src/orchestration/tooling/adapters.ts` and `executors.ts` | Completed Revision 3 generic boundary work | No | No new generic correction is justified by actual process provenance |
| Other 8 candidate files | Preserved inherited Revision 3 candidate | No | Not implicated in the final transport correction |

## Final test table

| Test | Pre-fix proof | Post-fix expected | Reviewer finding |
| --- | --- | --- | --- |
| Process stdout over-limit | Current branch rejects but leaves child alive; no production test | Reject before parse/result access/stringify; kill/reset child; no raw persistence | All four Revision 3 blockers |
| Valid bounded process response | No production process fixture | Serialized response reaches service parse, normalization, currentness/cache, and consumer contract | Code / Integration; Contract |
| Boundary-sized/multibyte response | Current policy exists but no process-path proof | UTF-8 byte measurement is exact without static huge fixture | Test / Quality |
| Cancellation isolation | Existing service cancellation tests | Overflow/cancel only affects Codebase Memory pending calls | Security; Test / Quality |
| Context7/shadcn/generic regressions | Revision 3 focused suites passed | Remain green | Regression guard |

## Reviewer rerun plan

| Reviewer | Current verdict | Final rerun? | Scope |
| --- | --- | --- | --- |
| Code / Integration | `CHANGES_REQUIRED` | Yes | Actual stdout boundary, process cleanup, parser-created result, producer/consumer contract |
| Test / Quality | `CHANGES_REQUIRED` | Yes | Real process oversized/valid/cleanup evidence and downstream non-reachability |
| Security | `CHANGES_REQUIRED` in Revision 3; `APPROVED` in stale Revision 2 | Yes | Fresh current-source review of inert provenance, bounds, cleanup, redaction, authority, cancellation |
| Contract Auditor | `CHANGES_REQUIRED` | Yes | Transport/service/tooling representation and evidence traceability |
| Architecture | Not required | No | No canonical architecture or authority change |

Future sequence is one pre-fix proof, one coherent correction, focused checks, typecheck/lint/build, these four fresh reviewers, full validation, then `COMPLETE` or `BLOCKED`. There is no correction loop.

## State and scope

Phase 6 remains `COMPLETE` with 0 findings. Phase 7A and R2-G1 remain `COMPLETE`. R2-G2 remains blocked and is now ready for one final transport-closure execution. R2-G3 remains independent, valid, active, and not executed. Phase 7C/7D/7E, customer E2E, deployment, QA cleanup, new dependencies, agents, skills, MCP, shell authority, and package upgrades remain out of scope.

The 14-file candidate is preserved byte-for-byte. This reconciliation creates only admin artifacts and does not stage or commit the candidate. `.context7-cache/` remains untracked/unstaged; `.qa-foundation-*` workspaces are not cleaned.

PHASE 7B REVISION 2 / R2-G2.3: RECONCILIATION COMPLETE
R2-G2: BLOCKED - FINAL TRANSPORT CLOSURE READY
NEXT: R2-G2 FINAL TRANSPORT CLOSURE - EXECUTE
