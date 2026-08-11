# Phase 7B — R2-G2.5 Closure Scope & Reviewer Drift Reconciliation

Status: **COMPLETE — FROZEN CLOSURE VERIFICATION READY**

This was an admin/meta-reconciliation only. No production source, test, R2-G3, Phase 7C/7D/7E, reviewer call, full test run, cleanup, deployment, or customer E2E was performed.

Machine contract: [r2-g2-closure-contract-2026-08-11.json](./r2-g2-closure-contract-2026-08-11.json)

## Why closure kept expanding

R2-G2 began with two genuine external-result boundary findings: unbounded pre-validation materialization and incomplete secret-key redaction. Revision 2 correctly exposed the generic adapter’s live-object traversal. Revision 3 corrected the generic serialized binding, which legitimately exposed that Codebase Memory’s process adapter still parsed and reserialized a bounded child result and lacked direct production-path evidence.

The final transport and semantic cycles then mixed three different classes of work:

1. direct R2-G2 behavior — raw bounds, inert parsing, redaction, terminal overflow, cancellation isolation, valid recovery, and UTF-8-safe normalization;
2. closure evidence — proving one frozen candidate across process, service, serializer, and ToolResult boundaries;
3. broader evidence/ownership and future hardening — production-factory wiring, TaskGraph traceability, generic policy ownership, and spawn-error handling.

The deterministic behavior for the first class is green. The loop continued because later reviews treated the second and third classes as new R2-G2 production requirements. This reconciliation preserves valid concerns but routes them to the correct owner.

## Current state

| Field | Value |
|---|---|
| Initial/current HEAD | `9dfaddf` / `9dfaddfe337b9d4fef054e244206cdf36ca2b7f8` |
| Candidate source/test files | 16 |
| Candidate preservation | 16/16 unchanged during this run |
| Focused prior result | 41/41 passed |
| Typecheck/lint/build/diff check | Passed before this run |
| Fresh GPT calls | 0 |
| R2-G2 | **BLOCKED — FROZEN CLOSURE VERIFICATION READY** |
| R2-G3 | NOT EXECUTED |
| Phase 7B | BLOCKED |

## Review history

| Revision/run | Candidate identity | Reviewer | Verdict | New findings | Resolved findings |
|---|---|---|---|---|---|
| Final bounded pass | `bbc9e3a`, unpersisted source snapshot | Architecture, Contract, Code, Security, Test/Quality | Mixed; all had blockers | 14 raw findings | None at run time |
| R2-G1 closure | `408858…` → `a377327…` | Architecture, Security | APPROVED / APPROVED | None | `7b-sec-001` |
| R2-G2 Revision 2 | `69674f46…` | Security, Code, Test | APPROVED / CHANGES_REQUIRED / CHANGES_REQUIRED | `r2-g2-002`, `r2-g2-tq-001` | Generic claim narrowed |
| R2-G2 Revision 3 | `82f048…` baseline | Code, Test, Security, Contract | All CHANGES_REQUIRED | `r3-r2-g2-001`, `7b-sec-004-codebase-transport`, `7b-sec-002-r3`, `7b-sec-004-transport-verification-gap` | Prior IDs rebased |
| Final transport closure | 14-file candidate hash set | Code, Test, Security, Contract | APPROVED / CHANGES_REQUIRED / CHANGES_REQUIRED / CHANGES_REQUIRED | Composition, child lifecycle, storage, contract, UTF-8 | Generic adapter claim approved |
| Final semantic closure | `r2-g2.5-candidate-2026-08-11` / `81b59dce…` | Code, Test, Security, Contract | CHANGES_REQUIRED / CHANGES_REQUIRED / CHANGES_REQUIRED / BLOCKED | Spawn-error hardening, ownership/traceability, composed evidence | Deterministic lifecycle/storage/UTF-8 behavior green |

## Approval currentness

| Reviewer | Last approval | Scope | Changed afterward | Still current |
|---|---|---|---|---|
| Architecture | R2-G1, `408858…` | Host-context authenticity and architecture boundary | No relevant host-context paths changed | Yes, scoped to R2-G1 |
| Contract Auditor | None for R2-G2 | No R2-G2 approval recorded | N/A | No approval to reopen |
| Code / Integration | Final transport closure | Lower process transport, inert JSON provenance, overflow boundary | Yes, transport/service/test changed | Partial; not a blanket current-candidate approval |
| Security | R2-G2 Revision 2, `69674f46…` | Generic external-result boundary before later lifecycle edits | Yes, transport/service/cache paths changed | Partial; later blocks mix changed lifecycle and evidence scope |
| Test / Quality | None | No R2-G2 approval recorded | N/A | No approval to reopen |

