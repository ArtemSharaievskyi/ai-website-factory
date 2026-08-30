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
import { PlanningRecoveryCrash, PlanningRecoveryService, type PlanningRecoveryProvider } from "./recovery";
import { CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY, planningSemanticChecksumForPolicy } from "./semantic-checksum";
import { buildPhase7CContractPackage } from "@/domain/contracts/phase7c";
import { createStaticSourceCurrentnessPort } from "@/runtime/source-head";

const timestamp = "2026-08-30T10:00:00.000Z";
const TEST_SOURCE_HEAD = "a".repeat(40);
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

function completeRecoveryCandidate(input: Parameters<typeof buildPlanningPackage>[0]) {
  const candidate = buildPlanningPackage(input);
  const canonical = input.canonicalBrief;
  if (!canonical) return candidate;
  return {
    ...candidate,
    traceability: [...candidate.traceability, {
      decisionId: randomUUID(),
      category: "synthetic-recovery-coverage",
      requirementReferences: canonicalRequirementEntries(canonical).map((entry) => entry.id),
      systemConstraintReferences: ["synthetic-recovery-fixture"],
      rationale: "Synthetic recovery fixture explicitly traces every current V3 requirement.",
      confidence: "high" as const,
      userConfirmationRequired: false,
    }],
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
  return { planRecovery: async (input) => completeRecoveryCandidate(input.plannerInput) };
}

function service(fixture: Awaited<ReturnType<typeof seeded>>, options: Partial<ConstructorParameters<typeof PlanningRecoveryService>[0]> = {}) {
  return new PlanningRecoveryService({ database: fixture.database, memory: new FakePlannerMemoryPort(), provider: provider(), source: createStaticSourceCurrentnessPort(TEST_SOURCE_HEAD), hostRecoveryEnabled: true, now: () => timestamp, ...options });
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
    const candidate = completeRecoveryCandidate(plannerInput(projectId, currentBrief));
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
    const candidate = { ...completeRecoveryCandidate(plannerInput(projectId, currentBrief)), routePolicy: "SINGLE_PAGE" as const };
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
    const complete = completeRecoveryCandidate(plannerInput(fixture.projectId, next));
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
    const complete = completeRecoveryCandidate(plannerInput(fixture.projectId, next));
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
    const complete = completeRecoveryCandidate(plannerInput(fixture.projectId, next));
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
    const recovery = new PlanningRecoveryService({ database: fixture.database, memory, provider: provider(), source: createStaticSourceCurrentnessPort(TEST_SOURCE_HEAD), hostRecoveryEnabled: true, now: () => timestamp });
    const prepared = await recovery.prepare({ projectId: fixture.projectId, projectVersion: 1, operationKey: "case-i" });
    const candidate = completeRecoveryCandidate(plannerInput(fixture.projectId, next));
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
    const candidate = completeRecoveryCandidate(plannerInput(fixture.projectId, next));
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

  it("durably consumes the sole provider attempt before the call and classifies a lost outcome", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:durable-provider-attempt", category: "FEATURE", statement: "Provide the durable provider attempt fixture.", sourceRefs: ["fixture:durable-provider-attempt"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    let now = timestamp;
    let calls = 0;
    const first = service(fixture, {
      now: () => now,
      provider: { planRecovery: async (input) => { calls += 1; return completeRecoveryCandidate(input.plannerInput); } },
      fault: { hit: (point) => { if (point === "after-provider-call-started") throw new Error("detached-before-provider-call"); } },
    });
    await expect(first.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "durable-provider-attempt" })).rejects.toThrow("detached-before-provider-call");
    expect(calls).toBe(0);
    const started = await fixture.database.transaction((tx) => tx.getPlanningRecoveryRun(fixture.projectId, 1, "durable-provider-attempt"));
    expect(started).toMatchObject({ state: "PROVIDER_CALL_STARTED", providerAttemptCount: 1, providerResult: null });

    now = "2026-08-30T10:16:00.000Z";
    const second = service(fixture, { now: () => now, provider: { planRecovery: async () => { calls += 1; throw new Error("provider-retry-forbidden"); } } });
    await expect(second.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "durable-provider-attempt" })).rejects.toMatchObject({ code: "PROVIDER_ATTEMPT_ALREADY_CONSUMED" });
    expect(calls).toBe(0);
    const terminal = await fixture.database.transaction((tx) => tx.getPlanningRecoveryRun(fixture.projectId, 1, "durable-provider-attempt"));
    expect(terminal).toMatchObject({ state: "OUTCOME_INDETERMINATE", terminalOutcome: "OUTCOME_INDETERMINATE", diagnosticCode: "PROVIDER_RESULT_MISSING" });
  });

  it("resumes from a durable provider result without a second provider call", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:durable-provider-result", category: "FEATURE", statement: "Provide the durable provider result fixture.", sourceRefs: ["fixture:durable-provider-result"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    let calls = 0;
    let now = timestamp;
    const first = service(fixture, {
      now: () => now,
      provider: { planRecovery: async (input) => { calls += 1; return completeRecoveryCandidate(input.plannerInput); } },
      fault: { hit: (point) => { if (point === "after-provider-result") throw new Error("detached-after-provider-result"); } },
    });
    await expect(first.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "durable-provider-result" })).rejects.toThrow("detached-after-provider-result");
    expect(calls).toBe(1);
    const returned = await fixture.database.transaction((tx) => tx.getPlanningRecoveryRun(fixture.projectId, 1, "durable-provider-result"));
    expect(returned).toMatchObject({ state: "PROVIDER_RETURNED", providerAttemptCount: 1, providerResultChecksum: expect.stringMatching(/^[a-f0-9]{64}$/) });
    now = "2026-08-30T10:16:00.000Z";
    const second = service(fixture, { now: () => now, provider: { planRecovery: async () => { calls += 1; throw new Error("provider-retry-forbidden"); } } });
    const result = await second.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "durable-provider-result" });
    expect(result.status).toBe("COMMITTED");
    expect(calls).toBe(1);
    const committed = await fixture.database.transaction((tx) => tx.getPlanningRecoveryRun(fixture.projectId, 1, "durable-provider-result"));
    expect(committed).toMatchObject({ state: "COMMITTED", providerAttemptCount: 1, projectMemoryStatus: "SYNCED" });
  });

  it("resumes after admission and persistence boundaries using the recorded result", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:durable-boundaries", category: "FEATURE", statement: "Provide the durable boundary fixture.", sourceRefs: ["fixture:durable-boundaries"] }] });
    for (const [point, expectedState] of [["after-admission-started", "ADMISSION_STARTED"], ["after-persistence-started", "PERSISTENCE_STARTED"], ["before-db-commit", "PERSISTENCE_STARTED"]] as const) {
      const fixture = await seeded({ currentBrief: next, packageBrief: base });
      let calls = 0;
      let now = timestamp;
      const first = service(fixture, {
        now: () => now,
        provider: { planRecovery: async (input) => { calls += 1; return completeRecoveryCandidate(input.plannerInput); } },
        fault: { hit: (candidatePoint) => { if (candidatePoint === point) throw new PlanningRecoveryCrash(point); } },
      });
      await expect(first.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: `durable-boundary-${point}` })).rejects.toBeInstanceOf(PlanningRecoveryCrash);
      expect(calls).toBe(1);
      const interrupted = await fixture.database.transaction((tx) => tx.getPlanningRecoveryRun(fixture.projectId, 1, `durable-boundary-${point}`));
      expect(interrupted?.state).toBe(expectedState);
      now = "2026-08-30T10:16:00.000Z";
      const second = service(fixture, { now: () => now, provider: { planRecovery: async () => { calls += 1; throw new Error("provider-retry-forbidden"); } } });
      const result = await second.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: `durable-boundary-${point}` });
      expect(result.status).toBe("COMMITTED");
      expect(calls).toBe(1);
    }
  });

  it("makes commit replay and Project Memory projection idempotent", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:durable-replay", category: "FEATURE", statement: "Provide the durable replay fixture.", sourceRefs: ["fixture:durable-replay"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    let calls = 0;
    const memory = new FakePlannerMemoryPort();
    const first = new PlanningRecoveryService({ database: fixture.database, memory, source: createStaticSourceCurrentnessPort(TEST_SOURCE_HEAD), hostRecoveryEnabled: true, now: () => timestamp, provider: { planRecovery: async (input) => { calls += 1; return completeRecoveryCandidate(input.plannerInput); } } });
    const firstResult = await first.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "durable-replay" });
    const second = new PlanningRecoveryService({ database: fixture.database, memory, source: createStaticSourceCurrentnessPort(TEST_SOURCE_HEAD), hostRecoveryEnabled: true, now: () => timestamp, provider: { planRecovery: async () => { calls += 1; throw new Error("provider-retry-forbidden"); } } });
    const secondResult = await second.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "durable-replay" });
    expect(firstResult.status).toBe("COMMITTED");
    expect(secondResult.status).toBe("REPLAYED");
    expect(calls).toBe(1);
    const runs = await fixture.database.transaction((tx) => tx.listPlanningRecoveryRuns(fixture.projectId, 1));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ state: "COMMITTED", providerAttemptCount: 1, terminalOutcome: "COMMITTED", projectMemoryStatus: "SYNCED" });
  });

  it("rejects a late canonical commit from an expired lease", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:late-lease", category: "FEATURE", statement: "Provide the late lease fixture.", sourceRefs: ["fixture:late-lease"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    let now = timestamp;
    let calls = 0;
    const first = service(fixture, {
      now: () => now,
      provider: { planRecovery: async (input) => { calls += 1; return completeRecoveryCandidate(input.plannerInput); } },
      fault: { hit: (point) => { if (point === "after-persistence-started") now = "2026-08-30T10:16:00.000Z"; } },
    });
    await expect(first.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "late-lease" })).rejects.toMatchObject({ code: "RECOVERY_RUN_LEASE_STALE" });
    const expired = await fixture.database.transaction((tx) => tx.getPlanningRecoveryRun(fixture.projectId, 1, "late-lease"));
    expect(expired).toMatchObject({ state: "PERSISTENCE_STARTED", providerAttemptCount: 1 });
    const second = service(fixture, { now: () => now, provider: { planRecovery: async () => { calls += 1; throw new Error("provider-retry-forbidden"); } } });
    await expect(second.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "late-lease" })).resolves.toMatchObject({ status: "COMMITTED" });
    expect(calls).toBe(1);
  });

  it("records Project Memory failure and does not automatically retry it", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:memory-failure", category: "FEATURE", statement: "Provide the memory failure fixture.", sourceRefs: ["fixture:memory-failure"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    class FailingMemory extends FakePlannerMemoryPort {
      writes = 0;
      override async writeSnapshot() { this.writes += 1; throw new Error("synthetic-memory-failure"); }
    }
    const memory = new FailingMemory();
    let calls = 0;
    const first = new PlanningRecoveryService({ database: fixture.database, memory, source: createStaticSourceCurrentnessPort(TEST_SOURCE_HEAD), hostRecoveryEnabled: true, now: () => timestamp, provider: { planRecovery: async (input) => { calls += 1; return completeRecoveryCandidate(input.plannerInput); } } });
    await expect(first.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "memory-failure" })).rejects.toMatchObject({ code: "RECOVERY_PROJECTION_FAILED" });
    const failed = await fixture.database.transaction((tx) => tx.getPlanningRecoveryRun(fixture.projectId, 1, "memory-failure"));
    expect(failed).toMatchObject({ state: "COMMITTED", projectMemoryStatus: "FAILED", projectMemoryFailureCode: "Error" });
    const second = new PlanningRecoveryService({ database: fixture.database, memory, source: createStaticSourceCurrentnessPort(TEST_SOURCE_HEAD), hostRecoveryEnabled: true, now: () => timestamp, provider: { planRecovery: async () => { calls += 1; throw new Error("provider-retry-forbidden"); } } });
    await expect(second.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "memory-failure" })).rejects.toMatchObject({ code: "RECOVERY_PROJECTION_FAILED" });
    expect(calls).toBe(1);
    expect(memory.writes).toBe(1);
  });

  it("reconciles a canonical commit whose run terminal update was lost", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:run-reconciliation", category: "FEATURE", statement: "Provide the run reconciliation fixture.", sourceRefs: ["fixture:run-reconciliation"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    let now = timestamp;
    let calls = 0;
    const first = service(fixture, {
      now: () => now,
      provider: { planRecovery: async (input) => { calls += 1; return completeRecoveryCandidate(input.plannerInput); } },
      fault: { hit: (point) => { if (point === "after-persistence-started") throw new PlanningRecoveryCrash(point); } },
    });
    const prepared = await first.prepare({ projectId: fixture.projectId, projectVersion: 1, operationKey: "run-reconciliation" });
    await expect(first.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "run-reconciliation" })).rejects.toBeInstanceOf(PlanningRecoveryCrash);
    const interrupted = await fixture.database.transaction((tx) => tx.getPlanningRecoveryRun(fixture.projectId, 1, "run-reconciliation"));
    expect(interrupted?.state).toBe("PERSISTENCE_STARTED");
    const candidate = completeRecoveryCandidate(plannerInput(fixture.projectId, next));
    await first.apply({ projectId: fixture.projectId, projectVersion: 1, operationKey: "run-reconciliation", plan: prepared.plan!, candidate });
    now = "2026-08-30T10:16:00.000Z";
    const second = service(fixture, { now: () => now, provider: { planRecovery: async () => { calls += 1; throw new Error("provider-retry-forbidden"); } } });
    const result = await second.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "run-reconciliation" });
    expect(result.status).toBe("REPLAYED");
    expect(calls).toBe(1);
    const reconciled = await fixture.database.transaction((tx) => tx.getPlanningRecoveryRun(fixture.projectId, 1, "run-reconciliation"));
    expect(reconciled).toMatchObject({ state: "COMMITTED_RECONCILED", terminalOutcome: "COMMITTED_RECONCILED", committedEvidenceId: result.evidence.id, projectMemoryStatus: "SYNCED" });
  });

  it("records provider failure as a terminal outcome without retry", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:provider-failure", category: "FEATURE", statement: "Provide the provider failure fixture.", sourceRefs: ["fixture:provider-failure"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    let calls = 0;
    const failing = service(fixture, { provider: { planRecovery: async () => { calls += 1; throw new Error("synthetic-provider-failure"); } } });
    await expect(failing.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "provider-failure" })).rejects.toMatchObject({ code: "RECOVERY_PROVIDER_FAILED" });
    const failed = await fixture.database.transaction((tx) => tx.getPlanningRecoveryRun(fixture.projectId, 1, "provider-failure"));
    expect(failed).toMatchObject({ state: "PROVIDER_FAILED", terminalOutcome: "PROVIDER_FAILED", providerAttemptCount: 1, diagnosticStage: "provider" });
    const retry = service(fixture, { provider: { planRecovery: async () => { calls += 1; throw new Error("retry-forbidden"); } } });
    await expect(retry.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "provider-failure" })).rejects.toMatchObject({ code: "TERMINAL_FAILURE_REPLAY" });
    expect(calls).toBe(1);
  });

  it("persists bounded complete blocker diagnostics for a failed admission", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, ...Array.from({ length: 72 }, (_, index) => ({ id: `REQUIREMENT:diagnostic-${index}`, category: "LEGAL_CONSTRAINT" as const, statement: `Synthetic admission diagnostic constraint ${index} requires explicit traceability coverage.`, sourceRefs: [`fixture:diagnostic:${index}`] }))] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    const recovery = service(fixture, { provider: { planRecovery: async (input) => buildPlanningPackage(input.plannerInput) } });
    await expect(recovery.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "diagnostic-summary" })).rejects.toMatchObject({ code: "RECOVERY_CANDIDATE_INVALID" });
    const failed = await fixture.database.transaction((tx) => tx.getPlanningRecoveryRun(fixture.projectId, 1, "diagnostic-summary"));
    expect(failed?.diagnosticSummary).toMatchObject({ truncated: true, returnedBlockers: 64, blockerCategoryCounts: expect.objectContaining({ coverage: expect.any(Number) }) });
    expect(failed?.diagnosticSummary?.totalBlockers).toBeGreaterThan(64);
  });

  it("S1 binds PREPARE and execution to the same source HEAD and changes the plan checksum for another HEAD", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:source-s1", category: "FEATURE", statement: "Provide the source binding fixture.", sourceRefs: ["fixture:source-s1"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    let calls = 0;
    const first = service(fixture, { provider: { planRecovery: async (input) => { calls += 1; return completeRecoveryCandidate(input.plannerInput); } } });
    const prepared = await first.prepare({ projectId: fixture.projectId, projectVersion: 1, operationKey: "source-s1" });
    expect(prepared.plan?.sourceHead).toBe(TEST_SOURCE_HEAD);
    const result = await first.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "source-s1" });
    expect(result.status).toBe("COMMITTED");
    expect(calls).toBe(1);
    const run = await fixture.database.transaction((tx) => tx.getPlanningRecoveryRun(fixture.projectId, 1, "source-s1"));
    expect(run).toMatchObject({ expectedSourceHead: TEST_SOURCE_HEAD, recoveryPlanChecksum: prepared.plan?.planChecksum });
    const otherHead = "b".repeat(40);
    const other = new PlanningRecoveryService({ database: fixture.database, memory: new FakePlannerMemoryPort(), provider: provider(), source: createStaticSourceCurrentnessPort(otherHead), hostRecoveryEnabled: true, now: () => timestamp });
    const otherPrepared = await other.prepare({ projectId: fixture.projectId, projectVersion: 1, operationKey: "source-s1-other" });
    expect(otherPrepared.plan?.sourceHead).toBe(otherHead);
    expect(otherPrepared.plan?.planChecksum).not.toBe(prepared.plan?.planChecksum);
  });

  it("S2 blocks a source change between PREPARE and provider start without consuming budget", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:source-s2", category: "FEATURE", statement: "Provide the source mismatch fixture.", sourceRefs: ["fixture:source-s2"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    const heads = [TEST_SOURCE_HEAD, TEST_SOURCE_HEAD, "b".repeat(40)];
    let calls = 0;
    const source = { read: async () => ({ head: heads.shift() ?? "b".repeat(40), trackedWorktreeClean: true }) };
    const recovery = service(fixture, { source, provider: { planRecovery: async (input) => { calls += 1; return completeRecoveryCandidate(input.plannerInput); } } });
    await expect(recovery.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "source-s2" })).rejects.toMatchObject({ code: "SOURCE_HEAD_MISMATCH" });
    expect(calls).toBe(0);
    const run = await fixture.database.transaction((tx) => tx.getPlanningRecoveryRun(fixture.projectId, 1, "source-s2"));
    expect(run).toMatchObject({ state: "CURRENTNESS_FAILED", terminalOutcome: "CURRENTNESS_FAILED", providerAttemptCount: 0 });
  });

  it("S3 rejects a caller-created run whose source binding differs from the certified plan", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:source-s3", category: "FEATURE", statement: "Provide the caller binding fixture.", sourceRefs: ["fixture:source-s3"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    const recovery = service(fixture, { provider: { planRecovery: async (input) => completeRecoveryCandidate(input.plannerInput) } });
    const prepared = await recovery.prepare({ projectId: fixture.projectId, projectVersion: 1, operationKey: "source-s3-seed" });
    const committed = await recovery.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "source-s3-seed" });
    const stored = await fixture.database.transaction((tx) => tx.getPlanningRecoveryRun(fixture.projectId, 1, "source-s3-seed"));
    expect(stored).toBeTruthy();
    const forged = { ...stored!, runId: randomUUID(), operationKey: "source-s3-override", expectedSourceHead: "b".repeat(40), state: "CREATED" as const, providerAttemptCount: 0, providerResultChecksum: null, providerResult: null, providerRequestId: null, providerModel: null, providerErrorClass: null, providerErrorCode: null, diagnosticStage: null, diagnosticCode: null, diagnosticMessage: null, diagnosticSummary: null, leaseOwner: null, leaseExpiresAt: null, terminalOutcome: null, committedEvidenceId: null, projectMemoryStatus: "PENDING" as const, projectMemoryFailureCode: null, projectMemoryFailureMessage: null, recoveryPlan: prepared.plan!, recoveryPlanChecksum: prepared.plan!.planChecksum };
    await expect(fixture.database.transaction((tx) => tx.createPlanningRecoveryRun(forged))).rejects.toMatchObject({ code: "PERSISTENCE_VALIDATION_FAILED" });
    expect(committed.status).toBe("COMMITTED");
  });

  it("S4 rejects a source change after provider result persistence before admission", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:source-s4", category: "FEATURE", statement: "Provide the post-provider source fixture.", sourceRefs: ["fixture:source-s4"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    let head = TEST_SOURCE_HEAD;
    let calls = 0;
    const source = { read: async () => ({ head, trackedWorktreeClean: true }) };
    const recovery = service(fixture, { source, provider: { planRecovery: async (input) => { calls += 1; const candidate = completeRecoveryCandidate(input.plannerInput); head = "b".repeat(40); return candidate; } } });
    await expect(recovery.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "source-s4" })).rejects.toMatchObject({ code: "SOURCE_HEAD_MISMATCH" });
    expect(calls).toBe(1);
    const state = await fixture.database.transaction(async (tx) => ({ run: await tx.getPlanningRecoveryRun(fixture.projectId, 1, "source-s4"), planning: await tx.getDocument(fixture.projectId, 1, "planning-package"), evidence: await tx.listPlanningRecoveryEvidence(fixture.projectId, 1) }));
    expect(state.run).toMatchObject({ state: "CURRENTNESS_FAILED", providerAttemptCount: 1 });
    expect(state.planning?.rowVersion).toBe(1);
    expect(state.evidence).toHaveLength(0);
  });

  it("S5 rejects a source change after admission before persistence", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:source-s5", category: "FEATURE", statement: "Provide the post-admission source fixture.", sourceRefs: ["fixture:source-s5"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    let head = TEST_SOURCE_HEAD;
    const source = { read: async () => ({ head, trackedWorktreeClean: true }) };
    const recovery = service(fixture, { source, provider: { planRecovery: async (input) => completeRecoveryCandidate(input.plannerInput) }, fault: { hit: (point) => { if (point === "after-admission-passed") head = "b".repeat(40); } } });
    await expect(recovery.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "source-s5" })).rejects.toMatchObject({ code: "SOURCE_HEAD_MISMATCH" });
    const state = await fixture.database.transaction(async (tx) => ({ run: await tx.getPlanningRecoveryRun(fixture.projectId, 1, "source-s5"), planning: await tx.getDocument(fixture.projectId, 1, "planning-package"), evidence: await tx.listPlanningRecoveryEvidence(fixture.projectId, 1) }));
    expect(state.run).toMatchObject({ state: "CURRENTNESS_FAILED", providerAttemptCount: 1 });
    expect(state.planning?.rowVersion).toBe(1);
    expect(state.evidence).toHaveLength(0);
  });

  it("S6 resumes a durable provider result with the same source HEAD and S7 blocks a changed HEAD", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:source-s67", category: "FEATURE", statement: "Provide the resume source fixture.", sourceRefs: ["fixture:source-s67"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    let head = TEST_SOURCE_HEAD;
    let now = timestamp;
    let calls = 0;
    const source = { read: async () => ({ head, trackedWorktreeClean: true }) };
    const first = service(fixture, { source, now: () => now, provider: { planRecovery: async (input) => { calls += 1; return completeRecoveryCandidate(input.plannerInput); } }, fault: { hit: (point) => { if (point === "after-provider-result") throw new PlanningRecoveryCrash(point); } } });
    await expect(first.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "source-s67-same" })).rejects.toBeInstanceOf(PlanningRecoveryCrash);
    const interrupted = await fixture.database.transaction((tx) => tx.getPlanningRecoveryRun(fixture.projectId, 1, "source-s67-same"));
    await expect(fixture.database.transaction((tx) => tx.transitionPlanningRecoveryRun({ runId: interrupted!.runId, operationKey: "source-s67-same", from: "PROVIDER_RETURNED", to: "ADMISSION_STARTED", now: timestamp, patch: { expectedSourceHead: "b".repeat(40) } as never }))).rejects.toMatchObject({ code: "PERSISTENCE_VALIDATION_FAILED" });
    const stillBound = await fixture.database.transaction((tx) => tx.getPlanningRecoveryRun(fixture.projectId, 1, "source-s67-same"));
    expect(stillBound?.expectedSourceHead).toBe(TEST_SOURCE_HEAD);
    now = "2026-08-30T10:16:00.000Z";
    const second = service(fixture, { source, now: () => now, provider: { planRecovery: async () => { calls += 1; throw new Error("resume-provider-retry-forbidden"); } } });
    await expect(second.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "source-s67-same" })).resolves.toMatchObject({ status: "COMMITTED" });
    expect(calls).toBe(1);

    head = TEST_SOURCE_HEAD;
    const changedFixture = await seeded({ currentBrief: next, packageBrief: base });
    now = timestamp;
    const changedFirst = service(changedFixture, { source, now: () => now, provider: { planRecovery: async (input) => { calls += 1; return completeRecoveryCandidate(input.plannerInput); } }, fault: { hit: (point) => { if (point === "after-provider-result") throw new PlanningRecoveryCrash(point); } } });
    await expect(changedFirst.recover({ projectId: changedFixture.projectId, projectVersion: 1, operationKey: "source-s67-changed" })).rejects.toBeInstanceOf(PlanningRecoveryCrash);
    head = "b".repeat(40);
    now = "2026-08-30T10:16:00.000Z";
    const changedSecond = service(changedFixture, { source, now: () => now, provider: { planRecovery: async () => { calls += 1; throw new Error("changed-head-provider-retry-forbidden"); } } });
    await expect(changedSecond.recover({ projectId: changedFixture.projectId, projectVersion: 1, operationKey: "source-s67-changed" })).rejects.toMatchObject({ code: "SOURCE_HEAD_MISMATCH" });
  });

  it.each([
    ["PROVIDER_RETURNED", "after-provider-result"],
    ["ADMISSION_STARTED", "after-admission-started"],
    ["ADMISSION_PASSED", "after-admission-passed"],
    ["PERSISTENCE_STARTED", "after-persistence-started"],
  ] as const)("blocks changed-HEAD resume from %s without another provider call", async (expectedState, crashPoint) => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: `REQUIREMENT:resume-${expectedState.toLowerCase()}`, category: "FEATURE", statement: `Provide the ${expectedState} resume fixture.`, sourceRefs: [`fixture:resume:${expectedState}`] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    let head = TEST_SOURCE_HEAD;
    let clock = timestamp;
    let calls = 0;
    const source = { read: async () => ({ head, trackedWorktreeClean: true }) };
    const first = service(fixture, { source, now: () => clock, provider: { planRecovery: async (input) => { calls += 1; return completeRecoveryCandidate(input.plannerInput); } }, fault: { hit: (point) => { if (point === crashPoint) throw new PlanningRecoveryCrash(point); } } });
    await expect(first.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: `resume-${expectedState.toLowerCase()}` })).rejects.toBeInstanceOf(PlanningRecoveryCrash);
    const interrupted = await fixture.database.transaction((tx) => tx.getPlanningRecoveryRun(fixture.projectId, 1, `resume-${expectedState.toLowerCase()}`));
    expect(interrupted?.state).toBe(expectedState);
    head = "b".repeat(40);
    clock = "2026-08-30T10:16:00.000Z";
    const second = service(fixture, { source, now: () => clock, provider: { planRecovery: async () => { calls += 1; throw new Error("changed-resume-provider-retry-forbidden"); } } });
    await expect(second.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: `resume-${expectedState.toLowerCase()}` })).rejects.toMatchObject({ code: "SOURCE_HEAD_MISMATCH" });
    expect(calls).toBe(1);
    const failed = await fixture.database.transaction((tx) => tx.getPlanningRecoveryRun(fixture.projectId, 1, `resume-${expectedState.toLowerCase()}`));
    expect(failed).toMatchObject({ state: "CURRENTNESS_FAILED", providerAttemptCount: 1 });
  });

  it("S8 rejects committed replay after the source HEAD changes, while S12 same-head replay is read-only", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:source-s812", category: "FEATURE", statement: "Provide the replay source fixture.", sourceRefs: ["fixture:source-s812"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    let head = TEST_SOURCE_HEAD;
    let calls = 0;
    const source = { read: async () => ({ head, trackedWorktreeClean: true }) };
    const first = service(fixture, { source, provider: { planRecovery: async (input) => { calls += 1; return completeRecoveryCandidate(input.plannerInput); } } });
    await expect(first.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "source-s812" })).resolves.toMatchObject({ status: "COMMITTED" });
    const same = service(fixture, { source, provider: { planRecovery: async () => { calls += 1; throw new Error("replay-provider-forbidden"); } } });
    await expect(same.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "source-s812" })).resolves.toMatchObject({ status: "REPLAYED" });
    expect(calls).toBe(1);
    head = "b".repeat(40);
    const changed = service(fixture, { source, provider: { planRecovery: async () => { calls += 1; throw new Error("changed-replay-provider-forbidden"); } } });
    await expect(changed.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "source-s812" })).rejects.toMatchObject({ code: "SOURCE_HEAD_MISMATCH" });
    expect(calls).toBe(1);
  });

  it("S9 keeps a historical terminal null-head run readable without retry and S10 rejects a new null-head run", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:source-s910", category: "FEATURE", statement: "Provide the historical source fixture.", sourceRefs: ["fixture:source-s910"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    const failedService = service(fixture, { provider: { planRecovery: async () => { throw new Error("synthetic-terminal-source-failure"); } } });
    await expect(failedService.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "source-s910-old" })).rejects.toMatchObject({ code: "RECOVERY_PROVIDER_FAILED" });
    const old = await fixture.database.transaction((tx) => tx.getPlanningRecoveryRun(fixture.projectId, 1, "source-s910-old"));
    expect(old).toBeTruthy();
    fixture.database.planningRecoveryRuns.set(old!.runId, { ...old!, expectedSourceHead: null });
    let calls = 0;
    const readable = service(fixture, { provider: { planRecovery: async () => { calls += 1; throw new Error("legacy-retry-forbidden"); } } });
    await expect(readable.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "source-s910-old" })).rejects.toMatchObject({ code: "TERMINAL_FAILURE_REPLAY" });
    expect(calls).toBe(0);
    const nullRun = { ...old!, runId: randomUUID(), operationKey: "source-s910-new-null", expectedSourceHead: null, state: "CREATED" as const, providerAttemptCount: 0, providerResultChecksum: null, providerResult: null, providerRequestId: null, providerModel: null, providerErrorClass: null, providerErrorCode: null, diagnosticStage: null, diagnosticCode: null, diagnosticMessage: null, diagnosticSummary: null, leaseOwner: null, leaseExpiresAt: null, terminalOutcome: null, committedEvidenceId: null, projectMemoryStatus: "PENDING" as const, projectMemoryFailureCode: null, projectMemoryFailureMessage: null };
    await expect(fixture.database.transaction((tx) => tx.createPlanningRecoveryRun(nullRun))).rejects.toMatchObject({ code: "PERSISTENCE_VALIDATION_FAILED" });
  });

  it("S11 rejects a provider candidate that tries to supply source authority", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:source-s11", category: "FEATURE", statement: "Provide the provider authority fixture.", sourceRefs: ["fixture:source-s11"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    let calls = 0;
    const recovery = service(fixture, { provider: { planRecovery: async (input) => { calls += 1; return { ...completeRecoveryCandidate(input.plannerInput), sourceHead: TEST_SOURCE_HEAD } as never; } } });
    await expect(recovery.recover({ projectId: fixture.projectId, projectVersion: 1, operationKey: "source-s11" })).rejects.toMatchObject({ code: "RECOVERY_PROVIDER_SEMANTIC_FAILED" });
    expect(calls).toBe(1);
    const run = await fixture.database.transaction((tx) => tx.getPlanningRecoveryRun(fixture.projectId, 1, "source-s11"));
    expect(run).toMatchObject({ state: "PROVIDER_SEMANTIC_FAILED", providerAttemptCount: 1 });
  });

  it("fails closed for a dirty tracked worktree during PREPARE", async () => {
    const base = brief();
    const next = brief({ requirements: [...base.requirements, { id: "REQUIREMENT:dirty-source", category: "FEATURE", statement: "Provide the dirty source fixture.", sourceRefs: ["fixture:dirty-source"] }] });
    const fixture = await seeded({ currentBrief: next, packageBrief: base });
    const prepared = await service(fixture, { source: createStaticSourceCurrentnessPort(TEST_SOURCE_HEAD, false) }).prepare({ projectId: fixture.projectId, projectVersion: 1, operationKey: "dirty-source" });
    expect(prepared.eligibility).toMatchObject({ eligible: false, reason: "SOURCE_CURRENTNESS_INVALID", blockers: ["SOURCE_WORKTREE_DIRTY"] });
  });
});
