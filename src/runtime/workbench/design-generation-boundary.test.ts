import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { RequirementSpecificationSchema, type RequirementSpecification } from "@/domain/requirements/schema";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { migrateLegacyBriefToCanonicalBriefV3 } from "@/domain/requirements/v3/migrate";
import { createBriefV3Document } from "@/persistence/database/brief-revision-v3-contracts";
import { buildPlanningPackage } from "@/agents/planner/deterministic";
import type { PlannerAgentInput, PlanningPackage } from "@/agents/planner/contracts";
import { ArchitectureReviewRecordSchema } from "@/domain/review/schema";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { TrialEntryService } from "@/runtime/trial-entry/service";
import { DesignAgentService } from "@/agents/design/service";
import { FakeDesignMemoryPort } from "@/agents/design/memory";
import { buildDesignDirectionSet } from "@/agents/design/deterministic";
import { WorkbenchApplication } from "./application";
import { WorkbenchRequestSchema, actionsForWorkbenchState } from "./contracts";
import type { SourceCurrentnessPort } from "@/domain/shared/source-head";

const timestamp = "2026-09-01T00:00:00.000Z";
const projectId = "73737373-7373-4373-8373-737373737373";

function brief(): RequirementSpecification {
  return RequirementSpecificationSchema.parse({
    schemaVersion: 1, documentType: "requirements", projectId, projectVersion: 1,
    createdAt: timestamp, updatedAt: timestamp, projectSummary: "Synthetic public marketing site",
    protectedFunctionalityRequired: false, imagesRequired: false,
    businessGoals: ["Explain the synthetic service"], targetAudiences: ["Synthetic visitors"],
    pages: [{ slug: "home", purpose: "Explain the service" }], userRoles: [], features: [], forms: [],
    contentRequirements: [], backendRequirements: [], supabaseRequirements: [],
    authenticationDecision: "no-authentication-guest-first", storageDecision: "not-needed",
    emailDecision: "not-needed", administrationDecision: "not-needed", seoRequirements: [],
    localization: { locales: ["en"], defaultLocale: "en" }, imageSourceDecision: "placeholders",
    suppliedBrandInformation: { status: "missing" }, suppliedLogoLocation: { status: "missing" },
    technicalConstraints: [], explicitExclusions: [], userAcceptanceCriteria: ["Home loads"], unresolvedItems: [],
    approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-user" }, briefStatus: "approved", briefVersion: 1,
    contactFacts: [], legalFacts: [], brandFacts: [], logoMetadata: [], imageSourcingNotes: [], evidence: [], recommendations: [],
    legalComplianceConstraints: { constraints: [], placeholderPolicy: "USE_EXPLICIT_PLACEHOLDERS", inventedFactsForbidden: true },
  });
}

