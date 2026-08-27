import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildPlanningPackage, planningSemanticChecksum } from "./deterministic";
import { admitPlanningRefresh } from "./refresh-admission";
import { PlannerArchitectService } from "./service";
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
    currentWorkflowState: "AWAITING_DESIGN_SELECTION",
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
    workflowState: "AWAITING_DESIGN_SELECTION",
  });
  await new ProjectRepository(database).create(project);
  await new ProjectVersionRepository(database).create({
    id: randomUUID(),
    projectId,
    versionNumber: 1,
    state: "AWAITING_DESIGN_SELECTION",
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

describe("host-owned Planning refresh admission", () => {
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
    expect(fixture.database.projects.get(fixture.projectId)?.workflow_state).toBe("AWAITING_DESIGN_SELECTION");
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