Code / Integration’s later spawn-error finding concerns a path present before the final semantic edits; the surrounding transport file changed, but no evidence shows that the candidate introduced this defect. Security’s alternating approvals reflect both real candidate changes and expansion from result bounding into generic lifecycle/policy evidence.

## Original R2-G2 anchor

Original findings: `7b-sec-002`, `7b-sec-004`.

Purpose: bound external Context7, shadcn, and Codebase Memory output before arbitrary materialization, preserve serialized/parsed contract coherence, redact secret-bearing data before ToolResult/cache/metadata publication, retain `UNTRUSTED_EXTERNAL`, and prevent external content from granting authority or write access.

The host-context finding `7b-sec-001` was R2-G1 and is complete. The independent `contract-audit-001` and `tqr-7b-003` findings belong to R2-G3.

## Frozen R2-G2 contract

The contract has exactly seven obligations. Future R2-G2 verification may only pass/fail these obligations or identify a concrete regression against them.

| Obligation ID | R2-G2 requirement | Deterministic proof | Semantic reviewer | Current status |
|---|---|---|---|---|
| `R2-G2-O1-INERT-SERIALIZED-EXTERNAL-RESULT` | External results are inert, bounded, serialized/validated, untrusted, and non-authoritative | Hostile-object tests; standard JSON.parse provenance; registered serialized ToolResult validation | Code, Security, Contract | Pass behavior; frozen verification required |
| `R2-G2-O2-INTEGRATION-RAW-RESULT-BOUND` | Context7, shadcn, and Codebase Memory reject oversized serialized output before downstream work | Integration-specific oversized tests; process overflow test | Code, Security, Test | Pass behavior; frozen verification required |
| `R2-G2-O3-CHILD-TRUST-TERMINAL-LIFECYCLE` | Minimal child environment, bounded/drained stderr, overflow cleanup, and valid recovery | Synthetic-secret, stderr, overflow, cleanup, and fresh-process tests | Code, Security, Test | Pass behavior; spawn-error hardening excluded |
| `R2-G2-O4-REDACTED-UNTRUSTED-PERSISTENCE` | Redact before Codebase/Context7/shadcn persistence; retain `UNTRUSTED_EXTERNAL` | Synthetic-secret persistence tests | Security, Test | Pass behavior; generic policy trace routes R2-G3 |
| `R2-G2-O5-CANCELLATION-ISOLATION` | Abort isolation across requests/shared work/status; terminal overflow remains fail-closed | Sibling, shared-index, status cancellation tests | Security, Test, Contract | Pass behavior; generic trace routes R2-G3 |
| `R2-G2-O6-UTF8-SAFE-NORMALIZATION` | Normalized excerpts do not split UTF-8 code points | Multibyte boundary test, no U+FFFD | Contract, Test | Pass behavior; cross-artifact trace routes R2-G3 |
| `R2-G2-O7-FROZEN-COMPOSED-CLOSURE-EVIDENCE` | One immutable candidate/evidence identity covers valid child → transport → service → ToolResult and oversized downstream suppression | 41 focused tests and real composed process test; candidate checksum frozen below | All four required reviewers | **Required frozen closure verification** |

The request for production-factory/TaskGraph ownership evidence is not silently accepted as a new R2-G2 behavior obligation; it routes to R2-G3 unless a concrete regression against one of these seven obligations is reproduced.

## Current finding routing

