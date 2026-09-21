import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildPlanningPackage, planningSemanticChecksum } from "./deterministic";
import { admitPlanningRefresh, PlanningAdmissionError } from "./refresh-admission";
import { PlannerArchitectService } from "./service";
import { PlannerError, serializePlannerError } from "./errors";
import { PlanningPackageSchema, type PlannerAgentInput, type PlanningPackage } from "./contracts";
import type { PlannerArchitectureProvider } from "./ports";
import { FakePlannerMemoryPort } from "./memory";
import { cleanBriefV3, representativeV1Brief } from "@/domain/requirements/v3/fixtures";
import { CanonicalBriefV3Schema, type CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { FactoryProjectSchema } from "@/domain/project/schema";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { createBriefV3Document, BriefV3DocumentSchema } from "@/persistence/database/brief-revision-v3-contracts";
import { DecisionRepository, DocumentRepository, ProjectRepository, ProjectVersionRepository } from "@/persistence/database/repositories";
import { workbenchFailureResponse } from "@/runtime/workbench/diagnostics";
import { WorkbenchOperationLedger } from "@/runtime/workbench/operation-ledger";

const timestamp = "2026-01-01T00:00:00.000Z";

function fixtureBrief(overrides: Partial<CanonicalBriefV3> = {}) {
  return CanonicalBriefV3Schema.parse({ ...cleanBriefV3, ...overrides });
}

function plannerInput(brief: CanonicalBriefV3, projectId: string = randomUUID()): PlannerAgentInput {
  const compatibility = RequirementSpecificationSchema.parse({
    ...representativeV1Brief,
    projectId,
    projectVersion: 1,
    approval: { approved: true, approvedRequirementsChecksum: canonicalBriefChecksum(brief) },
    briefStatus: "approved",
  });
  return {
    projectId,
    projectVersion: 1,
    approvedBrief: compatibility,
    canonicalBrief: brief,
    approvedBriefChecksum: canonicalBriefChecksum(brief),
    originalPromptReference: "synthetic-refresh-prompt",
    clarificationEvidenceReferences: ["synthetic-clarification"],
    currentWorkflowState: "AWAITING_PLANNING_GENERATION",
    existingDecisions: [],
    suppliedFiles: [],
    allowedSkills: [],
    idempotencyKey: randomUUID(),
    expectedRowVersion: 1,
  };
}

function packageFor(brief: CanonicalBriefV3, projectId: string = randomUUID()) {
  const input = plannerInput(brief, projectId);
  return { input, packageValue: buildPlanningPackage(input) };
}

async function seededFixture(brief = fixtureBrief()) {
  const database = new InMemoryPersistenceDatabase();
  const projectId = randomUUID();
  const project = FactoryProjectSchema.parse({
    schemaVersion: 1,
    documentType: "factory-project",
    projectId,
    projectVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    id: projectId,
    slug: "synthetic-planning-refresh",
    originalPrompt: "Synthetic planning refresh fixture.",
    currentVersion: 1,
    workflowState: "AWAITING_PLANNING_GENERATION",
  });
  await new ProjectRepository(database).create(project);
  await new ProjectVersionRepository(database).create({
    id: randomUUID(),
    projectId,
    versionNumber: 1,
    state: "AWAITING_PLANNING_GENERATION",
    memoryRootPath: null,
    requirementsChecksum: canonicalBriefChecksum(brief),
    selectedDesignChecksum: null,
    architectureChecksum: null,
    releasedAt: null,
    immutable: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    rowVersion: 1,
  });
  const document = createBriefV3Document({ projectId, projectVersion: 1, brief, createdAt: timestamp, updatedAt: timestamp });
  await new DocumentRepository(database).save(BriefV3DocumentSchema.parse({
    ...document,
    approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-user", approvedCanonicalChecksum: document.briefChecksum },
  }));
  return { database, input: plannerInput(brief, projectId), projectId };
}

function admitted(packageValue: PlanningPackage, input: PlannerAgentInput, current?: PlanningPackage) {
  return admitPlanningRefresh({
    candidate: packageValue,
    current,
    canonicalBrief: input.canonicalBrief,
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    approvedBriefChecksum: input.approvedBriefChecksum,
    timestamp,
  });
}

function withoutRequirementReference(value: unknown, requirementId: string): unknown {
  if (Array.isArray(value)) return value.map((item) => withoutRequirementReference(item, requirementId));
  if (value === "brief:features") return "brief:pages";
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [
    key,
    key === "requirementReferences" && Array.isArray(child)
      ? child.filter((reference) => reference !== requirementId).map((reference) => withoutRequirementReference(reference, requirementId))
      : withoutRequirementReference(child, requirementId),
  ]));
}

