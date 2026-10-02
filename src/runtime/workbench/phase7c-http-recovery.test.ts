import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { RequirementSpecificationSchema, type RequirementSpecification } from "@/domain/requirements/schema";
import { emptyBriefV2Fields } from "@/domain/requirements/brief";
import { migrateLegacyBriefToCanonicalBriefV3 } from "@/domain/requirements/v3/migrate";
import { createBriefV3Document, BriefV3DocumentSchema } from "@/persistence/database/brief-revision-v3-contracts";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { PlanningPackageSchema, type PlannerAgentInput, type PlanningPackage } from "@/agents/planner/contracts";
import { buildPlanningPackage, planningSemanticChecksum } from "@/agents/planner/deterministic";
import { buildImplementationTaskGraph } from "@/orchestration/orchestrator/graph";
import { DEFAULT_ORCHESTRATION_POLICY, type OrchestratorInput } from "@/orchestration/orchestrator/contracts";
import type { TaskGraph } from "@/domain/tasks/schema";
import { phase7CForLegacyTaskGraphCorrection, rebindTaskContractsToPackage, buildPhase7CContractPackage, approveDatabaseDecision, approveDependencyProposal, createPlanningAcceptance } from "@/domain/contracts/phase7c";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { ArchitectureReviewRecordSchema, ArchitectureReviewResultSchema, ContractAuditRecordSchema, ContractAuditResultSchema } from "@/domain/review/schema";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { TrialEntryService } from "@/runtime/trial-entry/service";
import { WorkbenchApplication, approvedBriefForDownstream } from "./application";
import { ContractAuditService } from "@/agents/reviewers/contracts/service";
import { ContractAuditOrchestrationService } from "@/orchestration/contract-audit/service";
import { OrchestratorService } from "@/orchestration/orchestrator/service";
import { CONTRACT_AUDIT_POLICY_VERSION } from "@/agents/reviewers/contracts/contracts";
import { evidenceIdFor } from "@/agents/reviewers/evidence";
import { createSerializedWorkbenchRequest } from "./http-client";

const { mockWorkbench } = vi.hoisted(() => ({ mockWorkbench: { handle: vi.fn() } }));

vi.mock("@/runtime/workbench/production", () => ({ getProductionWorkbench: () => mockWorkbench }));

import { POST } from "@/app/api/workbench/route";

const timestamp = "2026-09-26T12:00:00.000Z";
const id = () => randomUUID();

function syntheticBrief(): RequirementSpecification {
  return RequirementSpecificationSchema.parse({
    schemaVersion: 1,
    documentType: "requirements",
    projectId: id(),
    projectVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    projectSummary: "A synthetic public information site.",
    protectedFunctionalityRequired: false,
    imagesRequired: false,
    businessGoals: ["Explain the service"],
    targetAudiences: ["Visitors"],
    pages: [{ slug: "home", purpose: "Explain the service" }, { slug: "impressum", purpose: "Show legal information" }, { slug: "datenschutz", purpose: "Show privacy information" }],
    userRoles: [],
    features: ["Direct phone and email contact actions"],
    forms: [],
    contentRequirements: [],
    backendRequirements: [],
    supabaseRequirements: [],
    authenticationDecision: "no-authentication-guest-first",
    storageDecision: "not-needed",
    emailDecision: "not-needed",
    administrationDecision: "not-needed",
    seoRequirements: [],
    localization: { locales: ["en"], defaultLocale: "en" },
    imageSourceDecision: "placeholders",
    suppliedBrandInformation: { status: "missing" },
    suppliedLogoLocation: { status: "missing" },
    technicalConstraints: ["No contact form, database, authentication, or persistence."],
    explicitExclusions: [],
    userAcceptanceCriteria: ["Home loads"],
    unresolvedItems: [],
    approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-user" },
    briefStatus: "approved",
    briefVersion: 1,
    contactFacts: [],
    legalFacts: [],
    brandFacts: [],
    logoMetadata: [],
    imageSourcingNotes: [],
    evidence: [],
    recommendations: [],
    ...emptyBriefV2Fields(),
    formBehaviorRequirements: {
      ...emptyBriefV2Fields().formBehaviorRequirements,
      formPresent: false,
      validation: "NOT_REQUIRED",
      successUx: "NONE",
      dataTransmission: "NONE",
      persistence: "NONE",
      thirdParty: "NONE",
      privacyCheckbox: "NOT_APPLICABLE",
    },
  });
}

