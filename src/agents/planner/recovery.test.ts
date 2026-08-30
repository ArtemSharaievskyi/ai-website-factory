import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cleanBriefV3, representativeV1Brief } from "@/domain/requirements/v3/fixtures";
import { CanonicalBriefV3Schema, type CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import { canonicalRequirementEntries, createV3RequirementId, mapCanonicalBriefRequirementIds } from "@/domain/requirements/v3/identity";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { createBriefV3Document, BriefV3DocumentSchema } from "@/persistence/database/brief-revision-v3-contracts";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { buildPlanningPackage } from "./deterministic";
import { admitPlanningRefresh, normalizePlanningPackageForHost, validatePlanningRequirementCoverage } from "./refresh-admission";
import { FakePlannerMemoryPort } from "./memory";
import { PlanningRecoveryService, type PlanningRecoveryProvider } from "./recovery";
import { CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY, planningSemanticChecksumForPolicy } from "./semantic-checksum";
import { buildPhase7CContractPackage } from "@/domain/contracts/phase7c";

const timestamp = "2026-08-30T10:00:00.000Z";
const MOEBELTRANSPORT_REQUIREMENT_IDS = [
  "REQUIREMENT:v3-3f2c7ef23496aad4105640e2518751f5a584903a08aeb6348b334dd2a8ba484e",
  "REQUIREMENT:v3-a9fea3b4a2f500a53b942e2113c6fa649f8a47bfa52704f55a9f6898ae63d93f",
] as const;

function brief(overrides: Partial<CanonicalBriefV3> = {}) {
  const value = CanonicalBriefV3Schema.parse({ ...cleanBriefV3, ...overrides });
  const mappings = new Map(canonicalRequirementEntries(value).map((entry, index) => [entry.id, /^REQUIREMENT:v3-[a-f0-9]{64}$/.test(entry.id) ? entry.id : createV3RequirementId({ projectId: "99999999-9999-4999-8999-999999999999", projectVersion: 1, stableSemanticKey: `recovery:${index}:${entry.id}` })]));
  return mapCanonicalBriefRequirementIds(value, mappings);
}

function plannerInput(projectId: string, currentBrief: CanonicalBriefV3) {
  const compatibility = RequirementSpecificationSchema.parse({
    ...representativeV1Brief,
    projectId,
    projectVersion: 1,
    approval: { approved: true, approvedRequirementsChecksum: canonicalBriefChecksum(currentBrief) },
    briefStatus: "approved",
  });
  return {
    projectId,
    projectVersion: 1,
    approvedBrief: compatibility,
    canonicalBrief: currentBrief,
    approvedBriefChecksum: canonicalBriefChecksum(currentBrief),
    originalPromptReference: "synthetic-recovery-prompt",
    clarificationEvidenceReferences: [],
    currentWorkflowState: "AWAITING_DESIGN_SELECTION" as const,
    existingDecisions: [],
    suppliedFiles: [],
    allowedSkills: [],
    idempotencyKey: randomUUID(),
    expectedRowVersion: 1,
  };
}

function multiPageBrief() {
  return brief({
    pages: [...cleanBriefV3.pages, { id: "PAGE:services", slug: "services", purpose: "Explain the synthetic service options.", sourceRefs: ["fixture:services"] }],
    decisions: { ...cleanBriefV3.decisions, routePolicy: { mode: "MULTI_PAGE" } },
  });
}

function privacyRequiredBrief() {
  return brief({
    requirements: [...cleanBriefV3.requirements, { id: "REQUIREMENT:privacy-consent", category: "LEGAL_FACT", statement: "Use the approved privacy consent wording.", sourceRefs: ["fixture:privacy"] }],
    decisions: {
      ...cleanBriefV3.decisions,
      form: {
        mode: "SIMULATED",
        formPresent: true,
        validation: "ACTIVE",
        simulatedSuccessPolicy: "ALLOWED",
        transmissionMode: "NONE",
        persistenceMode: "NONE",
        serverProcessingMode: "NONE",
        externalProviderMode: "NONE",
        privacyConsentMode: "REQUIRED",
        interactionStates: [],
      },
    },
  });
}

async function seeded(input: { currentBrief: CanonicalBriefV3; packageBrief?: CanonicalBriefV3; historyFrom?: CanonicalBriefV3; seedDownstream?: boolean }) {
  const database = new InMemoryPersistenceDatabase();
  const projectId = randomUUID();
  const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "synthetic-recovery", originalPrompt: "Synthetic recovery fixture.", currentVersion: 1, workflowState: "AWAITING_DESIGN_SELECTION" });
  await new ProjectRepository(database).create(project);
  await new ProjectVersionRepository(database).create({ id: randomUUID(), projectId, versionNumber: 1, state: "AWAITING_DESIGN_SELECTION", memoryRootPath: null, requirementsChecksum: canonicalBriefChecksum(input.currentBrief), selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
  const briefDocument = createBriefV3Document({ projectId, projectVersion: 1, brief: input.currentBrief, createdAt: timestamp, updatedAt: timestamp });
  await new DocumentRepository(database).save(BriefV3DocumentSchema.parse({ ...briefDocument, approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-user", approvedCanonicalChecksum: briefDocument.briefChecksum } }));
  const packageBrief = input.packageBrief ?? input.currentBrief;
  const packageValue = buildPlanningPackage(plannerInput(projectId, packageBrief));
  const currentPackage = normalizePlanningPackageForHost({ candidate: packageValue, projectId, projectVersion: 1, approvedBriefChecksum: canonicalBriefChecksum(input.historyFrom ?? input.currentBrief), canonicalBrief: input.currentBrief, timestamp });
  await new DocumentRepository(database).save(currentPackage);
  if (input.seedDownstream) {
    await new DocumentRepository(database).save(currentPackage.architecture);
    await new DocumentRepository(database).save(currentPackage.content);
    await new DocumentRepository(database).save(currentPackage.assets);
    await new DocumentRepository(database).save(buildPhase7CContractPackage({ projectId, projectVersion: 1, createdAt: timestamp, approvedBriefChecksum: currentPackage.approvedBriefChecksum, planningChecksum: planningSemanticChecksumForPolicy(currentPackage, CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY), architectureChecksum: checksumPersistedDocument(currentPackage.architecture), designChecksum: "0".repeat(64), planning: currentPackage }));
  }
  if (input.historyFrom) database.briefRevisionHistory.set(randomUUID(), { id: randomUUID(), attemptId: randomUUID(), projectId, projectVersion: 1, revisionReference: "synthetic-history", previousCurrentChecksum: canonicalBriefChecksum(input.historyFrom), nextCurrentChecksum: canonicalBriefChecksum(input.currentBrief), changeSetChecksum: checksumPersistedDocument({ from: input.historyFrom, to: input.currentBrief }), entries: [{ target: input.currentBrief.requirements.at(-1)?.id ?? "REQUIREMENT:service", operation: "ADD" }], createdAt: timestamp });
  return { database, projectId, currentBrief: input.currentBrief, currentPackage };
}

function provider(): PlanningRecoveryProvider {
  return { planRecovery: async (input) => buildPlanningPackage(input.plannerInput) };
}

function service(fixture: Awaited<ReturnType<typeof seeded>>, options: Partial<ConstructorParameters<typeof PlanningRecoveryService>[0]> = {}) {
  return new PlanningRecoveryService({ database: fixture.database, memory: new FakePlannerMemoryPort(), provider: provider(), hostRecoveryEnabled: true, now: () => timestamp, ...options });
}

describe("host-owned full Planning recovery", () => {
  it("CASE A denies recovery when an append-only historical delta is reconstructable", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:recovery-history", category: "FEATURE", statement: "Provide the historical recovery capability.", sourceRefs: ["fixture:history"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base, historyFrom: base });
    const prepared = await service(fixture).prepare({ projectId: fixture.projectId, projectVersion: 1, operationKey: "case-a" });
    expect(prepared.eligibility).toMatchObject({ eligible: false, reason: "HISTORICAL_DELTA_AVAILABLE" });
  });

  it("CASE B denies recovery when bounded reconciliation is sufficient", async () => {
    const currentBrief = privacyRequiredBrief();
    const fixture = await seeded({ currentBrief });
    const prepared = await service(fixture).prepare({ projectId: fixture.projectId, projectVersion: 1, operationKey: "case-b" });
    expect(prepared.eligibility).toMatchObject({ eligible: false, reason: "BOUNDED_RECONCILIATION_SUFFICIENT" });
  });

  it("CASE C admits a recovery candidate only after current-state coverage is incomplete", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:recovery-missing", category: "FEATURE", statement: "Provide the missing recovery capability.", sourceRefs: ["fixture:missing"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    const prepared = await service(fixture).prepare({ projectId: fixture.projectId, projectVersion: 1, operationKey: "case-c" });
    expect(prepared.eligibility).toMatchObject({ eligible: true, reason: "RECOVERY_REQUIRED", planningOwnedRequirementCount: expect.any(Number) });
    expect(prepared.eligibility.currentCoverage).toEqual(expect.arrayContaining([expect.objectContaining({ requirementId: next.requirements.at(-1)!.id })]));
  });

  it("preserves both current Möbeltransport requirement handles in the recovery scope", async () => {
    const currentBrief = brief({ requirements: [...cleanBriefV3.requirements, ...MOEBELTRANSPORT_REQUIREMENT_IDS.map((id, index) => ({ id, category: "FEATURE" as const, statement: `Möbeltransport scope requirement ${index + 1} remains represented in Planning.`, sourceRefs: [`fixture:moebeltransport:${index + 1}`] }))] });
    const fixture = await seeded({ currentBrief, packageBrief: brief() });
    const prepared = await service(fixture).prepare({ projectId: fixture.projectId, projectVersion: 1, operationKey: "moebeltransport-scope" });
    expect(prepared.eligibility.eligible).toBe(true);
    expect(prepared.plan?.planningOwnedRequirementIds).toEqual(expect.arrayContaining([...MOEBELTRANSPORT_REQUIREMENT_IDS]));
    expect(prepared.providerInput?.planningOwnedRequirements.map((entry) => entry.id)).toEqual(expect.arrayContaining([...MOEBELTRANSPORT_REQUIREMENT_IDS]));
    const candidate = normalizePlanningPackageForHost({ candidate: buildPlanningPackage(plannerInput(fixture.projectId, currentBrief)), projectId: fixture.projectId, projectVersion: 1, approvedBriefChecksum: canonicalBriefChecksum(currentBrief), canonicalBrief: currentBrief, timestamp });
    expect(validatePlanningRequirementCoverage({ candidate, canonicalBrief: currentBrief })).toEqual([]);
  });

  it("CASE D derives route authority from a valid multi-page Brief", () => {
    const currentBrief = multiPageBrief();
    const projectId = randomUUID();
    const candidate = buildPlanningPackage(plannerInput(projectId, currentBrief));
    const admission = admitPlanningRefresh({ candidate, canonicalBrief: currentBrief, projectId, projectVersion: 1, approvedBriefChecksum: canonicalBriefChecksum(currentBrief), timestamp });
    expect(admission.blockers).not.toContain("PLANNING_ROUTE_POLICY_MISMATCH");
    expect(admission.candidate.sitemap.routes.map((route) => route.path)).toEqual(["/", "/services"]);
  });

  it("preserves single-page route authority and rejects a provider multi-page override", () => {
    const currentBrief = brief();
    const projectId = randomUUID();
    const candidate = buildPlanningPackage(plannerInput(projectId, currentBrief));
    const admission = admitPlanningRefresh({ candidate, canonicalBrief: currentBrief, projectId, projectVersion: 1, approvedBriefChecksum: canonicalBriefChecksum(currentBrief), timestamp });
    expect(admission.blockers).not.toContain("PLANNING_ROUTE_POLICY_MISMATCH");
    expect(admission.candidate.sitemap.routes.map((route) => route.path)).toEqual(["/"]);
    expect(() => admitPlanningRefresh({ candidate: { ...candidate, routePolicy: "MULTI_PAGE" }, canonicalBrief: currentBrief, projectId, projectVersion: 1, approvedBriefChecksum: canonicalBriefChecksum(currentBrief), timestamp })).toThrow("PLANNING_ROUTE_POLICY_PROVIDER_MISMATCH");
  });

  it("CASE E rejects a provider-authored route mode that conflicts with the current Brief", () => {
    const currentBrief = multiPageBrief();
    const projectId = randomUUID();
    const candidate = { ...buildPlanningPackage(plannerInput(projectId, currentBrief)), routePolicy: "SINGLE_PAGE" as const };
    expect(() => admitPlanningRefresh({ candidate, canonicalBrief: currentBrief, projectId, projectVersion: 1, approvedBriefChecksum: canonicalBriefChecksum(currentBrief), timestamp })).toThrow("PLANNING_ROUTE_POLICY_PROVIDER_MISMATCH");
  });

  it("CASE F rejects incomplete full-package coverage without writing evidence", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:recovery-incomplete", category: "FEATURE", statement: "Provide the incomplete recovery capability.", sourceRefs: ["fixture:incomplete"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    const recovery = service(fixture);
    const prepared = await recovery.prepare({ projectId: fixture.projectId, projectVersion: 1, operationKey: "case-f" });
    const candidate = fixture.currentPackage;
    await expect(recovery.apply({ projectId: fixture.projectId, projectVersion: 1, operationKey: "case-f", plan: prepared.plan!, candidate })).rejects.toMatchObject({ code: "RECOVERY_CANDIDATE_INVALID" });
    expect(fixture.database.planningRecoveryEvidence.size).toBe(0);
  });

  it("CASE G rejects invented requirement references", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:recovery-reference", category: "FEATURE", statement: "Provide the reference recovery capability.", sourceRefs: ["fixture:reference"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    const recovery = service(fixture);
    const prepared = await recovery.prepare({ projectId: fixture.projectId, projectVersion: 1, operationKey: "case-g" });
    const complete = buildPlanningPackage(plannerInput(fixture.projectId, next));
    const candidate = { ...complete, traceability: complete.traceability.map((entry, index) => index === 0 ? { ...entry, requirementReferences: [...entry.requirementReferences, "REQUIREMENT:v3-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"] } : entry) };
    await expect(recovery.apply({ projectId: fixture.projectId, projectVersion: 1, operationKey: "case-g", plan: prepared.plan!, candidate })).rejects.toThrow(/PLANNING_TRACEABILITY_UNKNOWN_REFERENCE|RECOVERY_CANDIDATE_INVALID/);
    expect(fixture.database.planningRecoveryEvidence.size).toBe(0);
  });

  it("CASE H rejects backend capability added to a no-backend Brief", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:recovery-backend", category: "FEATURE", statement: "Provide the backend recovery capability.", sourceRefs: ["fixture:backend"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    const recovery = service(fixture);
    const prepared = await recovery.prepare({ projectId: fixture.projectId, projectVersion: 1, operationKey: "case-h" });
    const complete = buildPlanningPackage(plannerInput(fixture.projectId, next));
    const candidate = { ...complete, architecture: { ...complete.architecture, backendPriority: ["server-actions"] as ["server-actions"] } };
    await expect(recovery.apply({ projectId: fixture.projectId, projectVersion: 1, operationKey: "case-h", plan: prepared.plan!, candidate })).rejects.toMatchObject({ code: "RECOVERY_CANDIDATE_INVALID" });
    expect(fixture.database.planningRecoveryEvidence.size).toBe(0);
  });

  it("rejects an unsupported invented business fact without writing recovery evidence", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:recovery-fact", category: "FEATURE", statement: "Provide the fact-check recovery capability.", sourceRefs: ["fixture:fact"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    const recovery = service(fixture);
    const prepared = await recovery.prepare({ projectId: fixture.projectId, projectVersion: 1, operationKey: "unsupported-fact" });
    const complete = buildPlanningPackage(plannerInput(fixture.projectId, next));
    const candidate = { ...complete, productScope: { ...complete.productScope, inScopeCapabilities: [...complete.productScope.inScopeCapabilities, "Guaranteed nationwide insurance coverage"] } };
    await expect(recovery.apply({ projectId: fixture.projectId, projectVersion: 1, operationKey: "unsupported-fact", plan: prepared.plan!, candidate })).rejects.toMatchObject({ code: "RECOVERY_CANDIDATE_INVALID" });
    expect(fixture.database.planningRecoveryEvidence.size).toBe(0);
  });

  it("CASE I admits a complete recovery candidate with full Planning-owned coverage", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:recovery-admitted", category: "FEATURE", statement: "Provide the admitted recovery capability.", sourceRefs: ["fixture:admitted"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    const candidate = normalizePlanningPackageForHost({ candidate: buildPlanningPackage(plannerInput(fixture.projectId, next)), projectId: fixture.projectId, projectVersion: 1, approvedBriefChecksum: canonicalBriefChecksum(next), canonicalBrief: next, timestamp });
    expect(validatePlanningRequirementCoverage({ candidate, canonicalBrief: next })).toEqual([]);
    const admission = admitPlanningRefresh({ candidate, current: fixture.currentPackage, canonicalBrief: next, projectId: fixture.projectId, projectVersion: 1, approvedBriefChecksum: canonicalBriefChecksum(next), timestamp });
    expect(admission.blockers).toEqual([]);
  });

  it("CASE J commits a complete recovery atomically and preserves the prior package as evidence", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:recovery-complete", category: "FEATURE", statement: "Provide the complete recovery capability.", sourceRefs: ["fixture:complete"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base, seedDownstream: true });
    const memory = new FakePlannerMemoryPort();
    const recovery = new PlanningRecoveryService({ database: fixture.database, memory, provider: provider(), hostRecoveryEnabled: true, now: () => timestamp });
    const prepared = await recovery.prepare({ projectId: fixture.projectId, projectVersion: 1, operationKey: "case-i" });
    const candidate = buildPlanningPackage(plannerInput(fixture.projectId, next));
    const result = await recovery.apply({ projectId: fixture.projectId, projectVersion: 1, operationKey: "case-i", plan: prepared.plan!, candidate });
    expect(result.status).toBe("COMMITTED");
    expect(result.package.accepted).toBe(false);
    expect(result.package.approvedBriefChecksum).toBe(canonicalBriefChecksum(next));
    expect(result.evidence.priorPlanningDocumentChecksum).toBe(checksumPersistedDocument(fixture.currentPackage));
    expect(result.evidence.priorPlanningPackage).toEqual(fixture.currentPackage);
    expect(fixture.database.planningRecoveryEvidence.size).toBe(1);
    expect((await new ProjectRepository(fixture.database).get(fixture.projectId))?.workflowState).toBe("AWAITING_DESIGN_SELECTION");
    expect(memory.documents.get(`${fixture.projectId}:1`)).toEqual(expect.objectContaining({ "planning-package.json": result.package }));
    const architecture = await new DocumentRepository(fixture.database).get(fixture.projectId, 1, "architecture");
    const phase7c = await new DocumentRepository(fixture.database).get(fixture.projectId, 1, "phase-7c-contract-package");
    expect(architecture).toEqual(fixture.currentPackage.architecture);
    expect(phase7c).toMatchObject({ planningChecksum: expect.not.stringMatching(result.evidence.nextPlanningSemanticChecksum) });
  });

  it("rolls back package and evidence writes when the atomic boundary fails", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:recovery-rollback", category: "FEATURE", statement: "Provide the rollback recovery capability.", sourceRefs: ["fixture:rollback"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    const before = checksumPersistedDocument(fixture.currentPackage);
    const recovery = service(fixture, { fault: { hit: (point) => { if (point === "after-package-write") throw new Error("synthetic-recovery-fault"); } } });
    const prepared = await recovery.prepare({ projectId: fixture.projectId, projectVersion: 1, operationKey: "case-j" });
    const candidate = buildPlanningPackage(plannerInput(fixture.projectId, next));
    await expect(recovery.apply({ projectId: fixture.projectId, projectVersion: 1, operationKey: "case-j", plan: prepared.plan!, candidate })).rejects.toThrow("synthetic-recovery-fault");
    const current = await new DocumentRepository(fixture.database).get(fixture.projectId, 1, "planning-package");
    expect(current && checksumPersistedDocument(current)).toBe(before);
    expect(fixture.database.planningRecoveryEvidence.size).toBe(0);
  });

  it("does not spend on a provider when recovery eligibility is denied", async () => {
    const fixture = await seeded({ currentBrief: privacyRequiredBrief() });
    let calls = 0;
    const recovery = service(fixture, { provider: { planRecovery: async () => { calls += 1; throw new Error("must-not-call"); } } });
    await expect(recovery.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "denied" })).rejects.toMatchObject({ code: "BOUNDED_RECONCILIATION_SUFFICIENT" });
    expect(calls).toBe(0);
  });

  it("denies recovery when the approved Brief still contains an unresolved semantic decision", async () => {
    const currentBrief = brief({ decisions: { ...cleanBriefV3.decisions, database: { mode: "UNRESOLVED" } } });
    const fixture = await seeded({ currentBrief });
    const prepared = await service(fixture).prepare({ projectId: fixture.projectId, projectVersion: 1, operationKey: "missing-decision" });
    expect(prepared.eligibility).toMatchObject({ eligible: false, reason: "CANONICAL_UNRESOLVED" });
    expect(prepared.eligibility.blockers).toContain("RECOVERY_MISSING_USER_DECISION:DATABASE_MODE");
  });

  it("keeps the current semantic checksum policy host-owned", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:recovery-policy", category: "FEATURE", statement: "Provide the policy recovery capability.", sourceRefs: ["fixture:policy"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    const prepared = await service(fixture).prepare({ projectId: fixture.projectId, projectVersion: 1, operationKey: "policy" });
    expect(prepared.plan?.currentness.planningSemanticChecksumPolicy).toBe(CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY);
    expect(prepared.providerInput?.contextPolicy).toMatchObject({ lossless: true, omittedSemanticFields: [] });
  });
});
