# R2-G3 O1 Review-Identity Traceability Reconciliation

Status: **BLOCKED — finite successor plan ready**
Baseline HEAD: `d4776ace417eb149cc363c5546b0919fea55a90d`
R2-G2 accepted commit: `be97c3839a494efe2d75d0edb029b2d5f7b9d009`

This was a reconciliation/planning run. No production source or test was changed, no semantic reviewer was called, no full Factory validation was run, and the current R2-G3 candidate was not committed.

## 1. Exact O1 failure

The frozen obligation is `R2-G3-O1-REVIEW-IDENTITY-TRACEABILITY` in `R2-G3-EVIDENCE_COMPLETENESS`, titled **“Persist semantic evidence and prove the generated graph path.”** The repository’s canonical definition says the final semantic execution identity was not persisted and that the earlier focused test stopped before the generated graph path (`docs/admin/phase-7b/phase-7b-semantic-reconciliation-2026-08-11.json:429-443`).

The current blocker is `tqr-r2g3-001`, severity `ERROR`, category `REQUIREMENT_NOT_VERIFIED`: the graph-policy test passes, but the frozen pack does not demonstrate persisted review identity or complete requirement → artifact → test mapping. Contract Auditor approved; Test / Quality Reviewer returned `CHANGES_REQUIRED`. The reported production-defect and regression counts are both zero.

The exact reconciliation result is:

- Ordinary project reviewer records already persist host-generated `reviewId`/`auditId`, reviewer metadata, upstream checksums, result checksum, verdict, findings, and history.
- The factory-only R2-G3 run did not use a project reviewer service record. Its temporary provider-level execution and evidence pack were not persisted.
- The existing factory self-review admin schema persists a run identity and scope/evidence checksums, but not a per-review execution ID, candidate ID/checksum, test execution ID, or a complete host-owned edge from evidence pack to reviewer result.
- Therefore O1 is primarily an **evidence-contract gap**, with current-run review identity, test execution, and pack linkage absent from durable R2-G3 artifacts.

## 2. Why O2 remains PASS

`R2-G3-O2-GENERATED-GRAPH-POLICY-EVIDENCE` is frozen as PASS. The current test at `src/orchestration/orchestrator/orchestrator.test.ts:33` calls `buildImplementationTaskGraph`, locates the generated functional task, checks resolved policy, aliases, derived capabilities, and graph validation. The generated path is implemented at `src/orchestration/orchestrator/graph.ts:57-68`, with policy resolution at `src/orchestration/orchestrator/tools.ts:6-24`.

The reported targeted result was 13/13 PASS. O2 is not reopened and the existing test remains byte-for-byte preserved.

## 3. Current candidate and authoritative-artifact findings

The current tracked candidate mutation is only:

| File | Start SHA-256 | End SHA-256 | Lines | Result |
|---|---|---|---:|---|
| `src/orchestration/orchestrator/orchestrator.test.ts` | `c290bfdc298a73e9cc5cc046d238c0c6aa314e429b79d11515e64d565b10b28f` | `c290bfdc298a73e9cc5cc046d238c0c6aa314e429b79d11515e64d565b10b28f` | 44 | Preserved |

The source-reported R2-G3 identities are retained as frozen inputs: candidate `r2-g3-evidence-candidate-2026-08-12` / `c7f2d6ad8762dee519596eb394155c35a8da4303201303fe6695c942dce542da`; pack `r2-g3-evidence-pack-2026-08-12` / `62182e6e5cb086f4addf950aa2b5be4190e8b0801dbe64898364c46cce5e8bb8`. However, no current R2-G3 machine result, evidence-pack JSON, reviewer-verification JSON, or candidate manifest exists in the repository, so these aggregate identities are not independently recoverable from a canonical machine artifact in this run. The reported 8 valid / 0 invalid references establish reference validity, not traceability completeness.

The untracked Phase 7B files are historical R2-G2 admin artifacts; `.context7-cache/` and the 18 `.qa-foundation-*` directories are known transient paths. None was cleaned or staged.

## 4. Review execution identity today

Ordinary reviewer identity is created by host code after the provider result is normalized:

- `ContractAuditService.audit` creates `auditId: randomUUID()` at `src/agents/reviewers/contracts/service.ts:169-190`.
- `TestQualityReviewService.review` creates `reviewId: randomUUID()` at `src/agents/reviewers/test-quality/service.ts:140-166`.
- The other ordinary reviewer services use the same record pattern with `reviewId`.
- The ID is created after the provider call and before the history/current record is saved. It is not a model-supplied identity.

