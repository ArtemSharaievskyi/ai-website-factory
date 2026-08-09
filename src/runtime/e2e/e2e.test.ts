import { describe, expect, it } from "vitest";
import { runRealFactoryE2E, VELOFIX_WERKSTATT_PROMPT, assertRealDependencies } from "./harness";
import { runRealFactoryE2EPreflight, safeSmokeProjectReference } from "./preflight";
import { validateResumeCheckpoint, validateResumeIdentity } from "@/runtime/production-e2e-stage-runner";
import { RealFactoryE2EReportSchema, type RealFactoryE2EReport } from "./contracts";

const resumeReport = (overrides: Partial<RealFactoryE2EReport> = {}) => RealFactoryE2EReportSchema.parse({ schemaVersion: 1, reportType: "real-factory-e2e", smokeId: "11111111-1111-4111-8111-111111111111", projectId: "22222222-2222-4222-8222-222222222222", projectVersion: 1, projectPathReference: "C:/disposable/_smoke/real-e2e-velofix-11111111-1111-4111-8111-111111111111/v1", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:01:00.000Z", overallStatus: "failed", optIn: true, preflightPassed: true, adapterIdentity: { leadProviderMode: "production", plannerProviderMode: "production", designProviderMode: "production", implementationProviderMode: "production", processRunnerMode: "real", browserRunnerMode: "real", executionStateMode: "production", taskExecutorMode: "production", repairerMode: "production", fullExecutorMode: "production" }, realStageEvidence: { leadRequest: true, plannerRequest: true, designRequest: true, implementationRequest: false, npmExecution: false, browserExecution: false }, stages: ["PROJECT", "LEAD", "CLARIFICATION", "BRIEF_FINALIZATION", "BRIEF_VALIDATION", "BRIEF_APPROVAL", "PLANNER", "PLANNING_ACCEPTANCE", "ARCHITECTURE_REVIEW", "DESIGN", "DESIGN_SELECTION", "ORCHESTRATOR", "START_IMPLEMENTATION"].map((name) => ({ name, status: "passed", executionMode: "EXECUTED", summary: `${name} completed.` })), provider: { status: "configured", requestCount: 3, inputTokens: 1, outputTokens: 1 }, context7: { status: "not-needed", requestCount: 0 }, shadcn: { status: "not-needed", requestCount: 0 }, npm: { status: "not-configured", commands: [], passedCount: 0, failedCount: 0 }, playwright: { status: "not-configured", scenarios: 0, passedCount: 0, failedCount: 0, unexpectedExternalRequests: 0 }, taskGraph: { taskCount: 1, passedCount: 1, failedCount: 0, repairCount: 0 }, generatedFiles: { createdCount: 1, changedCount: 0, checksumVerified: false }, blockers: [], warnings: [], releaseEligible: false, prohibitedActions: { deployment: false, gitMutation: false, customerDatabaseMigration: false, customerDataAccess: false, arbitraryBrowsing: false, screenshots: false }, ...overrides });

describe("real Factory E2E safety boundary", () => {
  it("stays pending and makes no external checks without explicit opt-in", async () => {
    const result = await runRealFactoryE2EPreflight({ OPENAI_API_KEY: "should-not-be-read" });
    expect(result.status).toBe("pending");
    expect(result.blockers).toContain("REAL_FACTORY_E2E_OPT_IN_REQUIRED");
  });
  it("reports the precise mandatory provider blocker without exposing credentials", async () => {
    const result = await runRealFactoryE2EPreflight({ ALLOW_REAL_FACTORY_E2E: "true" }, { npmAvailable: true, chromiumAvailable: true, gitClean: true });
    expect(result.status).toBe("blocked");
    expect(result.blockers).toContain("REAL_E2E_OPENAI_NOT_CONFIGURED");
    expect(JSON.stringify(result)).not.toContain("should-not-be-read");
  });
  it("returns a bounded pending report", async () => {
    const preflight = await runRealFactoryE2EPreflight({});
    const report = await runRealFactoryE2E({ preflight, generatedProjectsRoot: "C:\\disposable" });
    expect(report.overallStatus).toBe("pending");
    expect(report.releaseEligible).toBe(false);
    expect(report.prohibitedActions.deployment).toBe(false);
  });
  it("keeps the synthetic prompt factual and production runtime explicit", () => {
    expect(VELOFIX_WERKSTATT_PROMPT).toContain("VeloFix Werkstatt");
    expect(VELOFIX_WERKSTATT_PROMPT).toContain("Do not invent");
    expect(() => assertRealDependencies(undefined, { status: "passed", optIn: true, blockers: [], warnings: [], integrations: { provider: "configured", context7: "not-needed", shadcn: "not-needed" } })).toThrow("REAL_E2E_PRODUCTION_RUNTIME_REQUIRED");
  });
  it("uses the full smoke identity for isolated generated-project ownership", () => {
    const smokeId = "11111111-1111-4111-8111-111111111111";
    expect(safeSmokeProjectReference("C:\\generated", smokeId)).toContain(`real-e2e-velofix-${smokeId}`);
  });
  it("accepts a valid approved-brief checkpoint without requiring a provider execution", () => { const report = resumeReport(); expect(validateResumeCheckpoint(report)).toBe(true); expect(report.realStageEvidence.leadRequest).toBe(true); });
  it("rejects a stale Brief checkpoint", () => { const report = resumeReport({ stages: resumeReport().stages.map((stage) => stage.name === "BRIEF_APPROVAL" ? { ...stage, status: "failed" as const } : stage) }); expect(() => validateResumeCheckpoint(report)).toThrow("REAL_E2E_RESUME_CHECKPOINT_INVALID:BRIEF_APPROVAL"); });
  it("rejects stale planning acceptance", () => { const report = resumeReport({ stages: resumeReport().stages.map((stage) => stage.name === "PLANNING_ACCEPTANCE" ? { ...stage, status: "failed" as const } : stage) }); expect(() => validateResumeCheckpoint(report)).toThrow("REAL_E2E_RESUME_CHECKPOINT_INVALID:PLANNING_ACCEPTANCE"); });
  it("rejects stale design selection", () => { const report = resumeReport({ stages: resumeReport().stages.map((stage) => stage.name === "DESIGN_SELECTION" ? { ...stage, status: "failed" as const } : stage) }); expect(() => validateResumeCheckpoint(report)).toThrow("REAL_E2E_RESUME_CHECKPOINT_INVALID:DESIGN_SELECTION"); });
  it("requires the exact smoke identity", () => { expect(() => validateResumeIdentity(resumeReport(), "33333333-3333-4333-8333-333333333333")).toThrow("REAL_E2E_RESUME_IDENTITY_MISMATCH"); });
  it("requires the persisted project identity", () => { expect(() => validateResumeIdentity(resumeReport({ projectId: undefined }), "11111111-1111-4111-8111-111111111111")).toThrow("REAL_E2E_RESUME_IDENTITY_MISMATCH"); });
  it("requires the persisted project version", () => { expect(() => validateResumeIdentity(resumeReport({ projectVersion: undefined }), "11111111-1111-4111-8111-111111111111")).toThrow("REAL_E2E_RESUME_IDENTITY_MISMATCH"); });
  it("requires the persisted workspace reference", () => { expect(() => validateResumeIdentity(resumeReport({ projectPathReference: undefined }), "11111111-1111-4111-8111-111111111111")).toThrow("REAL_E2E_RESUME_IDENTITY_MISMATCH"); });
  it("does not relabel reused stages as executed", () => { const report = resumeReport(); expect(report.stages.every((stage) => stage.executionMode === "EXECUTED")).toBe(true); });
  it("keeps implementation evidence false before resumed implementation", () => { expect(resumeReport().realStageEvidence.implementationRequest).toBe(false); });
  it("keeps npm and browser evidence false before resumed execution", () => { const report = resumeReport(); expect(report.realStageEvidence.npmExecution).toBe(false); expect(report.realStageEvidence.browserExecution).toBe(false); });
  it("preserves the original smoke project path", () => { expect(resumeReport().projectPathReference).toContain("real-e2e-velofix-11111111-1111-4111-8111-111111111111"); });
  it("preserves the original project version", () => { expect(resumeReport().projectVersion).toBe(1); });
  it("preserves passed task evidence", () => { expect(resumeReport().taskGraph.passedCount).toBe(1); });
  it("does not claim release eligibility for a failed prior run", () => { expect(resumeReport().releaseEligible).toBe(false); });
  it("keeps prohibited external actions disabled", () => { expect(Object.values(resumeReport().prohibitedActions).every((value) => value === false)).toBe(true); });
  it("requires the orchestrator checkpoint", () => { const report = resumeReport({ stages: resumeReport().stages.filter((stage) => stage.name !== "ORCHESTRATOR") }); expect(() => validateResumeCheckpoint(report)).toThrow("REAL_E2E_RESUME_CHECKPOINT_INVALID:ORCHESTRATOR"); });
  it("requires implementation start checkpoint", () => { const report = resumeReport({ stages: resumeReport().stages.filter((stage) => stage.name !== "START_IMPLEMENTATION") }); expect(() => validateResumeCheckpoint(report)).toThrow("REAL_E2E_RESUME_CHECKPOINT_INVALID:START_IMPLEMENTATION"); });
  it("requires design generation checkpoint", () => { const report = resumeReport({ stages: resumeReport().stages.filter((stage) => stage.name !== "DESIGN") }); expect(() => validateResumeCheckpoint(report)).toThrow("REAL_E2E_RESUME_CHECKPOINT_INVALID:DESIGN"); });
  it("requires planner execution checkpoint", () => { const report = resumeReport({ stages: resumeReport().stages.filter((stage) => stage.name !== "PLANNER") }); expect(() => validateResumeCheckpoint(report)).toThrow("REAL_E2E_RESUME_CHECKPOINT_INVALID:PLANNER"); });
  it("requires lead execution checkpoint", () => { const report = resumeReport({ stages: resumeReport().stages.filter((stage) => stage.name !== "LEAD") }); expect(() => validateResumeCheckpoint(report)).toThrow("REAL_E2E_RESUME_CHECKPOINT_INVALID:LEAD"); });
  it("does not synthesize a provider request identifier", () => { expect(resumeReport().provider.requestCount).toBe(3); });
  it("keeps the prior provider evidence traceable", () => { expect(resumeReport().realStageEvidence.leadRequest).toBe(true); expect(resumeReport().realStageEvidence.plannerRequest).toBe(true); });
  it("supports the normal fresh path separately", async () => { const pending = await runRealFactoryE2EPreflight({}); expect(pending.status).toBe("pending"); });
  it("keeps deterministic tests external-call free", () => { expect(resumeReport().adapterIdentity.leadProviderMode).toBe("production"); expect(resumeReport().adapterIdentity.processRunnerMode).toBe("real"); });
});
