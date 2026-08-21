import { describe, expect, it } from "vitest";
import { applyBriefChangeSet } from "./reducer";
import { cleanBriefV3, pilotShapedV1Brief } from "./fixtures";
import { migrateV1ToCanonicalBriefV3 } from "./migrate-v1";
import { evaluateBriefReadiness } from "./readiness";

const pilotCurrentBrief = () => applyBriefChangeSet(
  migrateV1ToCanonicalBriefV3(pilotShapedV1Brief),
  { contractVersion: 1, changes: [{ operation: "SET", target: "FORM_SUCCESS_MODE", value: "SIMULATED" }], unresolved: [] },
);

const clarification = (answerStatus: "answered" | "unresolved") => ({
  questions: [{ id: "44444444-4444-4444-8444-444444444444", blocking: true, answerStatus }],
});

describe("canonical Brief readiness", () => {
  it("treats a pilot-shaped legal placeholder as approval-ready but not publication-ready", () => {
    const result = evaluateBriefReadiness({ brief: pilotCurrentBrief() });

    expect(result.readyForApproval).toBe(true);
    expect(result.approvalBlockers).toEqual([]);
    expect(result.nonBlockingUnresolvedTargets).toHaveLength(1);
    expect(result.publicationReady).toBe(false);
    expect(result.publicationBlockers).toContain("FINAL_LEGAL_FACTS_REQUIRED");
  });

  it("uses current legal no-invention requirements to resolve an old typed residue without reviving history", () => {
    const current = pilotCurrentBrief();
    const brief = { ...current, legal: { ...current.legal, inventedFactsPolicy: "UNRESOLVED" as const } };
    const result = evaluateBriefReadiness({ brief });

    expect(result.readyForApproval).toBe(true);
    expect(result.approvalBlockers).toEqual([]);
    expect(brief.requirements.some((requirement) => requirement.statement.includes("Historical"))).toBe(false);
  });

  it("keeps genuine product decisions blocking even when legal placeholders are authorized", () => {
    const brief = {
      ...cleanBriefV3,
      unresolved: [{ target: "REQUIREMENT:callback-policy", reason: "Decide whether visitors may request a callback.", sourceRefs: ["fixture:product-decision"] }],
    };
    const result = evaluateBriefReadiness({ brief });

    expect(result.readyForApproval).toBe(false);
    expect(result.approvalBlockers).toContainEqual({ code: "UNRESOLVED_CANONICAL_REQUIREMENT", target: "REQUIREMENT:callback-policy" });
    expect(result.nonBlockingUnresolvedTargets).toEqual([]);
  });

  it("keeps unresolved typed decisions blocking", () => {
    const brief = { ...cleanBriefV3, decisions: { ...cleanBriefV3.decisions, database: { mode: "UNRESOLVED" as const } } };
    const result = evaluateBriefReadiness({ brief });

    expect(result.readyForApproval).toBe(false);
    expect(result.approvalBlockers).toContainEqual({ code: "UNRESOLVED_CANONICAL_DECISION", target: "DATABASE_MODE" });
  });

  it("keeps an active analytics product decision blocking despite the optional-integration fallback", () => {
    const brief = {
      ...cleanBriefV3,
      decisions: { ...cleanBriefV3.decisions, analytics: { mode: "UNRESOLVED" as const } },
      requirements: [...cleanBriefV3.requirements, { id: "REQUIREMENT:analytics-choice", category: "TECHNICAL" as const, statement: "Use analytics tracking for visitor measurement.", sourceRefs: ["fixture:analytics-choice"] }],
    };
    const result = evaluateBriefReadiness({ brief });

    expect(result.readyForApproval).toBe(false);
    expect(result.approvalBlockers).toContainEqual({ code: "UNRESOLVED_CANONICAL_DECISION", target: "ANALYTICS_MODE" });
  });

  it("keeps canonical contradictions blocking", () => {
    const brief = { ...cleanBriefV3, decisions: { ...cleanBriefV3.decisions, routePolicy: { mode: "MULTI_PAGE" as const } } };
    const result = evaluateBriefReadiness({ brief });

    expect(result.readyForApproval).toBe(false);
    expect(result.approvalBlockers[0]).toMatchObject({ code: "CANONICAL_CONTRADICTION" });
  });

  it("allows answered current clarifications and blocks unanswered current clarifications", () => {
    expect(evaluateBriefReadiness({ brief: cleanBriefV3, clarificationSession: clarification("answered") }).readyForApproval).toBe(true);
    const unresolved = evaluateBriefReadiness({ brief: cleanBriefV3, clarificationSession: clarification("unresolved") });
    expect(unresolved.readyForApproval).toBe(false);
    expect(unresolved.approvalBlockers).toContainEqual({ code: "UNANSWERED_CLARIFICATION", id: "44444444-4444-4444-8444-444444444444" });
  });

  it("keeps publication readiness stricter than Brief approval readiness", () => {
    const publishable = { ...cleanBriefV3, legal: { ...cleanBriefV3.legal, placeholderPolicy: "NO_PLACEHOLDERS" as const } };
    const result = evaluateBriefReadiness({ brief: publishable });

    expect(result.readyForApproval).toBe(true);
    expect(result.publicationReady).toBe(true);
    expect(result.publicationBlockers).toEqual([]);
  });
});
