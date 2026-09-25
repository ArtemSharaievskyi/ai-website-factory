import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { RequirementSpecificationSchema, type RequirementSpecification } from "@/domain/requirements/schema";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { migrateLegacyBriefToCanonicalBriefV3 } from "@/domain/requirements/v3/migrate";
import { CanonicalBriefV3Schema } from "@/domain/requirements/v3/schema";
import { createBriefV3Document } from "@/persistence/database/brief-revision-v3-contracts";
import { buildPlanningPackage } from "@/agents/planner/deterministic";
import type { PlannerAgentInput, PlanningPackage } from "@/agents/planner/contracts";
import { ArchitectureReviewRecordSchema } from "@/domain/review/schema";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository, saveDocumentCASInTransaction } from "@/persistence/database/repositories";
import { TrialEntryService } from "@/runtime/trial-entry/service";
import { DesignAgentService } from "@/agents/design/service";
import { FakeDesignMemoryPort } from "@/agents/design/memory";
import { buildDesignDirectionSet } from "@/agents/design/deterministic";
import { WorkbenchApplication } from "./application";
import { WorkbenchRequestSchema, actionsForWorkbenchState } from "./contracts";
import type { SourceCurrentnessPort } from "@/domain/shared/source-head";
import type { DesignAgentInput } from "@/agents/design/contracts";
import type { AgentSkillSelection } from "@/skills/runtime/resolver";

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

