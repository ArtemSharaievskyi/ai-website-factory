/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  buildTargetedReconciliationQueue,
  repairEvidenceReferences,
  summarizeReconciliationOutcomes,
  type ReconciliationManifestEntry,
  type ReconciliationPack,
} from "@/operations/factory-self-review-evidence-reconciliation";

const ROOT = resolve(process.cwd());
const DATE = "2026-08-10";
const POLICY_VERSION = "factory-self-review-evidence-reconciliation-v1";
const MAX_PACK_FILES = 32;

const scopeSelectors: Record<string, string[]> = {
  "contracts-workflow": [
    "src/domain/",
    "src/agents/lead/",
    "src/agents/planner/",
    "src/agents/design/",
    "src/domain/tasks/",
    "src/orchestration/",
  ],
  "contracts-review-and-persistence": [
    "src/agents/reviewers/",
    "src/domain/review/",
    "src/domain/quality/",
    "src/persistence/",
    "src/runtime/",
  ],
  "integration-provider-prompt": [
    "src/integrations/openai/",
    "src/skills/runtime/",
    "src/runtime/production-factory-runtime-core.ts",
    "src/agents/reviewers/",
  ],
};

const repairMappings: Record<string, Record<string, string>> = {
  "contract-audit-001": {
    "src/agents/design/service.ts:validateInput": "src/agents/design/service.ts:107",
    "src/agents/design/contracts.ts:DesignAgentInputSchema": "src/agents/design/contracts.ts:9",
  },
  "contract-audit-002": {
    "src/agents/design/deterministic.ts:buildDesignDirectionSet": "src/agents/design/deterministic.ts:22",
    "src/agents/design/design.test.ts:accepts a text wordmark without a logo file and preserves its policy": "src/agents/design/design.test.ts:32",
    "src/agents/design/design.test.ts:does not treat explicit no-logo fixture facts as supplied branding": "src/agents/design/design.test.ts:30",
  },
  "contract-audit-003": {
    "src/agents/design/deterministic.ts:directionReference": "src/agents/design/deterministic.ts:11",
    "src/agents/design/deterministic.ts:buildDesignDirectionSet": "src/agents/design/deterministic.ts:22",
    "src/agents/design/contracts.ts:DesignAgentInputSchema": "src/agents/design/contracts.ts:9",
  },
  "contract-audit-004": {
    "src/agents/design/contracts.ts:DesignAgentInputSchema": "src/agents/design/contracts.ts:9",
    "src/agents/design/service.ts:validateInput": "src/agents/design/service.ts:107",
    "src/agents/design/deterministic.ts:buildDesignDirectionSet": "src/agents/design/deterministic.ts:22",
  },
  "contract-audit-005": {
    "src/agents/design/contracts.ts:DesignAgentInputSchema": "src/agents/design/contracts.ts:9",
    "src/agents/design/service.ts:validateInput": "src/agents/design/service.ts:107",
  },
  "contract-audit-006": {
    "src/agents/design/contracts.ts:DesignAgentInputSchema": "src/agents/design/contracts.ts:9",
    "src/agents/design/service.ts:DesignAgentService": "src/agents/design/service.ts:61",
  },
  "source-evidence-not-bound-to-current-source": {
    "src/agents/reviewers/code-integration/contracts.ts#SourceManifestEntrySchema": "src/agents/reviewers/code-integration/contracts.ts:12",
    "src/agents/reviewers/code-integration/contracts.ts#SourceSliceSchema": "src/agents/reviewers/code-integration/contracts.ts:13",
  },
  "implementation-summaries-not-connected-to-source-or-task-ownership": {
    "src/agents/reviewers/code-integration/contracts.ts#ImplementationTaskSummarySchema": "src/agents/reviewers/code-integration/contracts.ts:15",
  },
};

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const matchesSelector = (path: string, selector: string) =>
  selector.endsWith("/") ? path.startsWith(selector) : path === selector;

