# Phase 7B Revision 2.1 — R2-G2 External Result Boundary Replan

Status: `REPLAN COMPLETE`; R2-G2 remains `BLOCKED`.

This is a planning-only artifact. It authorizes one future implementation cycle named **R2-G2 Revision 2** and does not implement that correction.

## Current state and candidate preservation

Starting HEAD was `fb61e7b` (`docs: record phase 7b r2-g1 closure`). The only dirty source/test paths were `src/orchestration/tooling/executors.ts` and `src/orchestration/tooling/tooling.test.ts`; `.context7-cache/` was the only known transient untracked path; `.qa-foundation-*` count was 17. No unexpected dirty production, test, configuration, or evidence path existed.

The failed candidate was not reset, restored, stashed, discarded, overwritten, or committed:

| Candidate file | HEAD Git blob | Dirty SHA-256 | Dirty Git blob | Diff identity |
| --- | --- | --- | --- | --- |
| `src/orchestration/tooling/executors.ts` | `94e9b218d73a50bf94b69fa8db8ccc3b2a928c01` | `d9db6f8d164bbe2d21e379d7d598c52d007506a60974829d51bb1c46be144f8e` | `f9aeff007ed653aa316f8c2305e628e3e3e3bba5` | `c32a2a9a5f8e6b81b5052b67ec9590d3873f886c` |
| `src/orchestration/tooling/tooling.test.ts` | `788386edf89faccb7b6d8056ee6ea3a5db27c5d3` | `7f0fba15dd22fe138c22359f0cc799821b31b8a30694d2509f8a30a06f4e24f8` | `7861934a96c9ea9d139264e08a82913c74eced2f` | `6b6bbf647d0103507aa7104c946e2f7ddf7938e5` |

The executor diff is 77 added/changed lines: recursive clone/bounds, quoted-key redaction, and a new bounded conversion path. The test diff is 97 added/changed lines: result fixtures, cyclic/oversized/unsupported cases, quoted-key redaction, three supplemental-result cases, prompt placement, and dependency-authority checks.

## Why the first correction failed

The failed candidate replaced the old pre-validation `JSON.stringify(value)` with a recursive clone using node, depth, estimated-byte, cycle, and unsupported-value checks. The focused test passed 14/14; targeted typecheck, lint, and build also passed. The Security Reviewer then returned `CHANGES_REQUIRED` with `7b-sec-005`:

> The new resource bound limits the cloned data size, but traversal of unknown external objects can execute getters and Proxy traps before validation.

The cited operations are the candidate’s `for...in`, `propertyIsEnumerable`, and `source[key]`. They are executable inspection, not inert validation. The Test / Quality Reviewer returned `CHANGES_REQUIRED` with `7b-sec-002-004-quality-001` because the tests did not include a representative private-key fixture or a standalone token-pattern fixture. Code / Integration Reviewer approved, but that does not clear the two blockers.

The reconciled findings remain:

- `7b-sec-002`: `VALID_ACTIVE_REBASED`, `ERROR`. The remaining defect is pre-validation materialization, not absence of all output limits.
- `7b-sec-004`: `VALID_ACTIVE`, `WARNING`. Quoted JSON-key coverage was added, but the required external-result fixtures are missing.

## Safe diagnostic reproduction

An isolated temporary TypeScript diagnostic used only in-memory counters and values. It was deleted and is not committed. Against the current candidate it observed:

| JavaScript mechanism | Current attempted validation |
| --- | --- |
| Ordinary getter | Ran when `source[key]` read `packageName`. |
| Proxy `ownKeys` | Ran during `for...in`. |
| Proxy `getPrototypeOf` | Ran during `for...in` prototype traversal. |
| Proxy `getOwnPropertyDescriptor` | Ran during enumeration and again through `propertyIsEnumerable`. |
| Proxy `get` | Ran while the clone read each value. |
| `toJSON` | Did not run on the candidate fixture: an enumerable function was rejected as unsupported before `resultData`; a non-enumerable hook would be omitted. The old baseline stringify path could invoke it. |
| Custom iterator | Did not run: object cloning uses `for...in` and array cloning uses property access/`map`, not `Symbol.iterator`; array Proxy property reads can still trigger `get`. |

This directly proves executable behavior during attempted validation. It does not assume that `Object.keys`, descriptors, `getPrototypeOf`, `Reflect`, `structuredClone`, or any other reflection API defeats a Proxy.

