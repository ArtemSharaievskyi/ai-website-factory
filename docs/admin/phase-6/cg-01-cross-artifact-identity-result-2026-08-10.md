# Phase 6B — cg-01 Cross-Artifact Identity Result

Status: **BLOCKED**

## Root cause

`finding-b385146a5a20fb3e4f1b` identified a CRITICAL cross-artifact identity gap: canonical checksums validated document integrity, but downstream reviewer inputs did not uniformly bind every supplied artifact to the request’s `projectId` and `projectVersion`.

The Phase 6A group contract is HIGH confidence, has no dependencies, and contains exactly this one finding.

## Correction

The reviewer contract layer now has one project identity comparison rule. Contract Auditor and Code / Integration input schemas reject mismatched Brief, Planning Package, Architecture Review, Design, TaskGraph, and Contract Audit identities before review proceeds. Direct deterministic Contract Auditor execution and the existing Contract Audit service use the same invariant.

The correction does not hash whole-project state, alter checksums, rewrite historical artifacts, add a new artifact type, change reviewer authority, or redesign workflow/stack behavior.

## Files changed

| File | Change | Why required |
|---|---|---|
| `src/agents/reviewers/contracts/contracts.ts` | Added the shared project identity predicate and Contract Auditor schema invariant. | Canonical identity comparison and Contract Auditor input boundary. |
| `src/agents/reviewers/contracts/deterministic.ts` | Enforced the same identity invariant for direct deterministic calls. | Prevents bypassing the schema boundary. |
| `src/agents/reviewers/contracts/service.ts` | Reused the shared predicate in service validation. | Removes the prior duplicate comparison and preserves the existing blocked error path. |
| `src/agents/reviewers/code-integration/contracts.ts` | Added the invariant across all downstream Code / Integration artifacts. | Prevents mismatched review records reaching deterministic/provider review. |
| `src/agents/reviewers/contracts/contracts.test.ts` | Added a regression for a Brief from another project. | Proves the original schema defect is rejected. |
| `src/agents/reviewers/code-integration/code-integration.test.ts` | Added downstream identity regression coverage. | Proves the shared rule identifies a mismatched Contract Audit. |

No production files outside the Phase 6A `likelyFiles` list were changed; the two additional files are bounded regression tests required by the group contract.

## Evidence and resolution

The defect was reproduced before mutation: `ContractAuditInputSchema.parse` accepted a Brief with a different `projectId`. After correction, the targeted Contract Auditor and Code / Integration Reviewer suites passed, as did typecheck and lint.

The required same-boundary GPT-5.6 Luna rechecks could not execute because `OPENAI_API_KEY` and valid provider configuration are unavailable. Therefore the finding is recorded as `VERIFICATION_FAILED`, not RESOLVED, and the group remains correction-ready.

## Validation

| Check | Result |
|---|---|
| Targeted regression | PASS |
| TypeScript | PASS |
| ESLint | PASS; 3 pre-existing warnings only |
| Required reviewer recheck | BLOCKED; 0 real GPT calls |
| Full tests | PASS; 66 files, 808 tests |
| Build | PASS |
| Audit | PASS; 0 vulnerabilities |
| Database | PASS; validation, status, verification, integrity |
| Docker | PASS |
| TaskGraph | PASS; `releaseEligible=true` |
| `git diff --check` | PASS |

No customer website-generation E2E was run. The 12 pre-existing `.qa-foundation-*` directories were preserved.

## Next step

Keep cg-01 blocked until the Contract Auditor and Code / Integration Reviewer rechecks run through the production GPT reviewer pipeline with the approved current skills. Do not start cg-02.

Machine result: `docs/admin/phase-6/cg-01-cross-artifact-identity-result-2026-08-10.json`
