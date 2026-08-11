# Phase 7B Revision 2 — R2-G1 Host Context Authenticity

Status: `COMPLETE`

Phase 7B status after this one group: `BLOCKED — REMAINING REVISION 2 GROUPS`.

This report covers only `R2-G1-HOST_CONTEXT_AUTHENTICITY`. R2-G2, R2-G3, Phase 7C/7D/7E, customer website-generation E2E, cleanup, and a five-reviewer closure pass were not executed.

## Commit and baseline identity

| Item | Identity |
|---|---|
| Initial committed HEAD at turn start | `67306e3` |
| Revision 2 plan baseline | `bbc9e3a` |
| Inherited Phase 7B candidate checkpoint | [`408858ed`](../../../../commit/408858ed3b3685d21783884d33bedf5a64d81722) |
| R2-G1 correction commit | [`a3773276`](../../../../commit/a3773276e31c2bd5aaec622e8e8f915b2e987a2f) |
| Closure artifacts | Written after the correction commit; committed separately |
| Inherited candidate files | 22, preserved and checkpointed |
| Known transient | `.context7-cache/`, not staged |

The 22 inherited files were not treated as new R2-G1 scope. They remain in the checkpoint commit, while the correction commit contains only the three production files and one focused test file listed below.

## Finding closure

| Finding | Reviewer | Severity | Category | Defect class | Risk | Result |
|---|---|---:|---|---|---:|---|
| `7b-sec-001` | Security Reviewer | ERROR | TRUST_BOUNDARY | SECURITY_BOUNDARY_DEFECT | HIGH | RESOLVED |

Root cause: the old exported `createToolHostContext` accepted caller-supplied project scope and trusted executor identities. Its unique-symbol brand proved only that the exported function had been called, not that a factory host had created or attested the authority.

## Authority boundary

The host-created context now freezes and records these authority facts in a private runtime `WeakSet`:

- host identity and project/version/task identity;
- current workspace identity, reference, currentness, mutability, and allowed file scopes;
- task type, derived task capabilities, task file scopes, and task allowed tools;
- the host-snapshotted agent ID, allowed tools, and supported task types; and
- the registered trusted executor identities.

The request contains only `requestId`, project/version/task claims, registered tool and operation IDs, and typed input. Request project/version/task fields are claims checked against the host context; request input cannot select an agent, capability, executor, workspace root, file scope, network URL, mutation mode, dependency, shell command, or package argument.

Canonical authority remains split across the private host-context binding, the current `AgentTask` and its derived capabilities, the catalog `AgentDefinition`, the immutable tool registry, registered executor IDs, existing path/input policy, and the existing Dependency Authority/runtime validator.

## Before and after

| Boundary | Before | After |
|---|---|---|
| Context construction | Exported constructor accepted caller authority data; brand was not provenance. | Internal constructor validates host/task/agent identity, scope, capability, and executor facts, freezes them, and records the exact object in a private `WeakSet`. |
| Structural forgery | A lookalike could satisfy the structural/type shape. | Structural copies fail the `WeakSet` check and return `HOST_CONTEXT_UNTRUSTED`. |
| Task/project/version | Existing request checks existed, but context facts were caller-provided. | Host snapshot and current task must match; mismatches fail closed as `PROJECT_SCOPE_INVALID` or `TASK_SCOPE_INVALID`. |
| Agent impersonation | Authorization used the supplied agent definition directly. | The supplied agent must match the host-snapshotted ID, tools, and supported task types. |
| Capabilities | Derived task capabilities were used by the authority path. | The host snapshot is authoritative for the decision; operation requirements still must be present, and request input cannot add capabilities. |
| File scope | Request input was checked against task/host scope. | The same intersection remains enforced from immutable host fields. |
| Network/mutation/dependency | Existing registered policies applied. | No widening: arbitrary URLs, generic writes, shell, and package arguments remain denied; typed adapters/runtime validator/Dependency Authority remain the boundaries. |
| Currentness/cancellation | Existing current-task and controlled runtime cancellation behavior. | Preserved: only ready/running tasks authorize; runtime cancellation remains owned by the existing validator boundary. |

## Deterministic forgery proof