## Reachability and earliest safe boundary

`registeredOutputToToolResult` is exported by `executors.ts` and re-exported by `src/orchestration/tooling/index.ts`. Direct repository callers found are `adapters.ts` and `tooling.test.ts`; no non-test production caller of `executeBoundToolOperation` was found. The intended caller is host dispatch after authorization. No model, agent, plugin, or HTTP route directly receives this low-level API in the inspected source.

That does not make `unknown` an acceptable contract. Custom host/test ports can supply live objects, and the three raw transport contracts expose `unknown` before their normalizers. The issue is an exported internal API and contract defect, not a claim that JSON.parse makes network data into a Proxy.

The earliest inert boundary is: bounded text/bytes → `JSON.parse` → existing integration normalizer/schema → host-created typed DTO → adapter serialization → generic ToolResult redaction/bounds/provenance. A live caller object must not be accepted as raw supplemental data.

## Integration boundary table

| Integration | Raw representation | Current parse/normalization boundary | Arbitrary live object reachable? | Revised boundary |
| --- | --- | --- | --- | --- |
| Context7 | `Context7Transport` is `Promise<unknown>`; tests/synthetic transport return arrays/objects; no concrete HTTP client exists in this repository. | `Context7Service.request` passes unknown to `normalizeContext7Response`, which performs array checks, property reads, prompt-injection checks, checksums, `DocumentationExcerptSchema`, and excerpt/byte bounds. Cache hits use `JSON.parse`. | Yes through the current contract/custom injection; not from a concrete network client in this repository, and not from model/agent code. | Narrow transport to serialized JSON text, bound bytes before parse, then reuse normalizer, cache, retries, allowlist, version, size, and prompt-injection policy. Adapters serialize only typed normalized DTOs. |
| shadcn Registry | Fixed official server transport currently returns `response.json()` as `unknown`; synthetic/custom transports return objects. | `ShadcnRegistryService.request` passes raw to `normalizeComponent`, which reads object/files, checks paths/dependencies/source, bounds files/content, and parses `ShadcnComponentReferenceSchema`. | Official `response.json()` produces ordinary parsed JSON, but the current contract and constructor allow custom/test live objects. No explicit response-byte guard precedes `response.json()`. | Use existing fetch with `response.text()`, bound UTF-8 bytes before `JSON.parse`, narrow transport to text, and preserve official allowlist, normalizer, source scan, dependency, cache, retry, and design policies. |
| Codebase Memory | Production process transport reads newline-delimited JSON-RPC, parses each line, and resolves `result`; injected `UpstreamTransport` remains `Promise<unknown>`. | `CodebaseMemoryService.normalize` reads `results`/`content`, bounds rows/source bytes, constructs typed symbols/relationships/excerpts/index provenance, and persists JSON-validated state. | Not from production child-process JSON after parse, but yes through injected upstream/custom service construction. The process buffer has no explicit line-byte guard. | Preserve serialized child-process framing, bound line/text before parse, narrow injected upstream representation, then reuse current workspace/current-index/query/cache/persistence/schema policies. |

Source/transport provenance is not content authority: approved Context7, official shadcn, and local Codebase Memory remain supplemental `UNTRUSTED_EXTERNAL` data. External text cannot set project/task/capabilities/file scope/tool policy, approve dependencies, or mutate source.

## Revised root cause and option decision

Revised canonical root cause:

> The generic external-result boundary accepts an unknown live JavaScript value and tries to make it safe by recursively enumerating and reading it. Accessors and Proxy traps can execute during that inspection, so the boundary executes external object behavior before schema validation and bounding complete. The affected integration contracts also expose unknown raw transport values to normalizers. The safe boundary must require serialized text or another host-owned inert representation before generic ToolResult conversion; raw transport text must be bounded and parsed by the owning integration before existing normalizers construct supplemental DTOs.

Confidence: **HIGH**. The candidate source contains the triggering operations, the diagnostic observed them, and the transport/normalizer traces show the current `unknown` reachability.