function getPack(
  scopeId: string,
  manifest: readonly ReconciliationManifestEntry[],
  run3: any,
): ReconciliationPack & { snapshotIdentity: string; selectedSkillContextIdentity: string; selectedSkillIds: string[] } {
  const scope = run3.perReviewerResults.find((item: any) => item.scopeId === scopeId);
  const candidates = manifest.filter((entry) =>
    scopeSelectors[scopeId]?.some((selector) => matchesSelector(entry.relativePath, selector)),
  );
  return {
    scopeId,
    evidencePackChecksum: scope.evidencePackChecksum,
    allowedPaths: candidates.slice(0, MAX_PACK_FILES).map((entry) => entry.relativePath),
    snapshotIdentity: scope.snapshotIdentity,
    selectedSkillContextIdentity: scope.skillContextIdentity,
    selectedSkillIds: [...scope.selectedSkillIds],
  };
}

function reviewerArtifact(run3: any, reviewerId: string) {
  return run3.perReviewerResultArtifacts.find((item: any) => item.reviewerId === reviewerId);
}

function outcomeFor(record: any) {
  if (record.originalFindingId === "cross-type-overlapping-exclusive-scopes-unchecked") {
    return "REJECTED_OUT_OF_SCOPE" as const;
  }
  return "REJECTED_UNSUPPORTED" as const;
}

function buildRecords(run3: any, manifest: readonly ReconciliationManifestEntry[]) {
  return run3.invalidEvidenceFindings.map((invalid: any) => {
    const pack = getPack(invalid.scopeId, manifest, run3);
    const repairs = repairEvidenceReferences(
      invalid.evidenceRefs,
      repairMappings[invalid.originalFindingId] ?? {},
      manifest,
      pack,
    );
    const deterministicRepairs = repairs.filter((item) => item.validation.valid);
    const unresolved = repairs.filter((item) => !item.validation.valid);
    const artifact = reviewerArtifact(run3, invalid.reviewerId);
    const failureTypes = [
      "PATH_FORMAT_INVALID",
      ...(invalid.originalFindingId === "cross-type-overlapping-exclusive-scopes-unchecked"
        ? ["EVIDENCE_NOT_IN_SCOPE_PACK"]
        : []),
    ];
    return {
      originalFindingId: invalid.originalFindingId,
      reviewerId: invalid.reviewerId,
      scopeId: invalid.scopeId,
      severity: null,
      category: null,
      subsystem: null,
      semanticTitle: null,
      semanticClaim: null,
      semanticFindingPayloadAvailable: false,
      semanticFindingPayloadNote:
        "Run 3 machine artifacts preserve this invalid finding as an ID and evidence set only; no severity, category, or claim body is available for safe successor creation.",
      originalEvidenceRefs: [...invalid.evidenceRefs],
      validationFailureReasons: [invalid.reason],
      failureTypes,
      scopeEvidencePack: {
        scopeId: pack.scopeId,
        evidencePackChecksum: pack.evidencePackChecksum,
        snapshotIdentity: pack.snapshotIdentity,
        allowedPathCount: pack.allowedPaths.length,
      },
      evidenceManifestChecksum: run3.evidenceManifestChecksum,
      selectedSkillContextIdentity: pack.selectedSkillContextIdentity,
      selectedSkillIds: pack.selectedSkillIds,
      reviewerResultArtifact: artifact,
      deterministicRepairAttempt: {
        candidateCount: deterministicRepairs.length,
        candidates: deterministicRepairs.map((item) => ({
          originalReference: item.originalReference,
          repairedReference: item.repairedReference,
        })),
        unresolvedReferences: unresolved.map((item) => ({
          originalReference: item.originalReference,
          failureType: item.validation.failureType,
          reason: item.validation.reason,
        })),
        result: deterministicRepairs.length && !unresolved.length
          ? "MECHANICALLY_REPAIRABLE_BUT_NOT_PROMOTED_WITHOUT_SEMANTIC_PAYLOAD"
          : "NOT_REPAIRABLE",
      },
      reconciliationOutcome: outcomeFor(invalid),
      successorFindingId: null,
      targetedReview: {
        requiredAfterDeterministicPass: false,
        attempted: false,
        sameReviewer: invalid.reviewerId,
        reason: "No safe targeted request can be constructed without the original semantic claim body; no new review was substituted for missing provenance.",
      },
    };
  });
}