function acceptedPlanning(brief: RequirementSpecification, canonicalBrief: ReturnType<typeof migrateLegacyBriefToCanonicalBriefV3>, approvedBriefChecksum: string): PlanningPackage {
  const input: PlannerAgentInput = {
    projectId: brief.projectId,
    projectVersion: 1,
    approvedBrief: brief,
    approvedBriefChecksum,
    canonicalBrief,
    originalPromptReference: "synthetic-prompt",
    clarificationEvidenceReferences: [],
    currentWorkflowState: "AWAITING_DESIGN_SELECTION",
    existingDecisions: [],
    suppliedFiles: [],
    allowedSkills: [],
    idempotencyKey: id(),
    expectedRowVersion: 1,
  };
  const planning = buildPlanningPackage(input);
  const completePlanning = PlanningPackageSchema.parse({
    ...planning,
    traceability: [
      ...planning.traceability,
      {
        decisionId: id(),
        category: "synthetic-canonical-coverage",
        requirementReferences: canonicalBrief.requirements.map((entry) => entry.id),
        systemConstraintReferences: [],
        rationale: "Synthetic route fixture binds every canonical requirement before exercising the production route.",
        confidence: "high",
        userConfirmationRequired: false,
      },
    ],
  });
  return PlanningPackageSchema.parse({
    ...completePlanning,
    blockers: [],
    accepted: true,
    acceptance: { acceptedAt: timestamp, acceptedBy: "synthetic-user", checksum: checksumPersistedDocument(completePlanning) },
    architecture: { ...completePlanning.architecture, acceptance: { accepted: true, acceptedAt: timestamp, acceptedBy: "synthetic-user" } },
  });
}

function approvedArchitectureReview(brief: RequirementSpecification, planning: PlanningPackage, approvedBriefChecksum: string) {
  const result = ArchitectureReviewResultSchema.parse({ verdict: "APPROVED", findings: [], reviewedArtifactRefs: ["requirements", "planning-package"], policyVersion: "architecture-review-v1" });
  return ArchitectureReviewRecordSchema.parse({
    schemaVersion: 1,
    documentType: "architecture-review",
    projectId: brief.projectId,
    projectVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    reviewId: id(),
    reviewerAgentId: "architecture-reviewer",
    reviewerVersion: "synthetic",
    capability: "review.architecture",
    policyVersion: "architecture-review-v1",
    promptVersion: "architecture-reviewer.v2",
    reviewInputChecksum: "a".repeat(64),
    approvedBriefChecksum,
    acceptedPlanningChecksum: checksumPersistedDocument(planning),
    architectureChecksum: checksumPersistedDocument(planning.architecture),
    phase7cChecksum: "b".repeat(64),
    resultChecksum: checksumPersistedDocument(result),
    result,
  });
}

