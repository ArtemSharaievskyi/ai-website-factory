import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RequirementSpecificationSchema, type RequirementSpecification } from "@/domain/requirements/schema";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { ProjectRepository, ProjectVersionRepository, DocumentRepository } from "@/persistence/database/repositories";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { buildPlanningPackage } from "@/agents/planner/deterministic";
import type { PlannerAgentInput, PlanningPackage } from "@/agents/planner/contracts";
import { buildImplementationTaskGraph } from "@/orchestration/orchestrator/graph";
import { DEFAULT_ORCHESTRATION_POLICY, type OrchestratorInput } from "@/orchestration/orchestrator/contracts";
import { taskExecutionCapability } from "@/orchestration/execution/capabilities";
import { type ArchitectureReviewResult } from "@/domain/review/schema";
import { contractAuditorAgentDefinition } from "@/agents/catalog";
import { ContractAuditError } from "./errors";
import { CONTRACT_AUDIT_POLICY_VERSION, ContractAuditInputSchema, type ContractAuditInput } from "./contracts";
import { deterministicContractAudit } from "./deterministic";
import { ContractAuditService, type ContractAuditExecutionEvidence } from "./service";
import { ContractAuditOrchestrationService } from "@/orchestration/contract-audit/service";
import { evidenceIdFor } from "../evidence";
import { migrateLegacyBriefToCanonicalBriefV3 } from "@/domain/requirements/v3/migrate";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";

