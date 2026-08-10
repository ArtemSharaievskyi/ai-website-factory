import { describe, expect, it } from "vitest";
import { CodeIntegrationReviewResultSchema, ContractAuditResultSchema } from "@/domain/review/schema";
import { calculateUnblockedGroups, classifyReviewerOutput, loadVerificationConfig } from "../../scripts/phase-6b-cg01-verification";

describe("cg-01 correction verification harness", () => {
  it("loads configuration only after the supplied environment bootstrap", () => {
    let loaded = false;
    const config = loadVerificationConfig("fixture-root", () => { loaded = true; }, (_env, requireKey) => {
      expect(loaded).toBe(true);
      expect(requireKey).toBe(true);
      return { apiKey: "test-key", model: "gpt-5.6-luna", modelLabel: "GPT-5.6 Luna", maxRetries: 1, maxConcurrentRequests: 2 };
    });
    expect(config.model).toBe("gpt-5.6-luna");
  });
  it("accepts only strict approved empty reviewer results as resolved", () => {
    const result = classifyReviewerOutput("contract-auditor", ContractAuditResultSchema.parse({ verdict: "APPROVED", findings: [], reviewedArtifactRefs: ["current:contracts-contract"], policyVersion: "contract-audit-v1" }), new Set(["current:contracts-contract"]), 1);
    expect(result.state).toBe("RESOLVED");
    expect(result.realGptCalls).toBe(1);
  });
  it("keeps a reviewer finding active and rejects invented evidence", () => {
    const output = CodeIntegrationReviewResultSchema.parse({ verdict: "CHANGES_REQUIRED", findings: [{ findingId: "identity-still-active", severity: "ERROR", category: "CONTRACT_IMPLEMENTATION_MISMATCH", summary: "The identity binding remains incomplete.", evidenceRefs: ["current:code-contract"], affectedArtifacts: ["current:code-contract"], recommendedAction: "Bind the artifact identity.", correctionTarget: "UPSTREAM_CONTRACT" }], reviewedArtifactRefs: ["current:code-contract"], policyVersion: "code-integration-review-v1" });
    const result = classifyReviewerOutput("code-integration-reviewer", output, new Set(["current:code-contract"]), 1);
    expect(result.state).toBe("STILL_ACTIVE");
    expect(() => classifyReviewerOutput("code-integration-reviewer", output, new Set(), 1)).toThrow(/VERIFICATION_EVIDENCE_INVALID/);
  });
  it("calculates all newly unblocked groups from the Phase 6A DAG", () => {
    const result = calculateUnblockedGroups({
      correctionGroups: [
        { groupId: "cg-01", currentHighestSeverity: "CRITICAL", recommendedOrder: 1 },
        { groupId: "cg-02", currentHighestSeverity: "CRITICAL", recommendedOrder: 2 },
        { groupId: "cg-04", currentHighestSeverity: "ERROR", recommendedOrder: 4 },
        { groupId: "cg-03", currentHighestSeverity: "CRITICAL", recommendedOrder: 3 },
      ],
      dependencyGraph: [
        { groupId: "cg-01", dependsOn: [] },
        { groupId: "cg-02", dependsOn: ["cg-01"] },
        { groupId: "cg-04", dependsOn: ["cg-01"] },
        { groupId: "cg-03", dependsOn: ["cg-02"] },
      ],
    }, ["cg-01"]);
    expect(result.unblockedGroups).toEqual(["cg-02", "cg-04"]);
    expect(result.nextRecommendedGroup).toBe("cg-02");
  });
});