| Finding | Reviewer | Severity | Frozen obligation | Classification | R2-G2 blocker | Route |
|---|---|---:|---|---|---|---|
| `tqr-r2-g2-production-composition-001` | Test/Quality | ERROR | O7 | R2_G2_REQUIRED_EVIDENCE | Yes | R2-G2 closure contract |
| `sec-7b-001` | Security | ERROR | O3 | STALE | No | Stale/superseded |
| `sec-7b-002` | Security | ERROR | O3 | STALE | No | Stale/superseded |
| `sec-7b-003` | Security | WARNING | O5 | STALE | No | Stale/superseded |
| `sec-7b-004` | Security | ERROR | O4 | STALE | No | Stale/superseded |
| `r2-g2-final-transport-closure-f001` | Contract | ERROR | O1 | R2_G3_EVIDENCE_COMPLETENESS | No | R2-G3 |
| `r2-g2-final-transport-closure-f002` | Contract | WARNING | O7 | R2_G2_REQUIRED_EVIDENCE | Yes | R2-G2 closure contract |
| `r2-g2-final-transport-closure-f003` | Contract | WARNING | O6 | R2_G3_EVIDENCE_COMPLETENESS | No | R2-G3 |
| `r2-g2-final-semantic-closure-transport-f001` | Code/Security | ERROR | — | FUTURE_HARDENING | No | Post-Phase-7B hardening |
| `ca-r2-g2-001` | Contract | ERROR | O7 | R2_G3_EVIDENCE_COMPLETENESS | No | R2-G3 |
| `ca-r2-g2-002` | Contract | CRITICAL | O3 | R2_G3_EVIDENCE_COMPLETENESS | No | R2-G3 |
| `ca-r2-g2-003` | Contract | CRITICAL | O5 | R2_G3_EVIDENCE_COMPLETENESS | No | R2-G3 |
| `ca-r2-g2-004` | Contract | ERROR | O4 | R2_G3_EVIDENCE_COMPLETENESS | No | R2-G3 |
| `ca-r2-g2-005` | Contract | ERROR | O6 | R2_G3_EVIDENCE_COMPLETENESS | No | R2-G3 |
| `ca-r2-g2-006` | Contract | WARNING | O1 | R2_G3_EVIDENCE_COMPLETENESS | No | R2-G3 |
| `tqr-r2-g2-composed-boundary-002` | Test/Quality | WARNING | O7 | R2_G3_EVIDENCE_COMPLETENESS | No | R2-G3 |
| `contract-audit-001` | Contract | ERROR | — | R2_G3_EVIDENCE_COMPLETENESS | No | R2-G3 |
| `tqr-7b-003` | Test/Quality | WARNING | — | R2_G3_EVIDENCE_COMPLETENESS | No | R2-G3 |

The four `sec-7b-*` lifecycle/storage findings are stale as production claims because the current candidate now implements and tests the requested behavior. The new spawn-error finding is valid hardening but neither a reproduced candidate regression nor a frozen R2-G2 obligation.

## Scope drift and routing

| Finding/theme | First appeared | Original R2-G2 obligation | Regression | Correct owner |
|---|---|---|---|---|
| Spawned-child `error` event handling | Final semantic closure | None in original two-finding definition | No; path predates current correction | Post-Phase-7B hardening |
| Production-factory wiring proof | Final transport closure | O7 behavior, but factory wiring is extra | No | R2-G3 evidence completeness |
| Generic TaskGraph/ownership trace | Initial final bounded pass | None; explicitly R2-G3 group | No | R2-G3 |
| Cache policy ownership metadata | Final semantic closure | O4 behavior is proven | No | R2-G3 |
| UTF-8 cross-artifact trace | Final transport closure | O6 behavior is proven | No | R2-G3 |
| Historical `r3-*` transport IDs | Revision 3 | Rebased to final transport findings | N/A | Superseded/duplicate history |

## R2-G3 routing

| Finding | Why it is evidence completeness | R2-G2 behavior already proven? | R2-G3 action |
|---|---|---|---|
| `r2-g2-final-transport-closure-f001` | Producer/consumer trace is requested; no runtime mismatch reproduced | Yes, serialized binding and boundary tests pass | Record cross-artifact binding and owner |
| `r2-g2-final-transport-closure-f003` | Cross-contract evidence request | Yes, UTF-8 test passes | Trace schema/service/test evidence |
| `ca-r2-g2-001..006` | Ownership, policy, cancellation, storage, UTF-8, and inert-JSON traceability | Yes, relevant behavior passes | Execute independent R2-G3 evidence plan |
| `tqr-r2-g2-composed-boundary-002` | Requests one traceable evidence record across existing tests | Yes, behavior is covered in focused tests | Persist evidence lineage |
| `contract-audit-001` | Exact original R2-G3 requirement: persisted final review identity/lineage | Not executed | Execute R2-G3 |
| `tqr-7b-003` | Exact original R2-G3 requirement: generated TaskGraph path proof | Not executed | Execute R2-G3 |