| Option | Assessment | Decision |
| --- | --- | --- |
| A — Move validation into each adapter | Existing integration schemas help, but this duplicates/relocates normalization and does not remove the generic `unknown` API. | Not sufficient alone. |
| B — Generic ToolResult accepts only host-created serialized/normalized data | A string can be checked and bounded without reading caller properties; existing schemas, redaction, ToolResult bounds, provenance, and untrusted status remain. | Selected generic boundary. |
| C — Split transport raw from normalized supplemental result | Makes the inert boundary explicit for all three integrations while preserving typed DTOs for ImplementationContext. | Selected only where needed to eliminate raw `unknown` inputs. |
| D — Keep architecture and narrow reachability | Cannot prove all custom host implementations are inert; exported converter still accepts `unknown`. | Rejected. |

The implementation must not use reflection, exception-catching, `structuredClone`, prototype checks, `JSON.stringify(unknown)`, a VM/sandbox, a serializer package, or a security framework as the primary fix.

## Failed-attempt disposition

| Attempted change | Keep / Modify / Drop | Reason |
| --- | --- | --- |
| Recursive node/depth/estimated-byte clone | Drop from revision | Traversal itself executes getters and Proxy traps. |
| Cycle/unsupported-value rejection | Modify | Reject object inputs at the string-only API without walking them; do not discover cycles recursively. |
| Pre-validation size bound | Modify | Apply the bound to serialized text before parse; retain existing post-parse schemas/content bounds. |
| Quoted JSON-key redaction | Keep | It addresses the reproduced quoted-key gap; add the missing external-result fixtures and preserve precision. |
| Positive Context7/shadcn/Codebase Memory untrusted fixtures | Keep | They prove useful supplemental data and source/content trust separation; update inputs to serialized adapter data. |
| Prompt placement/dependency authority assertions | Keep | They prove external text remains user-role data and cannot grant package, tool, file, or write authority. |
| Temporary diagnostics | Removed/unrelated | Planning-only, harmless, and absent from the commit. |

Useful protections after moving the boundary are the existing ToolResult maximum/truncation, redaction, integration schemas and content bounds, `UNTRUSTED_EXTERNAL`, host-owned evidence identity, and prompt/dependency separation.

## Redaction evidence and gap

The current candidate already redacts these fake forms in a harmless direct diagnostic:

- `-----BEGIN PRIVATE KEY-----\nTEST-ONLY-NOT-A-REAL-KEY\n-----END PRIVATE KEY-----` → `[REDACTED]`.
- `sk-123456789012345` → `[REDACTED]` without a JSON key.

The surrounding `sha256:0123456789abcdef` and `src/page.ts` remained visible. The gap is external ToolResult/context evidence, not an observed leak for these forms.

| Fixture | Current behavior | Reviewer requirement | Future test/change |
| --- | --- | --- | --- |
| Private-key fixture | `secretPattern` redacts the fake PEM-like block. | Prove it through external structured/preview context; use no real key. | Assert no block remains, `redactionApplied` is true, and surrounding documentation remains. |
| Standalone token fixture | `sk-[A-Za-z0-9]{12,}` redacts `sk-123456789012345`; existing runtime tests cover this shape only on host output. | Prove the token without a JSON key in the external path. | Assert token absence while ordinary source/hash/version text remains; do not build universal DLP. |

## One future correction cycle

1. Change `registeredOutputToToolResult` to accept serialized JSON text. Reject non-strings by a primitive `typeof` check before property access; bound bytes before `JSON.parse`; then retain registered schema validation, `resultData`, redaction, ToolResult bounds, `UNTRUSTED_EXTERNAL`, and host-owned evidence identity.
2. Narrow Context7 and shadcn raw transport contracts to serialized text and add bounded parse at the owning boundary. Preserve existing Context7 and shadcn policies.
3. Preserve Codebase Memory’s serialized child-process boundary, add a bounded line/text guard, and narrow the injected upstream representation so `normalize` cannot receive an arbitrary live object. Preserve current workspace/index/cache/persistence/read-only policies.
4. In `adapters.ts`, serialize only the typed host-normalized DTOs before calling the string-only generic converter; never pass raw transport values to it.
5. Add getter/Proxy regressions. Direct invalid object inputs must be rejected with all counters at zero because the protected API does not inspect them. Do not claim a reflection API is Proxy-safe.
6. Add private-key and standalone `sk-` fixtures through the external ToolResult/context path, with surrounding legitimate text preserved.
7. Update positive integration tests to prove useful results, `UNTRUSTED_EXTERNAL`, prompt-injection inertness, and dependency-authority separation after serialization.
8. Run deterministic checks, then Security, Code / Integration, and Test / Quality rechecks. All three are required because the shared converter and all three integration contracts materially change.
9. Complete R2-G2 or block and return to reconciliation. No unbounded cycle is authorized.

