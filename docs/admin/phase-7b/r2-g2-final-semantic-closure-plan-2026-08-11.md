# R2-G2.4 Final Semantic Reconciliation

Status: **READY FOR ONE FINAL BOUNDED EXECUTION**
R2-G2: **BLOCKED — FINAL SEMANTIC CLOSURE READY**
Baseline: `2046614`
Fresh GPT calls in this reconciliation: `0`

## Reconciliation outcome

The prior transport correction remains intact. Code / Integration is **APPROVED** and its inert-input conclusion is preserved: standard `JSON.parse(raw)` without a reviver produces ordinary JSON data, so serialized process JSON cannot carry a live Proxy, getter, function, callable `toJSON`, or custom iterator.

The remaining three reviewer domains do not represent three duplicate transport rewrites. They normalize into one future bounded semantic-closure cycle containing composed evidence plus a small set of verified lifecycle/data-boundary corrections.

## Reviewer finding table

| Reviewer | Finding | Severity | Exact claim | Classification | Future action |
|---|---|---:|---|---|---|
| Test / Quality | `tqr-r2-g2-production-composition-001` | ERROR | Real process overflow and service oversized rejection are separate; their composed path is unproven. | Missing composed test evidence | Add one child → transport → service oversized scenario with downstream suppression. |
| Security | `sec-7b-001` | ERROR | Child inherits the parent environment. | Actual production defect | Pass an explicit minimal child environment. |
| Security | `sec-7b-002` | ERROR | stderr is piped but unread; timeout/cancellation leaves the child alive. | Actual stderr defect plus lifecycle evidence gap | Make stderr non-blocking/bounded or ignored; test timeout/overflow cleanup without killing unrelated calls. |
| Security | `sec-7b-003` | WARNING | `getIndexStatus` ignores cancellation and shared index work can be uncancellable. | Actual status/shared-work defect; pending-request isolation already covered | Honor status signals and preserve shared-request isolation. |
| Security | `sec-7b-004` | ERROR | External normalized output may persist before output-time redaction. | Actual storage-policy defect pending explicit protection | Redact before persistence or prove protected storage; use synthetic secrets. |
| Contract Auditor | `f001` | ERROR | Generic tooling expects serialized results while typed ports return DTOs. | Contract evidence gap; direct mismatch wording overstated | Prove the typed serializer binding; do not redesign `Promise<string>`. |
| Contract Auditor | `f002` | WARNING | No real process response is traced through generic tooling. | Missing test evidence | Add composed success/overflow boundary evidence. |
| Contract Auditor | `f003` | WARNING | Service byte slicing can split UTF-8 characters. | Actual production defect | Use UTF-8 code-point-safe truncation and test it. |

## Composed flow

| Stage | Representation | Bound | Existing proof | Missing proof |
|---|---|---|---|---|
| Child stdout | JSON-RPC bytes | 200,000 UTF-8 bytes | Real oversized/boundary process tests | None at lower transport layer |
| Process transport | `Promise<string>` serialized `value.result` | Raw line plus lifecycle reset | PASS | Service composition on oversized path |
| Codebase service | Serialized string → parsed JSON | 200,000-byte result guard | Injected oversized and valid process tests | Real child oversized through service |
| Normalize/cache | Parsed normalized DTO and bounded excerpts | plan byte/result limits | Existing cache/persistence tests | UTF-8-safe excerpt and storage policy |
| ToolResult/model | Serialized JSON → validated `UNTRUSTED_EXTERNAL` result | 16,000-byte ToolResult policy | Generic boundary tests | Direct Codebase process-to-ToolResult composition |

## Child security table

