import { describe, expect, it } from "vitest";
import { emptyBriefV2Fields } from "@/domain/requirements/brief";
import { RequirementSpecificationSchema, type RequirementSpecification } from "@/domain/requirements/schema";
import { CanonicalBriefV3Schema, type CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import { cleanBriefV3, representativeV1Brief } from "@/domain/requirements/v3/fixtures";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { admitPlanningRefresh } from "./refresh-admission";
import { createPlannerReferenceTable } from "./reference-table";
import {
  admitPlanningCoverage,
  admitPlanningDecomposition,
  assembleStagedPlanningCandidate,
  finalizePlanningElementGraph,
  requiredPlannerDecompositionDomains,
  stagedProviderContractMetrics,
} from "./staged-admission";
import { PlanningDecompositionProviderOutputSchema } from "./staged-contracts";
import { PlannerReferenceBindingError } from "@/integrations/openai/adapters";
import { PlannerArchitectService } from "./service";
import { FakePlannerMemoryPort } from "./memory";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { ProjectRepository, ProjectVersionRepository, DocumentRepository } from "@/persistence/database/repositories";
import { createBriefV3Document, BriefV3DocumentSchema } from "@/persistence/database/brief-revision-v3-contracts";
import { FactoryProjectSchema } from "@/domain/project/schema";
import type { PlannerArchitectureProvider } from "./ports";

const projectId = "11111111-1111-4111-8111-111111111111";

function portalBrief(): CanonicalBriefV3 {
  return CanonicalBriefV3Schema.parse({
    ...cleanBriefV3,
    summary: "A synthetic Service Request Portal for customers and staff.",
    title: "Service Request Portal",
    scope: { protectedFunctionality: true, images: { required: false, sourceStrategy: "NONE" } },
    pages: ["home", "sign-in", "request", "requests", "request-detail", "staff", "history"].map((slug, index) => ({
      id: `PAGE:${slug}`,
      slug,
      purpose: `Service Request Portal ${slug} page for the approved pilot.`,
      sourceRefs: [`fixture:portal-page:${index}`],
    })),
    requirements: Array.from({ length: 117 }, (_, index) => ({
      id: `REQUIREMENT:portal-${String(index + 1).padStart(3, "0")}`,
      category: "FEATURE" as const,
      statement: `The Service Request Portal supports approved service request capability ${index + 1} for authenticated customers and staff.`,
      sourceRefs: [`fixture:portal-requirement:${index + 1}`],
    })),
    decisions: {
      ...cleanBriefV3.decisions,
      form: {
        mode: "REAL",
        formPresent: true,
        validation: "ACTIVE",
        simulatedSuccessPolicy: "FORBIDDEN",
        transmissionMode: "API",
        persistenceMode: "DATABASE",
        serverProcessingMode: "SERVER",
        externalProviderMode: "NONE",
        privacyConsentMode: "REQUIRED",
        interactionStates: [],
      },
      database: { mode: "SUPABASE" },
      auth: { mode: "REQUIRED" },
      routePolicy: { mode: "MULTI_PAGE" },
    },
  });
}

function portalV1Brief(): RequirementSpecification {
  const v2 = emptyBriefV2Fields();
  return RequirementSpecificationSchema.parse({
    ...representativeV1Brief,
    projectId,
    projectVersion: 1,
    projectSummary: "A synthetic Service Request Portal for customers and staff.",
    protectedFunctionalityRequired: true,
    imagesRequired: false,
    pages: ["home", "sign-in", "request", "requests", "request-detail", "staff", "history"].map((slug) => ({ slug, purpose: `Service Request Portal ${slug} page.` })),
    userRoles: ["authenticated customer", "staff operator"],
    features: ["Customers submit service requests.", "Staff review and update request status."],
    forms: ["Authenticated service request form."],
    backendRequirements: ["Persist service requests and status history through the approved backend."],
    supabaseRequirements: ["Use the approved Supabase database and authenticated server boundary."],
    authenticationDecision: "authentication-required",
    administrationDecision: "needed",
    userAcceptanceCriteria: ["Customers can submit a request and see its status.", "Staff can review requests and status history."],
    approval: { approved: true, approvedRequirementsChecksum: "a".repeat(64) },
    briefStatus: "approved",
    ...v2,
    formBehaviorRequirements: {
      ...v2.formBehaviorRequirements,
      formPresent: true,
      validation: "ACTIVE",
      successUx: "REAL",
      dataTransmission: "API",
      persistence: "DATABASE",
      thirdParty: "NONE",
      privacyCheckbox: "REQUIRED",
    },
  });
}

function portalInput(brief: RequirementSpecification, canonicalBrief: CanonicalBriefV3) {
  return {
    projectId,
    projectVersion: 1,
    approvedBrief: brief,
    canonicalBrief,
    approvedBriefChecksum: canonicalBriefChecksum(canonicalBrief),
    originalPromptReference: "synthetic-service-request-portal",
    clarificationEvidenceReferences: [],
    currentWorkflowState: "AWAITING_PLANNING_GENERATION" as const,
    existingDecisions: [],
    suppliedFiles: [],
    allowedSkills: [],
    idempotencyKey: "synthetic-staged-planner",
    expectedRowVersion: 1,
  };
}

function portalTable() {
  const brief = portalBrief();
  return { brief, table: createPlannerReferenceTable({ projectId, projectVersion: 1, approvedBriefChecksum: canonicalBriefChecksum(brief), idempotencyKey: "synthetic-staged-planner", expectedRowVersion: 1, canonicalBrief: brief }) };
}

function portalDecomposition() {
  const { brief, table } = portalTable();
  const elements = [
    { kind: "PRODUCT_SCOPE" as const, domain: "FRONTEND" as const, title: "Customer and staff request scope", description: "Defines the customer submission and staff review responsibilities for the portal." },
    ...table.pages.map((page, index) => ({ kind: "PAGE" as const, domain: "FRONTEND" as const, title: `${page.path} page responsibility`, description: `Presents the approved Service Request Portal ${page.path} experience to its authorized audience.`, pageTokens: [page.token], routeTokens: [table.routes[index]!.token], dependencies: index === 0 ? [] : [0] })),
    { kind: "ARCHITECTURE" as const, domain: "BACKEND" as const, title: "Authenticated backend boundary", description: "Processes authenticated service requests through the approved server boundary and authorization checks.", dependencies: [9] },
    { kind: "DATABASE_MODEL" as const, domain: "DATABASE" as const, title: "Request and status history data model", description: "Persists service requests and immutable status history with ownership and staff access rules." },
    { kind: "AUTHENTICATION" as const, domain: "SECURITY" as const, title: "Customer and staff authentication", description: "Authenticates customers and staff and enforces their distinct portal permissions." },
    { kind: "FORM" as const, domain: "BACKEND" as const, title: "Authenticated request submission", description: "Validates and submits the service request form through the real authenticated backend path.", pageTokens: ["PAGE_003"], routeTokens: ["ROUTE_003"], dependencies: [9, 10] },
    { kind: "USER_FLOW" as const, domain: "BACKEND" as const, title: "Request lifecycle flow", description: "Moves a submitted request through review, status updates, and customer-visible history.", dependencies: [0, 9, 10, 11] },
    { kind: "SECURITY" as const, domain: "SECURITY" as const, title: "Authorization and RLS controls", description: "Protects request ownership, staff operations, and status history with server authorization and RLS." },
    { kind: "TEST_STRATEGY" as const, domain: "QA" as const, title: "Portal quality gates", description: "Covers authenticated submission, status transitions, history visibility, and safe failure behavior." },
    { kind: "TRACEABILITY" as const, domain: "LIFECYCLE" as const, title: "Requirement evidence ledger", description: "Records host-bound evidence for each approved Planning requirement without replacing substantive targets." },
  ];
  return { brief, table, output: PlanningDecompositionProviderOutputSchema.parse({ schemaVersion: 1, providerContractVersion: "planner.decomposition.v1", complete: true, elements: elements.map((element) => ({ pageTokens: null, routeTokens: null, dependencies: null, negativeEvidence: null, negativeOnly: null, ...element })) }) };
}

function validCoverage(table: ReturnType<typeof portalTable>["table"], elementId = "PE_001") {
  const coverageByRequirement = Object.fromEntries(table.requirements.filter((entry) => entry.mandatory).map((entry) => [entry.token, {
    planningElementIds: [elementId],
    semanticEvidence: `This host-issued decomposition target implements: ${entry.summary}`,
  }]));
  return { schemaVersion: 1 as const, providerContractVersion: "planner.coverage.v1" as const, complete: true as const, coverageByRequirement };
}

function expectFailure(action: () => unknown, expected: Record<string, unknown>) {
  let failure: unknown;
  try {
    action();
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject(expected);
}

describe("staged Planner pipeline", () => {
  it("assigns opaque PE identity only after valid decomposition admission", () => {
    const { brief, table, output } = portalDecomposition();
    const elements = admitPlanningDecomposition({ output, table, brief: portalV1Brief(), canonicalBrief: brief });
    expect(elements.map((element) => element.elementId)).toContain("PE_001");
    expect(elements).toHaveLength(16);
    expect(elements.every((element) => !Object.hasOwn(element, "requirementReferences"))).toBe(true);
  });

  it("rejects unknown page/route tokens before PE assignment", () => {
    const { brief, table, output } = portalDecomposition();
    const invalid = { ...output, elements: output.elements.map((element, index) => index === 1 ? { ...element, pageTokens: ["PAGE_999"] } : element) };
    expectFailure(() => admitPlanningDecomposition({ output: invalid, table, brief: portalV1Brief(), canonicalBrief: brief }), { code: "PLANNING_DECOMPOSITION_ROUTE_UNKNOWN" });
  });

  it("rejects duplicate and generic pathological proposals", () => {
    const { brief, table, output } = portalDecomposition();
    const duplicate = { ...output, elements: [...output.elements, output.elements[0]!] };
    expectFailure(() => admitPlanningDecomposition({ output: duplicate, table, brief: portalV1Brief(), canonicalBrief: brief }), { code: "PLANNING_DECOMPOSITION_DUPLICATE" });
    const generic = { ...output, elements: output.elements.map((element, index) => index === 0 ? { ...element, description: "see plan" } : element) };
    expectFailure(() => admitPlanningDecomposition({ output: generic, table, brief: portalV1Brief(), canonicalBrief: brief }), { code: "PLANNING_DECOMPOSITION_PATHOLOGY" });
  });

  it("builds a deterministic graph and rejects cycles", () => {
    const { brief, table, output } = portalDecomposition();
    const elements = admitPlanningDecomposition({ output, table, brief: portalV1Brief(), canonicalBrief: brief });
    const graph = finalizePlanningElementGraph(elements);
    expect(graph.edges.every((edge) => edge.from.startsWith("PE_") && edge.to.startsWith("PE_"))).toBe(true);
    const cyclic = elements.map((element) => ({ ...element, dependencies: element.elementId === "PE_001" ? ["PE_002"] : element.elementId === "PE_002" ? ["PE_001"] : element.dependencies }));
    expectFailure(() => finalizePlanningElementGraph(cyclic), { code: "PLANNING_GRAPH_CYCLE" });
  });

  it("admits exact 117/117 host-issued coverage and rejects a nonexistent PE", () => {
    const { brief, table, output } = portalDecomposition();
    const elements = admitPlanningDecomposition({ output, table, brief: portalV1Brief(), canonicalBrief: brief });
    expect(table.requirements.filter((entry) => entry.mandatory)).toHaveLength(117);
    const coverage = validCoverage(table);
    expect(Object.keys(admitPlanningCoverage({ output: coverage, table, elements }).coverageByRequirement)).toHaveLength(117);
    expectFailure(() => admitPlanningCoverage({ output: { ...coverage, coverageByRequirement: { ...coverage.coverageByRequirement, REQ_001: { planningElementIds: ["PE_999"], semanticEvidence: "A substantive but unbound target." } } }, table, elements }), { code: "PLANNING_REQUIREMENT_COVERAGE_INVALID" });
    try {
      admitPlanningCoverage({ output: { ...coverage, coverageByRequirement: { ...coverage.coverageByRequirement, REQ_001: { planningElementIds: ["PE_999"], semanticEvidence: "A substantive but unbound target." } } }, table, elements });
    } catch (error) {
      expect(error).toBeInstanceOf(PlannerReferenceBindingError);
      expect((error as PlannerReferenceBindingError).reasonCode).toBe("PLANNING_COVERAGE_ELEMENT_NOT_FOUND");
    }
  });

  it("keeps exact requirement-key guards and excludes final identity from decomposition wire", () => {
    const { brief, table, output } = portalDecomposition();
    expect(() => PlanningDecompositionProviderOutputSchema.parse({
      ...output,
      elements: [{ ...output.elements[0]!, elementId: "PE_001" }],
    })).toThrow();
    const elements = admitPlanningDecomposition({ output, table, brief: portalV1Brief(), canonicalBrief: brief });
    const valid = validCoverage(table);
    expectFailure(() => admitPlanningCoverage({ output: { ...valid, coverageByRequirement: { ...valid.coverageByRequirement, "REQUIREMENT:not-canonical": valid.coverageByRequirement.REQ_001 } }, table, elements }), { code: "PLANNING_TRACEABILITY_UNKNOWN_REFERENCE" });
    const missing = Object.fromEntries(Object.entries(valid.coverageByRequirement).filter(([token]) => token !== "REQ_001"));
    expectFailure(() => admitPlanningCoverage({ output: { ...valid, coverageByRequirement: missing }, table, elements }), { code: "PLANNING_REQUIREMENT_COVERAGE_MISSING" });
  });

  it("keeps semantic kind/domain and generic catch-all guards fail-closed", () => {
    const { brief, table, output } = portalDecomposition();
    const elements = admitPlanningDecomposition({ output, table, brief: portalV1Brief(), canonicalBrief: brief });
    const valid = validCoverage(table);
    expectFailure(() => admitPlanningCoverage({ output: { ...valid, coverageByRequirement: { ...valid.coverageByRequirement, REQ_001: { planningElementIds: ["PE_014"], semanticEvidence: "Wrong security target." } } }, table, elements }), { reasonCode: "PLANNING_COVERAGE_KIND_INCOMPATIBLE" });
    expectFailure(() => admitPlanningCoverage({ output: { ...valid, coverageByRequirement: { ...valid.coverageByRequirement, REQ_001: { planningElementIds: ["PE_016"], semanticEvidence: "Traceability only." } } }, table, elements }), { reasonCode: "PLANNING_COVERAGE_GENERIC_CATCH_ALL" });
  });

  it("assembles only after staged gates and passes full canonical Planning admission", () => {
    const { brief, table, output } = portalDecomposition();
    const briefV1 = portalV1Brief();
    const elements = admitPlanningDecomposition({ output, table, brief: briefV1, canonicalBrief: brief });
    const graph = finalizePlanningElementGraph(elements);
    const coverage = admitPlanningCoverage({ output: validCoverage(table), table, elements });
    const candidate = assembleStagedPlanningCandidate({ plannerInput: portalInput(briefV1, brief), brief: briefV1, canonicalBrief: brief, plannerReferenceTable: table, elements, graph, coverage });
    const admission = admitPlanningRefresh({ candidate, canonicalBrief: brief, projectId, projectVersion: 1, approvedBriefChecksum: canonicalBriefChecksum(brief) });
    expect(candidate.planningPipelineVersion).toBe("planner.staged.v1");
    expect(admission.blockers).toEqual([]);
  });

  it("requires the stateful domains implied by the approved portal decisions", () => {
    const { brief } = portalDecomposition();
    expect(requiredPlannerDecompositionDomains({ brief: portalV1Brief(), canonicalBrief: brief })).toEqual(["BACKEND", "DATABASE", "FRONTEND", "SECURITY"]);
  });

  it("measures smaller per-call staged context while keeping reference authority bounded", () => {
    const { table } = portalTable();
    const metrics = stagedProviderContractMetrics({
      monolithicInput: { approvedBrief: portalV1Brief(), referenceTable: table, coverageByRequirement: Object.fromEntries(table.requirements.map((entry) => [entry.token, { planningElementIds: ["PE_001"], semanticEvidence: entry.summary }])) },
      decompositionInput: { approvedBrief: portalV1Brief(), pages: table.pages, routes: table.routes, requiredDomains: ["BACKEND", "DATABASE", "FRONTEND", "SECURITY"] },
      coverageInput: { requirements: table.requirements.filter((entry) => entry.mandatory), elements: ["PE_001", "PE_002", "PE_003"], graph: [] },
      table,
    });
    expect(metrics.monolithic.estimatedTokens).toBeGreaterThan(metrics.decomposition.estimatedTokens);
    expect(metrics.monolithic.estimatedTokens).toBeGreaterThan(metrics.coverage.estimatedTokens);
    expect(metrics.largestStage).toBe("coverage");
    expect(metrics.decomposition.referenceBytes).toBeGreaterThan(0);
    expect(metrics.coverage.referenceBytes).toBeGreaterThan(0);
  });

  it("rechecks currentness after decomposition and makes zero coverage calls when stale", async () => {
    const canonicalBrief = cleanBriefV3;
    const approvedBrief = RequirementSpecificationSchema.parse({ ...representativeV1Brief, projectId, projectVersion: 1 });
    const database = new InMemoryPersistenceDatabase();
    const timestamp = "2026-01-01T00:00:00.000Z";
    const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "staged-currentness", originalPrompt: "Synthetic staged currentness fixture.", currentVersion: 1, workflowState: "AWAITING_PLANNING_GENERATION" });
    await new ProjectRepository(database).create(project);
    await new ProjectVersionRepository(database).create({ id: "44444444-4444-4444-8444-444444444444", projectId, versionNumber: 1, state: "AWAITING_PLANNING_GENERATION", memoryRootPath: null, requirementsChecksum: canonicalBriefChecksum(canonicalBrief), selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
    const document = createBriefV3Document({ projectId, projectVersion: 1, brief: canonicalBrief, createdAt: timestamp, updatedAt: timestamp });
    await new DocumentRepository(database).save(BriefV3DocumentSchema.parse({ ...document, approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-user", approvedCanonicalChecksum: document.briefChecksum } }));
    const input = portalInput(approvedBrief, canonicalBrief);
    let coverageCalls = 0;
    const provider: PlannerArchitectureProvider = {
      async plan() { throw new Error("legacy path must not be called"); },
      async decompose(stageInput) {
        const changed = CanonicalBriefV3Schema.parse({ ...canonicalBrief, summary: "Changed after decomposition." });
        const changedDocument = createBriefV3Document({ projectId, projectVersion: 1, brief: changed, createdAt: timestamp, updatedAt: timestamp });
        await new DocumentRepository(database).save(BriefV3DocumentSchema.parse({ ...changedDocument, approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-user", approvedCanonicalChecksum: changedDocument.briefChecksum } }));
        const page = stageInput.plannerReferenceTable.pages[0]!;
        const route = stageInput.plannerReferenceTable.routes[0]!;
        return { schemaVersion: 1, providerContractVersion: "planner.decomposition.v1", complete: true, elements: [
          { kind: "PRODUCT_SCOPE", domain: "FRONTEND", title: "Synthetic scope", description: "Defines the approved synthetic portal scope.", pageTokens: null, routeTokens: null, dependencies: null, negativeEvidence: null, negativeOnly: null },
          { kind: "PAGE", domain: "FRONTEND", title: "Synthetic page", description: "Presents the approved synthetic portal page.", pageTokens: [page.token], routeTokens: [route.token], dependencies: null, negativeEvidence: null, negativeOnly: null },
        ] };
      },
      async assignCoverage() { coverageCalls += 1; throw new Error("coverage must not be reached"); },
    };
    await expect(new PlannerArchitectService({ database, memory: new FakePlannerMemoryPort(), provider }).planApprovedProject(input)).rejects.toMatchObject({ code: "PLANNING_STALE" });
    expect(coverageCalls).toBe(0);
    expect(database.documents.size).toBe(1);
  });

  it("does not advance or persist when Stage 1 admission fails", async () => {
    const canonicalBrief = portalBrief();
    const approvedBrief = portalV1Brief();
    const { output } = portalDecomposition();
    const database = new InMemoryPersistenceDatabase();
    const timestamp = "2026-01-01T00:00:00.000Z";
    const project = FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "staged-admission-failure", originalPrompt: "Synthetic staged admission fixture.", currentVersion: 1, workflowState: "AWAITING_PLANNING_GENERATION" });
    await new ProjectRepository(database).create(project);
    await new ProjectVersionRepository(database).create({ id: "55555555-5555-4555-8555-555555555555", projectId, versionNumber: 1, state: "AWAITING_PLANNING_GENERATION", memoryRootPath: null, requirementsChecksum: canonicalBriefChecksum(canonicalBrief), selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
    const document = createBriefV3Document({ projectId, projectVersion: 1, brief: canonicalBrief, createdAt: timestamp, updatedAt: timestamp });
    await new DocumentRepository(database).save(BriefV3DocumentSchema.parse({ ...document, approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-user", approvedCanonicalChecksum: document.briefChecksum } }));
    let coverageCalls = 0;
    const provider: PlannerArchitectureProvider = {
      async plan() { throw new Error("legacy path must not be called"); },
      async decompose() { return { ...output, elements: output.elements.map((element, index) => index === 1 ? { ...element, routeTokens: ["ROUTE_999"] } : element) }; },
      async assignCoverage() { coverageCalls += 1; throw new Error("coverage must not be reached"); },
    };
    await expect(new PlannerArchitectService({ database, memory: new FakePlannerMemoryPort(), provider }).planApprovedProject(portalInput(approvedBrief, canonicalBrief))).rejects.toMatchObject({ code: "PLANNING_PACKAGE_INVALID" });
    const current = await new ProjectRepository(database).getWithVersion(projectId);
    expect(current?.project.workflowState).toBe("AWAITING_PLANNING_GENERATION");
    expect(current?.rowVersion).toBe(1);
    expect(await new DocumentRepository(database).get(projectId, 1, "planning-package")).toBeNull();
    expect(coverageCalls).toBe(0);
  });
});
