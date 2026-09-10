import { describe, expect, it, vi } from "vitest";
import { RequirementSpecificationSchema, type RequirementSpecification } from "@/domain/requirements/schema";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { migrateLegacyBriefToCanonicalBriefV3 } from "@/domain/requirements/v3/migrate";
import { buildPhase7CContractPackage } from "@/domain/contracts/phase7c";
import { buildPlanningPackage, planningSemanticChecksum } from "@/agents/planner/deterministic";
import type { PlanningPackage, PlannerAgentInput } from "@/agents/planner/contracts";
import type { ArchitectureReviewInput } from "@/agents/reviewers/architecture/contracts";
import { ArchitectureReviewService } from "@/agents/reviewers/architecture/service";
import { deterministicArchitectureReview } from "@/agents/reviewers/architecture/deterministic";
import { OpenAiArchitectureReviewerProvider } from "@/integrations/openai/adapters";
import { OpenAiStructuredClient } from "@/integrations/openai/client";
import { ArchitectureReviewOrchestrationService } from "@/orchestration/architecture-review/service";
import { createBriefV3Document } from "@/persistence/database/brief-revision-v3-contracts";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { TrialEntryService } from "@/runtime/trial-entry/service";
import { WorkbenchApplication } from "./application";
import { WorkbenchRequestSchema, actionsForWorkbenchState } from "./contracts";
import { workbenchFailureResponse } from "./diagnostics";

const timestamp = "2026-08-23T12:00:00.000Z";
const projectId = "28282828-2828-4282-8282-282828282828";

function brief(): RequirementSpecification {
  return RequirementSpecificationSchema.parse({
    schemaVersion: 1, documentType: "requirements", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp,
    projectSummary: "Synthetic review fixture", protectedFunctionalityRequired: false, imagesRequired: true,
    businessGoals: ["Explain the synthetic service"], targetAudiences: ["Synthetic visitors"], pages: [{ slug: "home", purpose: "Explain the service" }],
    userRoles: [], features: [], forms: [], contentRequirements: [], backendRequirements: [], supabaseRequirements: [],
    authenticationDecision: "no-authentication-guest-first", storageDecision: "not-needed", emailDecision: "not-needed", administrationDecision: "not-needed", seoRequirements: [],
    localization: { locales: ["en"], defaultLocale: "en" }, imageSourceDecision: "custom", suppliedBrandInformation: { status: "missing" }, suppliedLogoLocation: { status: "missing" },
    technicalConstraints: [], explicitExclusions: [], userAcceptanceCriteria: ["Home loads"], unresolvedItems: [],
    approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-user" }, briefStatus: "approved", briefVersion: 1,
    contactFacts: [], legalFacts: [], brandFacts: [], logoMetadata: [], imageSourcingNotes: [], evidence: [], recommendations: [],
    legalComplianceConstraints: { constraints: [], placeholderPolicy: "USE_EXPLICIT_PLACEHOLDERS", inventedFactsForbidden: true },
  });
}