async function seedFixture(options: { legacyPhase7C?: boolean; invalidLegacyBinding?: boolean; unchangedGraph?: boolean; upstreamPlanningFinding?: boolean; staleAuditGraphBinding?: boolean } = {}) {
  const database = new InMemoryPersistenceDatabase();
  const brief = syntheticBrief();
  const migratedCanonicalBrief = migrateLegacyBriefToCanonicalBriefV3(brief);
  const canonicalBrief = { ...migratedCanonicalBrief, decisions: { ...migratedCanonicalBrief.decisions, routePolicy: { mode: "SINGLE_PAGE" as const } } };
  const canonical = createBriefV3Document({ projectId: brief.projectId, projectVersion: 1, brief: canonicalBrief, createdAt: timestamp, updatedAt: timestamp });
  const briefV3 = BriefV3DocumentSchema.parse({ ...canonical, approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-user", approvedCanonicalChecksum: canonical.briefChecksum } });
  const planning = acceptedPlanning(brief, canonicalBrief, briefV3.briefChecksum);
  const selected = {
    schemaVersion: 1 as const,
    documentType: "selected-design" as const,
    projectId: brief.projectId,
    projectVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    directionSetId: id(),
    selectedDirectionId: id(),
    selectedAt: timestamp,
    selectedBy: "synthetic-user",
    selectionNotes: "Synthetic explicit selection",
    selectedDirectionChecksum: "c".repeat(64),
  };
  const architectureReview = approvedArchitectureReview(brief, planning, briefV3.briefChecksum);
  const input: OrchestratorInput = {
    projectId: brief.projectId,
    projectVersion: 1,
    approvedBrief: brief,
    canonicalBrief: briefV3.brief,
    approvedBriefChecksum: briefV3.briefChecksum,
    acceptedPlanningPackage: planning,
    acceptedPlanningChecksum: checksumPersistedDocument(planning),
    selectedDesign: selected,
    selectedDesignChecksum: checksumPersistedDocument(selected),
    technicalArchitecture: planning.architecture,
    contentPlan: planning.content,
    assetManifest: planning.assets,
    currentWorkflowState: "CONTRACT_AUDIT",
    existingDecisions: [],
    allowedRoles: ["lead", "planner-architect", "design", "implementation", "qa-release"],
    approvedSkillRegistrySnapshot: { schemaVersion: 1, checksum: "d".repeat(64), skills: [] },
    toolPolicyVersion: "tools-v1",
    orchestrationPolicyVersion: DEFAULT_ORCHESTRATION_POLICY.version,
    idempotencyKey: id(),
    expectedRowVersion: 1,
    workspaceReserved: true,
    projectImmutable: false,
    requiredExternalDecisionPending: false,
  };
  const builtGraph = buildImplementationTaskGraph(input, DEFAULT_ORCHESTRATION_POLICY);
  const oldGraph = {
    ...builtGraph,
    tasks: builtGraph.tasks.map((task) => task.taskType === "write-unit-tests" ? { ...task, objective: `${task.objective} Synthetic legacy form criterion.` } : task),
  };
  const oldGraphWithoutChecksum = { ...oldGraph };
  delete oldGraphWithoutChecksum.graphChecksum;
  let taskGraph: TaskGraph = { ...oldGraph, graphChecksum: checksumPersistedDocument(oldGraphWithoutChecksum) };
  const phaseDraft = buildPhase7CContractPackage({
    projectId: brief.projectId,
    projectVersion: 1,
    createdAt: timestamp,
    approvedBriefChecksum: briefV3.briefChecksum,
    planningChecksum: planningSemanticChecksum(planning),
    architectureChecksum: checksumPersistedDocument(planning.architecture),
    designChecksum: options.legacyPhase7C ? "0".repeat(64) : checksumPersistedDocument(selected),
    planning,
  });
  const databaseDecision = approveDatabaseDecision(phaseDraft.databaseDecision, { actorId: "synthetic-user", approvedAt: timestamp, mode: "NONE" });
  const dependencyProposal = approveDependencyProposal(phaseDraft.dependencyProposal, { actorId: "synthetic-user", approvedAt: timestamp });
  const planningAcceptance = createPlanningAcceptance({ projectId: brief.projectId, projectVersion: 1, planningChecksum: phaseDraft.planningChecksum, databaseDecision, dependencyProposal, architectureChecksum: phaseDraft.architectureChecksum, designChecksum: phaseDraft.designChecksum, createdAt: timestamp });
  const currentPhase7C = rebindTaskContractsToPackage({ ...phaseDraft, databaseDecision, dependencyProposal, planningAcceptance, safeEnvironmentMetadata: databaseDecision.connectionRequirements }, taskGraph.tasks);
  const phase7c = options.legacyPhase7C
    ? { ...currentPhase7C, currentness: { ...currentPhase7C.currentness, derivedFromChecksum: options.invalidLegacyBinding ? "e".repeat(64) : currentPhase7C.planningChecksum } }
    : currentPhase7C;
  if (options.unchangedGraph) taskGraph = buildImplementationTaskGraph({
    ...input,
    approvedBrief: approvedBriefForDownstream(brief, briefV3),
    approvedSkillRegistrySnapshot: { schemaVersion: 1, checksum: "0".repeat(64), skills: [] },
    phase7cContractPackage: phase7CForLegacyTaskGraphCorrection(phase7c),
  }, DEFAULT_ORCHESTRATION_POLICY);
  const badAuditResult = ContractAuditResultSchema.parse({
    verdict: "CHANGES_REQUIRED",
    findings: options.upstreamPlanningFinding
      ? [
        { findingId: "synthetic-planning-gap", severity: "ERROR", category: "REQUIREMENT_NOT_TRACED", summary: "Synthetic Planning evidence requires upstream correction.", evidenceRefs: ["requirements"], affectedArtifacts: ["planning-package"], recommendedAction: "Correct the Planning package.", correctionTarget: "PLANNING" },
        { findingId: "synthetic-taskgraph-warning", severity: "WARNING", category: "ARTIFACT_MULTIPLE_OWNERS", summary: "Synthetic TaskGraph ownership warning.", evidenceRefs: ["task-graph"], affectedArtifacts: ["task-graph"], recommendedAction: "Review TaskGraph ownership.", correctionTarget: "TASKGRAPH" },
      ]
      : [{ findingId: "legacy-form-template", severity: "ERROR", category: "FORM_CONTRACT_MISMATCH", summary: "Synthetic stale form criterion requires correction.", evidenceRefs: ["task-graph"], affectedArtifacts: ["task-graph"], recommendedAction: "Rebuild the current TaskGraph.", correctionTarget: "TASKGRAPH" }],
    reviewedArtifactRefs: ["task-graph"],
    policyVersion: CONTRACT_AUDIT_POLICY_VERSION,
  });
  const badAudit = ContractAuditRecordSchema.parse({
    schemaVersion: 1,
    documentType: "contract-audit",
    projectId: brief.projectId,
    projectVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    auditId: id(),
    auditorAgentId: "contract-auditor",
    auditorVersion: "synthetic",
    capability: "review.contracts",
    policyVersion: CONTRACT_AUDIT_POLICY_VERSION,
    promptVersion: "contract-auditor.v3",
    briefChecksum: briefV3.briefChecksum,
    planningChecksum: checksumPersistedDocument(planning),
    architectureReviewId: architectureReview.reviewId,
    architectureReviewChecksum: checksumPersistedDocument(architectureReview),
    designChecksum: checksumPersistedDocument(selected),
    taskGraphChecksum: options.staleAuditGraphBinding ? "f".repeat(64) : taskGraph.graphChecksum,
    resultChecksum: checksumPersistedDocument(badAuditResult),
    result: badAuditResult,
  });
  const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId: brief.projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: brief.projectId, slug: `synthetic-phase7c-${brief.projectId.slice(0, 8)}`, origin: "SYNTHETIC", originalPrompt: "Synthetic Phase 7C recovery fixture.", currentVersion: 1, workflowState: "CONTRACT_AUDIT" });
  await new ProjectRepository(database).create(project);
  await new ProjectVersionRepository(database).create({ id: id(), projectId: brief.projectId, versionNumber: 1, state: "CONTRACT_AUDIT", memoryRootPath: null, requirementsChecksum: briefV3.briefChecksum, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
  const documents = new DocumentRepository(database);
  await documents.save(brief);
  await documents.save(briefV3);
  await documents.save(planning);
  await documents.save(planning.architecture);
  await documents.save(planning.content);
  await documents.save(planning.assets);
  await documents.save(architectureReview);
  await documents.save(selected);
  await documents.save(phase7c);
  await documents.save(taskGraph);
  await documents.save(badAudit);
  const providerCalls: string[] = [];
  const auditor = new ContractAuditService(database, { provider: { promptVersion: "contract-auditor.v3", review: async (providerInput) => { providerCalls.push("contract-audit"); return { verdict: "APPROVED", findings: [], reviewedArtifactRefs: [evidenceIdFor(providerInput, "requirements")] }; } } });
  const contractAuditor = new ContractAuditOrchestrationService(database, auditor);
  const orchestrator = new OrchestratorService(database);
  const scope = { planner: {} as never, architectureReviewer: {} as never, design: {} as never, orchestrator, contractAuditor };
  const entry = new TrialEntryService({ database, createLeadAgent: () => { throw new Error("SYNTHETIC_LEAD_NOT_USED"); } });
  const app = new WorkbenchApplication({ database, entry, getWorkflowScope: () => scope });
  return { database, app, orchestrator, projectId: brief.projectId, providerCalls, oldGraphChecksum: taskGraph.graphChecksum };
}

async function post(input: Parameters<typeof createSerializedWorkbenchRequest>[0]) {
  const envelope = await createSerializedWorkbenchRequest(input);
  return POST(new Request("http://localhost/api/workbench", { method: envelope.method, headers: envelope.headers, body: envelope.body }));
}

async function readyForPhase7CApproval() {
  const fixture = await seedFixture();
  mockWorkbench.handle.mockImplementation((request) => fixture.app.handle(request));
  const correction = await post({ action: "correct-contract-audit", projectId: fixture.projectId, idempotencyKey: `synthetic-correction-${fixture.projectId}` });
  expect(correction.status).toBe(200);
  const reassessment = await post({ action: "reassess-contract-audit", projectId: fixture.projectId, idempotencyKey: `synthetic-reassessment-${fixture.projectId}` });
  expect(reassessment.status).toBe(200);
  const status = await fixture.app.handle({ action: "status", projectId: fixture.projectId });
  expect(status.status.allowedActions).toEqual(["APPROVE_PHASE7C"]);
  return fixture;
}

describe("Phase 7C recovery through the serialized Workbench route", () => {
  it("corrects a pending legacy planning-bound Phase 7C package atomically without a provider call", async () => {
    const fixture = await seedFixture({ legacyPhase7C: true });
    mockWorkbench.handle.mockImplementation((request) => fixture.app.handle(request));
    const response = await post({ action: "correct-contract-audit", projectId: fixture.projectId, idempotencyKey: `synthetic-legacy-correction-${fixture.projectId}` });
    expect(response.status).toBe(200);
    const documents = new DocumentRepository(fixture.database);
    const graph = await documents.get(fixture.projectId, 1, "task-graph");
    const phase7c = await documents.get(fixture.projectId, 1, "phase-7c-contract-package");
    expect(graph?.documentType === "task-graph" ? graph.graphChecksum : undefined).not.toBe(fixture.oldGraphChecksum);
    expect(phase7c?.documentType === "phase-7c-contract-package" ? phase7c.designChecksum : undefined).not.toBe("0".repeat(64));
    expect(fixture.providerCalls).toEqual([]);
  });

  it("rejects an unrecognized stale Phase 7C binding with a typed durable failure and no canonical write", async () => {
    const fixture = await seedFixture({ legacyPhase7C: true, invalidLegacyBinding: true });
    mockWorkbench.handle.mockImplementation((request) => fixture.app.handle(request));
    const response = await post({ action: "correct-contract-audit", projectId: fixture.projectId, idempotencyKey: `synthetic-invalid-binding-${fixture.projectId}` });
    expect(response.status).toBe(422);
    const body = await response.json() as { code: string; attemptId: string; operationId: string };
    expect(body.code).toBe("CONTRACT_PACKAGE_STALE");
    const documents = new DocumentRepository(fixture.database);
    const graph = await documents.get(fixture.projectId, 1, "task-graph");
    const phase7c = await documents.get(fixture.projectId, 1, "phase-7c-contract-package");
    expect(graph?.documentType === "task-graph" ? graph.graphChecksum : undefined).toBe(fixture.oldGraphChecksum);
    expect(phase7c?.documentType === "phase-7c-contract-package" ? phase7c.currentness.derivedFromChecksum : undefined).toBe("e".repeat(64));
    const operation = await fixture.database.transaction((tx) => tx.getOperation({ operation: "workbench.contract-audit.correct_contract_audit", key: body.operationId }));
    expect(operation).toMatchObject({ status: "FAILED", result: { code: "CONTRACT_PACKAGE_STALE", providerCallsTotal: 0, attemptId: body.attemptId } });
    expect(fixture.providerCalls).toEqual([]);
  });

  it("fences a same-checksum Phase 7C row-version change after Workbench read", async () => {
    const fixture = await seedFixture({ legacyPhase7C: true });
    const regenerate = fixture.orchestrator.regenerateImplementationTaskGraph.bind(fixture.orchestrator);
    vi.spyOn(fixture.orchestrator, "regenerateImplementationTaskGraph").mockImplementation(async (...args) => {
      await fixture.database.transaction(async (tx) => {
        const row = await tx.getDocument(fixture.projectId, 1, "phase-7c-contract-package");
        if (!row) throw new Error("SYNTHETIC_PACKAGE_MISSING");
        const next = await tx.saveDocumentCAS({ row, expectedRowVersion: row.rowVersion, expectedChecksum: row.checksum });
        expect(next.rowVersion).toBe(row.rowVersion + 1);
        expect(next.checksum).toBe(row.checksum);
      });
      return regenerate(...args);
    });
    mockWorkbench.handle.mockImplementation((request) => fixture.app.handle(request));
    const response = await post({ action: "correct-contract-audit", projectId: fixture.projectId, idempotencyKey: `synthetic-racing-correction-${fixture.projectId}` });
    expect(response.status).toBe(409);
    const body = await response.json() as { code: string; operationId: string };
    expect(body.code).toBe("ORCHESTRATOR_PLANNING_STALE");
    const graph = await new DocumentRepository(fixture.database).get(fixture.projectId, 1, "task-graph");
    expect(graph?.documentType === "task-graph" ? graph.graphChecksum : undefined).toBe(fixture.oldGraphChecksum);
    const operation = await fixture.database.transaction((tx) => tx.getOperation({ operation: "workbench.contract-audit.correct_contract_audit", key: body.operationId }));
    expect(operation).toMatchObject({ status: "FAILED", result: { code: "ORCHESTRATOR_PLANNING_STALE", providerCallsTotal: 0 } });
    expect(fixture.providerCalls).toEqual([]);
  });

  it("does not mark correction successful when the current TaskGraph is unchanged", async () => {
    const fixture = await seedFixture({ legacyPhase7C: true, unchangedGraph: true });
    mockWorkbench.handle.mockImplementation((request) => fixture.app.handle(request));
    const response = await post({ action: "correct-contract-audit", projectId: fixture.projectId, idempotencyKey: `synthetic-noop-correction-${fixture.projectId}` });
    expect(response.status).toBe(422);
    const body = await response.json() as { code: string; operationId: string };
    expect(body.code).toBe("ORCHESTRATOR_GRAPH_INVALID");
    const documents = new DocumentRepository(fixture.database);
    const graph = await documents.get(fixture.projectId, 1, "task-graph");
    const phase7c = await documents.get(fixture.projectId, 1, "phase-7c-contract-package");
    expect(graph?.documentType === "task-graph" ? graph.graphChecksum : undefined).toBe(fixture.oldGraphChecksum);
    expect(phase7c?.documentType === "phase-7c-contract-package" ? phase7c.currentness.derivedFromChecksum : undefined)
      .toBe(phase7c?.documentType === "phase-7c-contract-package" ? phase7c.planningChecksum : undefined);
    const operation = await fixture.database.transaction((tx) => tx.getOperation({ operation: "workbench.contract-audit.correct_contract_audit", key: body.operationId }));
    expect(operation).toMatchObject({ status: "FAILED", result: { code: "ORCHESTRATOR_GRAPH_INVALID", providerCallsTotal: 0 } });
    expect(fixture.providerCalls).toEqual([]);
  });

  it("does not advertise or reserve TaskGraph correction for an upstream Planning finding", async () => {
    const fixture = await seedFixture({ upstreamPlanningFinding: true });
    mockWorkbench.handle.mockImplementation((request) => fixture.app.handle(request));

    const status = await fixture.app.handle({ action: "status", projectId: fixture.projectId });
    expect(status.status.allowedActions).toEqual([]);
    expect(status.status.pendingUserAction).toBe("WAIT_FOR_WORKFLOW_OWNER");

    const response = await post({ action: "correct-contract-audit", projectId: fixture.projectId, idempotencyKey: `synthetic-upstream-correction-${fixture.projectId}` });
    expect(response.status).toBe(422);
    const body = await response.json() as { code: string; reasonCode?: string; attemptCreated: boolean; operationId?: string; attemptId?: string };
    expect(body).toMatchObject({ code: "CONTRACT_AUDIT_UPSTREAM_CORRECTION_REQUIRED", reasonCode: "CONTRACT_AUDIT_UPSTREAM_CORRECTION_REQUIRED", attemptCreated: false });
    expect(body.operationId).toBeUndefined();
    expect(body.attemptId).toBeUndefined();

    const corrections = await fixture.database.transaction((tx) => tx.listOperations({ operation: "workbench.contract-audit.correct_contract_audit" }));
    expect(corrections).toEqual([]);
    expect(fixture.providerCalls).toEqual([]);
  });

  it("does not advertise or reserve reassessment for unresolved upstream findings", async () => {
    const fixture = await seedFixture({ upstreamPlanningFinding: true, staleAuditGraphBinding: true });
    mockWorkbench.handle.mockImplementation((request) => fixture.app.handle(request));

    const status = await fixture.app.handle({ action: "status", projectId: fixture.projectId });
    expect(status.status.allowedActions).toEqual([]);

    const response = await post({ action: "reassess-contract-audit", projectId: fixture.projectId, idempotencyKey: `synthetic-upstream-reassessment-${fixture.projectId}` });
    expect(response.status).toBe(422);
    const body = await response.json() as { code: string; reasonCode?: string; attemptCreated: boolean; operationId?: string; attemptId?: string };
    expect(body).toMatchObject({ code: "CONTRACT_AUDIT_UPSTREAM_CORRECTION_REQUIRED", reasonCode: "CONTRACT_AUDIT_UPSTREAM_CORRECTION_REQUIRED", attemptCreated: false });
    expect(body.operationId).toBeUndefined();
    expect(body.attemptId).toBeUndefined();

    const reassessments = await fixture.database.transaction((tx) => tx.listOperations({ operation: "workbench.contract-audit.reassess_contract_audit" }));
    expect(reassessments).toEqual([]);
    expect(fixture.providerCalls).toEqual([]);
  });

  it("runs correction, reassessment, audit approval, and Phase 7C approval without entering Implementation", async () => {
    const fixture = await seedFixture();
    mockWorkbench.handle.mockImplementation((request) => fixture.app.handle(request));

    const initial = await fixture.app.handle({ action: "status", projectId: fixture.projectId });
    expect(initial.status.allowedActions).toEqual(["CORRECT_CONTRACT_AUDIT"]);

    const correctionResponse = await post({ action: "correct-contract-audit", projectId: fixture.projectId, idempotencyKey: "synthetic-correction-1" });
    expect(correctionResponse.status).toBe(200);
    const correctionBody = await correctionResponse.json() as { data: { status: { allowedActions: string[] } }; meta: { responseOrigin: string; attemptCreated: boolean; attemptId?: string; operationId?: string } };
    expect(correctionBody.meta).toMatchObject({ responseOrigin: "NEW_EXECUTION", attemptCreated: true });
    expect(correctionBody.meta.attemptId).toMatch(/^[0-9a-f-]{36}$/);
    expect(correctionBody.meta.operationId).toContain("correct_contract_audit");
    expect(correctionBody.data.status.allowedActions).toEqual(["REASSESS_CONTRACT_AUDIT"]);
    const corrected = await fixture.app.handle({ action: "status", projectId: fixture.projectId });
    const correctedGraph = await new DocumentRepository(fixture.database).get(fixture.projectId, 1, "task-graph");
    expect(correctedGraph?.documentType === "task-graph" ? correctedGraph.graphChecksum : undefined).not.toBe(fixture.oldGraphChecksum);
    expect(corrected.status.allowedActions).toEqual(["REASSESS_CONTRACT_AUDIT"]);

    const reassessmentResponse = await post({ action: "reassess-contract-audit", projectId: fixture.projectId, idempotencyKey: "synthetic-reassessment-1" });
    expect(reassessmentResponse.status).toBe(200);
    const reassessmentBody = await reassessmentResponse.json() as { data: { project?: { workflowState: string }; status: { allowedActions: string[] } }; meta: { responseOrigin: string; attemptCreated: boolean; attemptId?: string; operationId?: string } };
    expect(reassessmentBody.meta).toMatchObject({ responseOrigin: "NEW_EXECUTION", attemptCreated: true });
    expect(reassessmentBody.data.project?.workflowState).toBe("READY_FOR_IMPLEMENTATION");
    expect(reassessmentBody.data.status.allowedActions).toEqual(["APPROVE_PHASE7C"]);
    expect(fixture.providerCalls).toEqual(["contract-audit"]);

    const approvedAudit = await new DocumentRepository(fixture.database).get(fixture.projectId, 1, "contract-audit");
    expect(approvedAudit?.documentType === "contract-audit" ? approvedAudit.result.verdict : undefined).toBe("APPROVED");

    const approvalResponse = await post({ action: "approve-phase7c", projectId: fixture.projectId, idempotencyKey: "synthetic-phase7c-approval-1" });
    expect(approvalResponse.status).toBe(200);
    const approvalBody = await approvalResponse.json() as { data: { status: { allowedActions: string[] }; project?: { workflowState: string } }; meta: { responseOrigin: string; attemptCreated: boolean; attemptId?: string } };
    expect(approvalBody.meta).toMatchObject({ responseOrigin: "NEW_EXECUTION", attemptCreated: true });
    expect(approvalBody.data.project?.workflowState).toBe("READY_FOR_IMPLEMENTATION");
    expect(approvalBody.data.status.allowedActions).toEqual(["START_IMPLEMENTATION"]);

    const phase7c = await new DocumentRepository(fixture.database).get(fixture.projectId, 1, "phase-7c-contract-package");
    expect(phase7c?.documentType === "phase-7c-contract-package" ? phase7c.status : undefined).toBe("APPROVED");
    const selectedDesign = await new DocumentRepository(fixture.database).get(fixture.projectId, 1, "selected-design");
    const directionSet = await new DocumentRepository(fixture.database).get(fixture.projectId, 1, "design-directions");
    expect(selectedDesign?.documentType).toBe("selected-design");
    expect(directionSet).toBeNull();
    expect(fixture.providerCalls).toHaveLength(1);

    const correctionOperation = await fixture.database.transaction((tx) => tx.getOperation({ operation: "workbench.contract-audit.correct_contract_audit", key: correctionBody.meta.operationId! }));
    const reassessmentOperation = await fixture.database.transaction((tx) => tx.getOperation({ operation: "workbench.contract-audit.reassess_contract_audit", key: reassessmentBody.meta.operationId! }));
    expect(correctionOperation).toMatchObject({ status: "SUCCEEDED", result: { outcome: "CORRECTION_COMMITTED", providerCallsTotal: 0 } });
    expect(reassessmentOperation).toMatchObject({ status: "SUCCEEDED", result: { outcome: "AUDIT_APPROVED", providerCallsTotal: 1, execution: { providerBoundary: "RESPONSE_RECEIVED", responseReceived: true, parsed: true, persisted: true } } });
  });

  it("rejects Phase 7C approval when the selected-design document is missing before any new provider dispatch", async () => {
    const fixture = await readyForPhase7CApproval();
    const documents = new DocumentRepository(fixture.database);
    await documents.delete(fixture.projectId, 1, "selected-design");

    const response = await post({ action: "approve-phase7c", projectId: fixture.projectId, idempotencyKey: `synthetic-missing-selected-${fixture.projectId}` });
    expect(response.status).toBe(422);
    expect((await response.json() as { code?: string }).code).toBe("CONTRACT_AUDIT_INPUT_INVALID");
    const phase7c = await documents.get(fixture.projectId, 1, "phase-7c-contract-package");
    const status = await fixture.app.handle({ action: "status", projectId: fixture.projectId });
    expect(phase7c?.documentType === "phase-7c-contract-package" ? phase7c.status : undefined).toBe("PENDING_USER_APPROVAL");
    expect(status.status.allowedActions).toEqual(["APPROVE_PHASE7C"]);
    expect(fixture.providerCalls).toHaveLength(1);
  });

  it("rejects Phase 7C approval when the selected-design binding is stale and keeps implementation ineligible", async () => {
    const fixture = await readyForPhase7CApproval();
    const documents = new DocumentRepository(fixture.database);
    const selected = await documents.get(fixture.projectId, 1, "selected-design");
    if (!selected || selected.documentType !== "selected-design") throw new Error("SYNTHETIC_SELECTED_DESIGN_MISSING");
    await documents.save({ ...selected, selectedDirectionChecksum: "d".repeat(64) }, `synthetic-stale-selected-${fixture.projectId}`);

    const response = await post({ action: "approve-phase7c", projectId: fixture.projectId, idempotencyKey: `synthetic-stale-selected-approval-${fixture.projectId}` });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "PLANNING_ACCEPTANCE_STALE", category: "VALIDATION" });
    const phase7c = await documents.get(fixture.projectId, 1, "phase-7c-contract-package");
    const status = await fixture.app.handle({ action: "status", projectId: fixture.projectId });
    expect(phase7c?.documentType === "phase-7c-contract-package" ? phase7c.status : undefined).toBe("PENDING_USER_APPROVAL");
    expect(status.status.allowedActions).toEqual(["APPROVE_PHASE7C"]);
    expect(status.status.allowedActions).not.toContain("START_IMPLEMENTATION");
    expect(fixture.providerCalls).toHaveLength(1);
  });
});