The factory self-review path is different. `scripts/factory-self-review.ts:1200-1355` creates a deterministic whole-run `runId` from baseline, evidence-manifest, policy, reviewer, and skill identities, then calls provider adapters and writes admin findings. Its current `SelfReviewScopeResultSchema` has reviewer/scope IDs, `evidencePackChecksum`, `snapshotIdentity`, findings, and provider metadata, but no per-scope `reviewExecutionId`, candidate binding, or test execution binding. The temporary R2-G3 harness that produced the reported result is gone and left no canonical R2-G3 record.

### Review identity table

| Identity field | Created by | Host/model owned | Persisted where | Restart durable | O1 role |
|---|---|---|---|---|---|
| `reviewId` / `auditId` | Reviewer service `randomUUID()` | Host | Normal reviewer record and history | Yes for ordinary project reviews | Execution identity for service-backed reviews |
| `reviewerAgentId` / `auditorAgentId` | Agent definition + service | Host | Normal record | Yes | Reviewer identity |
| `reviewerVersion`, `capability`, `policyVersion`, `promptVersion` | Service/agent definition | Host | Normal record | Yes | Version/currentness |
| `candidateId`, candidate checksum | No current reviewer field | N/A | Not persisted for R2-G3 | No | Missing candidate binding |
| `evidencePackId`, evidence checksum | Admin scope has checksum only | Host checksum; no pack ID | Not persisted for R2-G3 | No | Missing pack binding |
| `projectId`, `projectVersion` | Reviewer input | Host | Normal project record | Yes | Normal project lineage only; do not invent for R2-G3 |
| workflow/group/obligation ID | Admin finding prose/history only | Host contract needed | Not in normal review record | No for R2-G3 | Missing O1 binding |
| `verdict`, finding IDs | Parsed provider result | Host validates; model proposes content | Normal record; transient for R2-G3 | Yes only for normal records | Result identity |
| timestamps | Service record | Host | Normal record/history | Yes | Currentness and audit timing |
| `resultChecksum` | Host checksum of parsed result | Host | Normal record | Yes | Result integrity |
| `runId` | Factory self-review harness deterministic checksum | Host | Existing self-review admin artifact | Yes when artifact exists | Whole-run identity, not per-review identity |
| `testExecutionId` | No current R2-G3 artifact | N/A | Not persisted | No | Missing test-execution identity |

## 5. Persistence authority and restart behavior

For normal customer-project reviewer services, the canonical authority is PostgreSQL’s `workflow_documents` table through `DocumentRepository`. `mapDocumentToRow` validates the typed record and stores its checksum and JSON payload; `PostgresDatabase.saveDocument/getDocument` performs the durable write/read. History is stored as a typed `*-history` document and current approval is loaded with `getCurrentReview`/`getCurrentAudit`.

Project Memory is not a reviewer authority. Reviewer services do not write reviewer records to Project Memory. The existing `full-execution` and quality documents there are runtime projections and are not a substitute for reviewer identity.

Normal records are recoverable after restart from `workflow_documents`, with schema/checksum validation. The reviewer services’ `idempotency` maps and input hashes are process-local, so a restart does not restore their in-memory result cache. Currentness is nevertheless checked against the persisted current record’s artifact checksums and APPROVED verdict. It does not currently check R2-G3 candidate ID, evidence-pack ID, test execution ID, or a complete review-execution binding.

For the current factory-only R2-G3 run, restart recovery is **NO**: there is no R2-G3 result/pack/verification artifact to load. This is why the preferred successor uses the already-established versioned admin-artifact authority for factory self-review and does not invent a customer project row or a second database review store.

### Persistence table

| Record/store | Authority | Fields relevant to O1 | Write path | Read/recovery path | Sufficient |
|---|---|---|---|---|---|
| Ordinary `contract-audit` + history | PostgreSQL `workflow_documents` | `auditId`, reviewer metadata, upstream checksums, result checksum/result | `ContractAuditService.audit` → `DocumentRepository.save` | `getCurrentAudit` → `DocumentRepository.get` | Partially; no R2-G3 candidate/pack/test binding |
| Ordinary `test-quality-review` + history | PostgreSQL `workflow_documents` | `reviewId`, reviewer metadata, source/test/quality checksums, result checksum/result | `TestQualityReviewService.review` → `DocumentRepository.save` | `getCurrentReview` → `DocumentRepository.get` | Partially; no R2-G3 candidate/pack/test binding |
| `workflow_documents` | Factory PostgreSQL | Typed JSON payload and checksum | `PostgresDatabase.saveDocument` | `getDocument` | Durable store, but no current R2-G3 row |
| `SelfReviewArtifact` | Factory admin JSON artifact | `runId`, baseline, manifest checksum, reviewer/scope/evidence checksums, findings | `scripts/factory-self-review.ts` | JSON artifact load/checksum validation | Partially; no per-review execution/candidate/test identity |
| Project Memory | Runtime filesystem projection | Quality/full-execution references | Runtime/project-memory services | Project Memory readers | Not a reviewer authority |
| Current R2-G3 result | None present | None | Removed transient harness only | No recovery path | No |