describe("host-owned Planning refresh admission", () => {
  it("serializes a precise coverage reason without changing the stable outer Planner error", () => {
    const error = new PlannerError("PLANNING_PACKAGE_INVALID", "Planner output failed deterministic token admission.", new PlanningAdmissionError("PLANNING_REQUIREMENT_COVERAGE_INVALID", "coverageByRequirement.REQ_001", "PLANNING_COVERAGE_KIND_INCOMPATIBLE"));
    expect(serializePlannerError(error)).toEqual({ code: "PLANNING_PACKAGE_INVALID", message: "Planner output failed deterministic token admission.", reasonCode: "PLANNING_COVERAGE_KIND_INCOMPATIBLE" });
  });
  it("admits a complete current V3 plan and stamps lifecycle fields", () => {
    const fixture = packageFor(fixtureBrief());
    const result = admitted(fixture.packageValue, fixture.input);

    expect(result.blockers).toEqual([]);
    expect(result.candidate.projectId).toBe(fixture.input.projectId);
    expect(result.candidate.projectVersion).toBe(1);
    expect(result.candidate.accepted).toBe(false);
    expect(result.candidate.acceptance).toEqual({});
    expect(result.candidate.architecture.acceptance.accepted).toBe(false);
    expect(result.candidate.traceability.every((entry) => entry.requirementReferences.every((reference) => reference.startsWith("REQUIREMENT:") || reference.startsWith("PAGE:") || reference.startsWith("ASSET") || reference.startsWith("PLANNING:")))).toBe(true);
  });

  it("rejects loss of one current canonical requirement even when the transport remains schema-valid", () => {
    const brief = fixtureBrief({ requirements: [...cleanBriefV3.requirements, { id: "REQUIREMENT:unique-service", category: "FEATURE", statement: "Provide the unique synthetic moving service.", sourceRefs: ["fixture:unique-service"] }] });
    const fixture = packageFor(brief);
    const candidate = {
      ...fixture.packageValue,
      productScope: {
        ...fixture.packageValue.productScope,
        inScopeCapabilities: fixture.packageValue.productScope.inScopeCapabilities.filter((value) => value !== "Provide the unique synthetic moving service."),
      },
    };
    const result = admitted(candidate, fixture.input);
    expect(result.blockers.some((blocker) => blocker.includes("REQUIREMENT:unique-service"))).toBe(true);
    expect(result.coverage).toEqual(expect.arrayContaining([expect.objectContaining({ requirementId: "REQUIREMENT:unique-service" })]));
    expect(result.coverageDiagnostics).toEqual(expect.arrayContaining([expect.objectContaining({
      canonicalRequirementId: "REQUIREMENT:unique-service",
      category: "FEATURE",
      ownership: "PLANNING",
      kind: "SEMANTIC_MISSING",
      reason: "MISSING_SEMANTIC_EVIDENCE",
      referenceStatus: "PRESENT",
      canonicalReferencesPresent: ["REQUIREMENT:unique-service"],
      normalizedEvidence: expect.objectContaining({ status: expect.any(String), score: expect.any(Number), requiredTokens: expect.any(Array), matchedTokens: expect.any(Array), unmatchedTokens: expect.any(Array), tokenListTruncated: expect.any(Boolean), normalizedCorpusChecksum: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    })]));
    expect(JSON.stringify(result.coverageDiagnostics)).not.toContain("The unique synthetic moving service.");
  });

  it("reports an absent canonical mapping without pretending semantic evidence was evaluated", () => {
    const brief = fixtureBrief({ requirements: [...cleanBriefV3.requirements, { id: "REQUIREMENT:unmapped-service", category: "FEATURE", statement: "Provide the unmapped synthetic service.", sourceRefs: ["fixture:unmapped-service"] }] });
    const fixture = packageFor(brief);
    const candidate = PlanningPackageSchema.parse(withoutRequirementReference(fixture.packageValue, "REQUIREMENT:unmapped-service"));
    const result = admitted(candidate, fixture.input);
    expect(result.coverageDiagnostics).toEqual(expect.arrayContaining([expect.objectContaining({
      canonicalRequirementId: "REQUIREMENT:unmapped-service",
      category: "FEATURE",
      kind: "ABSENT_MAPPING",
      reason: "MISSING_REFERENCE",
      referenceStatus: "ABSENT",
      canonicalReferencesPresent: [],
      normalizedEvidence: {
        status: "NOT_EVALUATED",
        score: null,
        requiredTokenCount: 0,
        matchedTokenCount: 0,
        requiredTokens: [],
        matchedTokens: [],
        unmatchedTokens: [],
        tokenListTruncated: false,
        evaluatedFieldPaths: [],
        normalizedCorpusChecksum: null,
      },
    })]));
  });

  it("rejects loss of an approved service scope point without naming the pilot in host logic", () => {
    const serviceScope = [
      "Transport von M\u00f6beln",
      "Abholung und Lieferung",
      "Hilfe beim Be- und Entladen",
      "auf Wunsch Auf- und Abbau von M\u00f6beln",
    ];
    const brief = fixtureBrief({ requirements: [...cleanBriefV3.requirements, ...serviceScope.map((statement, index) => ({ id: `REQUIREMENT:service-scope-${index}`, category: "FEATURE" as const, statement, sourceRefs: [`fixture:service-scope:${index}`] }))] });
    const fixture = packageFor(brief);
    const candidate = {
      ...fixture.packageValue,
      productScope: {
        ...fixture.packageValue.productScope,
        inScopeCapabilities: fixture.packageValue.productScope.inScopeCapabilities.filter((value) => value !== serviceScope[2]),
      },
    };
    const result = admitted(candidate, fixture.input);

    expect(result.coverage).toEqual(expect.arrayContaining([expect.objectContaining({ requirementId: "REQUIREMENT:service-scope-2", reason: "MISSING_SEMANTIC_EVIDENCE" })]));
  });

  it("rejects legacy and unknown traceability references before persistence", () => {
    const fixture = packageFor(fixtureBrief());
    const legacy = {
      ...fixture.packageValue,
      traceability: fixture.packageValue.traceability.map((entry, index) => index === 0 ? { ...entry, requirementReferences: ["REQUIREMENT:legacy-v1-removed"] } : entry),
    };
    expect(() => admitted(legacy, fixture.input)).toThrow(/PLANNING_TRACEABILITY_LEGACY_REFERENCE/);

    const unknown = {
      ...fixture.packageValue,
      traceability: fixture.packageValue.traceability.map((entry, index) => index === 0 ? { ...entry, requirementReferences: ["REQUIREMENT:not-in-current-brief"] } : entry),
    };
    expect(() => admitted(unknown, fixture.input)).toThrow(/PLANNING_TRACEABILITY_UNKNOWN_REFERENCE/);
    const unknownPlanningHandle = {
      ...fixture.packageValue,
      traceability: fixture.packageValue.traceability.map((entry, index) => index === 0 ? { ...entry, requirementReferences: ["PLANNING:BRIEF_FIELD:not-current"] } : entry),
    };
    expect(() => admitted(unknownPlanningHandle, fixture.input)).toThrow(/PLANNING_TRACEABILITY_UNKNOWN_REFERENCE/);

    const legacyOutsideTraceability = {
      ...fixture.packageValue,
      productScope: {
        ...fixture.packageValue.productScope,
        purpose: "See REQUIREMENT:legacy-v1-hidden before continuing.",
      },
    };
    expect(() => admitted(legacyOutsideTraceability, fixture.input)).toThrow(/PLANNING_TRACEABILITY_LEGACY_REFERENCE/);
  });

  it("does not admit routes or forms outside the current canonical decisions", () => {
    const fixture = packageFor(fixtureBrief());
    const route = {
      id: "route-unapproved",
      path: "/unapproved",
      titlePurpose: "Unapproved route",
      pageType: "content" as const,
      visibility: "public" as const,
      intendedUser: "Visitor",
      primaryGoal: "Unapproved route",
      contentResponsibilities: [],
      dataDependencies: [],
      formDependencies: [],
      authRequired: false,
      seoRelevant: false,
      parentId: undefined,
      navigationVisible: false,
      requirementReferences: ["PAGE:home"],
    };
    const candidate = {
      ...fixture.packageValue,
      sitemap: { ...fixture.packageValue.sitemap, routes: [...fixture.packageValue.sitemap.routes, route] },
    };
    expect(admitted(candidate, fixture.input).blockers).toEqual(expect.arrayContaining([expect.stringContaining("PLANNING_ROUTE_OUTSIDE_CANONICAL_PAGES")]));
  });

  it("allows a larger Brief delta when it genuinely changes form, data, auth, and route decisions", () => {
    const currentBrief = fixtureBrief();
    const nextBrief = fixtureBrief({
      pages: [...currentBrief.pages, { id: "PAGE:services", slug: "services", purpose: "Explain the synthetic service options.", sourceRefs: ["fixture:services-page"] }],
      requirements: [...currentBrief.requirements, { id: "REQUIREMENT:stateful-service", category: "FEATURE", statement: "Allow visitors to request a stateful synthetic service.", sourceRefs: ["fixture:stateful-service"] }],
      decisions: {
        ...currentBrief.decisions,
        form: { mode: "REAL", formPresent: true, validation: "ACTIVE", simulatedSuccessPolicy: "FORBIDDEN", transmissionMode: "API", persistenceMode: "DATABASE", serverProcessingMode: "SERVER", externalProviderMode: "NONE", privacyConsentMode: "OPTIONAL", interactionStates: [] },
        database: { mode: "SUPABASE" },
        auth: { mode: "REQUIRED" },
        routePolicy: { mode: "MULTI_PAGE" },
      },
    });
    const current = packageFor(currentBrief);
    const next = packageFor(nextBrief, current.input.projectId);
    const result = admitted(next.packageValue, next.input, current.packageValue);

    expect(result.blockers).toEqual([]);
    expect(result.changedDomains).toEqual(expect.arrayContaining(["forms", "data-model", "authentication", "routes", "pages", "architecture"]));
  });

  it("rejects an unrelated semantic architecture change without imposing a leaf-count limit", () => {
    const fixture = packageFor(fixtureBrief());
    const candidate = {
      ...fixture.packageValue,
      architecture: {
        ...fixture.packageValue.architecture,
        securityControls: [...fixture.packageValue.architecture.securityControls, "Unrelated synthetic architecture drift."],
      },
    };
    expect(admitted(candidate, fixture.input, fixture.packageValue).blockers).toEqual(expect.arrayContaining([expect.stringContaining("PLANNING_REFRESH_UNAUTHORIZED_DRIFT:architecture")]));
  });

  it("rejects unrelated security and form semantic rewrites during refresh", () => {
    const fixture = packageFor(fixtureBrief());
    const security = {
      ...fixture.packageValue,
      security: { ...fixture.packageValue.security, controls: [...fixture.packageValue.security.controls, { control: "Unrelated security rewrite.", scope: "Unrelated scope.", requirementReferences: ["REQUIREMENT:service"] }] },
    };
    const form = {
      ...fixture.packageValue,
      forms: { ...fixture.packageValue.forms, forms: fixture.packageValue.forms.forms.map((value) => ({ ...value, submissionMechanism: "server-action" as const })) },
    };
    expect(admitted(security, fixture.input, fixture.packageValue).blockers).toEqual(expect.arrayContaining([expect.stringContaining("PLANNING_REFRESH_UNAUTHORIZED_DRIFT:security")]));
    expect(admitted(form, fixture.input, fixture.packageValue).blockers).toEqual(expect.arrayContaining([expect.stringContaining("PLANNING_REFRESH_UNAUTHORIZED_DRIFT:forms")]));
  });

  it("allows a requirement-caused addition and its bounded derived fan-out", () => {
    const currentBrief = fixtureBrief();
    const nextBrief = fixtureBrief({ requirements: [...currentBrief.requirements, { id: "REQUIREMENT:additional-capability", category: "FEATURE", statement: "Provide a second synthetic service capability.", sourceRefs: ["fixture:additional-capability"] }] });
    const current = packageFor(currentBrief);
    const next = packageFor(nextBrief, current.input.projectId);
    const result = admitted(next.packageValue, next.input, current.packageValue);

    expect(result.blockers).toEqual([]);
    expect(result.introducedRequirementIds).toContain("REQUIREMENT:additional-capability");
    expect(result.changedDomains).toContain("product-scope");
  });

  it("preserves no-backend and client-only decisions across a bounded service refresh", () => {
    const currentBrief = fixtureBrief();
    const nextBrief = fixtureBrief({ requirements: [...currentBrief.requirements, { id: "REQUIREMENT:another-service", category: "FEATURE", statement: "Show another synthetic service option.", sourceRefs: ["fixture:another-service"] }] });
    const current = packageFor(currentBrief);
    const next = packageFor(nextBrief, current.input.projectId);
    const result = admitted(next.packageValue, next.input, current.packageValue);

    expect(result.blockers).toEqual([]);
    expect(result.candidate.architecture.backendPriority).toEqual([]);
    expect(result.candidate.architecture.serverActions).toEqual([]);
    expect(result.candidate.architecture.routeHandlers).toEqual([]);
    expect(result.candidate.supabase).toMatchObject({ postgres: false, auth: false, storage: false });
    expect(result.candidate.authentication).toMatchObject({ decision: "none", required: false });
    expect(result.candidate.forms.forms.every((form) => form.submissionMechanism === "client-only")).toBe(true);
  });

  it("rejects an adversarial provider candidate at the production service boundary with no Planning or Memory write", async () => {
    const fixture = await seededFixture();
    const valid = buildPlanningPackage(fixture.input);
    const bad = {
      ...valid,
      productScope: {
        ...valid.productScope,
        inScopeCapabilities: valid.productScope.inScopeCapabilities.filter((value) => value !== "Show the synthetic service overview."),
      },
    };
    let calls = 0;
    const provider: PlannerArchitectureProvider = { async plan() { calls += 1; return bad; } };
    const memory = new FakePlannerMemoryPort();
    const service = new PlannerArchitectService({ database: fixture.database, memory, provider });

    await expect(service.planApprovedProject(fixture.input)).rejects.toMatchObject({ code: "PLANNING_PACKAGE_INVALID" });
    expect(calls).toBe(1);
    expect([...fixture.database.documents.values()].some((row) => row.documentType === "planning-package")).toBe(false);
    expect(memory.documents.size).toBe(0);
  });

  it("preserves final coverage diagnostics through the real Planner and Workbench ledger path", async () => {
    const fixture = await seededFixture();
    const valid = buildPlanningPackage(fixture.input);
    const bad = {
      ...valid,
      productScope: {
        ...valid.productScope,
        inScopeCapabilities: valid.productScope.inScopeCapabilities.filter((value) => value !== "Show the synthetic service overview."),
      },
    };
    await new DocumentRepository(fixture.database).save(RequirementSpecificationSchema.parse(fixture.input.approvedBrief));
    const service = new PlannerArchitectService({ database: fixture.database, memory: new FakePlannerMemoryPort(), provider: { async plan() { return bad; } } });
    const correlationId = "13131313-1313-4131-8131-131313131313";
    const ledger = new WorkbenchOperationLedger(fixture.database, fixture.projectId, `workbench-planning:${fixture.projectId}`, correlationId);
    await ledger.reserve();
    let failure: unknown;
    try {
      await service.planApprovedProject(fixture.input);
    } catch (error) {
      failure = error;
    }
    const outerFailure = await ledger.fail(failure);
    const response = workbenchFailureResponse(outerFailure, { action: "generate-planning", projectId: fixture.projectId, correlationId });
    expect(response.response).toMatchObject({
      code: "PLANNING_PACKAGE_INVALID",
      finalAdmissionDiagnostics: {
        boundary: "FINAL_ADMISSION",
        coverage: {
          availability: "AVAILABLE",
          issueCount: 1,
          retainedIssueCount: 1,
          truncated: false,
          issues: [expect.objectContaining({ canonicalRequirementId: "REQUIREMENT:service", reason: "MISSING_SEMANTIC_EVIDENCE", referenceStatus: "PRESENT" })],
        },
      },
      canonicalPlanningPersisted: false,
      lifecycleMutated: false,
    });
    const persisted = await fixture.database.transaction((tx) => tx.getOperation({ operation: "workbench.planning", key: fixture.projectId }));
    expect(persisted).toMatchObject({ status: "FAILED", result: { finalAdmissionDiagnostics: { coverage: { issueCount: 1, retainedIssueCount: 1, truncated: false } }, canonicalPlanningPersisted: false, lifecycleMutated: false } });
    expect(JSON.stringify(persisted)).not.toContain("Show the synthetic service overview.");
  });

  it("rejects a stale CanonicalBrief that changes after provider return", async () => {
    const fixture = await seededFixture();
    const changedBrief = CanonicalBriefV3Schema.parse({ ...fixture.input.canonicalBrief, summary: "Synthetic concurrent Brief change." });
    const changedDocument = createBriefV3Document({ projectId: fixture.projectId, projectVersion: 1, brief: changedBrief, createdAt: timestamp, updatedAt: timestamp });
    const documents = new DocumentRepository(fixture.database);
    const provider: PlannerArchitectureProvider = { async plan() {
      await documents.save(BriefV3DocumentSchema.parse({
        ...changedDocument,
        approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-user", approvedCanonicalChecksum: changedDocument.briefChecksum },
      }));
      return buildPlanningPackage(fixture.input);
    } };
    const service = new PlannerArchitectService({ database: fixture.database, memory: new FakePlannerMemoryPort(), provider });

    await expect(service.planApprovedProject(fixture.input)).rejects.toMatchObject({ code: "BRIEF_CHECKSUM_MISMATCH" });
    expect([...fixture.database.documents.values()].some((row) => row.documentType === "planning-package")).toBe(false);
  });

  it("does not make a semantically incomplete current package approval-eligible", async () => {
    const brief = fixtureBrief({ requirements: [...cleanBriefV3.requirements, { id: "REQUIREMENT:approval-coverage", category: "FEATURE", statement: "Include the approval coverage capability.", sourceRefs: ["fixture:approval-coverage"] }] });
    const fixture = await seededFixture(brief);
    const valid = buildPlanningPackage(fixture.input);
    const bad = PlanningPackageSchema.parse({
      ...valid,
      productScope: {
        ...valid.productScope,
        inScopeCapabilities: valid.productScope.inScopeCapabilities.filter((value) => value !== "Include the approval coverage capability."),
      },
    });
    await new DocumentRepository(fixture.database).save(bad);
    const service = new PlannerArchitectService({ database: fixture.database, memory: new FakePlannerMemoryPort() });
    const validation = await service.validatePlanningPackage(fixture.projectId, 1);

    expect(validation.ready).toBe(false);
    await expect(service.acceptPlanningPackage({ projectId: fixture.projectId, projectVersion: 1, planningChecksum: checksumPersistedDocument(bad), acceptedBy: "synthetic-user", acceptedAt: timestamp, expectedRowVersion: 1, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "ARCHITECTURE_BLOCKED" });
    expect(fixture.database.projects.get(fixture.projectId)?.workflow_state).toBe("AWAITING_PLANNING_GENERATION");
    expect((await fixture.database.transaction((tx) => tx.listDecisions(fixture.projectId, 1)))).toHaveLength(0);
  });

  it("does not let Project Memory legitimize an invalid accepted projection", async () => {
    const fixture = await seededFixture();
    const valid = buildPlanningPackage(fixture.input);
    const bad = PlanningPackageSchema.parse({
      ...valid,
      productScope: {
        ...valid.productScope,
        inScopeCapabilities: valid.productScope.inScopeCapabilities.filter((value) => value !== "Show the synthetic service overview."),
      },
      accepted: true,
      acceptance: { acceptedAt: timestamp, acceptedBy: "synthetic-user", checksum: checksumPersistedDocument(valid) },
      architecture: { ...valid.architecture, acceptance: { accepted: true, acceptedAt: timestamp, acceptedBy: "synthetic-user" } },
    });
    await new DocumentRepository(fixture.database).save(bad);
    await new DecisionRepository(fixture.database).append(fixture.projectId, 1, {
      id: randomUUID(),
      timestamp,
      actorType: "user",
      actorIdentifier: "synthetic-user",
      category: "planning-acceptance",
      decision: "Synthetic accepted projection fixture.",
      rationale: "The fixture is intentionally invalid for admission coverage.",
      affectedDocuments: ["planning-package.json"],
      requirementChange: false,
      userApprovalRequired: false,
      userApprovalStatus: "not-required",
    });
    const memory = new FakePlannerMemoryPort();
    const service = new PlannerArchitectService({ database: fixture.database, memory });

    await expect(service.reconcileAcceptedPlanningProjection(fixture.projectId, 1)).rejects.toMatchObject({ code: "PLANNING_NOT_ACCEPTED" });
    expect(memory.documents.size).toBe(0);
  });

  it("keeps the document and semantic checksum domains distinct", () => {
    const fixture = packageFor(fixtureBrief());
    const admittedPackage = admitted(fixture.packageValue, fixture.input).candidate;
    const accepted = { ...admittedPackage, accepted: true, acceptance: { acceptedAt: timestamp, acceptedBy: "synthetic-user", checksum: checksumPersistedDocument(admittedPackage) } };
    expect(planningSemanticChecksum(accepted)).toBe(planningSemanticChecksum(admittedPackage));
    expect(checksumPersistedDocument(accepted)).not.toBe(checksumPersistedDocument(admittedPackage));
  });
});
