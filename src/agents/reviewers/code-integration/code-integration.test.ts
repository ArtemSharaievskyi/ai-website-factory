import { describe, expect, it } from "vitest";
import { codeIntegrationReviewerAgentDefinition } from "@/agents/catalog";
import { transitionWorkflow } from "@/domain/workflow/engine";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { CodeIntegrationReviewService } from "./service";
import { CodeIntegrationReviewError } from "./errors";
import { SourceManifestEntrySchema, SourceSliceSchema } from "./contracts";
import { projectIdentityMismatches } from "@/agents/reviewers/contracts/contracts";

describe("Code / Integration Reviewer", () => {
  it("is a read-only least-privilege reviewer with bounded source context", () => {
    expect(codeIntegrationReviewerAgentDefinition.agentId).toBe("code-integration-reviewer");
    expect(codeIntegrationReviewerAgentDefinition.role).toBe("review");
    expect(codeIntegrationReviewerAgentDefinition.capabilities).toEqual(["review.integration"]);
    expect(codeIntegrationReviewerAgentDefinition.allowedTools).toEqual(["openai-generation"]);
    expect(codeIntegrationReviewerAgentDefinition.allowedSkillIds).toEqual(["react-nextjs-integration-review"]);
    expect(codeIntegrationReviewerAgentDefinition.readOnly).toBe(true);
    expect(codeIntegrationReviewerAgentDefinition.contextPolicy.maxBytes).toBeLessThan(250000);
  });
  it("rejects unsafe source references and invalid ranges", () => {
    expect(() => SourceManifestEntrySchema.parse({ relativePath: "C:/secret.ts", sourceChecksum: "a".repeat(64), symbols: [] })).toThrow();
    expect(() => SourceManifestEntrySchema.parse({ relativePath: ".env", sourceChecksum: "a".repeat(64), symbols: [] })).toThrow();
    expect(() => SourceSliceSchema.parse({ relativePath: "src/app/page.tsx", startLine: 4, endLine: 2, content: "export default function Page() {}" })).toThrow();
  });
  it("keeps semantic review after the implementation gate", () => {
    expect(transitionWorkflow("IMPLEMENTING", "CODE_INTEGRATION_REVIEW")).toBe("CODE_INTEGRATION_REVIEW");
    expect(transitionWorkflow("CODE_INTEGRATION_REVIEW", "VALIDATING")).toBe("VALIDATING");
  });
  it("binds downstream review artifacts to one project identity", () => {
    expect(projectIdentityMismatches(
      { projectId: "11111111-1111-4111-8111-111111111111", projectVersion: 3 },
      [
        { label: "approvedBrief", value: { projectId: "11111111-1111-4111-8111-111111111111", projectVersion: 3 } },
        { label: "approvedContractAudit", value: { projectId: "22222222-2222-4222-8222-222222222222", projectVersion: 3 } },
      ],
    )).toEqual(["approvedContractAudit"]);
  });
  it("fails closed before any provider call for invalid or incomplete input", async () => {
    let calls = 0;
    const service = new CodeIntegrationReviewService(new InMemoryPersistenceDatabase(), { provider: { promptVersion: "code-integration-reviewer.v1", review: async () => { calls += 1; throw new Error("must not run"); } } });
    await expect(service.review({} as never)).rejects.toMatchObject({ code: "CODE_REVIEW_INPUT_INVALID" });
    expect(calls).toBe(0);
  });
  it("bounds correction cycles at two", () => {
    const service = new CodeIntegrationReviewService(new InMemoryPersistenceDatabase());
    service.recordCorrectionCycle("project", 1);
    service.recordCorrectionCycle("project", 1);
    expect(() => service.recordCorrectionCycle("project", 1)).toThrowError(CodeIntegrationReviewError);
  });
});