## 6. Current traceability graph

| From | To | Linking field/reference | Exists | Durable | Missing action |
|---|---|---|---|---|---|
| O1 requirement | R2-G3 definition | `R2-G3-O1-REVIEW-IDENTITY-TRACEABILITY`, source finding `contract-audit-001` | Yes | Yes in historical admin contract | Carry the same obligation ID into the final machine result |
| Generated graph | Test source | `buildImplementationTaskGraph` and generated functional task | Yes | Yes in source/test | Preserve O2 evidence |
| Test source | 13/13 execution | Command and test name only | Yes, transient | No | Persist `testExecutionId`, result, source/test checksums |
| Test execution | Candidate | Candidate checksum + test execution ID | No durable edge | No | Bind both in host record |
| Candidate | Evidence pack | Candidate ID/checksum + pack ID/checksum | Reported only | No | Persist manifest and pack artifact |
| Evidence pack | Reviewer execution | Review execution ID + candidate/pack checksums | No | No | Add host-owned per-review identity record |
| Reviewer execution | Verdict/findings | Result checksum + verdict + finding IDs | Transient only for R2-G3 | No | Persist and reload the result record |

The smallest broken edge is not the source-reference syntax. It is:

`test execution → candidate → evidence pack → host-owned reviewer execution → verdict`.

The current eight valid references do not close that edge because a source line range cannot stand in for a persisted record identity.

## 7. Classification and minimal successor

| Issue | Production defect | Factory infra defect | Test gap | Evidence gap | Persistence gap | Action |
|---|---:|---:|---:|---:|---:|---|
| Customer/generated website behavior | No | No | No | No | No | No production change |
| Current R2-G3 reviewer execution | No | Yes | Yes | Yes | Yes | Persist host-owned identity in the existing factory admin artifact |
| Ordinary reviewer record model | No | Partial limitation | No | Yes for R2-G3 binding | No for ordinary project records | Reuse; do not add a parallel DB authority |
| Current evidence references | No | No | No | Yes completeness gap | No | Rebuild one pack with structured identity metadata and validate before calls |

Primary root cause: **`EVIDENCE_CONTRACT_GAP`**, confidence **HIGH**. Secondary causes are current-run `REVIEW_IDENTITY_NOT_PERSISTED`, `EVIDENCE_PACK_LINKAGE_GAP`, and `TEST_EXECUTION_NOT_PERSISTED`.

Required mutation type: **`EVIDENCE_CONTRACT_FIX`**. This is a bounded Factory-review infrastructure/admin-artifact correction, not a customer-production defect. It needs no PostgreSQL migration and no new persistence authority, but it does need a typed admin-contract extension so the host can persist the missing fields.

Preferred single solution:

1. Extend the existing factory self-review artifact producer/schema to persist one host-generated `reviewExecutionId` per required reviewer, plus candidate, evidence-pack, test-execution, result, verdict, finding, obligation, reviewer/version, and currentness bindings.
2. Persist one new R2-G3 evidence pack and one machine result under `docs/admin/phase-7b/`.
3. Add the smallest deterministic round-trip test in `src/operations/factory-self-review.test.ts`.
4. Re-run only Contract Auditor and Test / Quality Reviewer against the same immutable candidate and pack.
5. Stop after those two verdicts; no correction cycle.

### File scope table

| File | Type | Future mutation | Reason |
|---|---|---|---|
| `scripts/factory-self-review.ts` | Factory infrastructure | Yes, bounded admin identity contract/output only | Existing factory self-review producer lacks per-review execution and candidate/test bindings |
| `src/operations/factory-self-review.test.ts` | Test | Yes, one deterministic persistence/round-trip proof | Prove observable identity survives serialization/reload |
| `src/orchestration/orchestrator/orchestrator.test.ts` | Current O2 candidate | No | Preserve frozen O2 test byte-for-byte |
| `src/domain/review/schema.ts` | Ordinary review contract | No | Existing project review identity remains authoritative; no customer-lineage expansion |
| `docs/admin/phase-7b/r2-g3-o1-evidence-pack-2026-08-12.json` | Admin evidence | Future only | New pack identity/checksum and manifest-bound references |
| `docs/admin/phase-7b/r2-g3-o1-review-identity-traceability-result-2026-08-12.json` | Admin machine result | Future only | Persist complete host-owned chain |
| `docs/admin/phase-7b/r2-g3-o1-review-identity-traceability-result-2026-08-12.md` | Admin report | Future only | Human-readable projection of the machine result |

