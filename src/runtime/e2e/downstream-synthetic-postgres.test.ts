import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { RequirementSpecificationSchema, type RequirementSpecification } from "@/domain/requirements/schema";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { buildPlanningPackage } from "@/agents/planner/deterministic";
import type { PlannerAgentInput, PlanningPackage } from "@/agents/planner/contracts";
import { DesignAgentInputSchema } from "@/agents/design/contracts";
import { DesignAgentService } from "@/agents/design/service";
import { ProfessionalDesignCapabilityPipeline } from "@/agents/design/professional";
import { buildDesignDirectionSet, directionChecksum, directionSetChecksum } from "@/agents/design/deterministic";
import { FakeDesignMemoryPort } from "@/agents/design/memory";
import { ArchitectureReviewOrchestrationService } from "@/orchestration/architecture-review/service";
import { ArchitectureReviewService } from "@/agents/reviewers/architecture/service";
import { deterministicArchitectureReview } from "@/agents/reviewers/architecture/deterministic";
import { FACTORY_ARCHITECTURE_STACK } from "@/agents/reviewers/architecture/contracts";
import { ContractAuditOrchestrationService } from "@/orchestration/contract-audit/service";
import { OrchestratorService } from "@/orchestration/orchestrator/service";
import { taskExecutionCapability } from "@/orchestration/execution/capabilities";
import { DEFAULT_ORCHESTRATION_POLICY } from "@/orchestration/orchestrator/contracts";
import { buildPhase7CContractPackage, buildDependencyProposal, approveDatabaseDecision, approveDependencyProposal, approvePhase7CContractPackage } from "@/domain/contracts/phase7c";
import { validateDirectionDesignCapability } from "@/domain/design/capability";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { planningSemanticChecksum } from "@/agents/planner/deterministic";
import { createPostgresPool, PostgresPersistenceDatabase } from "@/persistence/database/postgres";
import { validateQaReadiness } from "@/runtime/qa/policy";
import { FakeProjectMemorySyncPort } from "@/persistence/database/sync";
import { emptyBriefV2Fields } from "@/domain/requirements/brief";
import { deriveFunctionalQaPlan } from "@/runtime/qa/policy";

const id = () => randomUUID();
const timestamp = "2026-08-24T10:00:00.000Z";
function configuredDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const filename of [".env.local", ".env"]) {
    if (!existsSync(filename)) continue;
    const line = readFileSync(filename, "utf8").split(/\r?\n/).find((candidate) => /^\s*DATABASE_URL\s*=/.test(candidate));
    const value = line?.replace(/^\s*DATABASE_URL\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
    if (value) return value;
  }
  return undefined;
}
const databaseUrl = configuredDatabaseUrl();
const describePostgres = describe.skipIf(!databaseUrl);
const projectIds: string[] = [];

const makeBrief = (): RequirementSpecification => RequirementSpecificationSchema.parse({
  schemaVersion: 1, documentType: "requirements", projectId: id(), projectVersion: 1, createdAt: timestamp, updatedAt: timestamp,
  projectSummary: "Synthetic public service site", protectedFunctionalityRequired: false, imagesRequired: false,
  businessGoals: ["Explain the service"], targetAudiences: ["Visitors"], pages: [{ slug: "home", purpose: "Explain the service" }, { slug: "contact", purpose: "Contact form" }],
  userRoles: [], features: ["Contact form"], forms: ["Contact form"], contentRequirements: [], backendRequirements: [], supabaseRequirements: [],
  authenticationDecision: "no-authentication-guest-first", storageDecision: "not-needed", emailDecision: "not-needed", administrationDecision: "not-needed", seoRequirements: [],
  localization: { locales: ["en"], defaultLocale: "en" }, imageSourceDecision: "placeholders", suppliedBrandInformation: { status: "missing" }, suppliedLogoLocation: { status: "missing" },
  technicalConstraints: [], explicitExclusions: [], userAcceptanceCriteria: ["Home loads"], unresolvedItems: [],
  approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-user" }, briefStatus: "approved", briefVersion: 1,
  contactFacts: [], legalFacts: [], brandFacts: [], logoMetadata: [], imageSourcingNotes: [], evidence: [], recommendations: [],
  ...emptyBriefV2Fields(),
  formBehaviorRequirements: { ...emptyBriefV2Fields().formBehaviorRequirements, formPresent: true, validation: "ACTIVE", successUx: "SIMULATED", dataTransmission: "NONE", persistence: "NONE", thirdParty: "NONE", privacyCheckbox: "REQUIRED" },
});

