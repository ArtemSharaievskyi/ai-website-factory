import { describe, expect, it } from "vitest";
import { ReviewResultSchema } from "./schema";

const finding = { findingId: "missing-test", severity: "ERROR" as const, category: "quality", summary: "A required test is missing.", evidenceRefs: ["file:src/app.test.ts"], affectedArtifacts: ["file:src/app.ts"], recommendedAction: "Add the approved behavior test." };

describe("review contracts", () => {
  it("supports an approved read-only result", () => {
    const result = ReviewResultSchema.parse({ verdict: "APPROVED", findings: [], reviewedArtifactRefs: ["file:src/app.ts"], policyVersion: "review-v1" });
    expect(result.verdict).toBe("APPROVED");
    expect("write" in result).toBe(false);
  });
  it("requires findings for changes", () => expect(() => ReviewResultSchema.parse({ verdict: "CHANGES_REQUIRED", findings: [], reviewedArtifactRefs: ["file:src/app.ts"], policyVersion: "review-v1" })).toThrow());
  it("requires a reason and evidence when blocked", () => {
    expect(() => ReviewResultSchema.parse({ verdict: "BLOCKED", findings: [finding], reviewedArtifactRefs: ["file:src/app.ts"], policyVersion: "review-v1" })).toThrow();
    expect(ReviewResultSchema.parse({ verdict: "BLOCKED", findings: [finding], reviewedArtifactRefs: ["file:src/app.ts"], policyVersion: "review-v1", blockedReason: "Required evidence is unavailable." }).verdict).toBe("BLOCKED");
  });
  it("rejects duplicate findings and unsupported write fields", () => {
    expect(() => ReviewResultSchema.parse({ verdict: "CHANGES_REQUIRED", findings: [finding, finding], reviewedArtifactRefs: ["file:src/app.ts"], policyVersion: "review-v1" })).toThrow();
    expect(() => ReviewResultSchema.parse({ verdict: "APPROVED", findings: [], reviewedArtifactRefs: ["file:src/app.ts"], policyVersion: "review-v1", writeOperations: [] })).toThrow();
  });
});