No findings route to Phase 7C, Phase 7D, or Phase 7E in this reconciliation.

## Future hardening

| Finding | Valid concern? | Why non-blocking for R2-G2 | Future owner |
|---|---|---|---|
| `r2-g2-final-semantic-closure-transport-f001` | Yes | Spawn-error handling is adjacent child-process hardening, was present before the current correction, and is not one of the seven frozen obligations | Post-Phase-7B hardening |

Historical stale/rebased IDs retained as audit history are: `7b-arch-001`, `7b-arch-002`, `7b-arch-003`, `phase-7b-integration-001`, `phase-7b-integration-002`, `phase-7b-integration-003`, `7b-sec-003`, `tqr-7b-001`, `tqr-7b-002`, `r3-r2-g2-001`, `7b-sec-004-codebase-transport`, `7b-sec-002-r3`, and `7b-sec-004-transport-verification-gap`.

## Counts and next action

| Metric | Count/state | Consequence |
|---|---:|---|
| Latest unique current findings | 18 | All have one route |
| R2-G2 production defects | 0 | No production correction is planned |
| R2-G2 regressions | 0 | Critical regression escape hatch remains available |
| R2-G2 required evidence | 2 | Frozen verification remains required |
| R2-G3 evidence findings | 11 | R2-G3 remains independent and unexecuted |
| Future hardening findings | 1 | Nonblocking post-Phase-7B backlog |
| Current stale/duplicate/scope-drift findings | 4 | Not blockers |
| Historical superseded/rebased IDs | 13 | Retain as history; do not re-promote |

| Condition | Current value | Consequence |
|---|---|---|
| R2-G2 production defects > 0 | No | Do not plan another production correction |
| R2-G2 regressions > 0 | No | Do not invoke escape hatch |
| R2-G2 required evidence > 0 | Yes — 2 findings mapped to O7 | Freeze candidate and run bounded closure verification |
| All frozen obligations satisfied | Behavior yes; semantic closure verification no | R2-G2 remains blocked |
| R2-G3 findings present | Yes — 11 | Keep R2-G3 independent and not executed |

## Frozen candidate and reviewer policy

| Policy | Frozen value |
|---|---|
| Candidate ID | `r2-g2.5-candidate-2026-08-11` |
| Candidate checksum | `81b59dce2a78da2317759f0d6258e57bce650637803999de0a53a022cd342a97` |
| Evidence ID | `r2-g2.5-evidence-af001dd1bff714e03a95fea07018c1e43004e1e8b72e954558efd88b8ea804c9` |
| Candidate file count | 16 source/test files |
| Future reviewers | Code/Integration, Test/Quality, Security, Contract Auditor |
| Architecture Reviewer | Not required |
| Review mutation policy | Zero source/test mutation between deterministic gates and reviewer calls |
| Reviewer scope | Only the seven obligation IDs; adjacent findings route rather than expand scope |
| Critical escape hatch | Concrete current RCE, secret leakage, corruption, authority bypass, or equivalent regression directly caused by candidate may block with production-path evidence |

Required deterministic gates before the successor verification are the existing focused R2-G2 integration/tooling tests, `npm run typecheck`, `npm run lint`, `npm run build`, `git diff --check`, and candidate checksum equality. Full Factory validation remains after semantic closure approval and before the accepted implementation commit.

## Worktree and artifact policy

All 16 source/test candidates remained byte-for-byte unchanged during this run. `.context7-cache/` remains untracked. The 18 `.qa-foundation-*` directories remain untouched. Historical blocked result/reviewer artifacts remain retained but unstaged; the policy is explicit history retention, with no cleanup in this run.

The only intended commit from this turn is the meta-reconciliation contract/report and the canonical Phase 7B state pointer. No source/test candidate or historical blocked artifact may be staged.

## Final decision

No genuine R2-G2 production defect or regression remains in the frozen contract. The next state is:

**R2-G2: BLOCKED — FROZEN CLOSURE VERIFICATION READY**  
**NEXT: R2-G2 FROZEN CLOSURE VERIFICATION**