const makePlanning = (brief: RequirementSpecification): PlanningPackage => {
  const input: PlannerAgentInput = { projectId: brief.projectId, projectVersion: 1, approvedBrief: brief, approvedBriefChecksum: checksumPersistedDocument(brief), originalPromptReference: "synthetic-prompt", clarificationEvidenceReferences: [], currentWorkflowState: "AWAITING_DESIGN_SELECTION", existingDecisions: [], suppliedFiles: [], allowedSkills: [], idempotencyKey: id(), expectedRowVersion: 1 };
  const planning = buildPlanningPackage(input);
  return { ...planning, accepted: true, acceptance: { acceptedAt: timestamp, acceptedBy: "synthetic-user", checksum: checksumPersistedDocument(planning) }, architecture: { ...planning.architecture, acceptance: { accepted: true, acceptedAt: timestamp, acceptedBy: "synthetic-user" } } } as PlanningPackage;
};

const makeProfessionalPipeline = () => {
  const sources = {
    "twenty-first-dev": "https://21st.dev/",
    "react-bits": "https://reactbits.dev/",
    "magic-ui": "https://raw.githubusercontent.com/magicuidesign/magicui/main/registry.json",
    "shadcn-ui": "https://ui.shadcn.com/",
  } as const;
  const research = (source: keyof typeof sources) => ({
    source,
    query: "synthetic",
    sourceReference: sources[source],
    sourceChecksum: "b".repeat(64),
    retrievedAt: timestamp,
    liveEvidence: true,
    writeAuthority: "NONE" as const,
    candidates: [{
      candidateId: `${source}-candidate`,
      source,
      componentIdentity: `${source} synthetic candidate`,
      category: "synthetic",
      purpose: "Bounded synthetic discovery evidence.",
      dependencies: [],
      motionCharacteristics: "Evaluated.",
      compatibility: "adaptation-required" as const,
      sourceReference: sources[source],
      sourceChecksum: "b".repeat(64),
      retrievedAt: timestamp,
      freePolicy: source === "shadcn-ui" ? "EXISTING_APPROVED" as const : source === "magic-ui" ? "FREE_OPEN_SOURCE" as const : "FREE_PUBLIC_READ_ONLY" as const,
      disposition: "USED_FOR_RESEARCH_NOT_SELECTED" as const,
      decisionReason: "Compared within the bounded synthetic fixture.",
    }],
  });
  const skillEvidence = ["impeccable", "emil-design-eng", "review-animations", "improve-animations", "find-animation-opportunities", "animation-vocabulary", "transitions-dev"].map((skillId) => ({ skillId, officialRepository: skillId === "impeccable" ? "pbakaus/impeccable" : skillId === "transitions-dev" ? "Jakubantalik/transitions.dev" : "emilkowalski/skills", status: "APPROVED_IMMUTABLE" as const, sourceChecksum: "a".repeat(64), approvedDirectory: `skills/${skillId}` }));
  return new ProfessionalDesignCapabilityPipeline({
    fontpair: { listPairings: async () => [1, 2, 3].map((index) => ({ pairingId: `pair-${index}`, displayFamily: `Display ${index}`, bodyFamily: `Body ${index}`, sourceTypes: ["google-fonts"], styleUseCase: "synthetic", sourceUrl: "https://fontpair.co/", sourceChecksum: "c".repeat(64), normalizedChecksum: `${index}`.repeat(64) })) } as never,
    twentyFirstDev: { searchComponents: async () => research("twenty-first-dev") } as never,
    reactBits: { searchComponents: async () => research("react-bits") } as never,
    magicUi: { searchComponents: async () => research("magic-ui") } as never,
    approvedSkillEvidence: async () => skillEvidence,
  });
};