| Concern | Current behavior | Production defect? | Evidence gap? | Final action |
|---|---|---:|---:|---|
| Environment | `spawn` inherits `process.env`; optional executable is server-configured and disabled by default. | Yes: unnecessary secret exposure remains possible. | Required-variable contract is undocumented. | Minimal explicit environment and synthetic exposure test. |
| stderr | Piped, no listener, no bound, not persisted or sent to the model. | Yes: a noisy child can block on pipe backpressure. | Lifecycle regression is missing. | Ignore or boundedly consume stderr; test noisy synthetic stderr. |
| Cancellation | One shared child; abort removes only that request; `getIndexStatus` ignores its signal; shared index callers reuse one promise. | Yes for status/shared work; per-request isolation is correct. | Full child-lifecycle recovery proof is incomplete. | Fix status/shared semantics and test cancellation versus overflow separately. |
| Overflow cleanup | All pending calls fail, buffer clears, child is invalidated/terminated, fresh process recovers. | No remaining lower-layer defect. | Composed service proof is missing. | Reuse lower-layer evidence and add only the next-boundary test. |

The child is a trusted, server-configured local `codebase-memory-mcp` integration, not a user-selected arbitrary executable. That trust model does not justify inheriting unrelated Factory secrets.

## Contract table

| Producer | Output | Consumer | Expected input | Consistent? | Final action |
|---|---|---|---|---|---|
| `CodebaseMemoryProcessTransport` | `Promise<string>` containing serialized JSON `value.result` | `CodebaseMemoryService.parseUpstreamResult` | Serialized JSON text | Yes | Preserve. |
| `CodebaseMemoryService` | Parsed `CodebaseMemoryResult` DTO | Typed `SerializedToolExecutor<CodebaseMemoryPort>` binding | Serialized JSON text | Semantically intentional, under-proven | Add explicit composition evidence. |
| `registeredOutputToToolResult` | `ToolResult` | Agent/tool context | Bounded serialized JSON; validate registered schema | Yes | Preserve existing boundary. |

No new wrapper type is planned unless implementation proves the existing serializer binding is genuinely ambiguous.

## Future correction and tests

Future production files are limited to:

- `src/integrations/codebase-memory/transport.ts`
- `src/integrations/codebase-memory/service.ts`
- `src/integrations/context7/cache.ts`
- `src/integrations/shadcn/cache.ts`

Future test coverage is limited to the existing Codebase Memory and tooling test files. The single authorized cycle will:

1. preserve the approved raw stdout bound and inert JSON semantics;
2. isolate the child environment and prove synthetic secret names are not inherited;
3. make stderr non-blocking/bounded or explicitly ignored;
4. preserve per-request cancellation isolation while correcting status/shared-index behavior;
5. close the external cache/metadata redaction or protected-storage policy;
6. make service excerpt truncation UTF-8 safe;
7. add one composed real child → service → serialized ToolResult test for oversized rejection and valid recovery.

Required future reviewers: Test / Quality, Security, Contract Auditor, and Code / Integration if transport/service semantics change. Architecture is not required. The future budget is exactly one implementation/evidence cycle with no reviewer-fix-review loop.

Context7 and shadcn oversized R2-G2 coverage is already complete; no future changes to their services are planned beyond the narrowly identified cache-storage policy. Generic tooling remains serialized and bounded; no generic adapter redesign is planned. R2-G3 remains separate and unexecuted.

## Validation and preservation

This reconciliation performed no test suite, audit, database, Docker, TaskGraph, or reviewer execution. It validated the plan inputs, candidate hashes, and `git diff --check` only. All 14 source/test candidate hashes matched start/end unchanged during this reconciliation (12 non-mutable candidates plus the two previously mutable final-cycle candidates).

`.qa-foundation-*` count remains 18 and cleanup was not performed. `.context7-cache/` and historical blocked artifacts remain untouched. No production source, tests, dependency, agent, skill, MCP, Phase 7C/7D/7E, customer E2E, or deployment work was performed.

Machine plan: [r2-g2-final-semantic-closure-plan-2026-08-11.json](r2-g2-final-semantic-closure-plan-2026-08-11.json).

NEXT: `R2-G2 FINAL SEMANTIC CLOSURE — EXECUTE`

PHASE 7B / R2-G2.4: RECONCILIATION COMPLETE
R2-G2: BLOCKED — FINAL SEMANTIC CLOSURE READY
NEXT: R2-G2 FINAL SEMANTIC CLOSURE — EXECUTE
