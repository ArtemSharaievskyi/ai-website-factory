import { describe, expect, it } from "vitest";
import { boundedRolePrompt } from "@/runtime/context/bridge";
import { designContextBreakdown, designContextBudget } from "./context";
import { fixtureForContext } from "./context-test-fixture";

describe("Design context budget", () => {
  it("passes the compact host manifest and retains relevant approved guidance", () => {
    const input = fixtureForContext();
    const skill = {
      skillId: "responsive-form-ux-design",
      approvedChecksum: "a".repeat(64),
      coverageKeys: ["responsive-form-ux"],
      skillMarkdown: "# Responsive Forms\nKeep fields readable and actions reachable on narrow screens.",
      references: [],
    };
    const prompt = boundedRolePrompt("design", input, false, [skill]);
    const breakdown = designContextBreakdown(input);
    const budget = designContextBudget();
    expect(breakdown.legacyBriefBytes).toBe(0);
    expect(breakdown.duplicatedPlanningBytes).toBe(0);
    expect(breakdown.totalBytes).toBeLessThan(budget.maxBytes);
    expect(prompt.contextBundle.totalBytes).toBeLessThanOrEqual(budget.maxBytes);
    expect(prompt.contextBundle.skillSliceCount).toBe(1);
    expect(prompt.contextBundle.metrics.canonicalRequirementTruncated).toBe(false);
    const selected = JSON.stringify(prompt.contextBundle.selectedItems);
    expect(selected).toContain("canonicalDesignContent");
    expect(selected).not.toContain("approvedBrief");
    expect(selected).not.toContain("acceptedPlanningPackage");
  });
});
