# R2-G2 Final Evidence Completion Plan

Status: **BLOCKED — FINAL EVIDENCE COMPLETION READY**

This is a reconciliation/replan-only artifact. It does not modify production source or tests, call semantic reviewers, run full validation, or commit the current candidate.

## Current corrected candidate

The corrected candidate is `r2-g2-o2-o4-corrected-candidate-2026-08-11`, aggregate checksum `2b58d78110cc8eaaa17e221a15dcdd4827f4d504a466e9480e4e99d48380bbd4`, with 16 files. All 16 current hashes match the correction result. No source/test file changed during this reconciliation.

## O2 evidence analysis

O2 production behavior is complete. `indexInternal` now retains the serialized `index_repository` response and calls `parseUpstreamResult` before READY publication or persistence. The existing direct-service oversized test and bounded positive/process tests are sufficient; no new O2 test is required.

The prior Code / Integration reviewer returned APPROVED semantically, but cited bare repository paths as reviewed artifact references. The deterministic validator accepts only repository-relative `path:start[-end]` references that exist in the immutable manifest and fall within its line count. The paths were present and current; they were invalid solely because they lacked line ranges. This is an evidence-pack normalization defect, not an O2 production defect.

Valid future O2 references are:

- `src/integrations/codebase-memory/service.ts:31-40`
- `src/integrations/codebase-memory/service.ts:112-139`
- `src/integrations/codebase-memory/codebase-memory.test.ts:63-67`
- `src/integrations/codebase-memory/codebase-memory.test.ts:79-80`

Candidate identity, evidence-pack identity, and per-slice checksums remain metadata and must never be emitted as evidence references.

## O4 sourceLocation analysis

The exact type is `CodeRelationship.sourceLocation?: Partial<CodeSymbolReference>`, where `CodeSymbolReference` contains `symbol`, `kind`, `file`, optional `lineStart`, `lineEnd`, `exported`, `signatureSummary`, and `checksum`.

`redactPersistedResult` handles the nested path completely. `sourceLocation.symbol`, `kind`, `file`, and `signatureSummary` pass through `redactToolText`; numeric location fields, boolean metadata, and technical checksums are preserved. The code has no remaining production defect.

The current normalizer does not populate `sourceLocation`, and the existing persistence test does not seed an already-normalized relationship containing it. The minimum future test-only extension should use the existing in-memory persistence seam to seed a normalized result, persist it through the existing metadata path, and assert:

1. no synthetic marker reaches `cache[].result.relationships[].sourceLocation`;
2. `[REDACTED]` is present;
3. ordinary nested values remain meaningful;
4. lineStart, lineEnd, exported, and checksum remain unchanged; and
5. restart/cache-hit retrieval remains redacted.

No production change is planned.

## Evidence-pack defect and future gate

The prior pack mixed citeable source ranges with opaque pack IDs, property selectors, bare paths, and candidate/checksum labels. Three reviewer outputs therefore contained invalid references even though the source candidate and pack checksums were current.

The future order is mandatory:

`candidate freeze → build bounded pack → validate every reference against immutable manifest → require evidenceValid=true → freeze pack checksum → reviewer calls`.

All four required reviewers must use the same final candidate and validated evidence pack. Architecture Reviewer remains unnecessary.

## O2 evidence table

| Evidence | Current reference | Valid? | Failure reason | Future reference/action |
|---|---|---:|---|---|
| O2 parser/limit | `service.ts:31-40` | Yes | None | Use exact range |
| O2 index boundary | `service.ts:112-139` | Yes | None | Use exact range |
| O2 oversized/positive tests | `codebase-memory.test.ts:63-67` | Yes | None | Reuse; no new test |
| O2 composed guard | `codebase-memory.test.ts:79-80` | Yes | None | Reuse exact range |
| Prior Code reviewer paths | 13 bare candidate paths | No | Missing `:start[-end]` range | Replace with validated ranges above |

## O4 sourceLocation table

| Field | Origin | Current redaction | Existing test | Future evidence |
|---|---|---|---|---|
| symbol | External | `redactToolText` | Not nested | Persisted marker absent |
| kind | External | `redactToolText` | Not nested | Persisted marker absent |
| file | External | `redactToolText` | Not nested | Persisted marker absent; ordinary path survives |
| signatureSummary | External | `redactToolText` | Not nested | Persisted marker absent |
| lineStart/lineEnd | Numeric location | Preserved | Not nested | Values unchanged |
| exported | Boolean metadata | Preserved | Not nested | Value unchanged |
| checksum | Technical checksum | Preserved | Not nested | Value unchanged |

## Issue classification table

| Issue | Production defect | Test gap | Evidence protocol gap | Future action |
|---|---:|---:|---:|---|
| O2 reviewer references | No | No | Yes | Rebuild valid line-bound references |
| O4 nested sourceLocation | No | Yes | No | One minimal test-only extension |
| `contract-audit-001` | No | No | No | Preserve as R2-G3/future hardening |

## Future file scope table

| File | Type | Future mutation | Reason |
|---|---|---|---|
| `src/integrations/codebase-memory/service.ts` | Production | None | Source inspection shows nested redaction complete |
| `src/integrations/codebase-memory/codebase-memory.test.ts` | Test | Possible one-test extension | Direct persisted/reloaded nested sourceLocation evidence |

## Reviewer currentness table

| Reviewer | Previous verdict | Evidence valid | Future rerun | Obligations |
|---|---|---:|---|---|
| Code / Integration | APPROVED | No | MUST | O2, O4 |
| Test / Quality | CHANGES_REQUIRED | No | MUST | O2, O4 |
| Security | APPROVED | Yes | MUST | O4, O2 |
| Contract Auditor | APPROVED with adjacent warning | No | MUST | O2, O4 |
| Architecture | Not required | N/A | No | None |

## Future execution sequence

| Step | Candidate mutation allowed | Required result |
|---|---|---|
| Test-only O4 extension | Test file only | Nested persisted/reloaded evidence exists |
| Targeted guards | No further mutation | O1–O7 deterministic PASS |
| Candidate freeze | No mutation | New 16-file candidate/checksum |
| Evidence-pack build | No source mutation | Same-candidate bounded pack |
| Evidence validation | No source mutation | Zero invalid references before GPT calls |
| Four reviewers | No mutation | Same candidate/pack, valid evidence, all obligations closed |
| Full validation | No mutation | Only after 7/7 semantic closure |
| Accepted commit | Explicit 16-file staging | Complete accepted candidate committed |

## State and boundaries

R2-G2 remains blocked but is now ready for one final evidence-completion execution. R2-G3 remains **NOT EXECUTED** and separate. No cleanup, customer E2E, deployment, Phase 7C/7D/7E, new dependency, agent, reviewer, skill, MCP, or provider work is included.

## Reconciliation self-audit

- Frozen contract: exactly 7 obligations.
- Corrected candidate: verified byte-for-byte.
- Production defects remaining: 0.
- Regression count: 0.
- Test-evidence gaps: 1.
- Evidence-protocol root causes: 1.
- Fresh GPT calls: 0.
- Source/test changes this run: none.
- `.qa-foundation-*`: 18 preserved.
- `.context7-cache/`: preserved untracked.
- Cleanup: not performed.

PHASE 7B / R2-G2 FINAL EVIDENCE FAILURE RECONCILIATION: COMPLETE
R2-G2: BLOCKED — FINAL EVIDENCE COMPLETION READY
NEXT: R2-G2 FINAL EVIDENCE COMPLETION — EXECUTE
