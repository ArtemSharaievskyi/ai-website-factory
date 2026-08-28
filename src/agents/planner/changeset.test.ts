import { describe, expect, it } from "vitest";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { CanonicalBriefV3Schema, type CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { cleanBriefV3, representativeV1Brief } from "@/domain/requirements/v3/fixtures";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { createBriefV3Document, BriefV3DocumentSchema } from "@/persistence/database/brief-revision-v3-contracts";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { FakePlannerMemoryPort } from "./memory";
import { buildPlanningPackage, planningSemanticChecksum } from "./deterministic";
import { PlannerArchitectService } from "./service";
import { PlannerAgentInputSchema, type PlannerAgentInput } from "./contracts";
import type { PlannerArchitectureProvider } from "./ports";
import { applyPlanningChangeSet, computePlanningBriefDelta, planningAuthorizationScopeChecksum, PlanningChangeSetProviderOutputSchema, PlanningChangeSetSchema } from "./changeset";

const timestamp = "2026-01-01T00:00:00.000Z";
const transportScopePoints = [
  "Furniture transport",
  "Pickup and delivery",
  "Loading and unloading assistance",
  "Optional furniture assembly and disassembly",
] as const;

function targetBrief(base: CanonicalBriefV3 = cleanBriefV3) {
  return CanonicalBriefV3Schema.parse({
    ...base,
    requirements: [...base.requirements, { id: "REQUIREMENT:transport", category: "FEATURE", statement: "Offer synthetic Möbeltransport service." , sourceRefs: ["fixture:transport"] }],
  });
}

function backendTargetBrief(base: CanonicalBriefV3) {
  return CanonicalBriefV3Schema.parse({ ...base, requirements: [...base.requirements, { id: "REQUIREMENT:transport-backend", category: "BACKEND", statement: "Provide synthetic backend transport service.", sourceRefs: ["fixture:transport-backend"] }], decisions: { ...base.decisions, form: { mode: "NONE", formPresent: false, validation: "NOT_REQUIRED", simulatedSuccessPolicy: "NOT_APPLICABLE", transmissionMode: "NONE", persistenceMode: "NONE", serverProcessingMode: "NONE", externalProviderMode: "NONE", privacyConsentMode: "NOT_APPLICABLE", interactionStates: [] } } });
}

function plannerInput(brief: CanonicalBriefV3, projectId: string): PlannerAgentInput {
  const compatibility = RequirementSpecificationSchema.parse({
    ...representativeV1Brief,
    projectId,
    projectVersion: 1,
    approval: { approved: true, approvedRequirementsChecksum: canonicalBriefChecksum(brief) },
    briefStatus: "approved",
  });
  return PlannerAgentInputSchema.parse({
    projectId,
    projectVersion: 1,
    approvedBrief: compatibility,
    canonicalBrief: brief,
    approvedBriefChecksum: canonicalBriefChecksum(brief),
    originalPromptReference: "synthetic-refresh-prompt",
    clarificationEvidenceReferences: ["synthetic-clarification"],
    currentWorkflowState: "AWAITING_DESIGN_SELECTION",
    existingDecisions: [],
    suppliedFiles: [],
    allowedSkills: [],
    idempotencyKey: "synthetic-planning-refresh",
    expectedRowVersion: 1,
  });
}

async function seedRefreshFixture(next = targetBrief()) {
  const database = new InMemoryPersistenceDatabase();
  const projectId = randomUUID();
  const base = CanonicalBriefV3Schema.parse(cleanBriefV3);
  const baseChecksum = canonicalBriefChecksum(base);
  const nextChecksum = canonicalBriefChecksum(next);
  const newRequirementId = next.requirements.find((entry) => !base.requirements.some((candidate) => candidate.id === entry.id))?.id;
  const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "synthetic-change-set", origin: "SYNTHETIC", originalPrompt: "Synthetic planning refresh.", currentVersion: 1, workflowState: "AWAITING_DESIGN_SELECTION" });
  await new ProjectRepository(database).create(project);
  await new ProjectVersionRepository(database).create({ id: randomUUID(), projectId, versionNumber: 1, state: "AWAITING_DESIGN_SELECTION", memoryRootPath: null, requirementsChecksum: baseChecksum, selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
  const documents = new DocumentRepository(database);
  const baseDocument = createBriefV3Document({ projectId, projectVersion: 1, brief: base, createdAt: timestamp, updatedAt: timestamp });
  await documents.save(BriefV3DocumentSchema.parse({ ...baseDocument, approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-user", approvedCanonicalChecksum: baseChecksum } }));
  const baseInput = plannerInput(base, projectId);
  await documents.save(buildPlanningPackage(baseInput));
  const nextDocument = createBriefV3Document({ projectId, projectVersion: 1, brief: next, createdAt: timestamp, updatedAt: timestamp });
  await documents.save(BriefV3DocumentSchema.parse({ ...nextDocument, approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-user", approvedCanonicalChecksum: nextChecksum } }));
  const historyEntries: Array<{ revisionReference: string; target: string; operation: "UPSERT" | "SET"; outcome: "CHANGED"; beforeValueFingerprint: string; afterValueFingerprint: string }> = newRequirementId ? [{ revisionReference: "synthetic-brief-revision", target: newRequirementId, operation: "UPSERT", outcome: "CHANGED", beforeValueFingerprint: "b".repeat(64), afterValueFingerprint: "c".repeat(64) }] : [];
  if (checksumPersistedDocument(base.decisions.form) !== checksumPersistedDocument(next.decisions.form)) historyEntries.push({ revisionReference: "synthetic-brief-revision", target: "FORM_SUCCESS_MODE", operation: "SET" as const, outcome: "CHANGED" as const, beforeValueFingerprint: "d".repeat(64), afterValueFingerprint: "e".repeat(64) });
  database.briefRevisionHistory.set(randomUUID(), { id: randomUUID(), attemptId: randomUUID(), projectId, projectVersion: 1, revisionReference: "synthetic-brief-revision", previousCurrentChecksum: baseChecksum, nextCurrentChecksum: nextChecksum, changeSetChecksum: "a".repeat(64), entries: historyEntries, createdAt: timestamp });
  return { database, projectId, base, next, baseChecksum, nextChecksum, input: plannerInput(next, projectId), basePackage: buildPlanningPackage(baseInput) };
}

describe("bounded Planning ChangeSet refresh", () => {
  it("computes a host-owned delta and applies only the authorized product-scope operation", () => {
    const base = CanonicalBriefV3Schema.parse(cleanBriefV3);
    const next = targetBrief(base);
    const packageValue = buildPlanningPackage(plannerInput(base, randomUUID()));
    const delta = computePlanningBriefDelta(base, next);
    const changeSet = PlanningChangeSetSchema.parse({
      contractVersion: 1,
      projectId: packageValue.projectId,
      projectVersion: 1,
      basePlanningSemanticChecksum: planningSemanticChecksum(packageValue),
      baseBriefChecksum: delta.baseBriefChecksum,
      targetBriefChecksum: delta.targetBriefChecksum,
      authorizationScopeChecksum: delta.authorizationScopeChecksum,
      changes: [{ kind: "set-product-scope-field", field: "inScopeCapabilities", value: [...packageValue.productScope.inScopeCapabilities, "Offer synthetic Möbeltransport service."], requirementReferences: ["REQUIREMENT:transport"] }],
    });
    const boundedChangeSet = PlanningChangeSetSchema.parse({ ...changeSet, changes: [{ kind: "set-product-scope-field", field: "inScopeCapabilities", value: [...packageValue.productScope.inScopeCapabilities, ...transportScopePoints], requirementReferences: ["REQUIREMENT:transport"] }] });
    const applied = applyPlanningChangeSet({ current: packageValue, changeSet: boundedChangeSet, briefDelta: delta, canonicalBrief: next, projectId: packageValue.projectId, projectVersion: 1, timestamp });
    for (const point of transportScopePoints) expect(applied.productScope.inScopeCapabilities).toContain(point);
    expect(packageValue.productScope.inScopeCapabilities.every((value) => applied.productScope.inScopeCapabilities.includes(value))).toBe(true);
    expect(applied.architecture.serverActions).toEqual(packageValue.architecture.serverActions);
    expect(applied.accepted).toBe(false);
    expect(applied.architecture.acceptance.accepted).toBe(false);
    expect(planningSemanticChecksum(applied)).not.toBe(planningSemanticChecksum(packageValue));
    expect(checksumPersistedDocument(applied)).not.toBe(checksumPersistedDocument(packageValue));
    expect(() => applyPlanningChangeSet({ current: packageValue, changeSet: { ...changeSet, changes: [{ kind: "set-product-scope-field", field: "inScopeCapabilities", value: ["Only the new point"], requirementReferences: ["REQUIREMENT:transport"] }] }, briefDelta: delta, canonicalBrief: next, projectId: packageValue.projectId, projectVersion: 1, timestamp })).toThrow("PLANNING_CHANGESET_UNRELATED_SCOPE_LOSS");
  });

  it("rejects legacy, unknown, backend, form, and unrelated architecture mutations", () => {
    const base = CanonicalBriefV3Schema.parse(cleanBriefV3);
    const next = targetBrief(base);
    const packageValue = buildPlanningPackage(plannerInput(base, randomUUID()));
    const delta = computePlanningBriefDelta(base, next);
    const apply = (change: z.input<typeof PlanningChangeSetSchema>["changes"][number]) => applyPlanningChangeSet({
      current: packageValue,
      changeSet: PlanningChangeSetSchema.parse({ contractVersion: 1, projectId: packageValue.projectId, projectVersion: 1, basePlanningSemanticChecksum: planningSemanticChecksum(packageValue), baseBriefChecksum: delta.baseBriefChecksum, targetBriefChecksum: delta.targetBriefChecksum, authorizationScopeChecksum: delta.authorizationScopeChecksum, changes: [change] }),
      briefDelta: delta,
      canonicalBrief: next,
      projectId: packageValue.projectId,
      projectVersion: 1,
      timestamp,
    });
    expect(() => apply({ kind: "set-product-scope-field", field: "purpose", value: "Unsafe", requirementReferences: ["legacy-v1-service"] })).toThrow("PLANNING_TRACEABILITY_LEGACY_REFERENCE");
    expect(() => apply({ kind: "set-product-scope-field", field: "purpose", value: "Unsafe", requirementReferences: ["REQUIREMENT:not-canonical"] })).toThrow("PLANNING_TRACEABILITY_UNKNOWN_REFERENCE");
    expect(() => apply({ kind: "set-architecture-field", field: "serverActions", value: ["Unapproved backend"], requirementReferences: ["REQUIREMENT:transport"] })).toThrow("PLANNING_CHANGESET_DOMAIN_UNAUTHORIZED");
    expect(() => apply({ kind: "remove-form", formId: packageValue.forms.forms[0]!.id, requirementReferences: ["REQUIREMENT:transport"] })).toThrow("PLANNING_CHANGESET_DOMAIN_UNAUTHORIZED");
    expect(() => apply({ kind: "set-architecture-field", field: "testStrategy", value: ["Unrelated rewrite"], requirementReferences: ["REQUIREMENT:transport"] })).toThrow("PLANNING_CHANGESET_DOMAIN_UNAUTHORIZED");
    expect(PlanningChangeSetProviderOutputSchema.safeParse({ contractVersion: 1, changes: [], projectId: packageValue.projectId }).success).toBe(false);
  });

  it("rejects a cross-project change set and a stale scope checksum", () => {
    const base = CanonicalBriefV3Schema.parse(cleanBriefV3);
    const next = targetBrief(base);
    const packageValue = buildPlanningPackage(plannerInput(base, randomUUID()));
    const delta = computePlanningBriefDelta(base, next);
    const changeSet = { contractVersion: 1 as const, projectId: packageValue.projectId, projectVersion: 1, basePlanningSemanticChecksum: planningSemanticChecksum(packageValue), baseBriefChecksum: delta.baseBriefChecksum, targetBriefChecksum: delta.targetBriefChecksum, authorizationScopeChecksum: delta.authorizationScopeChecksum, changes: [] };
    expect(() => applyPlanningChangeSet({ current: packageValue, changeSet: { ...changeSet, projectId: randomUUID() }, briefDelta: delta, canonicalBrief: next, projectId: packageValue.projectId, projectVersion: 1, timestamp })).toThrow("PLANNING_CHANGESET_PROJECT_MISMATCH");
    expect(() => applyPlanningChangeSet({ current: packageValue, changeSet: { ...changeSet, projectVersion: 2 }, briefDelta: delta, canonicalBrief: next, projectId: packageValue.projectId, projectVersion: 1, timestamp })).toThrow("PLANNING_CHANGESET_PROJECT_MISMATCH");
    expect(() => applyPlanningChangeSet({ current: packageValue, changeSet: { ...changeSet, basePlanningSemanticChecksum: "f".repeat(64) }, briefDelta: delta, canonicalBrief: next, projectId: packageValue.projectId, projectVersion: 1, timestamp })).toThrow("PLANNING_CHANGESET_BASE_PLANNING_MISMATCH");
    expect(() => planningAuthorizationScopeChecksum({ ...delta, authorizedDomains: [...delta.authorizedDomains, "security"] })).not.toBe(delta.authorizationScopeChecksum);
    expect(() => applyPlanningChangeSet({ current: packageValue, changeSet, briefDelta: { ...delta, authorizationScopeChecksum: "d".repeat(64) }, canonicalBrief: next, projectId: packageValue.projectId, projectVersion: 1, timestamp })).toThrow("PLANNING_CHANGESET_SCOPE_MISMATCH");
  });

  it("uses the ChangeSet provider for refresh, never falls back to full-package planning, and isolates rejected proposals", async () => {
    const fixture = await seedRefreshFixture();
    let fullPlanCalls = 0;
    let changeSetCalls = 0;
    const memory = new FakePlannerMemoryPort();
    const service = new PlannerArchitectService({
      database: fixture.database,
      memory,
      provider: {
        async plan() { fullPlanCalls += 1; throw new Error("FULL_REFRESH_FALLBACK"); },
        async proposeChangeSet() {
          changeSetCalls += 1;
          return { contractVersion: 1, changes: [{ kind: "set-product-scope", field: "inScopeCapabilities", value: ["unsafe"], requirementReferences: ["REQUIREMENT:transport"] }] } as never;
        },
      },
    });
    await expect(service.planApprovedProject(fixture.input)).rejects.toMatchObject({ code: "PLANNING_PACKAGE_INVALID" });
    expect(changeSetCalls).toBe(1);
    expect(fullPlanCalls).toBe(0);
    expect(await new DocumentRepository(fixture.database).get(fixture.projectId, 1, "planning-package")).toEqual(fixture.basePackage);
    expect(memory.documents.size).toBe(0);
    expect(await new DocumentRepository(fixture.database).get(fixture.projectId, 1, "planning-refresh-diagnostics")).toMatchObject({ documentType: "planning-refresh-diagnostics" });
  });

  it("commits a valid larger delta that authorizes an architecture field", async () => {
    const fixture = await seedRefreshFixture(backendTargetBrief(cleanBriefV3));
    const provider: PlannerArchitectureProvider = {
      async plan() { throw new Error("FULL_REFRESH_FALLBACK"); },
      async proposeChangeSet() {
        return { contractVersion: 1, changes: [{ kind: "set-architecture-field", field: "serverActions", value: ["Provide synthetic backend transport service."], requirementReferences: ["REQUIREMENT:transport-backend"] }, { kind: "remove-form", formId: fixture.basePackage.forms.forms[0]!.id, requirementReferences: ["REQUIREMENT:transport-backend"] }] };
      },
    };
    const service = new PlannerArchitectService({ database: fixture.database, memory: new FakePlannerMemoryPort(), provider });
    const refreshed = await service.planApprovedProject(fixture.input);
    expect(refreshed.architecture.serverActions).toContain("Provide synthetic backend transport service.");
    expect(refreshed.accepted).toBe(false);
  });

  it("routes arbitrary Architecture Review correction through the same ChangeSet authority", async () => {
    const fixture = await seedRefreshFixture(cleanBriefV3);
    const project = fixture.database.projects.get(fixture.projectId)!;
    fixture.database.projects.set(fixture.projectId, { ...project, workflow_state: "ARCHITECTURE_REVIEW" });
    let fullPlanCalls = 0;
    let changeSetCalls = 0;
    const service = new PlannerArchitectService({
      database: fixture.database,
      memory: new FakePlannerMemoryPort(),
      provider: {
        async plan() { fullPlanCalls += 1; throw new Error("FULL_CORRECTION_FALLBACK"); },
        async proposeChangeSet(input) {
          changeSetCalls += 1;
          expect(input.correctionOnly).toBe(true);
          return { contractVersion: 1, changes: [{ kind: "set-architecture-field", field: "componentBoundaries", value: ["Synthetic bounded correction"], requirementReferences: ["PLANNING:DECISION:form-behavior"] }] };
        },
      },
    });
    const result = await service.correctAfterArchitectureReview({
      ...fixture.input,
      idempotencyKey: "synthetic-architecture-correction",
      currentPlanningPackage: fixture.basePackage,
      architectureReview: {
        verdict: "CHANGES_REQUIRED",
        findings: [{ findingId: "synthetic-api-boundary", category: "API_BOUNDARY", severity: "ERROR", summary: "Synthetic bounded correction is required.", evidenceRefs: ["planning:architecture"], affectedArtifacts: ["planning:architecture"], recommendedAction: "Apply the bounded synthetic correction." }],
        reviewedArtifactRefs: ["planning-package"],
        policyVersion: "synthetic-architecture-review-v1",
      },
    });
    expect(changeSetCalls).toBe(1);
    expect(fullPlanCalls).toBe(0);
    expect(result.package.architecture.componentBoundaries).toEqual(["Synthetic bounded correction"]);
    expect(result.package.accepted).toBe(false);
  });
});