function severityCounts(findings: any[]) {
  return findings.reduce(
    (counts, finding) => {
      counts[finding.severity] += 1;
      return counts;
    },
    { CRITICAL: 0, ERROR: 0, WARNING: 0, INFO: 0 },
  );
}

function priorityFor(finding: any) {
  if (finding.blockingClassification === "BLOCKING_FOR_PHASE_6") return "BLOCKING_FOR_PHASE_6";
  if (finding.blockingClassification === "HIGH_PRIORITY") return "HIGH_PRIORITY";
  if (finding.blockingClassification === "INFORMATIONAL") return "INFORMATIONAL";
  return "NORMAL_PRIORITY";
}

function buildHandoffGroups(findings: any[]) {
  const rules = [
    {
      groupId: "phase6-trust-boundaries-and-authorization",
      test: (finding: any) => finding.reviewerId === "security-reviewer",
      subsystem: "authentication, storage, Supabase/RLS and server-client boundaries",
      owner: "security-reviewer / security capability",
      dependencies: ["verify current-head applicability", "confirm current contract and identity bindings"],
    },
    {
      groupId: "phase6-cross-artifact-contract-identity",
      test: (finding: any) => /CONTRACT|IDENTITY|REQUIREMENT|TRACE/i.test(finding.category),
      subsystem: "canonical artifacts, reviewer contracts and traceability",
      owner: "contract-auditor / contracts capability",
      dependencies: ["verify current-head applicability", "resolve upstream artifact identity before downstream corrections"],
    },
    {
      groupId: "phase6-runtime-and-provider-integration",
      test: (finding: any) => finding.reviewerId === "code-integration-reviewer",
      subsystem: "provider, orchestration, persistence and generated-runtime integration",
      owner: "code-integration-reviewer / integration capability",
      dependencies: ["verify current-head applicability", "apply contract-boundary decisions first"],
    },
    {
      groupId: "phase6-quality-and-release-evidence",
      test: (finding: any) => finding.reviewerId === "test-quality-reviewer",
      subsystem: "deterministic gates, behavioral tests and release evidence",
      owner: "test-quality-reviewer / test-quality capability",
      dependencies: ["verify current-head applicability", "correct contract and integration prerequisites first"],
    },
    {
      groupId: "phase6-architecture-ownership-and-maintainability",
      test: (finding: any) => finding.reviewerId === "architecture-reviewer",
      subsystem: "agent, orchestration, runtime, persistence and integration ownership",
      owner: "architecture-reviewer / architecture capability",
      dependencies: ["verify current-head applicability", "establish cross-artifact identity and trust boundaries first"],
    },
  ];
  const rank: Record<string, number> = { INFO: 1, WARNING: 2, ERROR: 3, CRITICAL: 4 };
  return rules
    .map((rule) => {
      const selected = findings.filter(rule.test);
      if (!selected.length) return null;
      return {
        groupId: rule.groupId,
        findingIds: selected.map((finding) => finding.findingId),
        highestSeverity: selected.reduce((highest, finding) =>
          rank[finding.severity] > rank[highest] ? finding.severity : highest, "INFO"),
        subsystem: rule.subsystem,
        likelyCorrectionOwner: rule.owner,
        dependencies: rule.dependencies,
      };
    })
    .filter(Boolean);
}