async function fixture() {
  const database = new InMemoryPersistenceDatabase();
  const legacy = brief();
  const canonical = migrateLegacyBriefToCanonicalBriefV3(legacy);
  const draftV3 = createBriefV3Document({ projectId, projectVersion: 1, brief: canonical, createdAt: timestamp, updatedAt: timestamp });
  const briefV3 = { ...draftV3, approval: { approved: true as const, approvedAt: timestamp, approvedBy: "synthetic-user", approvedCanonicalChecksum: draftV3.briefChecksum } };
  const approvedBrief = RequirementSpecificationSchema.parse({ ...legacy, approval: { ...legacy.approval, approvedRequirementsChecksum: briefV3.briefChecksum } });
  const plannerInput: PlannerAgentInput = { projectId, projectVersion: 1, approvedBrief, canonicalBrief: briefV3.brief, approvedBriefChecksum: briefV3.briefChecksum, originalPromptReference: "original-prompt.md", clarificationEvidenceReferences: [], currentWorkflowState: "AWAITING_DESIGN_SELECTION", existingDecisions: [], suppliedFiles: [], allowedSkills: [], idempotencyKey: "synthetic-planning", expectedRowVersion: 1 };
  const builtPlanning = buildPlanningPackage(plannerInput);
  const planning = { ...builtPlanning, accepted: true, acceptance: { acceptedAt: timestamp, acceptedBy: "synthetic-user", checksum: checksumPersistedDocument(builtPlanning) }, architecture: { ...builtPlanning.architecture, acceptance: { accepted: true, acceptedAt: timestamp, acceptedBy: "synthetic-user" } } } as PlanningPackage;
  const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "synthetic-architecture-boundary", origin: "SYNTHETIC", originalPrompt: "Synthetic Architecture Review Workbench boundary fixture.", currentVersion: 1, workflowState: "ARCHITECTURE_REVIEW" });
  await new ProjectRepository(database).create(project);
  await new ProjectVersionRepository(database).create({ id: "29292929-2929-4292-8292-292929292929", projectId, versionNumber: 1, state: "ARCHITECTURE_REVIEW", memoryRootPath: null, requirementsChecksum: briefV3.briefChecksum, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
  const documents = new DocumentRepository(database);
  await documents.save(approvedBrief);
  await documents.save(briefV3);
  await documents.save(planning);
  await documents.save(planning.architecture);
  const phase7c = buildPhase7CContractPackage({ projectId, projectVersion: 1, createdAt: timestamp, approvedBriefChecksum: briefV3.briefChecksum, planningChecksum: planningSemanticChecksum(planning), architectureChecksum: checksumPersistedDocument(planning.architecture), designChecksum: "0".repeat(64), planning });
  await documents.save(phase7c);
  const entry = new TrialEntryService({ database, createLeadAgent: () => { throw new Error("SYNTHETIC_LEAD_NOT_EXPECTED"); } });
  return { database, entry, approvedBrief, briefV3, planning };
}

describe("canonical Workbench Architecture Review boundary", () => {
  it("accepts only the minimal host-owned Architecture action request", () => {
    expect(WorkbenchRequestSchema.parse({ action: "generate-architecture-review", projectId }).action).toBe("generate-architecture-review");
    expect(WorkbenchRequestSchema.safeParse({ action: "generate-architecture-review", projectId, approvedBriefChecksum: "a".repeat(64) }).success).toBe(false);
  });

  it("derives exactly one Architecture action at the valid lifecycle frontier", () => {
    const base = { workflowState: "ARCHITECTURE_REVIEW" as const, hasBlockingQuestions: false, hasBrief: true, briefReady: true, hasPlanning: true, hasDesigns: false };
    expect(actionsForWorkbenchState({ ...base, canGenerateArchitectureReview: true })).toEqual(["GENERATE_ARCHITECTURE_REVIEW"]);
    expect(actionsForWorkbenchState({ ...base, canGenerateArchitectureReview: false })).toEqual([]);
    expect(actionsForWorkbenchState({ ...base, workflowState: "AWAITING_PLANNING_APPROVAL", canGenerateArchitectureReview: true })).not.toContain("GENERATE_ARCHITECTURE_REVIEW");
  });

  it("projects the valid synthetic frontier and dispatches host-derived input through orchestration", async () => {
    const state = await fixture();
    const calls: ArchitectureReviewInput[] = [];
    const architectureReviewer = { reviewAndRoute: vi.fn(async (input: ArchitectureReviewInput) => { calls.push(input); return { result: { verdict: "APPROVED", findings: [], reviewedArtifactRefs: [] }, projectState: "ARCHITECTURE_REVIEW" as const, rowVersion: 1, projectionStatus: "SYNCED" as const }; }) } as unknown as ArchitectureReviewOrchestrationService;
    const app = new WorkbenchApplication({ database: state.database, entry: state.entry, getWorkflowScope: () => ({ architectureReviewer, planner: undefined, design: undefined, orchestrator: undefined, contractAuditor: undefined } as never) });
    const result = await app.handle({ action: "generate-architecture-review", projectId });
    expect(result.project?.workflowState).toBe("ARCHITECTURE_REVIEW");
    expect(architectureReviewer.reviewAndRoute).toHaveBeenCalledOnce();
    expect(calls[0]).toMatchObject({ projectId, projectVersion: 1, approvedBriefChecksum: state.briefV3.briefChecksum, acceptedPlanningChecksum: checksumPersistedDocument(state.planning), expectedRowVersion: 1 });
    expect(calls[0]).not.toHaveProperty("untrustedClientPayload");
    expect(await new DocumentRepository(state.database).get(projectId, 1, "architecture-review")).toBeNull();
    const operation = await state.database.transaction((tx) => tx.getOperation({ operation: "workbench.architecture-review", key: projectId }));
    expect(operation?.status).toBe("SUCCEEDED");
    expect(operation?.result).toMatchObject({ providerCallsTotal: 0, providerCallsByStage: { "architecture-review": { attempted: 0, started: 0, responseReceived: 0, structuredParsePassed: 0, semanticAdmissionPassed: 0, completed: 0, failed: 0 } }, canonicalArchitecturePersisted: false, lifecycleMutated: false });
  });

  it("uses one provider invocation with retries disabled at the canonical Workbench boundary", async () => {
    const state = await fixture();
    let calls = 0;
    const provider = { promptVersion: "architecture-reviewer.v2", review: async (input: ArchitectureReviewInput) => { calls += 1; return deterministicArchitectureReview(input); } };
    const service = new ArchitectureReviewOrchestrationService(state.database, new ArchitectureReviewService(state.database, { provider }));
    const app = new WorkbenchApplication({ database: state.database, entry: state.entry, getWorkflowScope: () => ({ architectureReviewer: service, planner: undefined, design: undefined, orchestrator: undefined, contractAuditor: undefined } as never) });
    const result = await app.handle({ action: "generate-architecture-review", projectId });
    expect(result.project?.workflowState).toBe("AWAITING_DESIGN_SELECTION");
    expect(calls).toBe(1);
    expect(await new DocumentRepository(state.database).get(projectId, 1, "architecture-review")).not.toBeNull();
    expect((await state.database.transaction((tx) => tx.getOperation({ operation: "workbench.architecture-review", key: projectId })))?.status).toBe("SUCCEEDED");
  });

  it("persists bounded transport diagnostics through the real Architecture Workbench failure envelope", async () => {
    const state = await fixture();
    let providerCalls = 0;
    const cause = Object.assign(new Error("SECRET_DNS_DETAIL"), { code: "ENOTFOUND" });
    const provider = new OpenAiArchitectureReviewerProvider(new OpenAiStructuredClient({ apiKey: "synthetic", model: "synthetic-model", modelLabel: "Synthetic", maxRetries: 0, maxConcurrentRequests: 1 }, {
      executor: async () => {
        providerCalls += 1;
        throw Object.assign(new Error("SECRET_PROVIDER_WRAPPER"), { cause });
      },
    }));
    const service = new ArchitectureReviewOrchestrationService(state.database, new ArchitectureReviewService(state.database, { provider }));
    const app = new WorkbenchApplication({ database: state.database, entry: state.entry, getWorkflowScope: () => ({ architectureReviewer: service, planner: undefined, design: undefined, orchestrator: undefined, contractAuditor: undefined } as never) });
    let failure: unknown;
    try {
      await app.handle({ action: "generate-architecture-review", projectId });
    } catch (error) {
      failure = error;
    }
    expect(providerCalls).toBe(1);
    const response = workbenchFailureResponse(failure, { action: "generate-architecture-review", projectId });
    expect(response.status).toBe(503);
    expect(response.response).toMatchObject({
      code: "ARCHITECTURE_REVIEW_PROVIDER_FAILED",
      operationStage: "PROVIDER_TRANSPORT",
      providerCallsTotal: 1,
      providerInvocationState: "FAILED",
      canonicalArchitecturePersisted: false,
      lifecycleMutated: false,
      providerDiagnostic: {
        transportPhase: "DNS",
        transportFailureClass: "DNS_RESOLUTION_FAILED",
        transportCauseCode: "ENOTFOUND",
      },
    });
    expect(JSON.stringify(response.response)).not.toContain("SECRET_");
    const operation = await state.database.transaction((tx) => tx.getOperation({ operation: "workbench.architecture-review", key: projectId }));
    expect(operation).toMatchObject({ status: "FAILED", result: { stage: "PROVIDER_TRANSPORT", providerCallsTotal: 1, providerDiagnostic: { transportFailureClass: "DNS_RESOLUTION_FAILED" }, canonicalArchitecturePersisted: false, lifecycleMutated: false } });
    expect(await new DocumentRepository(state.database).get(projectId, 1, "architecture-review")).toBeNull();
    const current = await new ProjectRepository(state.database).getWithVersion(projectId);
    expect(current).toMatchObject({ project: { workflowState: "ARCHITECTURE_REVIEW" }, rowVersion: 1 });
  });
});