async function fixture(options: { provider?: (input: Parameters<typeof buildDesignDirectionSet>[0]) => Promise<ReturnType<typeof buildDesignDirectionSet>>; source?: SourceCurrentnessPort; canonicalUnresolved?: boolean; resolveSkills?: (input: DesignAgentInput) => Promise<AgentSkillSelection> } = {}) {
  const database = new InMemoryPersistenceDatabase();
  const legacyBrief = brief();
  const migratedBrief = migrateLegacyBriefToCanonicalBriefV3(legacyBrief);
  const canonicalBrief = options.canonicalUnresolved
    ? CanonicalBriefV3Schema.parse({ ...migratedBrief, unresolved: [{ target: "LEGAL:REGULATORY_AUTHORITY", reason: "Synthetic conditional publication review.", sourceRefs: ["fixture:publication"], status: "CONDITIONAL_IF_APPLICABLE", blockingStages: [] }] })
    : migratedBrief;
  const canonicalDraft = createBriefV3Document({ projectId, projectVersion: 1, brief: canonicalBrief, createdAt: timestamp, updatedAt: timestamp });
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
  const design = new DesignAgentService({ database, memory: new FakeDesignMemoryPort(), provider, ...(options.source ? { source: options.source } : {}), ...(options.resolveSkills ? { resolveSkills: options.resolveSkills } : {}) });
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

  it("passes canonical unresolved status through the strict Workbench Design boundary", async () => {
    const state = await fixture({ canonicalUnresolved: true });
    const result = await state.app.handle({ action: "generate-design", projectId });
    expect(state.providerCalls()).toBe(1);
    expect(result.designs).toHaveLength(3);
    expect(result.status.allowedActions).toContain("DESIGN_SELECTION");
  });

  it("replays the same frontier without a second provider call", async () => {
    const state = await fixture();
    const first = await state.app.handle({ action: "generate-design", projectId });
    const second = await state.app.handle({ action: "generate-design", projectId });
    expect(second.designSetChecksum).toBe(first.designSetChecksum);
    expect(state.providerCalls()).toBe(1);
    expect((await state.database.transaction((tx) => tx.listOperations({ operation: "workbench.design" })))[0]?.status).toBe("SUCCEEDED");
  });

  it("creates a fresh attempt after a terminal provider failure while preserving the failed attempt", async () => {
    let calls = 0;
    const state = await fixture({ provider: async (input) => {
      calls += 1;
      if (calls === 1) throw new Error("SYNTHETIC_PROVIDER_FAILURE");
      return buildDesignDirectionSet(input);
    } });
    await expect(state.app.handle({ action: "generate-design", projectId })).rejects.toMatchObject({ code: "DESIGN_PROVIDER_FAILED" });
    const failed = await state.documents.get(projectId, 1, "design-generation-attempt");
    if (!failed || failed.documentType !== "design-generation-attempt") throw new Error("failed Design attempt missing");
    const failedOperation = await state.database.transaction((tx) => tx.getOperation({ operation: "workbench.design", key: failed.operationKey }));
    expect(failedOperation?.status).toBe("FAILED");

    const result = await state.app.handle({ action: "generate-design", projectId });
    const fresh = await state.documents.get(projectId, 1, "design-generation-attempt");
    if (!fresh || fresh.documentType !== "design-generation-attempt") throw new Error("fresh Design attempt missing");
    expect(calls).toBe(2);
    expect(fresh.attemptId).not.toBe(failed.attemptId);
    expect(fresh.state).toBe("PERSISTED");
    expect(result.designs).toHaveLength(3);
    const history = await state.documents.get(projectId, 1, "design-generation-attempt-history");
    expect(history).toMatchObject({ records: [expect.objectContaining({ attemptId: failed.attemptId, state: expect.stringMatching(/FAILED/) })] });
    const operation = await state.database.transaction((tx) => tx.getOperation({ operation: "workbench.design", key: fresh.operationKey }));
    expect(operation?.status).toBe("SUCCEEDED");
    expect(operation?.history).toEqual([expect.objectContaining({ status: "FAILED" })]);
  });

  it("terminalizes a pre-provider setup failure after claim without recording provider activity", async () => {
    const state = await fixture({ resolveSkills: async () => { throw new Error("SKILL_NOT_FOUND:synthetic"); } });
    await expect(state.app.handle({ action: "generate-design", projectId })).rejects.toMatchObject({ code: "DESIGN_SETUP_FAILED" });
    const attempt = await state.documents.get(projectId, 1, "design-generation-attempt");
    expect(attempt).toMatchObject({ state: "SETUP_FAILED", failureCode: "DESIGN_SETUP_FAILED", preProviderFailure: { code: "SKILL_NOT_FOUND", providerInvocation: "NOT_STARTED" }, failureDiagnostic: { requestAttempted: false, errorCode: "SKILL_NOT_FOUND" }, executionEvidence: { providerBoundary: "NOT_STARTED" } });
    expect(state.providerCalls()).toBe(0);
    expect(await state.documents.get(projectId, 1, "design-directions")).toBeNull();
  });

  it("reconciles a stranded claimed skill failure with CAS and permits exactly one fresh frontier", async () => {
    const state = await fixture({ resolveSkills: async () => { throw new Error("SKILL_NOT_FOUND:synthetic"); } });
    await expect(state.app.handle({ action: "generate-design", projectId })).rejects.toMatchObject({ code: "DESIGN_SETUP_FAILED" });
    const failed = await state.documents.get(projectId, 1, "design-generation-attempt");
    if (!failed || failed.documentType !== "design-generation-attempt") throw new Error("failed Design attempt missing");
    const operation = await state.database.transaction((tx) => tx.getOperation({ operation: "workbench.design", key: failed.operationKey }));
    if (!operation) throw new Error("Design operation missing");
    await state.database.transaction((tx) => tx.reserveOperation({ operation: "workbench.design", key: failed.operationKey, payloadHash: operation.payloadHash }));
    await state.database.transaction((tx) => tx.failOperation({ operation: "workbench.design", key: failed.operationKey, payloadHash: operation.payloadHash, result: { status: "FAILED", code: "SKILL_NOT_FOUND" } }));
    const claimed = { ...failed, state: "CLAIMED" as const, updatedAt: timestamp, failureCode: undefined, failureDiagnostic: undefined, preProviderFailure: undefined };
    await state.documents.save(claimed);
    const stranded = await state.documents.get(projectId, 1, "design-generation-attempt");
    if (!stranded || stranded.documentType !== "design-generation-attempt") throw new Error("stranded Design attempt missing");
    const strandedRow = await state.database.transaction((tx) => tx.getDocument(projectId, 1, "design-generation-attempt"));
    if (!strandedRow) throw new Error("stranded Design row missing");
    const request = { action: "reconcile-design-pre-provider-failure" as const, projectId, projectVersion: 1, expectedRowVersion: 1, attemptId: stranded.attemptId, operationKey: stranded.operationKey, expectedAttemptChecksum: checksumPersistedDocument(stranded) };
    expect(WorkbenchRequestSchema.safeParse(request).success).toBe(true);
    await state.app.handle(request);
    const reconciled = await state.documents.get(projectId, 1, "design-generation-attempt");
    expect(reconciled).toMatchObject({ attemptId: stranded.attemptId, state: "SETUP_FAILED", failureCode: "SKILL_NOT_FOUND", preProviderFailure: { providerInvocation: "NOT_STARTED", providerReceipt: "NOT_ATTEMPTED", providerUsage: "NOT_AVAILABLE", providerCost: "NOT_AVAILABLE" } });
    const history = await state.documents.get(projectId, 1, "design-generation-attempt-history");
    expect(history).toMatchObject({ records: [expect.objectContaining({ attemptId: stranded.attemptId, state: "CLAIMED" })] });
    const repeated = await state.app.handle(request);
    expect(repeated.designs).toHaveLength(0);
    expect(state.providerCalls()).toBe(0);
    await expect(state.app.handle({ action: "generate-design", projectId })).rejects.toMatchObject({ code: "DESIGN_SETUP_FAILED" });
    await expect(state.database.transaction((tx) => saveDocumentCASInTransaction(tx, { ...stranded, state: "PROVIDER_STARTED", updatedAt: timestamp }, strandedRow.rowVersion, strandedRow.checksum))).rejects.toMatchObject({ code: "PERSISTENCE_CONFLICT" });
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

  it("reconciles an indeterminate attempt, fences late provider completion, and preserves canonical Design absence", async () => {
    let release!: () => void;
    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => { providerStarted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const state = await fixture({ provider: async (input) => { providerStarted(); await gate; return buildDesignDirectionSet(input); } });
    const generation = state.app.handle({ action: "generate-design", projectId });
    await started;
    expect((await state.app.handle({ action: "status", projectId })).status.allowedActions).toEqual(["RECONCILE_DESIGN_OUTCOME_UNKNOWN"]);
    const before = await state.documents.get(projectId, 1, "design-generation-attempt");
    if (!before || before.documentType !== "design-generation-attempt") throw new Error("active Design attempt missing");
    const request = { action: "reconcile-design-outcome-unknown" as const, projectId, projectVersion: 1, expectedRowVersion: 1, attemptId: before.attemptId, operationKey: before.operationKey, expectedAttemptChecksum: checksumPersistedDocument(before) };
    await state.app.handle(request);
    await expect(state.app.handle({ action: "generate-design", projectId })).rejects.toMatchObject({ code: "DESIGN_OUTCOME_UNKNOWN_REQUIRES_AUTHORIZATION" });
    release();
    await expect(generation).rejects.toMatchObject({ code: "DESIGN_CONTRACT_STALE" });
    const after = await state.documents.get(projectId, 1, "design-generation-attempt");
    expect(after).toMatchObject({ state: "OUTCOME_UNKNOWN", failureCode: "OUTCOME_UNKNOWN", outcomeUnknown: { providerReceipt: "UNKNOWN", providerUsage: "UNKNOWN", providerCost: "UNKNOWN" } });
    const history = await state.documents.get(projectId, 1, "design-generation-attempt-history");
    expect(history).toMatchObject({ records: [{ attemptId: before.attemptId, state: "PROVIDER_STARTED" }] });
    expect(await state.documents.get(projectId, 1, "design-directions")).toBeNull();
    const operation = await state.database.transaction((tx) => tx.getOperation({ operation: "workbench.design", key: before.operationKey }));
    expect(operation).toMatchObject({ status: "FAILED", result: { code: "OUTCOME_UNKNOWN", providerReceipt: "UNKNOWN", providerUsage: "UNKNOWN", providerCost: "UNKNOWN", canonicalDesignPersisted: false } });
  });

  it("makes reconciliation idempotent and rejects stale upstream currentness", async () => {
    let release!: () => void;
    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => { providerStarted = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const state = await fixture({ provider: async (input) => { providerStarted(); await gate; return buildDesignDirectionSet(input); } });
    const generation = state.app.handle({ action: "generate-design", projectId });
    await started;
    const before = await state.documents.get(projectId, 1, "design-generation-attempt");
    if (!before || before.documentType !== "design-generation-attempt") throw new Error("active Design attempt missing");
    const request = { action: "reconcile-design-outcome-unknown" as const, projectId, projectVersion: 1, expectedRowVersion: 1, attemptId: before.attemptId, operationKey: before.operationKey, expectedAttemptChecksum: checksumPersistedDocument(before) };
    const results = await Promise.all([state.app.handle(request), state.app.handle(request)]);
    expect(results).toHaveLength(2);
    const repeated = await state.app.handle(request);
    expect(repeated.status.allowedActions).not.toContain("GENERATE_DESIGN");
    const history = await state.documents.get(projectId, 1, "design-generation-attempt-history");
    expect(history?.documentType === "design-generation-attempt-history" ? history.records.filter((record) => record.attemptId === before.attemptId) : []).toHaveLength(1);
    await new ProjectVersionRepository(state.database).reserveNextVersion(projectId, "stale-reconcile");
    await expect(state.app.handle(request)).rejects.toMatchObject({ code: "DESIGN_RECONCILIATION_STALE" });
    release();
    await expect(generation).rejects.toMatchObject({ code: "DESIGN_CONTRACT_STALE" });
    expect(await state.documents.get(projectId, 1, "design-directions")).toBeNull();
  });

  it("recovers a failed source-currentness preflight with a fresh attempt and no stale replay", async () => {
    let clean = false;
    const source: SourceCurrentnessPort = { read: async () => ({ head: "a".repeat(40), trackedWorktreeClean: clean, disallowedPaths: clean ? [] : ["supabase/.temp/cli-latest"] }) };
    const state = await fixture({ source });
    await expect(state.app.handle({ action: "generate-design", projectId })).rejects.toMatchObject({ code: "DESIGN_CONTRACT_STALE" });
    expect(state.providerCalls()).toBe(0);
    expect(await state.documents.get(projectId, 1, "design-generation-attempt")).toBeNull();
    const failedOperation = await state.database.transaction((tx) => tx.listOperations({ operation: "workbench.design" }));
    expect(failedOperation[0]).toMatchObject({ status: "FAILED", result: { status: "FAILED", code: "DESIGN_CONTRACT_STALE" } });
    clean = true;
    const result = await state.app.handle({ action: "generate-design", projectId });
    expect(result.designs).toHaveLength(3);
    expect(state.providerCalls()).toBe(1);
    const recoveredOperation = await state.database.transaction((tx) => tx.listOperations({ operation: "workbench.design" }));
    expect(recoveredOperation[0]).toMatchObject({ status: "SUCCEEDED", result: { status: "SUCCEEDED" } });
    expect(recoveredOperation[0]?.history).toEqual([
      expect.objectContaining({ status: "FAILED", result: { status: "FAILED", code: "DESIGN_CONTRACT_STALE" } }),
    ]);
    const attempt = await state.documents.get(projectId, 1, "design-generation-attempt");
    expect(attempt?.documentType).toBe("design-generation-attempt");
    if (attempt?.documentType !== "design-generation-attempt") throw new Error("design attempt missing");
    expect(attempt.attemptId).toBeDefined();
  });
});