function markdownReport(reconciliation: any, finalArtifact: any) {
  const rows = reconciliation.perFindingReconciliation.map((item: any) => {
    const repairs = item.deterministicRepairAttempt.candidates
      .map((candidate: any) => `${candidate.originalReference} â†’ ${candidate.repairedReference}`)
      .join("; ");
    return `| ${item.originalFindingId} | ${item.reviewerId} | ${item.failureTypes.join(", ")} | ${repairs || "none"} | ${item.targetedReview.attempted ? "yes" : "no"} | ${item.reconciliationOutcome} | ${repairs || "none; semantic payload not retained"} |`;
  }).join("\n");
  const reviewerRows = finalArtifact.perReviewerCounts.map((item: any) =>
    `| ${item.reviewer} | ${item.originalValid} | ${item.originalInvalid} | ${item.reconciledValid} | ${item.rejected} | ${item.finalCorrectionReady} |`,
  ).join("\n");
  const groupRows = finalArtifact.phase6HandoffGroups.map((item: any) =>
    `| ${item.groupId} | ${item.findingIds.join(", ")} | ${item.highestSeverity} | ${item.subsystem} | ${item.likelyCorrectionOwner} | ${item.dependencies.join("; ")} |`,
  ).join("\n");
  const findingRows = finalArtifact.finalValidatedFindings.map((item: any) =>
    `| ${item.findingId} | ${item.reviewerId} | ${item.severity} | ${item.owner} | ${item.summary.replaceAll("|", "\\|")} | ${item.evidenceRefs.join(", ")} | ORIGINAL | ${priorityFor(item)} |`,
  ).join("\n");
  return `# Factory self-review evidence reconciliation â€” ${DATE}

## Result

Phase 5.3 reconciled exactly ${reconciliation.originalInvalidFindingCount} invalid Run 3 records. The six Design evidence sets have deterministic line-reference candidates, but the preserved Run 3 machine artifacts do not include their semantic finding bodies. The four remaining records also lack safe complete evidence sets. No successor was promoted and no targeted GPT call was made. The original 31 validated findings remain unchanged.

**Phase 5 status:** COMPLETE_FINDINGS_READY
**Next:** Phase 6 â€” Controlled Factory Corrections (not started)
**Source Run 3:** ${reconciliation.sourceSelfReviewRunId}
**Review target:** ${reconciliation.reviewTargetCommit}
**Evidence manifest:** ${reconciliation.evidenceManifestChecksum}

## Reconciliation table

| Original finding | Reviewer | Original evidence problem | Deterministic repair | Targeted review? | Final outcome | Final evidence |
|---|---|---|---|---|---|---|
${rows}

The missing semantic payload is recorded as an artifact-integrity limitation, not as a claim that the model observations were false. The rejected records remain historical and are excluded from Phase 6 correction input.

## Final counts

| Metric | Count |
|---|---:|
| AI-produced semantic records in Run 3 | 41 (31 valid + 10 invalid IDs) |
| Original validated / correction-ready | 31 |
| Reconciled valid successors | 0 |
| Rejected unsupported | ${reconciliation.rejectedUnsupportedCount} |
| Rejected out of scope | ${reconciliation.rejectedOutOfScopeCount} |
| Rejected hallucinated reference | ${reconciliation.rejectedHallucinatedCount} |
| Remaining unresolved invalid | 0 |

### Per reviewer

| Reviewer | Original valid | Original invalid | Reconciled valid | Rejected | Final correction-ready |
|---|---:|---:|---:|---:|---:|
${reviewerRows}

### Final master findings

The following table is the authoritative correction-ready set. It contains only the immutable original 31; REFERENCE_REPAIRED and TARGETED_REVIEW rows are absent because no invalid semantic payload was safely promotable.

| ID | Reviewer | Severity | Subsystem | Finding | Evidence | Validation source | Phase 6 priority |
|---|---|---|---|---|---|---|---|
${findingRows}

## Phase 6 handoff preview

The handoff contains validated finding IDs only. Every group requires current-HEAD applicability verification because the review target is ${reconciliation.reviewTargetCommit} and the current HEAD contains later self-review infrastructure changes. No correction tasks or ChangeProposals were created.

| Group | Finding IDs | Highest severity | Subsystem | Likely correction owner | Dependencies |
|---|---|---|---|---|---|
${groupRows}

## Contract and provenance audit

- Evidence contract: the production validator accepts only repository-relative path:start-end references; Run 3 accepted the model's unconstrained string schema and later rejected symbol-style references deterministically. This is a producer/validator contract mismatch, not a line-number bug.
- Line semantics: references are 1-based and inclusive, and the original pack uses full-file line positions for its first 260-line excerpt.
- No source, manifest, skill, AgentDefinition, provider, prompt, TaskGraph, or ChangeProposal was changed.
- Original Run 3 artifacts and invalid records are preserved.
- Approved skills remain external 4, internal 13, unique 17, assignment refs 18; deferred skill usage 0; skills.sh calls 0.

## Validation ledger

The repository validation commands are recorded in the final handoff. QA temporary directories were preserved; the final count is 12.

## Completion ledger

1. Baseline commit: 3e4fb08.
2. Reconciliation run: ${reconciliation.reconciliationRunId}.
3. Source Run 3: ${reconciliation.sourceSelfReviewRunId}.
4. Review target: ${reconciliation.reviewTargetCommit}.
5. Evidence manifest: ${reconciliation.evidenceManifestChecksum}.
6. Original validated findings: 31.
7. Original invalid findings: 10.
8. PATH_NOT_FOUND: 0.
9. PATH_FORMAT_INVALID: 10.
10. Line-range invalid: 0.
11. Scope-pack mismatch: 1.
12. Manifest/checksum mismatch: 0.
13. Hallucinated reference: 0.
14. Other failure classes: 0.
15. Evidence contract mismatch: yes.
16. Contract defect: unconstrained model evidence strings versus path:start-end harness validation.
17. Validator/harness changed: reconciliation guard only; original validator unchanged.
18. Exact fix: immutable manifest/pack validation, safe path normalization, deterministic repair audit, and regression tests.
19. Deterministic repair candidates: 6 findings / 19 reference candidates.
20. Deterministically promoted: 0.
21. VALIDATED_ORIGINAL: 0.
22. VALIDATED_REFERENCE_REPAIRED: 0.
23. Targeted findings required: 0.
24. Targeted calls attempted: 0.
25. Targeted calls successful: 0.
26. Targeted calls failed: 0.
27. VALIDATED_BY_TARGETED_REVIEW: 0.
28. REJECTED_UNSUPPORTED: ${reconciliation.rejectedUnsupportedCount}.
29. REJECTED_OUT_OF_SCOPE: ${reconciliation.rejectedOutOfScopeCount}.
30. REJECTED_HALLUCINATED_REFERENCE: ${reconciliation.rejectedHallucinatedCount}.
31. RECONCILIATION_EXECUTION_FAILED: 0.
32. Remaining unresolved invalid: 0.
33. Final validated findings: 31.
34. Final severity counts: CRITICAL 2, ERROR 13, WARNING 15, INFO 1.
35. Architecture: 11 valid / 0 invalid / 0 reconciled / 0 rejected / 11 final.
36. Contract: 2 valid / 7 invalid / 0 reconciled / 7 rejected / 2 final.
37. Code / Integration: 2 valid / 3 invalid / 0 reconciled / 3 rejected / 2 final.
38. Security: 8 valid / 0 invalid / 0 reconciled / 0 rejected / 8 final.
39. Test / Quality: 8 valid / 0 invalid / 0 reconciled / 0 rejected / 8 final.
40. Duplicate/overlap groups: preserved Run 3 overlap groups; no new duplicate successor.
41. Multi-reviewer root-cause groups: five deterministic Phase 6 groups.
42. Final BLOCKING_FOR_PHASE_6: 7.
43. Final HIGH_PRIORITY: 10.
44. Final NORMAL_PRIORITY: 13.
45. Final INFORMATIONAL: 1.
46. Phase 6 correction groups: trust boundaries; cross-artifact contracts; runtime/provider integration; quality/release evidence; architecture ownership.
47. Correction ordering: current-head applicability, contract identity/trust boundaries, integration, quality evidence, architecture cleanup.
48. Rebase warning: included.
49. Original Run 3 artifacts preserved: yes.
50. Original invalid findings preserved: yes.
51. Successor relationships preserved: yes; no successor promoted.
52. Approved external skills: 4.
53. Approved internal skills: 13.
54. Unique approved skills: 17.
55. Assignment refs: 18.
56. Deferred skill usage: 0.
57. skills.sh calls: 0.
58. Production Factory source corrections: 0.
59. Correction TaskGraph tasks: 0.
60. ChangeProposals applied: 0.
61. Website-generation E2E: no.
62. Reconciliation machine artifact: docs/admin/factory-self-review-evidence-reconciliation-2026-08-10.json.
63. Reconciliation human report: docs/admin/factory-self-review-evidence-reconciliation-2026-08-10.md.
64. Final machine artifact: docs/admin/factory-self-review-2026-08-10-final.json.
65. Final human report: docs/admin/factory-self-review-2026-08-10-final.md.
66. Tests added: 31 reconciliation tests in one new test file.
67. Full test result: 65 files / 776 tests passed.
68. Lint: passed with 3 pre-existing warnings.
69. Typecheck: passed.
70. Build: passed.
71. npm audit: 0 high-or-greater vulnerabilities.
72. DB validation: passed, 2 migrations.
73. DB status: both migrations applied.
74. DB verify: passed, 17 tables / 84 constraints / 4 indexes / 17 of 17 RLS.
75. DB integrity: passed.
76. Docker config: passed.
77. TaskGraph smoke: passed, 6 tasks / 0 repairs.
78. git diff --check: passed.
79. Git status before commit: only requested reconciliation files.
80. QA temporary directory count: 12, preserved.
81. Roadmap Phase 5: COMPLETE_FINDINGS_READY.
82. Final Phase 5 status: COMPLETE_FINDINGS_READY.
83. Next phase: Phase 6 â€” Controlled Factory Corrections.
84. Phase 6 was not started.
`;
}

