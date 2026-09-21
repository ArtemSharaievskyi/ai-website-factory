import { describe, expect, it } from "vitest";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { workbenchFailureResponse } from "@/runtime/workbench/diagnostics";
import { WorkbenchOperationLedger } from "@/runtime/workbench/operation-ledger";
import {
  PlanningFinalAdmissionDiagnosticsSchema,
  PlanningFinalCoverageIssueSchema,
  planningFinalCoverageDiagnostics,
  planningFinalAdmissionDiagnostics,
  PlanningFinalAdmissionError,
} from "./final-admission-diagnostics";
import {
  StagedPlanningOperationTelemetry,
  StagedPlanningOperationSummarySchema,
} from "./staged-failures";

const projectId = "11111111-1111-4111-8111-111111111111";
const correlationId = "99999999-9999-4999-8999-999999999999";
const identity = {
  operationId: "workbench-planning:11111111-1111-4111-8111-111111111111",
  operationChecksum: "a".repeat(64),
  correlationId,
  projectId,
  briefChecksum: "b".repeat(64),
};

function diagnostics(boundary: "FINAL_ASSEMBLY" | "FINAL_ADMISSION", blockers: string[], validator: "ASSEMBLE_STAGED_PLANNING_CANDIDATE" | "ADMIT_PLANNING_REFRESH" | "VALIDATE_PLANNING_ADMISSION" | "VALIDATE_PLANNING_PACKAGE_AGAINST_BRIEF" | "FINAL_CURRENTNESS") {
  return planningFinalAdmissionDiagnostics({ boundary, blockers, validator });
}

function stagedFailure(finalAdmissionDiagnostics: ReturnType<typeof diagnostics>, cause?: unknown) {
  const telemetry = new StagedPlanningOperationTelemetry(identity);
  telemetry.enter(finalAdmissionDiagnostics.boundary);
  return telemetry.fail({
    stage: finalAdmissionDiagnostics.boundary,
    boundary: finalAdmissionDiagnostics.boundary,
    outerCode: "PLANNING_PACKAGE_INVALID",
    failureClass: "STAGED_FINAL_ASSEMBLY_FAILURE",
    reasonCode: finalAdmissionDiagnostics.primary.reasonCode,
    safeToken: finalAdmissionDiagnostics.primary.safeToken,
    finalAdmissionDiagnostics,
    message: "private provider and canonical requirement prose",
    cause,
  });
}