async function cleanup(pool: Pool) {
  for (const projectId of projectIds) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM workflow_events WHERE project_id=$1", [projectId]);
      await client.query("DELETE FROM decision_records WHERE project_id=$1", [projectId]);
      await client.query("DELETE FROM workflow_documents WHERE project_id=$1", [projectId]);
      await client.query("DELETE FROM project_versions WHERE project_id=$1", [projectId]);
      await client.query("DELETE FROM factory_projects WHERE id=$1", [projectId]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}

describePostgres("synthetic downstream lifecycle on real Postgres", () => {
  let pool: ReturnType<typeof createPostgresPool>;
  let database: PostgresPersistenceDatabase;

  beforeAll(() => { pool = createPostgresPool({ DATABASE_URL: databaseUrl, NODE_ENV: "test" }); database = new PostgresPersistenceDatabase(pool); });
  afterAll(async () => { await cleanup(pool); await pool.end(); });

  it("connects Architecture Review -> exactly three Design -> selection -> TaskGraph -> Contract Audit -> Implementation admission -> QA preconditions", async () => {
    const brief = makeBrief();
    projectIds.push(brief.projectId);
    const planning = makePlanning(brief);
    const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId: brief.projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: brief.projectId, slug: `synthetic-downstream-${brief.projectId.slice(0, 8)}`, origin: "SYNTHETIC", originalPrompt: "Synthetic downstream lifecycle.", currentVersion: 1, workflowState: "ARCHITECTURE_REVIEW" });
    await new ProjectRepository(database).create(project);
    await new ProjectVersionRepository(database).create({ id: id(), projectId: brief.projectId, versionNumber: 1, state: "ARCHITECTURE_REVIEW", memoryRootPath: null, requirementsChecksum: null, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
    const documents = new DocumentRepository(database);
    await documents.save(brief);
    await documents.save(planning);
    await documents.save(planning.architecture);
    const phase7cDraft = buildPhase7CContractPackage({ projectId: brief.projectId, projectVersion: 1, createdAt: timestamp, approvedBriefChecksum: checksumPersistedDocument(brief), planningChecksum: planningSemanticChecksum(planning), architectureChecksum: checksumPersistedDocument(planning.architecture), designChecksum: "0".repeat(64), planning });
    await documents.save(phase7cDraft);
    const architectureInput = { projectId: brief.projectId, projectVersion: 1, approvedBrief: brief, approvedBriefChecksum: checksumPersistedDocument(brief), acceptedPlanningPackage: planning, acceptedPlanningChecksum: checksumPersistedDocument(planning), factoryArchitecturePolicy: { policyVersion: "factory-architecture-v1" as const, stack: [...FACTORY_ARCHITECTURE_STACK], prohibitedTechnologies: ["redis"], serverActionPreference: "preferred" as const, routeHandlerPreference: "second" as const, packageManager: "npm" as const }, relevantProjectConstraints: [], idempotencyKey: `synthetic-architecture-review-${brief.projectId}`, expectedRowVersion: 1 };
    const architectureReviewer = new ArchitectureReviewService(database, { provider: { promptVersion: "architecture-reviewer.v2", review: async (input) => deterministicArchitectureReview(input) } });
    const memoryProjection = new FakeProjectMemorySyncPort();
    const architectureOrchestration = new ArchitectureReviewOrchestrationService(database, architectureReviewer, { projection: memoryProjection });
    const architectureReview = await architectureOrchestration.reviewAndRoute(architectureInput);
    expect(architectureReview.result.verdict).toBe("APPROVED");
    expect(architectureReview.projectState).toBe("AWAITING_DESIGN_SELECTION");
    expect(architectureReview.projectionStatus).toBe("SYNCED");
    expect(memoryProjection.decisions.get(`${brief.projectId}:1`)).toHaveLength(1);
    await expect(architectureOrchestration.reconcileArchitectureReviewProjection(brief.projectId, 1)).resolves.toMatchObject({ projectionStatus: "SYNCED", decisionCount: 1 });
    expect(memoryProjection.decisions.get(`${brief.projectId}:1`)).toHaveLength(1);
    const review = await documents.get(brief.projectId, 1, "architecture-review");
    if (!review || review.documentType !== "architecture-review") throw new Error("Synthetic Architecture Review was not persisted.");
    const approvedArchitectureReview = review;

    const designInput = DesignAgentInputSchema.parse({ projectId: brief.projectId, projectVersion: 1, approvedBrief: brief, approvedBriefChecksum: checksumPersistedDocument(brief), acceptedPlanningPackage: planning, acceptedPlanningChecksum: checksumPersistedDocument(planning), contentPlan: planning.content, assetManifest: planning.assets, suppliedBrandMetadata: {}, suppliedLogoMetadata: brief.suppliedLogoLocation, imageSourceDecision: brief.imageSourceDecision, designPreferences: [], explicitDesignExclusions: [], currentWorkflowState: "AWAITING_DESIGN_SELECTION", existingDecisions: [], allowedSkills: [], idempotencyKey: `synthetic-design-${brief.projectId}`, expectedRowVersion: architectureReview.rowVersion });
    const professionalPipeline = makeProfessionalPipeline();
    const providerShapedDirections = (input: Parameters<typeof buildDesignDirectionSet>[0]) => { const set = buildDesignDirectionSet(input); return { ...set, directions: set.directions.map((direction) => { const copy = { ...direction }; delete copy.professionalDesign; return copy; }) }; };
    const invalidDesign = (input: Parameters<typeof buildDesignDirectionSet>[0]) => { const set = providerShapedDirections(input); return { ...set, directions: set.directions.map((_, index) => ({ ...set.directions[0]!, id: index === 0 ? set.directions[0]!.id : id(), label: `Synthetic duplicate ${index}` })) }; };
    const failingDesign = new DesignAgentService({ database, memory: new FakeDesignMemoryPort(), professionalPipeline, provider: { proposeDesignDirections: async (input) => invalidDesign(input) } });
    await expect(failingDesign.generateDesignDirections(designInput)).rejects.toMatchObject({ code: "DESIGN_DIRECTIONS_TOO_SIMILAR" });
    expect(await documents.get(brief.projectId, 1, "design-directions")).toBeNull();
    expect(await documents.get(brief.projectId, 1, "selected-design")).toBeNull();
    const design = new DesignAgentService({ database, memory: new FakeDesignMemoryPort(), professionalPipeline, provider: { proposeDesignDirections: async (input) => providerShapedDirections(input) } });
    const generated = await design.generateDesignDirections({ ...designInput, idempotencyKey: `${designInput.idempotencyKey}-replacement` }, { replaceExisting: true });
    expect(generated.directionSet.directions).toHaveLength(3);
    expect(generated.directionSet.directions.every((direction) => direction.professionalDesign?.currentness.status === "CURRENT")).toBe(true);
    expect(generated.directionSet.professionalCapability?.directions).toHaveLength(3);
    expect(await documents.get(brief.projectId, 1, "selected-design")).toBeNull();
    const selected = await design.selectDesignDirection({ projectId: brief.projectId, projectVersion: 1, designDirectionSetId: generated.directionSet.setId, selectedDirectionId: generated.directionSet.directions[0]!.id, directionSetChecksum: directionSetChecksum(generated.directionSet), selectedDirectionChecksum: directionChecksum(generated.directionSet.directions[0]!), expectedRowVersion: architectureReview.rowVersion, selectedBy: "synthetic-user", selectedAt: timestamp, selectionNotes: "Synthetic explicit selection", idempotencyKey: `synthetic-selection-${brief.projectId}` });

    const phaseDraft = buildPhase7CContractPackage({ projectId: brief.projectId, projectVersion: 1, createdAt: timestamp, approvedBriefChecksum: checksumPersistedDocument(brief), planningChecksum: planningSemanticChecksum(planning), architectureChecksum: checksumPersistedDocument(planning.architecture), designChecksum: checksumPersistedDocument(selected.selectedDesign), planning });
    const databaseDecision = approveDatabaseDecision(phaseDraft.databaseDecision, { actorId: "synthetic-user", approvedAt: timestamp, mode: "NONE" });
    const dependencyDraft = buildDependencyProposal({ dependencyProposalId: id(), projectId: brief.projectId, projectVersion: 1, createdAt: timestamp, planningChecksum: planningSemanticChecksum(planning), dependencies: [] }, { projectId: brief.projectId, projectVersion: 1, planningChecksum: planningSemanticChecksum(planning), plannedDependencies: [] });
    const dependencyProposal = approveDependencyProposal(dependencyDraft, { actorId: "synthetic-user", approvedAt: timestamp });
    const approvedDraft = buildPhase7CContractPackage({ projectId: brief.projectId, projectVersion: 1, createdAt: timestamp, approvedBriefChecksum: checksumPersistedDocument(brief), planningChecksum: planningSemanticChecksum(planning), architectureChecksum: checksumPersistedDocument(planning.architecture), designChecksum: checksumPersistedDocument(selected.selectedDesign), planning, databaseDecision, dependencyProposal });
    const phase7c = approvePhase7CContractPackage(approvedDraft, { actorId: "synthetic-user", approvedAt: timestamp });
    const currentPhase7c = { ...phase7c, architectureAccepted: true, contractAuditAccepted: true, designSelected: true };
    await documents.save(currentPhase7c);

    const orchestratorInput = { projectId: brief.projectId, projectVersion: 1, approvedBrief: brief, approvedBriefChecksum: checksumPersistedDocument(brief), acceptedPlanningPackage: planning, acceptedPlanningChecksum: checksumPersistedDocument(planning), selectedDesign: selected.selectedDesign, selectedDesignChecksum: checksumPersistedDocument(selected.selectedDesign), technicalArchitecture: planning.architecture, contentPlan: planning.content, assetManifest: planning.assets, currentWorkflowState: "READY_FOR_IMPLEMENTATION" as const, existingDecisions: [], allowedRoles: ["lead", "planner-architect", "design", "implementation", "qa-release"] as ("lead" | "planner-architect" | "design" | "implementation" | "qa-release")[], approvedSkillRegistrySnapshot: { schemaVersion: 1 as const, checksum: "0".repeat(64), skills: [] }, toolPolicyVersion: "tools-v1", orchestrationPolicyVersion: DEFAULT_ORCHESTRATION_POLICY.version, idempotencyKey: `synthetic-orchestrator-${brief.projectId}`, expectedRowVersion: (await new ProjectRepository(database).getWithVersion(brief.projectId))!.rowVersion, workspaceReserved: true, projectImmutable: false, phase7cContractPackage: currentPhase7c };
    const orchestrator = new OrchestratorService(database);
    const graph = await orchestrator.createImplementationTaskGraph(orchestratorInput);
    expect(graph.valid).toBe(true);
    expect(planning.forms.forms[0]?.submissionMechanism).toBe("client-only");
    expect(planning.dataModel.entities).toHaveLength(0);
    expect(planning.architecture.serverActions).toHaveLength(0);
    expect(planning.architecture.routeHandlers).toHaveLength(0);
    expect(planning.architecture.backendPriority).toEqual([]);
    expect(planning.supabase.postgres).toBe(false);
    expect(planning.supabase.auth).toBe(false);
    expect(planning.supabase.storage).toBe(false);
    expect(planning.supabase.realtime).toBe(false);
    expect(planning.authentication.required).toBe(false);
    expect(planning.storage.decision).toBe("not-required");
    expect(planning.email.decision).toBe("not-required");
    expect(graph.taskGraph.tasks.filter((task) => ["implement-server-action", "implement-route-handler", "implement-database-schema", "implement-rls-policy", "implement-email", "implement-authentication", "implement-storage"].includes(task.taskType))).toHaveLength(0);
    expect(graph.taskGraph.tasks.some((task) => ["implement-server-action", "implement-route-handler", "implement-database-schema", "implement-rls-policy", "implement-email", "implement-authentication", "implement-storage"].includes(task.taskType))).toBe(false);
    const entered = await new ContractAuditOrchestrationService(database).enterAudit({ projectId: brief.projectId, projectVersion: 1, expectedRowVersion: (await new ProjectRepository(database).getWithVersion(brief.projectId))!.rowVersion, idempotencyKey: `synthetic-audit-enter-${brief.projectId}` });
    const audit = new ContractAuditOrchestrationService(database);
    const reviewInput = { projectId: brief.projectId, projectVersion: 1, approvedBrief: brief, briefChecksum: checksumPersistedDocument(brief), acceptedPlanningPackage: planning, planningChecksum: checksumPersistedDocument(planning), approvedArchitectureReview, architectureReviewChecksum: checksumPersistedDocument(approvedArchitectureReview), selectedDesign: selected.selectedDesign, designChecksum: checksumPersistedDocument(selected.selectedDesign), taskGraph: graph.taskGraph, taskGraphChecksum: graph.taskGraph.graphChecksum!, executorCatalog: [{ executorId: "factory-runtime", kind: "runtime" as const, current: true, capabilities: [...new Set(graph.taskGraph.tasks.map((task) => taskExecutionCapability(task.taskType)).filter(Boolean) as string[])] }], idempotencyKey: `synthetic-audit-${brief.projectId}`, expectedRowVersion: entered.rowVersion };
    const auditResult = await audit.auditAndRoute(reviewInput);
    expect(auditResult).toMatchObject({ projectState: "READY_FOR_IMPLEMENTATION", result: { verdict: "APPROVED" } });
    const auditDocument = await documents.get(brief.projectId, 1, "contract-audit");
    expect(auditDocument?.documentType).toBe("contract-audit");
    const selectedReadiness = validateDirectionDesignCapability(selected.selectedDesign.selectedDirectionId, selected.selectedDesign.selectedDirectionContract!, { requireLiveEvidence: true, approvedDependencies: new Set() });
    expect(selectedReadiness).toMatchObject({ valid: true });
    const started = await orchestrator.startImplementation({ ...orchestratorInput, approvedContractAuditChecksum: checksumPersistedDocument(auditDocument!), expectedRowVersion: (await new ProjectRepository(database).getWithVersion(brief.projectId))!.rowVersion });
    expect(started.project.workflowState).toBe("IMPLEMENTING");
    const qaTask = started.taskGraph.tasks.find((task) => task.taskType === "validate-functional-flow")!;
    const qaPlan = deriveFunctionalQaPlan({ projectId: brief.projectId, projectVersion: 1, brief, planning, briefChecksum: checksumPersistedDocument(brief), planningChecksum: planningSemanticChecksum(planning), designChecksum: checksumPersistedDocument(selected.selectedDesign) });
    const formScenario = qaPlan.scenarios.find((scenario) => scenario.scenarioType === "form");
    expect(formScenario).toMatchObject({ formSubmissionMechanism: "client-only", requiresDatabaseFixture: false, ownershipCandidates: ["implement-form"] });
    const checksums = { brief: checksumPersistedDocument(brief), planning: checksumPersistedDocument(planning), design: checksumPersistedDocument(selected.selectedDesign) };
    expect(() => validateQaReadiness({ projectId: brief.projectId, projectVersion: 1, workspacePath: "C:\\synthetic-root\\staging", generatedProjectsRoot: "C:\\synthetic-root", mutable: true, runtimeValidation: { overallStatus: "passed", validationRunId: id(), packageChecksum: "a".repeat(64), lockfileChecksum: "b".repeat(64) }, task: { ...qaTask, status: "ready", allowedTools: [...qaTask.allowedTools, "Playwright-functional"] }, expectedBriefChecksum: checksums.brief, expectedPlanningChecksum: checksums.planning, expectedDesignChecksum: checksums.design, actualBriefChecksum: "c".repeat(64), actualPlanningChecksum: checksums.planning, actualDesignChecksum: checksums.design, blockingImplementationTask: false, fixturesAvailable: true })).toThrow(/Approved QA inputs are stale/);
  }, 30_000);
});

if (!databaseUrl) console.log("SYNTHETIC DOWNSTREAM POSTGRES LIFECYCLE: SKIPPED (DATABASE_URL unavailable)");
