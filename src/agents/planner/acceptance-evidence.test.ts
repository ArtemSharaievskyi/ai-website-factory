import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { cleanBriefV3, representativeV1Brief } from "@/domain/requirements/v3/fixtures";
import { CanonicalBriefV3Schema, type CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { createBriefV3Document, BriefV3DocumentSchema } from "@/persistence/database/brief-revision-v3-contracts";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { buildPlanningPackage, planningDocumentChecksum, planningSemanticChecksum } from "./deterministic";
import { PlanningPackageSchema, type PlannerAgentInput, type PlanningPackage } from "./contracts";
import {
  admitPlanningRefresh,
  projectPlanningAcceptanceCoverageFromRecoveryAccounting,
  validatePlanningRequirementCoverage,
} from "./refresh-admission";
import {
  createCanonicalPlanningRouteManifest,
  createPlanningOwnedRequirementManifest,
  createPlanningTargetCatalog,
} from "./recovery-manifests";
import {
  PlanningRecoveryEvidenceSchema,
  PlanningRecoveryProviderResultSchema,
  PlanningRecoveryPlanSchema,
} from "./recovery";
import { PlanningRecoveryRunSchema } from "./recovery-runs";
import { PlannerArchitectService } from "./service";
import { FakePlannerMemoryPort } from "./memory";

const timestamp = "2026-08-31T12:00:00.000Z";

function canonicalBrief(requirementCount = 8, excluded = false, category: "FEATURE" | "ADMINISTRATION" = "FEATURE"): CanonicalBriefV3 {
  const requirements = Array.from({ length: requirementCount }, (_, index) => ({
    id: `REQUIREMENT:synthetic-acceptance-${String(index).padStart(3, "0")}`,
    category: excluded && index === requirementCount - 1 ? "LEGAL_FACT" as const : category,
    statement: `Preserve synthetic Planning responsibility ${index + 1}.`,
    sourceRefs: [`fixture:acceptance:${index}`],
  }));
  return CanonicalBriefV3Schema.parse({
    ...cleanBriefV3,
    requirements,
    decisions: { ...cleanBriefV3.decisions, form: { ...cleanBriefV3.decisions.form, interactionStates: [] } },
    seo: { ...cleanBriefV3.seo, locationTargeting: [] },
  });
}

function plannerInput(brief: CanonicalBriefV3, projectId: string): PlannerAgentInput {
  const approvedBrief = RequirementSpecificationSchema.parse({
    ...representativeV1Brief,
    projectId,
    projectVersion: 1,
    approval: { approved: true, approvedRequirementsChecksum: canonicalBriefChecksum(brief) },
    briefStatus: "approved",
  });
  return {
    projectId,
    projectVersion: 1,
    approvedBrief,
    canonicalBrief: brief,
    approvedBriefChecksum: canonicalBriefChecksum(brief),
    originalPromptReference: "synthetic-acceptance-evidence",
    clarificationEvidenceReferences: [],
    currentWorkflowState: "AWAITING_DESIGN_SELECTION",
    existingDecisions: [],
    suppliedFiles: [],
    allowedSkills: [],
    idempotencyKey: `synthetic-acceptance-evidence-${projectId}`,
    expectedRowVersion: 1,
  };
}

function accountingFor(brief: CanonicalBriefV3, candidate: PlanningPackage) {
  const routeManifest = createCanonicalPlanningRouteManifest(brief);
  const manifest = createPlanningOwnedRequirementManifest(brief);
  const catalog = createPlanningTargetCatalog(routeManifest);
  const section = catalog.targets.find((target) => target.kind === "section" && target.section === "productScope")!;
  const semanticAccounting = Object.fromEntries(manifest.requirements.map((entry, index) => [entry.requirementHandle, {
    disposition: "OTHER_PLANNING_RESPONSIBILITY" as const,
    planningTargetRefs: [{ targetHandle: section.targetHandle }],
    semanticEvidence: `Synthetic accepted semantic evidence ${index + 1}.`,
  }]));
  return { canonicalBrief: brief, routeManifest, manifest, targetCatalog: catalog, semanticAccounting, candidate };
}

function candidateFor(brief: CanonicalBriefV3, projectId = randomUUID(), clearBlockers = false) {
  const input = plannerInput(brief, projectId);
  const base = buildPlanningPackage(input);
  const manifest = createPlanningOwnedRequirementManifest(brief);
  const candidate = PlanningPackageSchema.parse({
    ...base,
    ...(clearBlockers ? { blockers: [] } : {}),
    traceability: [...base.traceability, {
      decisionId: randomUUID(),
      category: "synthetic-acceptance-accounting",
      requirementReferences: manifest.requirements.map((entry) => entry.requirementId),
      systemConstraintReferences: ["synthetic-acceptance-evidence"],
      rationale: "Synthetic host traceability for acceptance projection tests.",
      confidence: "high",
      userConfirmationRequired: false,
    }],
  });
  return { input, candidate };
}

describe("host-owned Planning Acceptance evidence projection", () => {
  it("projects every Planning-owned accounting entry exactly once without a second provider coverage array", () => {
    const brief = canonicalBrief(118);
    const fixture = candidateFor(brief);
    const accounting = accountingFor(brief, fixture.candidate);
    const projection = projectPlanningAcceptanceCoverageFromRecoveryAccounting(accounting);

    expect(createPlanningOwnedRequirementManifest(brief).requirements).toHaveLength(118);
    expect(projection.entries).toHaveLength(118);
    expect(new Set(projection.entries.map((entry) => entry.requirementId)).size).toBe(118);
    expect(projection.coverage).toEqual([]);
    expect(projection.blockers).toEqual([]);
    expect(projection.entries.every((entry) => entry.semanticEvidence.startsWith("Synthetic accepted semantic evidence"))).toBe(true);
    expect(projection.entries.every((entry) => entry.planningTargetRefs.length > 0)).toBe(true);
  });

  it("uses host manifest identities and resolved targets, while the old package scan reports the stale false blockers", () => {
    const brief = canonicalBrief(25, false, "ADMINISTRATION");
    const fixture = candidateFor(brief);
    const staleCandidate = PlanningPackageSchema.parse({
      ...fixture.candidate,
      productScope: { ...fixture.candidate.productScope, inScopeCapabilities: [] },
    });
    const accounting = accountingFor(brief, staleCandidate);
    const oldFindings = validatePlanningRequirementCoverage({ candidate: staleCandidate, canonicalBrief: brief });
    const projection = projectPlanningAcceptanceCoverageFromRecoveryAccounting(accounting);
    const admitted = admitPlanningRefresh({
      candidate: staleCandidate,
      current: staleCandidate,
      canonicalBrief: brief,
      projectId: fixture.input.projectId,
      projectVersion: 1,
      approvedBriefChecksum: fixture.input.approvedBriefChecksum,
      timestamp,
      requirementCoverage: projection.coverage,
    });

    expect(oldFindings.filter((finding) => finding.reason === "MISSING_SEMANTIC_EVIDENCE")).toHaveLength(25);
    expect(projection.entries.map((entry) => entry.requirementId)).toEqual(accounting.manifest.requirements.map((entry) => entry.requirementId));
    expect(projection.entries[0]?.requirementId).toBe(accounting.manifest.requirements[0]?.requirementId);
    expect(projection.entries[0]?.planningTargetRefs[0]).toEqual(expect.objectContaining({ kind: "section", section: "productScope" }));
    expect(admitted.coverage).toEqual([]);
    expect(admitted.blockers).toEqual([]);
    expect(Object.keys(staleCandidate).includes("coverage")).toBe(false);
  });

  it("keeps missing, empty, and placeholder accounting evidence blocking", () => {
    const brief = canonicalBrief(4);
    const fixture = candidateFor(brief);
    const accounting = accountingFor(brief, fixture.candidate);
    const entries = Object.entries(accounting.semanticAccounting);
    const missing = projectPlanningAcceptanceCoverageFromRecoveryAccounting({ ...accounting, semanticAccounting: Object.fromEntries(entries.slice(0, -1)) });
    const empty = projectPlanningAcceptanceCoverageFromRecoveryAccounting({ ...accounting, semanticAccounting: { ...accounting.semanticAccounting, [entries[0]![0]]: { ...entries[0]![1], semanticEvidence: " " } } });
    const placeholder = projectPlanningAcceptanceCoverageFromRecoveryAccounting({ ...accounting, semanticAccounting: { ...accounting.semanticAccounting, [entries[0]![0]]: { ...entries[0]![1], semanticEvidence: "handled" } } });

    expect(missing.coverage).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "MISSING_SEMANTIC_EVIDENCE" })]));
    expect(missing.blockers.length).toBeGreaterThan(0);
    expect(empty.coverage.length).toBeGreaterThan(0);
    expect(empty.blockers.length).toBeGreaterThan(0);
    expect(placeholder.blockers).toEqual(expect.arrayContaining([expect.stringContaining("PLACEHOLDER_SEMANTIC_EVIDENCE")]));
  });

  it("excludes later-owned domains and preserves explicit canonical target bindings", () => {
    const brief = canonicalBrief(5, true);
    const fixture = candidateFor(brief);
    const accounting = accountingFor(brief, fixture.candidate);
    const projected = projectPlanningAcceptanceCoverageFromRecoveryAccounting(accounting);
    expect(accounting.manifest.requirements).toHaveLength(4);
    expect(projected.entries).toHaveLength(4);
    expect(projected.entries.every((entry) => entry.category !== "LEGAL_FACT")).toBe(true);

    const boundRoute = accounting.routeManifest.routes[0]!;
    const routeManifest = {
      ...accounting.routeManifest,
      routes: accounting.routeManifest.routes.map((route, index) => index === 0 ? { ...route, requirementIds: [accounting.manifest.requirements[0]!.requirementId] } : route),
    };
    const boundCatalog = createPlanningTargetCatalog(routeManifest);
    const routeTarget = boundCatalog.targets.find((target) => target.kind === "route" && target.routeHandle === boundRoute.routeHandle)!;
    const withBinding = { ...accounting.semanticAccounting, [accounting.manifest.requirements[0]!.requirementHandle]: { ...accounting.semanticAccounting[accounting.manifest.requirements[0]!.requirementHandle]!, planningTargetRefs: [{ targetHandle: routeTarget.targetHandle }] } };
    const bound = projectPlanningAcceptanceCoverageFromRecoveryAccounting({ ...accounting, semanticAccounting: withBinding, routeManifest, targetCatalog: boundCatalog });
    expect(bound.blockers).toEqual([]);
    expect(bound.entries[0]?.planningTargetRefs).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "route", routeHandle: boundRoute.routeHandle })]));
  });

  it("accepts through the normal service using only a current durable recovery result", async () => {
    const projectId = randomUUID();
    const brief = canonicalBrief(8);
    const fixture = candidateFor(brief, projectId, true);
    const accounting = accountingFor(brief, fixture.candidate);
    const briefDocument = createBriefV3Document({ projectId, projectVersion: 1, brief, createdAt: timestamp, updatedAt: timestamp });
    const approvedBrief = BriefV3DocumentSchema.parse({ ...briefDocument, approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-user", approvedCanonicalChecksum: briefDocument.briefChecksum } });
    const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "synthetic-acceptance-projection", origin: "SYNTHETIC", siteLanguage: "en", originalPrompt: "Synthetic acceptance projection fixture.", currentVersion: 1, workflowState: "AWAITING_DESIGN_SELECTION" });
    const database = new InMemoryPersistenceDatabase();
    await new ProjectRepository(database).create(project);
    const versionId = randomUUID();
    await new ProjectVersionRepository(database).create({ id: versionId, projectId, versionNumber: 1, state: "AWAITING_DESIGN_SELECTION", memoryRootPath: null, requirementsChecksum: approvedBrief.briefChecksum, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
    const documents = new DocumentRepository(database);
    await documents.save(approvedBrief);
    await documents.save(fixture.candidate);
    await documents.save(fixture.candidate.architecture);
    await documents.save(fixture.candidate.content);
    await documents.save(fixture.candidate.assets);
    const planningRow = await documents.getWithMetadata(projectId, 1, "planning-package");
    const routeManifest = accounting.routeManifest;
    const planPayload = {
      schemaVersion: 1 as const,
      authority: "PLANNING_RECOVERY" as const,
      mode: "FULL_PLANNING_REBUILD" as const,
      policyVersion: "planning-recovery-v1" as const,
      projectId,
      projectVersion: 1,
      versionId,
      recoveryReason: "UNRECOVERABLE_CURRENT_PLANNING_STATE" as const,
      sourceHead: "a".repeat(40),
      currentness: { projectId, projectVersion: 1, projectRowVersion: 1, projectVersionRowVersion: 1, workflowState: "AWAITING_DESIGN_SELECTION" as const, briefRowVersion: 1, briefSemanticChecksum: approvedBrief.briefChecksum, briefDocumentChecksum: checksumPersistedDocument(approvedBrief), planningRowVersion: 1, planningSemanticChecksum: planningSemanticChecksum(fixture.candidate), planningDocumentChecksum: planningDocumentChecksum(fixture.candidate), planningSemanticChecksumPolicy: fixture.candidate.semanticChecksumPolicyVersion!, planningApprovedBriefChecksum: fixture.candidate.approvedBriefChecksum, planningAccepted: false as const },
      briefChecksum: approvedBrief.briefChecksum,
      routePolicy: brief.decisions.routePolicy.mode,
      decisions: brief.decisions,
      planningOwnedRequirementIds: accounting.manifest.requirements.map((entry) => entry.requirementId),
      canonicalRouteManifest: routeManifest,
      planningRequirementManifest: accounting.manifest,
      planningTargetCatalog: accounting.targetCatalog,
      reconciliationScopeChecksum: "b".repeat(64),
      providerCapability: { contractVersion: 2 as const, outputMode: "FULL_PLANNING_PACKAGE" as const, canonicalBriefIsSoleSemanticAuthority: true as const, hostOwnedFields: ["projectId", "projectVersion", "approvedBriefChecksum", "semanticChecksumPolicyVersion", "accepted", "acceptance", "routePolicy", "timestamps", "decisionIds", "sourceHead"] as const, forbiddenProviderActions: ["mutateCanonicalBrief", "mutateProject", "mutateWorkflow", "writePersistence", "approvePlanning", "inventRequirementIds", "inventBusinessFacts"] as const },
    };
    const plan = PlanningRecoveryPlanSchema.parse({ ...planPayload, planChecksum: checksumPersistedDocument(planPayload) });
    const providerResult = PlanningRecoveryProviderResultSchema.parse({ planningPackage: fixture.candidate, requirementAccounting: accounting.semanticAccounting });
    const evidence = PlanningRecoveryEvidenceSchema.parse({ id: randomUUID(), operationKey: "synthetic-accepted-recovery", projectId, projectVersion: 1, recoveryPlanChecksum: plan.planChecksum, briefRowVersion: 1, briefSemanticChecksum: approvedBrief.briefChecksum, briefDocumentChecksum: checksumPersistedDocument(approvedBrief), priorPlanningRowVersion: 1, priorPlanningSemanticChecksum: planningSemanticChecksum(fixture.candidate), priorPlanningDocumentChecksum: planningDocumentChecksum(fixture.candidate), priorPlanningPackage: fixture.candidate, nextPlanningRowVersion: planningRow!.rowVersion, nextPlanningSemanticChecksum: planningSemanticChecksum(fixture.candidate), nextPlanningDocumentChecksum: planningRow!.checksum, createdAt: timestamp });
    const run = PlanningRecoveryRunSchema.parse({ runId: randomUUID(), operationKey: evidence.operationKey, projectId, projectVersion: 1, versionId, expectedSourceHead: plan.sourceHead, recoveryPlanChecksum: plan.planChecksum, recoveryPlan: plan, projectRowVersion: 1, projectVersionRowVersion: 1, briefRowVersion: 1, briefSemanticChecksum: approvedBrief.briefChecksum, briefDocumentChecksum: checksumPersistedDocument(approvedBrief), planningRowVersion: 1, planningSemanticChecksum: planningSemanticChecksum(fixture.candidate), planningDocumentChecksum: planningDocumentChecksum(fixture.candidate), providerBudget: 1, providerAttemptCount: 1, state: "COMMITTED", providerResultChecksum: checksumPersistedDocument(providerResult), providerResult, providerRequestId: "synthetic-request", providerModel: "synthetic-model", providerErrorClass: null, providerErrorCode: null, diagnosticStage: null, diagnosticCode: null, diagnosticMessage: null, diagnosticSummary: null, leaseOwner: null, leaseExpiresAt: null, terminalOutcome: "COMMITTED", committedEvidenceId: evidence.id, projectMemoryStatus: "SYNCED", projectMemoryFailureCode: null, projectMemoryFailureMessage: null, createdAt: timestamp, updatedAt: timestamp });
    await database.transaction(async (tx) => { await tx.appendPlanningRecoveryEvidence(evidence); await tx.createPlanningRecoveryRun(run); });

    const service = new PlannerArchitectService({ database, memory: new FakePlannerMemoryPort(), provider: { plan: async () => { throw new Error("PLANNING_PROVIDER_MUST_NOT_RUN"); } } });
    const validation = await service.validatePlanningPackage(projectId, 1);
    expect(validation.ready).toBe(true);
    expect(validation.blockers).toEqual([]);
    const accepted = await service.acceptPlanningPackage({ projectId, projectVersion: 1, planningChecksum: planningRow!.checksum, acceptedBy: "synthetic-user", acceptedAt: "2026-08-31T12:01:00.000Z", expectedRowVersion: 1, idempotencyKey: "synthetic-acceptance-projection-commit" });
    expect(accepted.projectState).toBe("ARCHITECTURE_REVIEW");
    expect(accepted.package.accepted).toBe(true);
    expect((await database.transaction((tx) => tx.listDecisions(projectId, 1)))).toHaveLength(1);
  });
});