| Case | Expected/observed result | Evidence |
|---|---|---|
| Structural copy of trusted context | `HOST_CONTEXT_UNTRUSTED` | `tooling.test.ts` |
| Task/scope mismatch during construction | Constructor throws | `tooling.test.ts` |
| Request project/version/task mismatch | `PROJECT_SCOPE_INVALID` | `tooling.test.ts` |
| Lead/reviewer agent against implementation host context | `AGENT_TOOL_NOT_ALLOWED` | `tooling.test.ts` |
| Forged capability/command-like request input | `INPUT_NOT_ALLOWED` | `tooling.test.ts` |

## Changed files

| File | Role | SHA-256 after R2-G1 |
|---|---|---|
| `src/orchestration/tooling/host-context.ts` | New private-bound host context and identity checks | `3b7f663283e1de0a301ceea7fd0588b91b08500a282b1ce2d8062478284279ee` |
| `src/domain/tooling/schema.ts` | Adds `HOST_CONTEXT_UNTRUSTED` and decision identity | `bbc8946194422fb900f2d6ae26f6c59268415f8b52cbdfbb3789119943f286e7` |
| `src/orchestration/tooling/authority.ts` | Enforces trusted context, task/agent matching, and host-derived permissions | `b27219215152d13a030e6929f97d4627f1df6931fd4779db87f5b6c6179ef38c` |
| `src/orchestration/tooling/tooling.test.ts` | Adds focused authenticity and mismatch tests; updates host fixtures | `3576690b9be11386a80e1783655e9793cc09678dcb1d1d51e1c7b298d502dbce` |

The machine-readable version records the pre-R2-G1 hashes and the full inherited checkpoint file list: [`r2-g1-host-context-authenticity-result-2026-08-11.json`](./r2-g1-host-context-authenticity-result-2026-08-11.json).

## Fresh semantic reviewer rechecks

Exactly two fresh production-provider calls were made, with no reused calls.

| Reviewer | Model | Selected approved skills | Verdict | Findings |
|---|---|---|---|---:|
| Architecture Reviewer | GPT-5.6 Luna (`gpt-5.6-luna`) | `architecture-tradeoff-review`, `module-boundaries-fb20497b5c35`, `review-maintainability-d9faf7cb9775` | APPROVED | 0 |
| Security Reviewer | GPT-5.6 Luna (`gpt-5.6-luna`) | none | APPROVED | 0 |

Evidence validation passed. The reviewer target was the R2-G1 working tree based at `408858ed`; the committed correction source hashes match the reviewed slices. Architecture skill checksums, reviewer identity checksums, selected skill IDs, source slices, and provider identity are persisted in the JSON result.

## Validation

| Gate | Result |
|---|---|
| Focused tooling test | PASS — 1 file, 11 tests |
| Reviewer regression suite | PASS — 7 files, 77 tests |
| Typecheck | PASS |
| Lint | PASS — 0 errors, 3 pre-existing warnings |
| Production build | PASS — Next.js 16.2.12 |
| Full test suite | PASS — 72 files, 867 tests |
| High-severity audit | PASS — 0 vulnerabilities |
| `git diff --check` | PASS; only expected CRLF normalization warnings |
| Database validation/status/verification/integrity | PASS — 2 migrations; 17 tables; RLS 17/17; public policies 0 |
| Docker Compose config | PASS |
| TaskGraph smoke | PASS — 6 tasks, release eligible, 0 repairs, no network/npm/browser |

An initial parallel build/test invocation raced the local QA build and produced two missing-`.next/BUILD_ID` failures. The build was rerun first, then `npm test` passed completely. No QA fixture cleanup was performed. The `.qa-foundation-*` count was 16 before validation and 17 afterward; all were preserved.

## Successor state

R2-G1 resolved one finding. Four valid blockers remain:

- R2-G2 — `7b-sec-002`, `7b-sec-004`: external result boundary;
- R2-G3 — `contract-audit-001`, `tqr-7b-003`: evidence completeness.

R2-G2 is newly unblocked by the completed dependency. R2-G3 remains independent and active. No later finding was auto-resolved. The updated machine state is [`phase-7b-revision-2-state-2026-08-11.json`](./phase-7b-revision-2-state-2026-08-11.json), and its exact next recommendation is `R2-G2-EXTERNAL_RESULT_BOUNDARY`.

Phase 6 remains COMPLETE with 0 findings. Phase 7A remains COMPLETE. The portfolio remains 9 agents, 4 approved external artifacts, 13 approved internal artifacts, 17 unique approved artifacts, 18 explicit assignments, and 0 deferred external candidate usage. Skills remain procedural context only; no new agent, skill, Filesystem MCP, unrestricted shell, AST patching, deployment, or customer website-generation E2E was introduced.