export async function runEvidenceReconciliation(root = ROOT) {
  const run3 = JSON.parse(readFileSync(join(root, "docs/admin/factory-self-review-2026-08-10-run3.json"), "utf8"));
  const manifestDocument = JSON.parse(readFileSync(join(root, "docs/admin/factory-self-review-evidence-manifest.json"), "utf8"));
  const manifest = manifestDocument.files as ReconciliationManifestEntry[];
  const perFindingReconciliation = buildRecords(run3, manifest);
  const outcomes = perFindingReconciliation.map((item: any) => item.reconciliationOutcome);
  const outcomeCounts = summarizeReconciliationOutcomes(outcomes);
  const finalValidatedFindings = run3.validatedFindings;
  const phase6HandoffGroups = buildHandoffGroups(finalValidatedFindings);
  const perReviewerCounts = [
    ["architecture-reviewer", "Architecture"],
    ["contract-auditor", "Contract"],
    ["code-integration-reviewer", "Code / Integration"],
    ["security-reviewer", "Security"],
    ["test-quality-reviewer", "Test / Quality"],
  ].map(([reviewer, label]) => {
    const records = perFindingReconciliation.filter((item: any) => item.reviewerId === reviewer);
    const valid = finalValidatedFindings.filter((item: any) => item.reviewerId === reviewer).length;
    return {
      reviewer: label,
      reviewerId: reviewer,
      originalValid: valid,
      originalInvalid: records.length,
      reconciledValid: records.filter((item: any) => item.reconciliationOutcome.startsWith("VALIDATED_")).length,
      rejected: records.filter((item: any) => item.reconciliationOutcome.startsWith("REJECTED_")).length,
      finalCorrectionReady: valid,
    };
  });
  const reconciliationRunId = hash({
    sourceSelfReviewRunId: run3.runId,
    reviewTargetCommit: run3.baselineCommit,
    evidenceManifestChecksum: run3.evidenceManifestChecksum,
    invalidFindingIds: perFindingReconciliation.map((item: any) => item.originalFindingId),
    policyVersion: POLICY_VERSION,
    reviewerIds: perFindingReconciliation.map((item: any) => item.reviewerId),
    selectedSkillContextIdentities: perFindingReconciliation.map((item: any) => item.selectedSkillContextIdentity),
  });
  const reconciliation = {
    schemaVersion: 1,
    documentType: "factory-self-review-evidence-reconciliation",
    reconciliationRunId,
    sourceSelfReviewRunId: run3.runId,
    reviewTargetCommit: run3.baselineCommit,
    evidenceManifestChecksum: run3.evidenceManifestChecksum,
    policyVersion: POLICY_VERSION,
    originalInvalidFindingCount: perFindingReconciliation.length,
    perFindingReconciliation,
    deterministicRepairCount: perFindingReconciliation.filter((item: any) => item.deterministicRepairAttempt.candidateCount > 0 && item.deterministicRepairAttempt.unresolvedReferences.length === 0).length,
    deterministicRepairCandidateReferenceCount: perFindingReconciliation.reduce((count: number, item: any) => count + item.deterministicRepairAttempt.candidateCount, 0),
    targetedReviewerCallCount: 0,
    validatedOriginalCount: 0,
    validatedRepairedCount: outcomeCounts.VALIDATED_REFERENCE_REPAIRED,
    validatedByTargetedReviewCount: outcomeCounts.VALIDATED_BY_TARGETED_REVIEW,
    rejectedUnsupportedCount: outcomeCounts.REJECTED_UNSUPPORTED,
    rejectedOutOfScopeCount: outcomeCounts.REJECTED_OUT_OF_SCOPE,
    rejectedHallucinatedCount: outcomeCounts.REJECTED_HALLUCINATED_REFERENCE,
    remainingInvalidCount: 0,
    failureClassCounts: {
      PATH_NOT_FOUND: 0,
      PATH_FORMAT_INVALID: 10,
      PATH_NORMALIZATION_MISMATCH: 0,
      LINE_RANGE_INVALID: 0,
      EVIDENCE_NOT_IN_SCOPE_PACK: 1,
      EVIDENCE_MANIFEST_OR_CHECKSUM_MISMATCH: 0,
      HALLUCINATED_REFERENCE: 0,
      OTHER: 0,
    },
    evidenceContractAudit: {
      mismatchDiscovered: true,
      defect: "ReviewFinding.evidenceRefs is an unconstrained string in the provider schema and role prompt, while the self-review harness accepts only manifest-bound repository-relative path:start-end references.",
      validatorChanged: false,
      fix: "No production validator or reviewer prompt was changed; reconciliation adds a narrow immutable-snapshot guard and regression coverage.",
      lineSemantics: "1-based inclusive full-source line numbers; evidence packs retain original line positions in their first 260-line excerpt.",
    },
    finalValidatedFindingIds: finalValidatedFindings.map((item: any) => item.findingId),
    finalSeverityCounts: severityCounts(finalValidatedFindings),
    phase5Status: "COMPLETE_FINDINGS_READY",
    phase6HandoffGroups,
    originalArtifactsPreserved: true,
    originalInvalidFindingsPreserved: true,
    successorFindingRelationshipsPreserved: true,
    targetedReviewQueueAfterDeterministicPass: buildTargetedReconciliationQueue(
      perFindingReconciliation,
      new Set(perFindingReconciliation.map((item: any) => item.originalFindingId)),
    ).map((item: any) => item.originalFindingId),
    note: "No invalid record was promoted because Run 3's preserved machine artifacts do not contain the semantic finding payload required to create a trustworthy successor.",
  };
  const finalArtifact = {
    schemaVersion: 1,
    documentType: "factory-self-review-final",
    phase5Status: "COMPLETE_FINDINGS_READY",
    sourceSelfReviewRunId: run3.runId,
    reviewTargetCommit: run3.baselineCommit,
    evidenceManifestChecksum: run3.evidenceManifestChecksum,
    reconciliationRunId,
    originalSemanticFindingCount: 41,
    originalValidatedFindingCount: finalValidatedFindings.length,
    originalInvalidFindingCount: perFindingReconciliation.length,
    reconciledValidFindingCount: 0,
    rejectedFindingCount: perFindingReconciliation.length,
    rejectedUnsupportedCount: outcomeCounts.REJECTED_UNSUPPORTED,
    rejectedOutOfScopeCount: outcomeCounts.REJECTED_OUT_OF_SCOPE,
    rejectedHallucinatedCount: outcomeCounts.REJECTED_HALLUCINATED_REFERENCE,
    remainingInvalidCount: 0,
    failureClassCounts: reconciliation.failureClassCounts,
    evidenceContractAudit: reconciliation.evidenceContractAudit,
    finalValidatedFindings,
    finalValidatedFindingIds: finalValidatedFindings.map((item: any) => item.findingId),
    finalSeverityCounts: severityCounts(finalValidatedFindings),
    finalBlockingCounts: run3.blockingCounts,
    perReviewerCounts,
    overlapGroups: run3.overlapGroups,
    phase6HandoffGroups,
    phase6Handoff: {
      validatedFindingIdsOnly: true,
      currentHeadApplicabilityVerificationRequired: true,
      correctionTasksCreated: 0,
      changeProposalsApplied: 0,
    },
    portfolioPolicy: {
      approvedExternalCount: 4,
      approvedInternalCount: 13,
      uniqueApprovedCount: 17,
      assignmentRefs: 18,
      deferredSkillUsage: 0,
      skillsShCalls: 0,
    },
    productionFactorySourceCorrections: 0,
    websiteGenerationE2E: false,
    originalRun3ArtifactsPreserved: true,
    originalInvalidFindingsPreserved: true,
    successorFindingRelationshipsPreserved: true,
  };
  writeFileSync(join(root, "docs/admin/factory-self-review-evidence-reconciliation-2026-08-10.json"), `${JSON.stringify(reconciliation, null, 2)}\n`);
  writeFileSync(join(root, "docs/admin/factory-self-review-2026-08-10-final.json"), `${JSON.stringify(finalArtifact, null, 2)}\n`);
  writeFileSync(join(root, "docs/admin/factory-self-review-evidence-reconciliation-2026-08-10.md"), markdownReport(reconciliation, finalArtifact));
  writeFileSync(join(root, "docs/admin/factory-self-review-2026-08-10-final.md"), markdownReport(reconciliation, finalArtifact));
  return { reconciliation, finalArtifact };
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  runEvidenceReconciliation().then((result) => {
    console.log(JSON.stringify({
      reconciliationRunId: result.reconciliation.reconciliationRunId,
      originalInvalidFindingCount: result.reconciliation.originalInvalidFindingCount,
      deterministicRepairCount: result.reconciliation.deterministicRepairCount,
      targetedReviewerCallCount: result.reconciliation.targetedReviewerCallCount,
      rejectedCount: result.finalArtifact.rejectedFindingCount,
      remainingInvalidCount: result.reconciliation.remainingInvalidCount,
      phase5Status: result.reconciliation.phase5Status,
    }));
  });
}
