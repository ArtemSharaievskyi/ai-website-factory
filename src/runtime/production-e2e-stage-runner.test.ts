import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { VELOFIX_SMOKE_SPECIFICATION } from "./production-e2e-stage-runner";

describe("production E2E stage runner structure", () => {
  it("uses one concrete ordered coordinator and no raw external transports", async () => {
    const source = await readFile(new URL("./production-e2e-stage-runner.ts", import.meta.url), "utf8");
    for (const name of ["PROJECT", "LEAD", "CLARIFICATION", "BRIEF_FINALIZATION", "BRIEF_VALIDATION", "BRIEF_APPROVAL", "PLANNER", "PLANNING_ACCEPTANCE", "DESIGN", "DESIGN_SELECTION", "ORCHESTRATOR", "START_IMPLEMENTATION", "FULL_EXECUTION", "RELEASE_ELIGIBILITY"]) expect(source).toContain(`stage(\"${name}\"`);
    expect(source.indexOf('stage("PROJECT"')).toBeLessThan(source.indexOf('stage("LEAD"'));
    expect(source.indexOf('stage("LEAD"')).toBeLessThan(source.indexOf('stage("BRIEF_FINALIZATION"'));
    expect(source.indexOf('stage("BRIEF_FINALIZATION"')).toBeLessThan(source.indexOf('stage("BRIEF_VALIDATION"'));
    expect(source.indexOf('stage("BRIEF_VALIDATION"')).toBeLessThan(source.indexOf('stage("BRIEF_APPROVAL"'));
    expect(source.indexOf('stage("BRIEF_APPROVAL"')).toBeLessThan(source.indexOf('stage("PLANNER"'));
    expect(source.indexOf('stage("PLANNING_ACCEPTANCE"')).toBeLessThan(source.indexOf('stage("DESIGN"'));
    expect(source.indexOf('stage("DESIGN_SELECTION"')).toBeLessThan(source.indexOf('stage("ORCHESTRATOR"'));
    expect(source.indexOf('stage("ORCHESTRATOR"')).toBeLessThan(source.indexOf('stage("START_IMPLEMENTATION"'));
    expect(source.indexOf('stage("START_IMPLEMENTATION"')).toBeLessThan(source.indexOf('stage("FULL_EXECUTION"'));
    expect(source.indexOf('stage("FULL_EXECUTION"')).toBeLessThan(source.indexOf('stage("RELEASE_ELIGIBILITY"'));
    expect(source).toContain("repairTaskCapabilityBindings");
    expect(source.indexOf("repairTaskCapabilityBindings")).toBeLessThan(source.indexOf("!graph.readyForExecution"));
    expect(source).not.toMatch(/from ["']openai["']/);
    expect(source).not.toContain("child_process");
    expect(source).not.toMatch(/from ["'][^"']*playwright/i);
    expect(source).not.toContain("createImplementationTaskGraph({");
  });

  it("keeps the smoke answers fixture-derived and bounded", () => {
    expect(VELOFIX_SMOKE_SPECIFICATION.prompt).toContain("Do not invent");
    expect(VELOFIX_SMOKE_SPECIFICATION.answers["database"]).toBe("No real database");
    expect(VELOFIX_SMOKE_SPECIFICATION.answers.storage).toBe("No Storage");
  });
});