describe("staged Planning final admission diagnostics", () => {
  it("retains bounded actionable coverage evidence with separate totals and truncation", () => {
    const makeIssue = (index: number) => PlanningFinalCoverageIssueSchema.parse({
      canonicalRequirementId: `REQUIREMENT:synthetic-${String(index).padStart(3, "0")}`,
      category: "FEATURE",
      ownership: "PLANNING",
      kind: "SEMANTIC_MISSING",
      reason: "MISSING_SEMANTIC_EVIDENCE",
      referenceStatus: "PRESENT",
      canonicalReferencesPresent: [`REQUIREMENT:synthetic-${String(index).padStart(3, "0")}`],
      stagedRequirementToken: `REQ_${String(index).padStart(3, "0")}`,
      planningElementIds: [`PE_${String(index).padStart(3, "0")}`],
      normalizedEvidence: {
        status: "PARTIAL",
        score: 0.5,
        requiredTokenCount: 8,
        matchedTokenCount: 4,
        requiredTokens: ["synthetic", "requirement"],
        matchedTokens: ["synthetic"],
        unmatchedTokens: ["requirement"],
        tokenListTruncated: false,
        evaluatedFieldPaths: ["productScope.inScopeCapabilities", "traceability"],
        normalizedCorpusChecksum: "a".repeat(64),
      },
      explanation: "SEMANTIC_EVIDENCE_BELOW_THRESHOLD",
    });
    const coverage = planningFinalCoverageDiagnostics({ issues: Array.from({ length: 10 }, (_, index) => makeIssue(index + 1)) });
    expect(coverage).toMatchObject({ availability: "AVAILABLE", issueCount: 10, retainedIssueCount: 8, truncated: true });
    expect(coverage.issues).toHaveLength(8);
    expect(coverage.issues[0]).toMatchObject({
      canonicalRequirementId: "REQUIREMENT:synthetic-001",
      category: "FEATURE",
      ownership: "PLANNING",
      reason: "MISSING_SEMANTIC_EVIDENCE",
      stagedRequirementToken: "REQ_001",
      planningElementIds: ["PE_001"],
      normalizedEvidence: { status: "PARTIAL", score: 0.5, requiredTokenCount: 8, matchedTokenCount: 4, requiredTokens: ["synthetic", "requirement"], matchedTokens: ["synthetic"], unmatchedTokens: ["requirement"], tokenListTruncated: false, evaluatedFieldPaths: ["productScope.inScopeCapabilities", "traceability"], normalizedCorpusChecksum: "a".repeat(64) },
    });
    expect(JSON.stringify(coverage)).not.toContain("private provider response");
  });

  it("represents unavailable coverage diagnostics without inventing an issue", () => {
    expect(planningFinalCoverageDiagnostics({ availability: "UNAVAILABLE", issues: [] })).toEqual({ availability: "UNAVAILABLE", issueCount: 0, retainedIssueCount: 0, issues: [], truncated: false });
  });

  it("retains the distinction between a staged mapping that did not bind and an absent mapping", () => {
    const issue = PlanningFinalCoverageIssueSchema.parse({
      canonicalRequirementId: "REQUIREMENT:synthetic-invalid-mapping",
      category: "FEATURE",
      ownership: "PLANNING",
      kind: "INVALID_MAPPING",
      reason: "MISSING_REFERENCE",
      referenceStatus: "INVALID",
      canonicalReferencesPresent: [],
      stagedRequirementToken: "REQ_009",
      planningElementIds: ["PE_009"],
      normalizedEvidence: { status: "NOT_EVALUATED", score: null, requiredTokenCount: 0, matchedTokenCount: 0, requiredTokens: [], matchedTokens: [], unmatchedTokens: [], tokenListTruncated: false, evaluatedFieldPaths: [], normalizedCorpusChecksum: null },
      explanation: "STAGED_MAPPING_NOT_BOUND",
    });
    expect(planningFinalCoverageDiagnostics({ issues: [issue] }).issues[0]).toMatchObject({ kind: "INVALID_MAPPING", referenceStatus: "INVALID", stagedRequirementToken: "REQ_009", explanation: "STAGED_MAPPING_NOT_BOUND" });
  });

  it("keeps true assembly failures distinct from final admission", () => {
    const failure = stagedFailure(diagnostics("FINAL_ASSEMBLY", ["PLANNING_FINAL_ASSEMBLY_INVALID"], "ASSEMBLE_STAGED_PLANNING_CANDIDATE"));
    expect(failure.details).toMatchObject({
      stage: "FINAL_ASSEMBLY",
      boundary: "FINAL_ASSEMBLY",
      reasonCode: "PLANNING_FINAL_ASSEMBLY_INVALID",
      finalAdmissionDiagnostics: {
        boundary: "FINAL_ASSEMBLY",
        primary: { reasonCode: "PLANNING_FINAL_ASSEMBLY_INVALID", validator: "ASSEMBLE_STAGED_PLANNING_CANDIDATE", category: "ASSEMBLY" },
        issueCount: 1,
      },
    });
  });

  it("preserves exact deterministic final-admission reasons and coverage diagnostics", () => {
    const finalDiagnostics = diagnostics("FINAL_ADMISSION", ["PLANNING_REQUIREMENT_COVERAGE_MISSING:REQ_117:MISSING_SEMANTIC_EVIDENCE"], "ADMIT_PLANNING_REFRESH");
    expect(PlanningFinalAdmissionDiagnosticsSchema.parse(finalDiagnostics)).toEqual(finalDiagnostics);
    const failure = stagedFailure(finalDiagnostics);
    const response = workbenchFailureResponse(failure, { action: "approve-planning", projectId, correlationId });
    expect(response.response).toMatchObject({
      code: "PLANNING_PACKAGE_INVALID",
      stage: "FINAL_ADMISSION",
      boundary: "FINAL_ADMISSION",
      reasonCode: "PLANNING_REQUIREMENT_COVERAGE_MISSING",
      safeToken: "REQ_117",
      finalAdmissionDiagnostics: {
        boundary: "FINAL_ADMISSION",
        primary: { reasonCode: "PLANNING_REQUIREMENT_COVERAGE_MISSING", validator: "ADMIT_PLANNING_REFRESH", category: "COVERAGE", safeToken: "REQ_117" },
      },
    });
  });

  it("reports route, currentness, and multi-issue failures deterministically", () => {
    const route = diagnostics("FINAL_ADMISSION", ["PLANNING_ROUTE_POLICY_MISMATCH"], "VALIDATE_PLANNING_PACKAGE_AGAINST_BRIEF");
    const currentness = diagnostics("FINAL_ADMISSION", ["PLANNING_STALE"], "FINAL_CURRENTNESS");
    const many = diagnostics("FINAL_ADMISSION", [
      "PLANNING_ROUTE_POLICY_MISMATCH",
      "PLANNING_REQUIREMENT_COVERAGE_MISSING:REQ_117",
      "PLANNING_REQUIREMENT_COVERAGE_MISSING:REQ_116",
      "PLANNING_REQUIREMENT_COVERAGE_MISSING:REQ_115",
      "PLANNING_REQUIREMENT_COVERAGE_MISSING:REQ_114",
      "PLANNING_REQUIREMENT_COVERAGE_MISSING:REQ_113",
      "PLANNING_REQUIREMENT_COVERAGE_MISSING:REQ_112",
      "PLANNING_REQUIREMENT_COVERAGE_MISSING:REQ_111",
      "PLANNING_REQUIREMENT_COVERAGE_MISSING:REQ_110",
      "PLANNING_STALE",
    ], "VALIDATE_PLANNING_ADMISSION");
    expect(route.primary).toMatchObject({ reasonCode: "PLANNING_ROUTE_POLICY_MISMATCH", category: "ROUTE" });
    expect(currentness.primary).toMatchObject({ reasonCode: "PLANNING_STALE", category: "CURRENTNESS" });
    expect(many.issueCount).toBe(10);
    expect(many.safeIssues).toHaveLength(8);
    expect(many.safeIssues).toEqual([...many.safeIssues].sort((left, right) => `${left.reasonCode}|${left.safeToken ?? ""}`.localeCompare(`${right.reasonCode}|${right.safeToken ?? ""}`, "en")));
    expect(JSON.stringify(many)).not.toMatch(/MISSING_SEMANTIC_EVIDENCE|private|\/private/);
  });

  it("round-trips final diagnostics through Workbench and the durable operation ledger", async () => {
    const database = new InMemoryPersistenceDatabase();
    const staged = stagedFailure(diagnostics("FINAL_ADMISSION", ["PLANNING_ROUTE_OUTSIDE_CANONICAL_PAGES:/private"], "VALIDATE_PLANNING_PACKAGE_AGAINST_BRIEF"));
    const ledger = new WorkbenchOperationLedger(database, projectId, identity.operationId, correlationId);
    await ledger.reserve();
    const failure = await ledger.fail(staged);
    const persisted = await database.transaction((tx) => tx.getOperation({ operation: "workbench.planning", key: projectId }));
    expect(persisted?.result).toMatchObject({
      boundary: "FINAL_ADMISSION",
      reasonCode: "PLANNING_ROUTE_OUTSIDE_CANONICAL_PAGES",
      finalAdmissionDiagnostics: {
        primary: { reasonCode: "PLANNING_ROUTE_OUTSIDE_CANONICAL_PAGES", category: "ROUTE" },
      },
    });
    const response = workbenchFailureResponse(failure, { action: "approve-planning", projectId, correlationId });
    expect(response.response.finalAdmissionDiagnostics).toEqual(failure.details.finalAdmissionDiagnostics);
    expect(JSON.stringify(response.response)).not.toContain("/private");
  });

  it("round-trips actionable coverage diagnostics through the durable attempt and report", async () => {
    const requirementId = "REQUIREMENT:synthetic-actionable";
    const issue = PlanningFinalCoverageIssueSchema.parse({
      canonicalRequirementId: requirementId,
      category: "FEATURE",
      ownership: "PLANNING",
      kind: "ABSENT_MAPPING",
      reason: "MISSING_REFERENCE",
      referenceStatus: "ABSENT",
      canonicalReferencesPresent: [],
      stagedRequirementToken: "REQ_007",
      planningElementIds: ["PE_003"],
      normalizedEvidence: { status: "NOT_EVALUATED", score: null, requiredTokenCount: 0, matchedTokenCount: 0, requiredTokens: [], matchedTokens: [], unmatchedTokens: [], tokenListTruncated: false, evaluatedFieldPaths: [], normalizedCorpusChecksum: null },
      explanation: "CANONICAL_REFERENCE_ABSENT",
    });
    const finalDiagnostics = planningFinalAdmissionDiagnostics({
      boundary: "FINAL_ADMISSION",
      validator: "ADMIT_PLANNING_REFRESH",
      blockers: [`PLANNING_REQUIREMENT_COVERAGE_MISSING:REQ_007:MISSING_REFERENCE`],
      coverage: planningFinalCoverageDiagnostics({ issues: [issue] }),
    });
    const database = new InMemoryPersistenceDatabase();
    const staged = stagedFailure(finalDiagnostics, new Error("private provider response with SECRET=redacted"));
    const ledger = new WorkbenchOperationLedger(database, projectId, identity.operationId, correlationId);
    await ledger.reserve();
    const failure = await ledger.fail(staged);
    const persistedAttempt = await database.transaction((tx) => tx.getOperation({ operation: "workbench.planning.attempt", key: `${identity.operationId}:${failure.details.attemptId}` }));
    expect(persistedAttempt?.result).toMatchObject({
      finalAdmissionDiagnostics: {
        coverage: {
          availability: "AVAILABLE",
          issueCount: 1,
          retainedIssueCount: 1,
          truncated: false,
          issues: [{ canonicalRequirementId: requirementId, kind: "ABSENT_MAPPING", reason: "MISSING_REFERENCE", stagedRequirementToken: "REQ_007", planningElementIds: ["PE_003"], canonicalReferencesPresent: [] }],
        },
      },
    });
    const response = workbenchFailureResponse(failure, { action: "approve-planning", projectId, correlationId });
    expect(response.response.finalAdmissionDiagnostics).toEqual(failure.details.finalAdmissionDiagnostics);
    expect(JSON.stringify(persistedAttempt)).not.toContain("private provider response");
    expect(JSON.stringify(response.response)).not.toContain("SECRET=redacted");
  });

  it("continues to read historical summaries without new final fields", () => {
    const telemetry = new StagedPlanningOperationTelemetry(identity);
    const current = telemetry.succeed();
    const historical = { ...current };
    delete historical.boundary;
    delete historical.finalAdmissionDiagnostics;
    expect(StagedPlanningOperationSummarySchema.parse(historical)).toEqual(historical);
  });

  it("does not expose the original error through the typed failure wrapper", () => {
    const finalDiagnostics = diagnostics("FINAL_ADMISSION", ["PLANNING_STALE"], "FINAL_CURRENTNESS");
    const error = new PlanningFinalAdmissionError(finalDiagnostics, ["PLANNING_STALE:private project detail"], "private final admission detail");
    const response = workbenchFailureResponse(stagedFailure(finalDiagnostics, error), { action: "approve-planning", projectId, correlationId });
    expect(error.message).toContain("private");
    expect(JSON.stringify(response.response)).not.toContain("private");
  });
});
