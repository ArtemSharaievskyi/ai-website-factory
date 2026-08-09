import { describe, expect, it } from "vitest";
import { classifyRequirementCandidate, isWorkflowRequirement } from "./clarification-policy";
import { rolePrompt } from "../../integrations/openai/prompts";

describe("clarification semantic policy", () => {
  it.each([
    ["Brief must be approved before Planner", "APPROVAL_GATE"],
    ["The Brief has not yet been approved", "APPROVAL_GATE"],
    ["Planning acceptance is required", "WORKFLOW_GATE"],
    ["One of the three design directions must be selected before implementation", "SELECTION_GATE"],
    ["Release eligibility requires QA completion", "QUALITY_GATE"],
    ["A tool prerequisite is required before execution", "TOOL_PREREQUISITE"],
  ])("classifies %s as %s", (description, expected) => {
    expect(classifyRequirementCandidate({ description })).toBe(expected);
    expect(isWorkflowRequirement({ description })).toBe(true);
  });

  it("keeps genuine missing project information as clarification", () => {
    expect(classifyRequirementCandidate({ key: "forms.fields", question: "Which fields should the form contain?" })).toBe("USER_INPUT_REQUIRED");
    expect(isWorkflowRequirement({ key: "forms.fields", question: "Which fields should the form contain?" })).toBe(false);
  });

  it("does not use a model or VeloFix-specific rule", () => {
    expect(rolePrompt("lead", {}).system).toContain("Clarification questions may ask only for missing user or project/business requirements");
    expect(rolePrompt("lead", {}).system).toContain("Do not ask or emit blockers for Factory workflow actions");
    expect(rolePrompt("lead", {}).system).not.toContain("VeloFix");
  });
});