async function fixture(options: { provider?: (input: Parameters<typeof buildDesignDirectionSet>[0]) => Promise<ReturnType<typeof buildDesignDirectionSet>>; source?: SourceCurrentnessPort } = {}) {
  const database = new InMemoryPersistenceDatabase();
  const legacyBrief = brief();
  const canonicalDraft = createBriefV3Document({ projectId, projectVersion: 1, brief: migrateLegacyBriefToCanonicalBriefV3(legacyBrief), createdAt: timestamp, updatedAt: timestamp });
  const briefV3 = { ...canonicalDraft, approval: { approved: true as const, approvedAt: timestamp, approvedBy: "synthetic-user", approvedCanonicalChecksum: canonicalDraft.briefChecksum } };
  const plannerInput: PlannerAgentInput = { projectId, projectVersion: 1, approvedBrief: legacyBrief, canonicalBrief: briefV3.brief, approvedBriefChecksum: briefV3.briefChecksum, originalPromptReference: "synthetic-prompt", clarificationEvidenceReferences: [], currentWorkflowState: "AWAITING_DESIGN_SELECTION", existingDecisions: [], suppliedFiles: [], allowedSkills: [], idempotencyKey: "synthetic-planning", expectedRowVersion: 1 };
  const builtPlanning = buildPlanningPackage(plannerInput);
  const planning = { ...builtPlanning, accepted: true, acceptance: { acceptedAt: timestamp, acceptedBy: "synthetic-user", checksum: checksumPersistedDocument(builtPlanning) }, architecture: { ...builtPlanning.architecture, acceptance: { accepted: true, acceptedAt: timestamp, acceptedBy: "synthetic-user" } } } as PlanningPackage;
  const review = ArchitectureReviewRecordSchema.parse({
    schemaVersion: 1, documentType: "architecture-review", projectId, projectVersion: 1,
    createdAt: timestamp, updatedAt: timestamp, reviewId: randomUUID(), reviewerAgentId: "architecture-reviewer",
    reviewerVersion: "1.0.0", capability: "review.architecture", policyVersion: "architecture-review-v1", promptVersion: "architecture-reviewer.v2",
    reviewInputChecksum: "1".repeat(64), approvedBriefChecksum: briefV3.briefChecksum,
    acceptedPlanningChecksum: checksumPersistedDocument(planning), architectureChecksum: "2".repeat(64), phase7cChecksum: "3".repeat(64), resultChecksum: "4".repeat(64),
    result: { verdict: "APPROVED", findings: [], reviewedArtifactRefs: ["brief:projectSummary", "planning:architecture"], policyVersion: "architecture-review-v1" },
  });
  const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "synthetic-design-boundary", origin: "SYNTHETIC", originalPrompt: "Synthetic Design Workbench boundary fixture.", currentVersion: 1, workflowState: "AWAITING_DESIGN_SELECTION" });
  await new ProjectRepository(database).create(project);
  await new ProjectVersionRepository(database).create({ id: randomUUID(), projectId, versionNumber: 1, state: project.workflowState, memoryRootPath: null, requirementsChecksum: briefV3.briefChecksum, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
  const documents = new DocumentRepository(database);
  await documents.save(legacyBrief);
  await documents.save(briefV3);
  await documents.save(planning);
  await documents.save(review);
  const entry = new TrialEntryService({ database, createLeadAgent: () => { throw new Error("SYNTHETIC_LEAD_NOT_EXPECTED"); } });
  let providerCalls = 0;
  const provider = { proposeDesignDirections: async (input: Parameters<typeof buildDesignDirectionSet>[0]) => { providerCalls += 1; return options.provider ? options.provider(input) : buildDesignDirectionSet(input); } };
  const design = new DesignAgentService({ database, memory: new FakeDesignMemoryPort(), provider, ...(options.source ? { source: options.source } : {}) });
  const app = new WorkbenchApplication({ database, entry, getWorkflowScope: () => ({ design, planner: undefined, architectureReviewer: undefined, orchestrator: undefined, contractAuditor: undefined } as never) });
  return { database, documents, entry, app, design, planning, review, providerCalls: () => providerCalls };
}

describe("canonical Workbench Design generation boundary", () => {
  it("exposes generation, not selection, when the approved Review has zero directions", async () => {
    const state = await fixture();
    expect(WorkbenchRequestSchema.safeParse({ action: "generate-design", projectId }).success).toBe(true);
    expect(actionsForWorkbenchState({ workflowState: "AWAITING_DESIGN_SELECTION", hasBlockingQuestions: false, hasBrief: true, briefReady: true, hasPlanning: true, hasDesigns: false })).toEqual(["GENERATE_DESIGN", "REQUEST_PLANNING_CHANGES", "DATABASE_DECISION", "DEPENDENCY_APPROVAL"]);
    const status = await state.app.handle({ action: "status", projectId });
    expect(status.status.allowedActions).toContain("GENERATE_DESIGN");
    expect(status.status.allowedActions).not.toContain("DESIGN_SELECTION");
  });

  it("dispatches the existing Design service and makes selection eligible without selecting", async () => {
    const state = await fixture();
    const result = await state.app.handle({ action: "generate-design", projectId });
    expect(state.providerCalls()).toBe(1);
    expect(result.project?.workflowState).toBe("AWAITING_DESIGN_SELECTION");
    expect(result.designs).toHaveLength(3);
    expect(result.status.allowedActions).toContain("DESIGN_SELECTION");
    expect(result.status.allowedActions).not.toContain("GENERATE_DESIGN");
    expect(result.selectedDesignId).toBeUndefined();
    expect(await state.documents.get(projectId, 1, "selected-design")).toBeNull();
    const operation = await state.database.transaction((tx) => tx.listOperations({ operation: "workbench.design" }));
    expect(operation).toHaveLength(1);
    expect(operation[0]?.status).toBe("SUCCEEDED");
  });

  it("replays the same frontier without a second provider call", async () => {
    const state = await fixture();
    const first = await state.app.handle({ action: "generate-design", projectId });
    const second = await state.app.handle({ action: "generate-design", projectId });
    expect(second.designSetChecksum).toBe(first.designSetChecksum);
    expect(state.providerCalls()).toBe(1);
    expect((await state.database.transaction((tx) => tx.listOperations({ operation: "workbench.design" })))[0]?.status).toBe("SUCCEEDED");
  });

  it("rejects a stale Architecture Review before the provider boundary", async () => {
    const state = await fixture();
    const currentReview = await state.documents.get(projectId, 1, "architecture-review");
    if (!currentReview || currentReview.documentType !== "architecture-review") throw new Error("review fixture missing");
    await state.documents.save({ ...currentReview, updatedAt: "2026-09-01T00:00:01.000Z", approvedBriefChecksum: "f".repeat(64) });
    await expect(state.app.handle({ action: "generate-design", projectId })).rejects.toMatchObject({ code: "DESIGN_ARCHITECTURE_REVIEW_STALE" });
    expect(state.providerCalls()).toBe(0);
    expect(await state.documents.get(projectId, 1, "design-directions")).toBeNull();
  });

  it("reserves one active frontier across concurrent requests", async () => {
    let release!: () => void;
    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => { providerStarted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const state = await fixture({ provider: async (input) => { providerStarted(); await gate; return buildDesignDirectionSet(input); } });
    const first = state.app.handle({ action: "generate-design", projectId });
    await started;
    const second = state.app.handle({ action: "generate-design", projectId });
    await expect(second).rejects.toMatchObject({ code: "WORKBENCH_OPERATION_IN_PROGRESS" });
    release();
    await first;
    expect(state.providerCalls()).toBe(1);
  });

  it("recovers a failed source-currentness preflight with a fresh attempt and no stale replay", async () => {
    let clean = false;
    const source: SourceCurrentnessPort = { read: async () => ({ head: "a".repeat(40), trackedWorktreeClean: clean, disallowedPaths: clean ? [] : ["supabase/.temp/cli-latest"] }) };
    const state = await fixture({ source });
    await expect(state.app.handle({ action: "generate-design", projectId })).rejects.toMatchObject({ code: "DESIGN_CONTRACT_STALE" });
    expect(state.providerCalls()).toBe(0);
    expect(await state.documents.get(projectId, 1, "design-generation-attempt")).toBeNull();
    clean = true;
    const result = await state.app.handle({ action: "generate-design", projectId });
    expect(result.designs).toHaveLength(3);
    expect(state.providerCalls()).toBe(1);
    const attempt = await state.documents.get(projectId, 1, "design-generation-attempt");
    expect(attempt?.documentType).toBe("design-generation-attempt");
    if (attempt?.documentType !== "design-generation-attempt") throw new Error("design attempt missing");
    expect(attempt.attemptId).toBeDefined();
  });
});