## Future test matrix

| Test | Pre-fix expected | Post-fix expected | Finding |
| --- | --- | --- | --- |
| Getter passed to generic converter | Getter runs during clone. | Object rejected by `typeof`; getter count remains zero. | `7b-sec-002`, `7b-sec-005` |
| Proxy passed to generic converter | `ownKeys`, prototype, descriptor, and get traps run. | No relevant trap runs at the protected boundary. | `7b-sec-002`, `7b-sec-005` |
| Cyclic live object | Candidate traverses to cycle rejection. | Object denied without recursive handling. | `7b-sec-002` |
| Oversized serialized text | Old path serialized the live value before size rejection. | Byte bound fails before parse. | `7b-sec-002` |
| Valid serialized normalized result | Direct unknown fixture succeeds. | Context7 excerpts, shadcn metadata/files, and Codebase structure remain useful and typed. | `7b-sec-002` plus preservation |
| Fake PEM and standalone sk-token | Required external fixtures absent. | Both redacted in structured/preview output; useful surrounding text remains. | `7b-sec-004` |
| Prompt injection/fake authority | Text remains data in existing direct fixtures. | It remains user-role supplemental data; no system/tool/dependency/file/write authority. | Preservation invariants |

The zero-trap assertion is valid only for the revised string-only API. No impossible guarantee is claimed for unrelated code that accepts arbitrary objects; those raw transport contracts are narrowed as part of this cycle.

## Future scope and non-goals

Primary files may be `src/orchestration/tooling/executors.ts`, `src/orchestration/tooling/adapters.ts`, Context7 contract/service files, shadcn contract/server/service files, and Codebase Memory transport/service files. Focused tests may be `src/orchestration/tooling/tooling.test.ts`, `src/integrations/context7/context7.test.ts`, `src/integrations/shadcn/shadcn-registry.test.ts`, and `src/integrations/codebase-memory/codebase-memory.test.ts`. Optional config/schema edits are allowed only if an existing limit cannot express the bounded raw read. Future result evidence may be recorded in the R2-G2 Revision 2 result artifacts.

Non-goals: R2-G3; Phase 7C; Phase 7D; Phase 7E and QA cleanup; Filesystem MCP; unrestricted shell/generic command execution; new agents; new providers/network discovery; customer E2E; deployment/preview; AST patching; new dependencies/serializer/security framework; ChangeProposal or source-mutation redesign; staging `.context7-cache/`; cleaning `.qa-foundation-*`.

## Checks and reviewers for future execution

Required deterministic checks:

```text
npm exec vitest run src/orchestration/tooling/tooling.test.ts
npm run typecheck
npm run lint
npm run build
npm test
npm audit --audit-level=high
git diff --check
```

Required reviewers: `security-reviewer`, `code-integration-reviewer`, and `test-quality-reviewer`.

- Security: Does the revised boundary reject arbitrary live getter/Proxy/cyclic objects without inspecting them, require bounded serialized text or adapter-owned inert normalized data before generic ToolResult conversion, and preserve source/content trust and host/dependency/write authority?
- Test / Quality: Do regressions prove zero protected-boundary trap execution, pre-parse byte rejection, valid result usability, and the private-key/standalone-token fixtures without over-redacting ordinary source or hashes?
- Code / Integration: Do Context7, shadcn Registry, Codebase Memory, and the generic result boundary share one serialized-transport/normalized-DTO contract without duplicate parsing or loss of provenance/currentness/cache/retry semantics?

Fresh GPT calls in this replan: `0`. No reviewer calls were made for the plan.

## Phase state and next action

R2-G1 remains `COMPLETE`. R2-G2 remains `BLOCKED` with a revised correction ready. R2-G3 remains `NOT EXECUTED`. Phase 6 remains `COMPLETE` with zero findings; Phase 7A remains `COMPLETE`.

The next authorized action is:

`R2-G2 REVISION 2 — EXECUTE REVISED EXTERNAL RESULT BOUNDARY`

That action is not performed in this run.