const id = () => randomUUID();
const brief = (overrides: Partial<RequirementSpecification> = {}) => RequirementSpecificationSchema.parse({ schemaVersion: 1, documentType: "requirements", projectId: id(), projectVersion: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", projectSummary: "A public information site", protectedFunctionalityRequired: false, imagesRequired: false, businessGoals: ["Explain the service"], targetAudiences: ["Visitors"], pages: [{ slug: "home", purpose: "Explain the service" }], userRoles: [], features: [], forms: [], contentRequirements: [], backendRequirements: [], supabaseRequirements: [], authenticationDecision: "no-authentication-guest-first", storageDecision: "not-needed", emailDecision: "not-needed", administrationDecision: "not-needed", seoRequirements: [], localization: { locales: ["en"], defaultLocale: "en" }, imageSourceDecision: "placeholders", suppliedBrandInformation: { status: "missing" }, suppliedLogoLocation: { status: "missing" }, technicalConstraints: [], explicitExclusions: [], userAcceptanceCriteria: ["Home loads"], unresolvedItems: [], approval: { approved: true, approvedAt: "2026-01-01T00:00:00.000Z", approvedBy: "user" }, briefStatus: "approved", briefVersion: 1, ...overrides });
const planningFor = (value: RequirementSpecification, approvedBriefChecksum = checksumPersistedDocument(value), canonicalBrief?: ReturnType<typeof migrateLegacyBriefToCanonicalBriefV3>) => { const input: PlannerAgentInput = { projectId: value.projectId, projectVersion: 1, approvedBrief: value, approvedBriefChecksum, ...(canonicalBrief ? { canonicalBrief } : {}), originalPromptReference: "original-prompt.md", clarificationEvidenceReferences: [], currentWorkflowState: "AWAITING_DESIGN_SELECTION", existingDecisions: [], suppliedFiles: [], allowedSkills: [], idempotencyKey: id(), expectedRowVersion: 1 }; const planning = buildPlanningPackage(input); return { ...planning, accepted: true, acceptance: { acceptedAt: "2026-01-01T00:00:00.000Z", acceptedBy: "user", checksum: checksumPersistedDocument(planning) }, architecture: { ...planning.architecture, acceptance: { accepted: true, acceptedAt: "2026-01-01T00:00:00.000Z", acceptedBy: "user" } } } as PlanningPackage; };
function chain(value = brief(), planning = planningFor(value), approvedBriefChecksum = checksumPersistedDocument(value), canonicalBrief?: ReturnType<typeof migrateLegacyBriefToCanonicalBriefV3>) {
  const selected = { schemaVersion: 1 as const, documentType: "selected-design" as const, projectId: value.projectId, projectVersion: 1, createdAt: value.createdAt, updatedAt: value.updatedAt, directionSetId: id(), selectedDirectionId: id(), selectedAt: value.createdAt, selectedBy: "user", selectionNotes: "selected", selectedDirectionChecksum: "b".repeat(64) };
  const base: OrchestratorInput = { projectId: value.projectId, projectVersion: 1, approvedBrief: value, approvedBriefChecksum, ...(canonicalBrief ? { canonicalBrief } : {}), acceptedPlanningPackage: planning, acceptedPlanningChecksum: checksumPersistedDocument(planning), selectedDesign: selected, selectedDesignChecksum: checksumPersistedDocument(selected), technicalArchitecture: planning.architecture, contentPlan: planning.content, assetManifest: planning.assets, currentWorkflowState: "READY_FOR_IMPLEMENTATION", existingDecisions: [], allowedRoles: ["lead", "planner-architect", "design", "implementation", "qa-release"], approvedSkillRegistrySnapshot: { schemaVersion: 1, checksum: "c".repeat(64), skills: [] }, toolPolicyVersion: "tools-v1", orchestrationPolicyVersion: DEFAULT_ORCHESTRATION_POLICY.version, idempotencyKey: id(), expectedRowVersion: 1, workspaceReserved: true, projectImmutable: false, requiredExternalDecisionPending: false };
  const graph = buildImplementationTaskGraph(base, DEFAULT_ORCHESTRATION_POLICY); const graphWithoutChecksum = { ...graph }; delete graphWithoutChecksum.graphChecksum; const currentGraph = { ...graph, graphChecksum: checksumPersistedDocument(graphWithoutChecksum) }; const reviewResult: ArchitectureReviewResult = { verdict: "APPROVED", findings: [], reviewedArtifactRefs: ["requirements", "planning-package"], policyVersion: "architecture-review-v1" };
  const architectureReview = { schemaVersion: 1 as const, documentType: "architecture-review" as const, projectId: value.projectId, projectVersion: 1, createdAt: value.createdAt, updatedAt: value.updatedAt, reviewId: id(), reviewerAgentId: "architecture-reviewer" as const, reviewerVersion: "1.0.0", capability: "review.architecture" as const, policyVersion: "architecture-review-v1" as const, promptVersion: "architecture-reviewer.v2", reviewInputChecksum: "0".repeat(64), approvedBriefChecksum: base.approvedBriefChecksum, acceptedPlanningChecksum: base.acceptedPlanningChecksum, architectureChecksum: "a".repeat(64), phase7cChecksum: "b".repeat(64), resultChecksum: checksumPersistedDocument(reviewResult), result: reviewResult };
  const executorCatalog = [{ executorId: "factory-runtime", kind: "runtime" as const, current: true, capabilities: [...new Set(currentGraph.tasks.map((task) => taskExecutionCapability(task.taskType)).filter(Boolean)) as Set<string>] }];
  return { base, graph: currentGraph, selected, architectureReview, input: { projectId: value.projectId, projectVersion: 1, approvedBrief: value, ...(canonicalBrief ? { canonicalBrief } : {}), briefChecksum: base.approvedBriefChecksum, acceptedPlanningPackage: planning, planningChecksum: base.acceptedPlanningChecksum, approvedArchitectureReview: architectureReview, architectureReviewChecksum: checksumPersistedDocument(architectureReview), selectedDesign: selected, designChecksum: base.selectedDesignChecksum, taskGraph: currentGraph, taskGraphChecksum: currentGraph.graphChecksum!, executorCatalog, idempotencyKey: id(), expectedRowVersion: 1 } satisfies ContractAuditInput };
}
async function projectInAudit(database: InMemoryPersistenceDatabase, projectId: string) { const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", id: projectId, slug: "contract-audit", originalPrompt: "fixture", currentVersion: 1, workflowState: "CONTRACT_AUDIT" }); await new ProjectRepository(database).create(project); await new ProjectVersionRepository(database).create({ id: id(), projectId, versionNumber: 1, state: "CONTRACT_AUDIT", memoryRootPath: null, requirementsChecksum: null, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: project.createdAt, updatedAt: project.updatedAt, rowVersion: 1 }); }

describe("Contract Auditor", () => {
  it("is a read-only reviewer with its complete approved portfolio and correct capability", () => { expect(contractAuditorAgentDefinition.role).toBe("review"); expect(contractAuditorAgentDefinition.capabilities).toEqual(["review.contracts"]); expect(contractAuditorAgentDefinition.allowedTools).toEqual(["openai-generation"]); expect(contractAuditorAgentDefinition.allowedSkillIds).toEqual(["acceptance-criteria-80493e317476", "requirements-evidence-traceability"]); expect(contractAuditorAgentDefinition.readOnly).toBe(true); });
  it("approves a fully traced generated graph", () => { const value = chain(); const result = deterministicContractAudit(value.input); expect(result.verdict).toBe("APPROVED"); });
  it("rejects canonical artifacts from a different project at the input boundary", () => { const value = chain(); const mismatchedBrief = { ...value.input.approvedBrief, projectId: id() }; expect(() => ContractAuditInputSchema.parse({ ...value.input, approvedBrief: mismatchedBrief })).toThrow(/project identity/i); });
  it("detects missing route ownership and stale TaskGraph checksums", async () => { const value = chain(); const page = value.graph.tasks.find((task) => task.taskType === "implement-page")!; const changed = { ...value.graph, tasks: value.graph.tasks.filter((task) => task.id !== page.id) }; const input = { ...value.input, taskGraph: changed, taskGraphChecksum: value.graph.graphChecksum! }; expect(deterministicContractAudit(input).findings.some((item) => item.category === "ROUTE_CONTRACT_MISMATCH")).toBe(true); const stale = { ...value.input, taskGraph: value.graph, taskGraphChecksum: "d".repeat(64) }; await expect(new ContractAuditService(new InMemoryPersistenceDatabase()).audit(stale)).rejects.toMatchObject({ code: "CONTRACT_AUDIT_BLOCKED" }); });
  it("requires the current approved Architecture Review, Design, and TaskGraph", async () => { const value = chain(); const database = new InMemoryPersistenceDatabase(); await projectInAudit(database, value.input.projectId); const stale = { ...value.input, approvedArchitectureReview: { ...value.architectureReview, result: { ...value.architectureReview.result, verdict: "CHANGES_REQUIRED" as const, findings: [{ findingId: "blocked", severity: "ERROR" as const, category: "REQUIREMENT_TRACEABILITY" as const, summary: "blocked", evidenceRefs: ["requirements"], affectedArtifacts: ["planning-package"], recommendedAction: "correct" }] } } }; await expect(new ContractAuditService(database).audit(stale)).rejects.toMatchObject({ code: "CONTRACT_AUDIT_BLOCKED" }); });
  it("persists an approved audit and provides stable idempotency", async () => { const value = chain(); const database = new InMemoryPersistenceDatabase(); await projectInAudit(database, value.input.projectId); const service = new ContractAuditService(database); const input = { ...value.input, idempotencyKey: "same-audit" }; const first = await service.audit(input); const second = await service.audit(input); expect(second).toEqual(first); expect((await new DocumentRepository(database).get(value.input.projectId, 1, "contract-audit"))?.documentType).toBe("contract-audit"); expect((await service.getCurrentAudit(value.input.projectId, 1, { brief: input.briefChecksum, planning: input.planningChecksum, architectureReview: input.architectureReviewChecksum, design: input.designChecksum, taskGraph: input.taskGraphChecksum }))?.result.verdict).toBe("APPROVED"); });
  it("rejects actionable provider findings without correction targets or invented evidence", async () => { const value = chain(); const database = new InMemoryPersistenceDatabase(); await projectInAudit(database, value.input.projectId); const provider = { promptVersion: "contract-auditor.v1", review: async () => ({ verdict: "CHANGES_REQUIRED" as const, findings: [{ findingId: "semantic-gap", severity: "ERROR" as const, category: "REQUIREMENT_CONTRADICTION" as const, summary: "Meaning changed", evidenceRefs: ["requirements"], affectedArtifacts: ["task-graph"], recommendedAction: "Correct the task.", routeMismatchAspect: null }], reviewedArtifactRefs: ["requirements"], policyVersion: CONTRACT_AUDIT_POLICY_VERSION }) }; await expect(new ContractAuditService(database, { provider }).audit(value.input)).rejects.toMatchObject({ code: "CONTRACT_AUDIT_OUTPUT_INVALID" }); });
  it("keeps semantic review separate from deterministic facts", async () => { const value = chain(); const database = new InMemoryPersistenceDatabase(); await projectInAudit(database, value.input.projectId); const provider = { promptVersion: "contract-auditor.v1", review: async (reviewInput: ContractAuditInput) => { const requirements = evidenceIdFor(reviewInput, "requirements"); const taskGraph = evidenceIdFor(reviewInput, "task-graph"); return { verdict: "CHANGES_REQUIRED" as const, findings: [{ findingId: "semantic-gap", severity: "ERROR" as const, category: "REQUIREMENT_CONTRADICTION" as const, summary: "The downstream task changes the approved meaning.", evidenceRefs: [requirements], affectedArtifacts: [taskGraph], recommendedAction: "Correct the task contract.", correctionTarget: "TASKGRAPH" as const, routeMismatchAspect: null }], reviewedArtifactRefs: [requirements, taskGraph] }; } }; const result = await new ContractAuditService(database, { provider }).audit(value.input); expect(result.verdict).toBe("CHANGES_REQUIRED"); expect(result.policyVersion).toBe(CONTRACT_AUDIT_POLICY_VERSION); expect(result.findings[0]?.correctionTarget).toBe("TASKGRAPH"); });
  it("maps the selected direction into an opaque provider catalog reference while preserving the canonical identity internally", async () => {
    const value = chain();
    const database = new InMemoryPersistenceDatabase();
    await projectInAudit(database, value.input.projectId);
    let providerCatalog: Array<{ canonicalRef: string }> = [];
    const provider = { promptVersion: "contract-auditor.v1", review: async (reviewInput: ContractAuditInput) => {
      providerCatalog = (reviewInput as unknown as { evidenceCatalog?: { entries: Array<{ canonicalRef: string }> } }).evidenceCatalog?.entries ?? [];
      const requirements = evidenceIdFor(reviewInput, "requirements");
      return { verdict: "CHANGES_REQUIRED" as const, findings: [{ findingId: "synthetic-selected-design-review", severity: "INFO" as const, category: "REQUIREMENT_NOT_TRACED" as const, summary: "Synthetic bounded finding.", evidenceRefs: [requirements], affectedArtifacts: [requirements], recommendedAction: "Review the synthetic evidence.", routeMismatchAspect: null }], reviewedArtifactRefs: [requirements] };
    } };
    await new ContractAuditService(database, { provider }).audit(value.input);
    const selectedEntry = providerCatalog.find((entry) => entry.canonicalRef.startsWith("selected-design-evidence:"));
    expect(selectedEntry).toBeDefined();
    expect(providerCatalog.some((entry) => entry.canonicalRef === value.selected.selectedDirectionId)).toBe(false);
  });
  it("retains bounded provider-boundary evidence without retaining provider content", async () => {
    const value = chain();
    const database = new InMemoryPersistenceDatabase();
    await projectInAudit(database, value.input.projectId);
    const execution: ContractAuditExecutionEvidence = { providerBoundary: "NOT_STARTED", providerCallsTotal: 0, responseReceived: false, parsed: false, persisted: false };
    const provider = { promptVersion: "contract-auditor.v1", review: async () => { throw new Error("private synthetic provider detail"); } };
    await expect(new ContractAuditService(database, { provider }).audit(value.input, undefined, execution)).rejects.toMatchObject({ code: "CONTRACT_AUDIT_PROVIDER_FAILED" });
    expect(execution).toMatchObject({ providerBoundary: "STARTED", providerCallsTotal: 1, responseReceived: false, parsed: false, persisted: false, requestBytes: expect.any(Number), requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(JSON.stringify(execution)).not.toContain("private synthetic provider detail");
  });
  it("distinguishes response, parse, and persistence completion on a synthetic provider response", async () => {
    const value = chain();
    const database = new InMemoryPersistenceDatabase();
    await projectInAudit(database, value.input.projectId);
    const execution: ContractAuditExecutionEvidence = { providerBoundary: "NOT_STARTED", providerCallsTotal: 0, responseReceived: false, parsed: false, persisted: false };
    const provider = { promptVersion: "contract-auditor.v1", review: async (reviewInput: ContractAuditInput) => ({ verdict: "APPROVED" as const, findings: [], reviewedArtifactRefs: [evidenceIdFor(reviewInput, "requirements")] }) };
    await new ContractAuditService(database, { provider }).audit(value.input, undefined, execution);
    expect(execution).toMatchObject({ providerBoundary: "RESPONSE_RECEIVED", providerCallsTotal: 1, responseReceived: true, parsed: true, persisted: true });
  });
  it("rejects Planning-targeted structural route findings contradicted by current host evidence", async () => {
    const legacyBrief = brief();
    const canonicalBrief = migrateLegacyBriefToCanonicalBriefV3(legacyBrief);
    const approvedBriefChecksum = canonicalBriefChecksum(canonicalBrief);
    const approvedBrief = RequirementSpecificationSchema.parse({
      ...legacyBrief,
      approval: { ...legacyBrief.approval, approvedRequirementsChecksum: approvedBriefChecksum },
    });
    const value = chain(approvedBrief, planningFor(approvedBrief, approvedBriefChecksum, canonicalBrief), approvedBriefChecksum, canonicalBrief);
    for (const routeMismatchAspect of ["ROUTE_POLICY", "PATH_IDENTITY"] as const) {
      const database = new InMemoryPersistenceDatabase();
      await projectInAudit(database, value.input.projectId);
      const provider = { promptVersion: "contract-auditor.v1", review: async (reviewInput: ContractAuditInput) => {
        const requirements = evidenceIdFor(reviewInput, "requirements");
        const planning = evidenceIdFor(reviewInput, "planning-package");
        return { verdict: "CHANGES_REQUIRED" as const, findings: [{ findingId: `false-${routeMismatchAspect.toLowerCase()}`, severity: "ERROR" as const, category: "ROUTE_CONTRACT_MISMATCH" as const, summary: "Synthetic structural route mismatch.", evidenceRefs: [requirements, planning], affectedArtifacts: [planning], recommendedAction: "Correct Planning.", correctionTarget: "PLANNING" as const, routeMismatchAspect }], reviewedArtifactRefs: [requirements, planning] };
      } };

      await expect(new ContractAuditService(database, { provider }).audit(value.input)).rejects.toMatchObject({
        code: "CONTRACT_AUDIT_FINDING_CONTRADICTS_HOST_EVIDENCE",
      });
      expect(await new DocumentRepository(database).get(value.input.projectId, 1, "contract-audit")).toBeNull();
    }
  });
  it("preserves semantic route findings and non-Planning correction ownership", async () => {
    const legacyBrief = brief();
    const canonicalBrief = migrateLegacyBriefToCanonicalBriefV3(legacyBrief);
    const approvedBriefChecksum = canonicalBriefChecksum(canonicalBrief);
    const approvedBrief = RequirementSpecificationSchema.parse({
      ...legacyBrief,
      approval: { ...legacyBrief.approval, approvedRequirementsChecksum: approvedBriefChecksum },
    });
    const value = chain(approvedBrief, planningFor(approvedBrief, approvedBriefChecksum, canonicalBrief), approvedBriefChecksum, canonicalBrief);

    for (const finding of [
      ...(["ROUTE_OWNERSHIP", "PAGE_PURPOSE", "PAGE_ROLE", "LEGAL_OBLIGATION", "SEO_OBLIGATION"] as const).map((routeMismatchAspect) => ({ findingId: routeMismatchAspect.toLowerCase(), correctionTarget: "PLANNING" as const, routeMismatchAspect })),
      { findingId: "taskgraph-route-policy", correctionTarget: "TASKGRAPH" as const, routeMismatchAspect: "ROUTE_POLICY" as const },
    ]) {
      const database = new InMemoryPersistenceDatabase();
      await projectInAudit(database, value.input.projectId);
      const provider = { promptVersion: "contract-auditor.v1", review: async (reviewInput: ContractAuditInput) => {
        const requirements = evidenceIdFor(reviewInput, "requirements");
        const planning = evidenceIdFor(reviewInput, "planning-package");
        return { verdict: "CHANGES_REQUIRED" as const, findings: [{ ...finding, severity: "ERROR" as const, category: "ROUTE_CONTRACT_MISMATCH" as const, summary: "Synthetic semantic route mismatch.", evidenceRefs: [requirements, planning], affectedArtifacts: [planning], recommendedAction: "Review the cited contract." }], reviewedArtifactRefs: [requirements, planning] };
      } };

      const result = await new ContractAuditService(database, { provider }).audit(value.input);
      expect(result).toMatchObject({ verdict: "CHANGES_REQUIRED", findings: [finding] });
    }
  });
  it("exhausts TaskGraph regeneration after one bounded cycle", () => { const service = new ContractAuditService(new InMemoryPersistenceDatabase()); const projectId = id(); service.recordTaskGraphRegeneration(projectId, 1); expect(() => service.recordTaskGraphRegeneration(projectId, 1)).toThrowError(ContractAuditError); });
  it("unlocks implementation only through orchestration after approval", async () => { const value = chain(); const database = new InMemoryPersistenceDatabase(); await projectInAudit(database, value.input.projectId); const result = await new ContractAuditOrchestrationService(database).auditAndRoute(value.input); expect(result.result.verdict).toBe("APPROVED"); expect(result.projectState).toBe("READY_FOR_IMPLEMENTATION"); expect((await new ProjectRepository(database).getWithVersion(value.input.projectId))?.project.workflowState).toBe("READY_FOR_IMPLEMENTATION"); });
});
