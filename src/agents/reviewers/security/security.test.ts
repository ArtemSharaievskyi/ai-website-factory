import { describe, expect, it } from "vitest";
import { securityReviewerAgentDefinition } from "@/agents/catalog";
import { transitionWorkflow } from "@/domain/workflow/engine";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { SecurityReviewError } from "./errors";
import { SecurityReviewService, sanitizeSecurityInput } from "./service";
import { SecurityEnvironmentDeclarationSchema } from "./contracts";
import { SecuritySurfaceSchema } from "@/domain/review/schema";

describe("Security Reviewer", () => {
  it("is read-only, least privileged, and skill-free", () => {
    expect(securityReviewerAgentDefinition.agentId).toBe("security-reviewer");
    expect(securityReviewerAgentDefinition.capabilities).toEqual(["review.security"]);
    expect(securityReviewerAgentDefinition.allowedTools).toEqual(["openai-generation"]);
    expect(securityReviewerAgentDefinition.allowedSkillIds).toEqual([]);
    expect(securityReviewerAgentDefinition.readOnly).toBe(true);
    expect(securityReviewerAgentDefinition.contextPolicy.maxBytes).toBeLessThan(250000);
  });
  it("keeps security surface categories bounded", () => {
    expect(SecuritySurfaceSchema.options).toEqual(["NONE", "FORM_INPUT", "SERVER_ACTION", "ROUTE_HANDLER", "AUTH", "DATABASE", "STORAGE", "UPLOAD", "ADMIN", "EMAIL", "EXTERNAL_API"]);
    expect(() => SecurityEnvironmentDeclarationSchema.parse({ name: "bad-name", serverOnly: true, secret: true })).toThrow();
  });
  it("redacts synthetic secret values before provider context", () => {
    const input = { sourceSlices: [{ relativePath: "src/app/page.tsx", content: "const API_KEY = 'sk-12345678901234567890';" }] } as never;
    const safe = sanitizeSecurityInput(input);
    expect(safe.sourceSlices[0].content).not.toContain("sk-12345678901234567890");
    expect(safe.sourceSlices[0].content).toContain("[REDACTED]");
  });
  it("fails closed before any provider call for invalid input", async () => {
    let calls = 0;
    const service = new SecurityReviewService(new InMemoryPersistenceDatabase(), { provider: { promptVersion: "security-reviewer.v1", review: async () => { calls += 1; throw new Error("must not run"); } } });
    await expect(service.review({} as never)).rejects.toMatchObject({ code: "SECURITY_REVIEW_INPUT_INVALID" });
    expect(calls).toBe(0);
  });
  it("bounds correction cycles at two", () => {
    const service = new SecurityReviewService(new InMemoryPersistenceDatabase());
    service.recordCorrectionCycle("project", 1);
    service.recordCorrectionCycle("project", 1);
    expect(() => service.recordCorrectionCycle("project", 1)).toThrowError(SecurityReviewError);
  });
  it("places Security Review after Code / Integration Review", () => {
    expect(transitionWorkflow("CODE_INTEGRATION_REVIEW", "SECURITY_REVIEW")).toBe("SECURITY_REVIEW");
    expect(transitionWorkflow("SECURITY_REVIEW", "VALIDATING")).toBe("VALIDATING");
  });
});
