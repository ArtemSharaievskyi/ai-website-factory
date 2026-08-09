import { describe, expect, it } from "vitest";
import { testQualityReviewerAgentDefinition } from "@/agents/catalog";
import { TestQualityReviewService } from "./service";
import { TestQualityReviewError } from "./errors";
import { TestQualityFindingCategorySchema } from "@/domain/review/schema";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { selectTargetedValidation } from "@/orchestration/execution/targeted-validation";
import { transitionWorkflow } from "@/domain/workflow/engine";

describe("Test / Quality Reviewer", () => {
  it("is read-only, OpenAI-only, portfolio-bound, and bounded", () => {
    expect(testQualityReviewerAgentDefinition.agentId).toBe("test-quality-reviewer");
    expect(testQualityReviewerAgentDefinition.role).toBe("review");
    expect(testQualityReviewerAgentDefinition.capabilities).toEqual(["review.test-quality"]);
    expect(testQualityReviewerAgentDefinition.allowedTools).toEqual(["openai-generation"]);
    expect(testQualityReviewerAgentDefinition.allowedSkillIds).toEqual(["requirements-evidence-traceability", "behavioral-test-quality-review"]);
    expect(testQualityReviewerAgentDefinition.readOnly).toBe(true);
    expect(testQualityReviewerAgentDefinition.contextPolicy.allowedCategories).not.toContain("ORIGINAL_PROMPT");
  });
  it("keeps the compact finding taxonomy explicit", () => expect(TestQualityFindingCategorySchema.options).toContain("CRITICAL_FLOW_NOT_VERIFIED"));
  it("fails closed before provider invocation for invalid input", async () => {
    let calls = 0;
    const service = new TestQualityReviewService(new InMemoryPersistenceDatabase(), { provider: { promptVersion: "test-quality-reviewer.v1", review: async () => { calls += 1; throw new Error("must not run"); } } });
    await expect(service.review({} as never)).rejects.toMatchObject({ code: "TEST_QUALITY_INPUT_INVALID" });
    expect(calls).toBe(0);
  });
  it("caps semantic correction cycles at two", () => {
    const service = new TestQualityReviewService(new InMemoryPersistenceDatabase());
    service.recordCorrectionCycle("project", 1); service.recordCorrectionCycle("project", 1);
    expect(() => service.recordCorrectionCycle("project", 1)).toThrowError(TestQualityReviewError);
  });
  it("selects targeted checks from bounded task ownership", () => {
    const task = { id: "task", taskType: "implement-form", fileScopes: ["src/app/contact/**"] } as never;
    expect(selectTargetedValidation(task, { tasks: [{ taskType: "validate-lint" }, { taskType: "validate-typecheck" }, { taskType: "validate-unit-tests" }, { taskType: "validate-functional-flow" }] as never }).validationTaskTypes).toEqual(["validate-lint", "validate-typecheck", "validate-unit-tests", "validate-functional-flow"]);
  });
  it("does not expose mutation or execution tools through its definition", () => expect(testQualityReviewerAgentDefinition.allowedTools).not.toContain("context7-read"));
  it("is required before the final release transition", () => {
    expect(() => transitionWorkflow("TEST_QUALITY_REVIEW", "PROJECT_READY")).toThrow(/Test \/ Quality/i);
  });
});
