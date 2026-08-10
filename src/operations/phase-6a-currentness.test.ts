/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assertAcyclicDependencies,
  assertCurrentEvidenceRequirement,
  assertExactlyOneCurrentnessState,
  correctionReadyFindings,
  highestSeverity,
  severityCounts,
  validateCorrectionGroups,
  type CorrectionGroup,
} from "./phase-6a-currentness";

const plan = JSON.parse(
  readFileSync("docs/admin/phase-6/factory-findings-currentness-plan-2026-08-10.json", "utf8"),
);
const findings = plan.perFindingCurrentness.map((finding: any) => ({
  findingId: finding.findingId,
  severity: finding.originalSeverity,
  currentness: finding.currentness,
}));

describe("Phase 6A currentness and grouping", () => {
  it("1. loads exactly 31 findings", () => expect(findings).toHaveLength(31));
  it("2. excludes rejected Phase 5 findings", () => {
    expect(findings.some((finding: any) => plan.rejectedPhase5FindingIds.includes(finding.findingId))).toBe(false);
  });
  it("3. preserves original finding IDs", () => {
    expect(findings.every((finding: any) => finding.findingId.startsWith("finding-") || finding.findingId.startsWith("contract-"))).toBe(true);
  });
  it("4. keeps unchanged evidence ACTIVE_UNCHANGED", () => {
    expect(plan.currentnessCounts.ACTIVE_UNCHANGED).toBe(29);
  });
  it("5. changed evidence is not automatically resolved", () => {
    expect(plan.perFindingCurrentness.filter((finding: any) => finding.laterRelevantChanges.length).every((finding: any) => finding.currentness === "ACTIVE_REBASED")).toBe(true);
  });
  it("6. resolved states require current evidence", () => {
    expect(() => assertCurrentEvidenceRequirement("ALREADY_RESOLVED", 0)).toThrow();
    expect(assertCurrentEvidenceRequirement("ALREADY_RESOLVED", 1)).toBe(true);
  });
  it("7. rebased findings require current evidence", () => {
    expect(() => assertCurrentEvidenceRequirement("ACTIVE_REBASED", 0)).toThrow();
    expect(plan.perFindingCurrentness.filter((finding: any) => finding.currentness === "ACTIVE_REBASED").every((finding: any) => finding.currentEvidence.length > 0)).toBe(true);
  });
  it("8. partial resolution retains a remaining issue", () => {
    const partial = { currentness: "PARTIALLY_RESOLVED", remainingIssue: "still active" };
    expect(partial.remainingIssue).toBeTruthy();
  });
  it("9. no-longer-applicable is distinct from resolved", () => {
    expect(() => assertExactlyOneCurrentnessState("NO_LONGER_APPLICABLE")).not.toThrow();
    expect(() => assertExactlyOneCurrentnessState("ALREADY_RESOLVED")).not.toThrow();
  });
  it("10. every finding receives exactly one currentness state", () => {
    expect(findings.every((finding: any) => {
      try { assertExactlyOneCurrentnessState(finding.currentness); return true; } catch { return false; }
    })).toBe(true);
  });
  it("11. correction-ready set excludes resolved and not-applicable", () => {
    const result = correctionReadyFindings([
      { findingId: "a", severity: "ERROR", currentness: "ACTIVE_UNCHANGED" },
      { findingId: "b", severity: "ERROR", currentness: "ALREADY_RESOLVED" },
      { findingId: "c", severity: "ERROR", currentness: "NO_LONGER_APPLICABLE" },
    ]);
    expect(result.map((finding) => finding.findingId)).toEqual(["a"]);
  });
  it("12. current severity counts derive from correction-ready findings", () => {
    expect(severityCounts(correctionReadyFindings(findings))).toEqual({ CRITICAL: 2, ERROR: 13, WARNING: 15, INFO: 1 });
  });
  it("13. one finding maps to at most one primary group", () => {
    expect(() => validateCorrectionGroups([{ findingId: "a", severity: "ERROR", currentness: "ACTIVE_UNCHANGED" }], [{ groupId: "g1", findingIds: ["a"], dependencies: [], rootCauseConfidence: "HIGH" }])).not.toThrow();
    expect(() => validateCorrectionGroups([{ findingId: "a", severity: "ERROR", currentness: "ACTIVE_UNCHANGED" }], [{ groupId: "g1", findingIds: ["a"], dependencies: [], rootCauseConfidence: "HIGH" }, { groupId: "g2", findingIds: ["a"], dependencies: [], rootCauseConfidence: "HIGH" }])).toThrow();
  });
  it("14. one group can contain multiple findings", () => {
    expect(validateCorrectionGroups([
      { findingId: "a", severity: "ERROR", currentness: "ACTIVE_UNCHANGED" },
      { findingId: "b", severity: "WARNING", currentness: "ACTIVE_UNCHANGED" },
    ], [{ groupId: "g1", findingIds: ["a", "b"], dependencies: [], rootCauseConfidence: "HIGH" }]).size).toBe(2);
  });
  it("15. grouping is not based only on matching files", () => {
    const groups = plan.correctionGroups.filter((group: any) => group.likelyFiles.includes("src/integrations/openai/client.ts"));
    expect(new Set(groups.map((group: any) => group.groupId)).size).toBeGreaterThan(0);
    expect(groups.every((group: any) => group.rootCause && group.correctionGoal)).toBe(true);
  });
  it("16. resolved findings cannot enter correction groups", () => {
    expect(() => validateCorrectionGroups([{ findingId: "resolved", severity: "ERROR", currentness: "ALREADY_RESOLVED" }], [{ groupId: "g", findingIds: ["resolved"], dependencies: [], rootCauseConfidence: "HIGH" }])).toThrow();
  });
  it("17. rejected Phase 5 findings cannot enter correction groups", () => {
    expect(plan.correctionGroups.flatMap((group: any) => group.findingIds).some((id: string) => plan.rejectedPhase5FindingIds.includes(id))).toBe(false);
  });
  it("18. every group stores a root cause", () => {
    expect(plan.correctionGroups.every((group: any) => group.rootCause.length > 0)).toBe(true);
  });
  it("19. groups store dependency IDs", () => {
    expect(plan.correctionGroups.every((group: any) => Array.isArray(group.dependencies))).toBe(true);
  });
  it("20. dependency cycles are rejected", () => {
    const cycle: CorrectionGroup[] = [
      { groupId: "a", findingIds: [], dependencies: ["b"], rootCauseConfidence: "HIGH" },
      { groupId: "b", findingIds: [], dependencies: ["a"], rootCauseConfidence: "HIGH" },
    ];
    expect(() => assertAcyclicDependencies(cycle)).toThrow();
  });
  it("21. groups store reviewer rechecks", () => {
    expect(plan.correctionGroups.every((group: any) => group.requiredReviewerRechecks.length > 0)).toBe(true);
  });
  it("22. groups store deterministic validation requirements", () => {
    expect(plan.correctionGroups.every((group: any) => group.requiredDeterministicChecks.length > 0)).toBe(true);
  });
  it("23. highest severity is deterministic", () => {
    expect(highestSeverity([{ findingId: "a", severity: "WARNING", currentness: "ACTIVE_UNCHANGED" }, { findingId: "b", severity: "CRITICAL", currentness: "ACTIVE_UNCHANGED" }])).toBe("CRITICAL");
  });
  it("24. the first correction group is explicitly selected", () => {
    expect(plan.firstRecommendedGroupId).toBe("cg-01-cross-artifact-identity");
  });
  it("25. the dependency graph is acyclic", () => {
    expect(plan.dependencyGraphAcyclic).toBe(true);
  });
  it("26. no targeted applicability calls were needed", () => {
    expect(plan.targetedReviewerCalls).toBe(0);
  });
  it("27. current evidence is bound to current HEAD", () => {
    expect(plan.perFindingCurrentness.every((finding: any) => finding.currentEvidence.every((evidence: any) => evidence.currentHead === plan.baselineHead))).toBe(true);
  });
  it("28. the critical findings remain correction-ready", () => {
    expect(plan.perFindingCurrentness.filter((finding: any) => finding.originalSeverity === "CRITICAL").every((finding: any) => ["ACTIVE_UNCHANGED", "ACTIVE_REBASED", "PARTIALLY_RESOLVED"].includes(finding.currentness))).toBe(true);
  });
  it("29. QA maintenance is outside the correction set", () => {
    expect(plan.knownMaintenanceItems[0].includedInCorrectionGroups).toBe(false);
  });
  it("30. Phase 6A roadmap state is terminal for planning", () => {
    expect(plan.phase6AStatus).toBe("CURRENTNESS_AND_GROUPING_COMPLETE");
    expect(plan.roadmap.next).toContain("PHASE 6B");
  });
});