`futureProductionFiles` is explicitly `[]`.

## 8. Future trace and acceptance

The required machine-reconstructible chain is:

`R2-G3-O1-REVIEW-IDENTITY-TRACEABILITY`
→ `taskGraphChecksum` / generated functional task
→ `src/orchestration/orchestrator/orchestrator.test.ts:33` plus test-source checksum
→ host-generated `testExecutionId` and exact 13/13 result
→ candidate ID/checksum and per-file manifest
→ new evidence-pack ID/checksum and evidence-manifest checksum
→ host-generated per-review `reviewExecutionId`, reviewer/version, policy/prompt, candidate/pack/result checksums
→ verdict, finding IDs, obligation ID, timestamps.

### O1 acceptance table

| Criterion | Current evidence | Missing? | Future deterministic proof |
|---|---|---:|---|
| Durable review execution identity | Ordinary service UUID fields exist; current R2-G3 has none | Yes | Persist and reload host-generated per-review `reviewExecutionId` |
| Candidate binding | Reported aggregate only; no current manifest | Yes | Candidate ID/checksum equals frozen per-file manifest aggregate |
| Evidence-pack binding | Reported pack checksum only; no current pack file | Yes | New pack ID/checksum and manifest checksum are stored in each reviewer record |
| O1/finding identity | Historical source findings exist; current result absent | Yes | Persist O1 plus `contract-audit-001`/`tqr-r2g3-001` identities |
| Requirement → artifact → test | Source/test evidence exists, but no typed final edge | Yes | Persist exact graph checksum, test name/range, and references |
| Test execution | 13/13 was transient | Yes | Persist `testExecutionId`, command, result, source/test checksums |
| Restart reconstruction | No current R2-G3 artifact | Yes | Reload JSON machine record and compare all identity/checksum fields |
| Reference validity | Reported 8 valid / 0 invalid | No for syntax | Validate all pack refs before reviewer calls |
| Same frozen candidate/pack for both reviewers | Reported no mutation | Not yet durable | Freeze pack and verify both reviewer records match both checksums |

O2 remains a deterministic regression guard only. It is not a new obligation and does not require another graph-policy implementation/test change.

## 9. Future reviewer plan

| Reviewer | Previous verdict | Future rerun | O1 scope | Reason |
|---|---|---|---|---|
| Contract Auditor | APPROVED | MUST_RERUN | Cross-stage identity and requirement/artifact/test mapping | New evidence identity makes the old provider-level result non-current |
| Test / Quality Reviewer | CHANGES_REQUIRED | MUST_RERUN | Durable test execution, evidence completeness, and same candidate/pack | Owns the frozen O1 blocker |
| Architecture Reviewer | Not required | DO NOT RUN | None | No architecture contract change |
| Code / Integration Reviewer | Not required | DO NOT RUN | None | No source integration change |
| Security Reviewer | Not required | DO NOT RUN | None | No security-surface change |

Budget: one bounded Factory infrastructure cycle, one new pack, two reviewer calls, zero correction cycles, and no full Factory validation.

## 10. Candidate, evidence, and scope policy

- Any future source/test mutation creates a new candidate ID and checksum. Candidate reuse is allowed only after a new per-file hash verification proves no source/test mutation.
- Any evidence change creates a new evidence-pack ID and checksum.
- Both required reviewers inspect the same immutable candidate and pack; mutation between calls is forbidden.
- Structured reviewer/database/admin identities remain structured metadata. They must not be forced into `path:start-end` source-reference syntax.
- No reviewer self-assertion or raw model field is authoritative without host validation and binding.
- No raw prompts, chain-of-thought, secrets, or full model context are persisted.

## 11. Validation and final state

This reconciliation’s fresh GPT/provider call count is **0**. The current candidate start/end hashes are equal. The plan JSON must be parsed against repository conventions and `git diff --check` must pass before the plan-only commit.

Final state after this plan commit:

- R2-G2: **COMPLETE**
- R2-G3-O2: **PASS / FROZEN**
- R2-G3-O1: **BLOCKED — successor plan ready**
- R2-G3: **BLOCKED**
- Phase 7B: **BLOCKED**

Next action: execute one future authorized implementation turn containing only the bounded Factory-review evidence-contract extension, one new evidence pack, the two required reviewer calls, and deterministic reload/identity checks. Mark O1 complete only if every acceptance criterion passes; otherwise remain blocked without a correction cycle.
