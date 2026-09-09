import { beforeEach, describe, expect, it } from "vitest";
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
  admitPlanningDecompositionSemantics,
  assertAdmissibleCoverageTargetCounts,
  assertAdmissibleCoverageTargetTableCurrent,
  assembleStagedPlanningCandidate,
  createAdmissibleCoverageTargetTable,
  deriveAdmissibleCoverageTargets,
  finalizePlanningElementGraph,
  planningElementGraphCycleDiagnostics,
  requiredPlannerDecompositionDomains,
  stagedElementDescriptorIndex,
  stagedProviderContractMetrics,
} from "./staged-admission";
import {
  PLANNER_DECOMPOSITION_CONTRACT_VERSION,
  PLANNER_DECOMPOSITION_PROVIDER_SCHEMA_NAME,
  PLANNER_COVERAGE_CONTRACT_VERSION,
  normalizePlanningCoverageProviderOutput,
  createPlanningCoverageProviderWireSchemaV1,
  PlanningDecompositionProviderOutputSchema,
  PlanningDecompositionProviderOutputV1Schema,
  type PlanningElement,
  type PlanningElementGraph,
  PlanningElementGraphSchema,
  createPlanningCoverageProviderWireSchema,
} from "./staged-contracts";
import {
  PLANNER_ELEMENT_KINDS_BY_DOMAIN,
  PLANNER_ELEMENT_KIND_DOMAINS,
  PlannerCoverageDomainSchema,
  PlannerCoverageElementKindSchema,
} from "./coverage-contract";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { PlannerReferenceBindingError, validatePlannerRequirementCoverage } from "@/integrations/openai/adapters";
import { PlannerArchitectService } from "./service";
import { FakePlannerMemoryPort } from "./memory";
import { InMemoryPersistenceDatabase } from "@/persistence/database/fake";
import { ProjectRepository, ProjectVersionRepository, DocumentRepository } from "@/persistence/database/repositories";
import type { PersistenceDatabase, PersistenceTransaction } from "@/persistence/database/types";
import { createBriefV3Document, BriefV3DocumentSchema } from "@/persistence/database/brief-revision-v3-contracts";
import { FactoryProjectSchema } from "@/domain/project/schema";
import type { PlannerArchitectureProvider } from "./ports";
import { AiProviderError } from "@/integrations/openai/errors";
import { clearStagedPlanningOperations, getStagedPlanningOperations, isStagedPlanningFailure, StagedPlanningOperationTelemetry } from "./staged-failures";
import { workbenchFailureResponse } from "@/runtime/workbench/diagnostics";
import { WorkbenchOperationLedger } from "@/runtime/workbench/operation-ledger";
import { buildProductionResponseFormat } from "@/integrations/openai/client";

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
  return { brief, table, output: PlanningDecompositionProviderOutputSchema.parse({ schemaVersion: 1, providerContractVersion: PLANNER_DECOMPOSITION_CONTRACT_VERSION, complete: true, elements: elements.map((element) => ({ pageTokens: null, routeTokens: null, dependencies: null, negativeEvidence: null, negativeOnly: null, ...element })) }) };
}

function validCoverage(table: ReturnType<typeof portalTable>["table"], elementId = "PE_001") {
  const coverageByRequirement = Object.fromEntries(table.requirements.filter((entry) => entry.mandatory).map((entry) => [entry.token, {
    planningElementIds: [elementId],
    semanticEvidence: `This host-issued decomposition target implements: ${entry.summary}`,
  }]));
  return { schemaVersion: 1 as const, providerContractVersion: "planner.coverage.v2" as const, complete: true as const, coverageByRequirement };
}

function coverageForTargets(table: ReturnType<typeof portalTable>["table"], targets: Record<string, readonly string[]>) {
  return {
    schemaVersion: 1 as const,
    providerContractVersion: PLANNER_COVERAGE_CONTRACT_VERSION,
    complete: true as const,
    coverageByRequirement: Object.fromEntries(table.requirements.filter((entry) => entry.mandatory).map((entry) => [entry.token, {
      planningElementIds: [targets[entry.token]![0]!],
      semanticEvidence: `This host-issued target substantively treats ${entry.token}.`,
    }])),
  };
}

function wireCoverageForTargets(table: ReturnType<typeof portalTable>["table"], targets: Record<string, readonly string[]>) {
  return {
    schemaVersion: 1 as const,
    providerContractVersion: PLANNER_COVERAGE_CONTRACT_VERSION,
    complete: true as const,
    coverageByRequirement: Object.fromEntries(table.requirements.filter((entry) => entry.mandatory).map((entry) => [entry.token, {
      planningElementRefs: [targets[entry.token]!.indexOf(targets[entry.token]![0]!)],
      semanticEvidence: `This host-issued target substantively treats ${entry.token}.`,
    }])),
  };
}

function portalTargetTable(table: ReturnType<typeof portalTable>["table"], elements: readonly PlanningElement[], graph: PlanningElementGraph) {
  return createAdmissibleCoverageTargetTable({
    table,
    elements,
    graph,
    binding: {
      projectId,
      projectVersion: 1,
      expectedRowVersion: 1,
      approvedBriefChecksum: table.approvedBriefChecksum,
      referenceTableChecksum: table.referenceTableChecksum,
      planningElementsChecksum: checksumPersistedDocument(elements),
      graphChecksum: checksumPersistedDocument(graph),
      coverageOperationId: table.operationChecksum,
      operationChecksum: table.operationChecksum,
      contractVersion: PLANNER_COVERAGE_CONTRACT_VERSION,
    },
  });
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

async function stagedService(provider: PlannerArchitectureProvider, memory: FakePlannerMemoryPort = new FakePlannerMemoryPort()) {
  const canonicalBrief = portalBrief();
  const approvedBrief = portalV1Brief();
  const database = new InMemoryPersistenceDatabase();
  const timestamp = "2026-01-01T00:00:00.000Z";
  await new ProjectRepository(database).create(FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "staged-observability", originalPrompt: "Synthetic staged observability fixture.", currentVersion: 1, workflowState: "AWAITING_PLANNING_GENERATION" }));
  await new ProjectVersionRepository(database).create({ id: "66666666-6666-4666-8666-666666666666", projectId, versionNumber: 1, state: "AWAITING_PLANNING_GENERATION", memoryRootPath: null, requirementsChecksum: canonicalBriefChecksum(canonicalBrief), selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
  const document = createBriefV3Document({ projectId, projectVersion: 1, brief: canonicalBrief, createdAt: timestamp, updatedAt: timestamp });
  await new DocumentRepository(database).save(BriefV3DocumentSchema.parse({ ...document, approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-user", approvedCanonicalChecksum: document.briefChecksum } }));
  return { database, service: new PlannerArchitectService({ database, memory, provider }), input: portalInput(approvedBrief, canonicalBrief) };
}

function failingPlanningDatabase(inner: InMemoryPersistenceDatabase): PersistenceDatabase {
  return {
    transaction: <T>(work: (transaction: PersistenceTransaction) => Promise<T>) => inner.transaction((transaction) => work(new Proxy(transaction, {
      get(target, property, receiver) {
        if (["saveDocument", "saveDocumentCAS", "updateProjectState"].includes(String(property))) return async () => { throw new Error("DATABASE_URL=private"); };
        return Reflect.get(target, property, receiver);
      },
    })) as Promise<T>),
  };
}

describe("staged Planner pipeline", () => {
  beforeEach(() => clearStagedPlanningOperations());
  it("certifies every compatibility pair from the single authority and rejects every other pair at the wire boundary", () => {
    const { brief, table, output } = portalDecomposition();
    const proposalFields = {
      title: "Synthetic compatibility target",
      description: "Represents one allowed typed decomposition target for the synthetic portal.",
      pageTokens: null,
      routeTokens: null,
      dependencies: null,
      negativeEvidence: null,
      negativeOnly: null,
    };
    let allowedPairs = 0;
    for (const domain of PlannerCoverageDomainSchema.options) {
      for (const kind of PLANNER_ELEMENT_KINDS_BY_DOMAIN[domain]) {
        allowedPairs += 1;
        const candidate = { ...output, elements: [...output.elements, { ...proposalFields, kind, domain, title: `Allowed ${domain} ${kind}` }] };
        expect(PlanningDecompositionProviderOutputSchema.safeParse(candidate).success).toBe(true);
        expect(() => admitPlanningDecomposition({ output: candidate, table, brief: portalV1Brief(), canonicalBrief: brief })).not.toThrow();
      }
    }
    expect(allowedPairs).toBe(Object.values(PLANNER_ELEMENT_KIND_DOMAINS).flat().length);
    for (const domain of PlannerCoverageDomainSchema.options) {
      for (const kind of PlannerCoverageElementKindSchema.options) {
        if (PLANNER_ELEMENT_KINDS_BY_DOMAIN[domain].includes(kind)) continue;
        const candidate = { ...output, elements: [{ ...proposalFields, kind, domain }] };
        expect(PlanningDecompositionProviderOutputSchema.safeParse(candidate).success).toBe(false);
      }
    }
  });

  it("keeps historical v1 decomposition evidence readable without using its broad wire contract for new requests", () => {
    const historical = {
      schemaVersion: 1 as const,
      providerContractVersion: "planner.decomposition.v1" as const,
      complete: true as const,
      elements: [{
        kind: "DATABASE_MODEL" as const,
        domain: "FRONTEND" as const,
        title: "Historical invalid pair",
        description: "A historical v1 proposal retained for evidence readability.",
        pageTokens: null,
        routeTokens: null,
        dependencies: null,
        negativeEvidence: null,
        negativeOnly: null,
      }],
    };
    expect(PlanningDecompositionProviderOutputV1Schema.parse(historical).providerContractVersion).toBe("planner.decomposition.v1");
    expect(PlanningDecompositionProviderOutputSchema.safeParse({ ...historical, providerContractVersion: PLANNER_DECOMPOSITION_CONTRACT_VERSION }).success).toBe(false);
  });

  it("retains the deterministic mismatch guard for an internal typed bypass and emits only bounded enum diagnostics", () => {
    const { brief, table, output } = portalDecomposition();
    const invalid = { ...output, elements: output.elements.map((element, index) => index === 0 ? { ...element, kind: "DATABASE_MODEL" as const, domain: "FRONTEND" as const } : element) };
    expectFailure(() => admitPlanningDecompositionSemantics({ output: invalid as never, table, brief: portalV1Brief(), canonicalBrief: brief }), {
      reasonCode: "PLANNING_DECOMPOSITION_KIND_DOMAIN_MISMATCH",
      kindDomainDiagnostics: {
        actualDomain: "FRONTEND",
        actualKind: "DATABASE_MODEL",
        allowedKindsForDomain: PLANNER_ELEMENT_KINDS_BY_DOMAIN.FRONTEND,
        elementIndex: 0,
      },
    });
  });

  it("projects kind/domain diagnostics through the staged failure envelope without provider prose", () => {
    const telemetry = new StagedPlanningOperationTelemetry({
      operationId: `workbench-planning:${projectId}`,
      operationChecksum: "a".repeat(64),
      correlationId: "66666666-6666-4666-8666-666666666666",
      projectId,
      briefChecksum: "b".repeat(64),
    });
    telemetry.enter("DECOMPOSITION_ADMISSION");
    telemetry.beginProvider("decomposition", PLANNER_DECOMPOSITION_PROVIDER_SCHEMA_NAME);
    telemetry.providerSucceeded({ stage: "decomposition", providerContract: PLANNER_DECOMPOSITION_PROVIDER_SCHEMA_NAME });
    const failure = telemetry.fail({
      stage: "DECOMPOSITION_ADMISSION",
      outerCode: "PLANNING_PACKAGE_INVALID",
      failureClass: "STAGED_DECOMPOSITION_FAILURE",
      reasonCode: "PLANNING_DECOMPOSITION_KIND_DOMAIN_MISMATCH",
      kindDomainDiagnostics: { actualDomain: "FRONTEND", actualKind: "DATABASE_MODEL", allowedKindsForDomain: [...PLANNER_ELEMENT_KINDS_BY_DOMAIN.FRONTEND], elementIndex: 7 },
      message: "private title and description must not escape",
    });
    const response = workbenchFailureResponse(failure, { action: "approve-planning", projectId, correlationId: "66666666-6666-4666-8666-666666666666" });
    expect(response.response).toMatchObject({ reasonCode: "PLANNING_DECOMPOSITION_KIND_DOMAIN_MISMATCH", kindDomainDiagnostics: { actualDomain: "FRONTEND", actualKind: "DATABASE_MODEL", allowedKindsForDomain: [...PLANNER_ELEMENT_KINDS_BY_DOMAIN.FRONTEND], elementIndex: 7 } });
    expect(JSON.stringify(response)).not.toContain("private title and description");
  });

  it("assigns opaque PE identity only after valid decomposition admission", () => {
    const { brief, table, output } = portalDecomposition();
    const elements = admitPlanningDecomposition({ output, table, brief: portalV1Brief(), canonicalBrief: brief });
    expect(elements.map((element) => element.elementId)).toContain("PE_001");
    expect(elements).toHaveLength(16);
    expect(elements.every((element) => !Object.hasOwn(element, "requirementReferences"))).toBe(true);
  });

  it("bridges a raw decomposition provider fault to the durable outer ledger", async () => {
    const provider: PlannerArchitectureProvider = {
      plan: async () => { throw new Error("legacy provider must not run"); },
      decompose: async (_input, _skills, _identity, providerInvocation) => { await providerInvocation?.invocation?.beforeTransport(); throw new Error("PRIVATE_PROVIDER_PAYLOAD"); },
      assignCoverage: async () => { throw new Error("coverage must not run"); },
    };
    const fixture = await stagedService(provider);
    const correlationId = "50505050-5050-4550-8550-505050505050";
    const ledger = new WorkbenchOperationLedger(fixture.database, projectId, "workbench-planning:11111111-1111-4111-8111-111111111111", correlationId);
    await ledger.bindCurrentness({ projectVersion: 1, rowVersion: 1, briefChecksum: canonicalBriefChecksum(fixture.input.canonicalBrief) });
    await ledger.reserve();
    await expect(fixture.service.planApprovedProject(fixture.input, { correlationId, providerInvocationLedger: ledger })).rejects.toMatchObject({ code: "PLANNER_PROVIDER_FAILED" });
    expect(ledger.snapshot()).toMatchObject({ providerCallsTotal: 1, providerCallsByStage: { decomposition: { attempted: 1, started: 1, responseReceived: 0, failed: 1 }, coverage: { attempted: 0 } } });
  });

  it("does not bypass a durable staged operation through the legacy monolithic provider", async () => {
    const fixture = await stagedService({ plan: async () => { throw new Error("legacy provider must not run"); } });
    const correlationId = "51515151-5151-4515-8515-515151515151";
    const ledger = new WorkbenchOperationLedger(fixture.database, projectId, `workbench-planning:${projectId}`, correlationId);
    await ledger.bindCurrentness({ projectVersion: 1, rowVersion: 1, briefChecksum: canonicalBriefChecksum(fixture.input.canonicalBrief) });
    await ledger.reserve();
    await expect(fixture.service.planApprovedProject(fixture.input, { correlationId, providerInvocationLedger: ledger })).rejects.toMatchObject({ code: "PLANNING_PACKAGE_INVALID" });
    expect(ledger.snapshot().providerCallsTotal).toBe(0);
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

  it("reports deterministic minimal safe diagnostics for self, two-node, and three-node cycles", () => {
    const { brief, table, output } = portalDecomposition();
    const elements = admitPlanningDecomposition({ output, table, brief: portalV1Brief(), canonicalBrief: brief });
    const twoNode = elements.map((element) => ({
      ...element,
      dependencies: element.elementId === "PE_001" ? ["PE_002"] : element.elementId === "PE_002" ? ["PE_001"] : element.dependencies,
    }));
    expect(planningElementGraphCycleDiagnostics(twoNode)).toMatchObject({
      cycleLength: 2,
      cyclePeTokens: ["PE_001", "PE_002"],
      cycleEdges: [
        { fromPE: "PE_001", toPE: "PE_002", relationshipType: "DEPENDS_ON", source: "PROVIDER_DECLARED", fromDomain: "FRONTEND", fromKind: "PRODUCT_SCOPE", toDomain: "FRONTEND", toKind: "PAGE" },
        { fromPE: "PE_002", toPE: "PE_001", relationshipType: "DEPENDS_ON", source: "PROVIDER_DECLARED", fromDomain: "FRONTEND", fromKind: "PAGE", toDomain: "FRONTEND", toKind: "PRODUCT_SCOPE" },
      ],
    });
    expect(() => finalizePlanningElementGraph(twoNode)).toThrow(/PLANNING_GRAPH_CYCLE/);

    const threeNode = elements.map((element) => ({
      ...element,
      dependencies: element.elementId === "PE_001" ? ["PE_002"] : element.elementId === "PE_002" ? ["PE_003"] : element.elementId === "PE_003" ? ["PE_001"] : [],
    }));
    expect(planningElementGraphCycleDiagnostics(threeNode)).toMatchObject({ cycleLength: 3, cyclePeTokens: ["PE_001", "PE_002", "PE_003"] });
    expect(() => finalizePlanningElementGraph(threeNode)).toThrow(/PLANNING_GRAPH_CYCLE/);

    const selfCycle = elements.map((element) => ({ ...element, dependencies: element.elementId === "PE_001" ? ["PE_001"] : [] }));
    expect(planningElementGraphCycleDiagnostics(selfCycle)).toMatchObject({ cycleLength: 1, cyclePeTokens: ["PE_001"], cycleEdges: [{ fromPE: "PE_001", toPE: "PE_001" }] });
    expect(() => finalizePlanningElementGraph(selfCycle)).toThrow(/PLANNING_GRAPH_CYCLE/);
  });

  it("accepts shared dependency DAGs and keeps associations outside the dependency edge contract", () => {
    const { brief, table, output } = portalDecomposition();
    const elements = admitPlanningDecomposition({ output, table, brief: portalV1Brief(), canonicalBrief: brief });
    const shared = elements.map((element) => ({
      ...element,
      dependencies: element.elementId === "PE_002" || element.elementId === "PE_003"
        ? ["PE_001"]
        : element.elementId === "PE_004" ? ["PE_002", "PE_003"] : [],
    }));
    const graph = finalizePlanningElementGraph(shared);
    expect(planningElementGraphCycleDiagnostics(shared)).toBeUndefined();
    expect(graph.edges.every((edge) => edge.relation === "DEPENDS_ON")).toBe(true);
    expect(PlanningElementGraphSchema.safeParse({
      ...graph,
      edges: [...graph.edges, { from: "PE_002", to: "PE_003", relation: "INTEGRATES_WITH" }],
    }).success).toBe(false);
  });

  it("admits exact 117/117 host-issued coverage and rejects a nonexistent PE", () => {
    const { brief, table, output } = portalDecomposition();
    const elements = admitPlanningDecomposition({ output, table, brief: portalV1Brief(), canonicalBrief: brief });
    expect(table.requirements.filter((entry) => entry.mandatory)).toHaveLength(117);
    const coverage = validCoverage(table);
    expect(Object.keys(admitPlanningCoverage({ output: coverage, table, elements }).coverageByRequirement)).toHaveLength(117);
    expectFailure(() => admitPlanningCoverage({ output: { ...coverage, coverageByRequirement: { ...coverage.coverageByRequirement, REQ_001: { planningElementIds: ["PE_999"], semanticEvidence: "A substantive but unbound target." } } }, table, elements }), { code: "PLANNING_REQUIREMENT_COVERAGE_INVALID", reasonCode: "PLANNING_COVERAGE_ELEMENT_NOT_FOUND" });
    try {
      validatePlannerRequirementCoverage({ REQ_001: { planningElementIds: ["PE_999"], semanticEvidence: "A substantive but unbound target." } }, table, {}, stagedElementDescriptorIndex(elements));
    } catch (error) {
      expect(error).toBeInstanceOf(PlannerReferenceBindingError);
      expect((error as PlannerReferenceBindingError).reasonCode).toBe("PLANNING_COVERAGE_ELEMENT_NOT_FOUND");
    }
  });

  it("derives sufficient host-owned targets for every mandatory requirement and admits 117/117 through Coverage v2", () => {
    const { brief, table, output } = portalDecomposition();
    const elements = admitPlanningDecomposition({ output, table, brief: portalV1Brief(), canonicalBrief: brief });
    const graph = finalizePlanningElementGraph(elements);
    const targets = deriveAdmissibleCoverageTargets(table, elements);
    const mandatory = table.requirements.filter((entry) => entry.mandatory);
    const counts = mandatory.map((entry) => targets[entry.token]!.length);
    expect(mandatory).toHaveLength(117);
    expect(counts.every((count, index) => count >= mandatory[index]!.coverageConstraints.minimumCoverageTargets)).toBe(true);
    expect(counts.filter((count) => count === 0)).toHaveLength(0);
    expect(new Set(Object.keys(targets))).toEqual(new Set(mandatory.map((entry) => entry.token)));
    const targetTable = portalTargetTable(table, elements, graph);
    expect(() => assertAdmissibleCoverageTargetCounts({ table, targetTable })).not.toThrow();
    const outputV2 = coverageForTargets(table, targets);
    const wireOutputV2 = wireCoverageForTargets(table, targets);
    const schema = createPlanningCoverageProviderWireSchema(table, targets);
    expect(schema.safeParse(wireOutputV2).success).toBe(true);
    expect(normalizePlanningCoverageProviderOutput(wireOutputV2, table, targets)).toEqual(outputV2);
    const admitted = admitPlanningCoverage({ output: outputV2, table, elements, admissibleCoverageTargetsByRequirement: targets });
    expect(Object.keys(admitted.coverageByRequirement)).toHaveLength(117);
    expect(admitted.providerContractVersion).toBe(PLANNER_COVERAGE_CONTRACT_VERSION);
    const narrowedTargets = { ...targets, REQ_001: targets.REQ_001!.slice(1) };
    expectFailure(() => admitPlanningCoverage({ output: outputV2, table, elements, admissibleCoverageTargetsByRequirement: narrowedTargets }), { code: "PLANNING_REQUIREMENT_COVERAGE_INVALID", reasonCode: "PLANNING_COVERAGE_TARGET_NOT_ADMISSIBLE" });
    const redactedProviderInput = {
      stage: "PLANNING_REQUIREMENT_COVERAGE",
      requirements: mandatory.map(({ token, summary, category, coverageConstraints }) => ({ token, summary, category, coverageConstraints })),
      requiredRequirementTokens: mandatory.map((entry) => entry.token),
      admissibleCoverageTargetsByRequirement: targets,
      planningElements: elements.map(({ elementId, kind, domain, title, description, pageTokens, routeTokens }) => ({ elementId, kind, domain, title, description, pageTokens, routeTokens })),
      graph: graph.edges,
    };
    const v1SchemaBytes = Buffer.byteLength(JSON.stringify(buildProductionResponseFormat(createPlanningCoverageProviderWireSchemaV1(table), "planning-coverage-v1")), "utf8");
    const v2SchemaBytes = Buffer.byteLength(JSON.stringify(buildProductionResponseFormat(schema, "planning-coverage-v2")), "utf8");
    const providerInputBytes = Buffer.byteLength(JSON.stringify(redactedProviderInput), "utf8");
    expect(v2SchemaBytes).toBeGreaterThan(v1SchemaBytes);
    expect(providerInputBytes).toBeLessThan(384_000);
  });

  it("keeps historical Coverage v1 readable while rejecting its broad contract for current v2", () => {
    const { table } = portalTable();
    const historical = validCoverage(table);
    const v1 = { ...historical, providerContractVersion: "planner.coverage.v1" as const };
    expect(createPlanningCoverageProviderWireSchemaV1(table).safeParse(v1).success).toBe(true);
    expect(createPlanningCoverageProviderWireSchema(table, Object.fromEntries(table.requirements.filter((entry) => entry.mandatory).map((entry) => [entry.token, ["PE_001"]]))).safeParse(v1).success).toBe(false);
  });

  it("rejects structurally incompatible v2 targets before host semantic admission", () => {
    const { brief, table, output } = portalDecomposition();
    const elements = admitPlanningDecomposition({ output, table, brief: portalV1Brief(), canonicalBrief: brief });
    const targets = deriveAdmissibleCoverageTargets(table, elements);
    const schema = createPlanningCoverageProviderWireSchema(table, targets);
    const wire = wireCoverageForTargets(table, targets);
    const rejectedIndex = (reference: number) => schema.safeParse({
      ...wire,
      coverageByRequirement: { ...wire.coverageByRequirement, REQ_001: { planningElementRefs: [reference], semanticEvidence: "A substantive synthetic target." } },
    }).success;
    expect(targets.REQ_001).not.toContain("PE_014");
    expect(rejectedIndex(targets.REQ_001!.length)).toBe(false);
    expect(schema.safeParse({ ...wire, coverageByRequirement: { ...wire.coverageByRequirement, REQ_001: { planningElementIds: ["PE_999"], semanticEvidence: "A substantive synthetic target." } } }).success).toBe(false);
    const wrongDomainTable = { ...table, requirements: table.requirements.map((entry) => entry.token === "REQ_001" ? { ...entry, coverageConstraints: { ...entry.coverageConstraints, allowedDomains: ["DATABASE"] as const, allowedElementKinds: ["PRODUCT_SCOPE"] as const } } : entry) } as typeof table;
    const domainElements = [...elements, { ...elements[0]!, elementId: "PE_017", domain: "DATABASE" as const }];
    const domainTargets = deriveAdmissibleCoverageTargets(wrongDomainTable, domainElements);
    const domainSchema = createPlanningCoverageProviderWireSchema(wrongDomainTable, domainTargets);
    const domainValid = wireCoverageForTargets(wrongDomainTable, domainTargets);
    expect(domainTargets.REQ_001).not.toContain("PE_001");
    expect(domainSchema.safeParse({ ...domainValid, coverageByRequirement: { ...domainValid.coverageByRequirement, REQ_001: { planningElementRefs: [domainTargets.REQ_001!.length], semanticEvidence: "A substantive synthetic target." } } }).success).toBe(false);
    const pageTable = { ...table, requirements: table.requirements.map((entry) => entry.token === "REQ_001" ? { ...entry, coverageConstraints: { ...entry.coverageConstraints, allowedDomains: ["FRONTEND"] as const, allowedElementKinds: ["PAGE"] as const, requiredPageTokens: ["PAGE_002"], allowedPageTokens: ["PAGE_002"] } } : entry) } as typeof table;
    const pageTargets = deriveAdmissibleCoverageTargets(pageTable, elements);
    const pageSchema = createPlanningCoverageProviderWireSchema(pageTable, pageTargets);
    const pageValid = wireCoverageForTargets(pageTable, pageTargets);
    expect(pageTargets.REQ_001).not.toContain("PE_002");
    expect(pageSchema.safeParse({ ...pageValid, coverageByRequirement: { ...pageValid.coverageByRequirement, REQ_001: { planningElementRefs: [pageTargets.REQ_001!.length], semanticEvidence: "A substantive synthetic target." } } }).success).toBe(false);
    const routeTable = { ...table, requirements: table.requirements.map((entry) => entry.token === "REQ_001" ? { ...entry, coverageConstraints: { ...entry.coverageConstraints, allowedDomains: ["FRONTEND"] as const, allowedElementKinds: ["PAGE"] as const, requiredRouteTokens: ["ROUTE_002"], allowedRouteTokens: ["ROUTE_002"] } } : entry) } as typeof table;
    const routeTargets = deriveAdmissibleCoverageTargets(routeTable, elements);
    const routeSchema = createPlanningCoverageProviderWireSchema(routeTable, routeTargets);
    const routeValid = wireCoverageForTargets(routeTable, routeTargets);
    expect(routeTargets.REQ_001).not.toContain("PE_002");
    expect(routeSchema.safeParse({ ...routeValid, coverageByRequirement: { ...routeValid.coverageByRequirement, REQ_001: { planningElementRefs: [routeTargets.REQ_001!.length], semanticEvidence: "A substantive synthetic target." } } }).success).toBe(false);
  });

  it("retains host defense-in-depth diagnostics and rejects a stale target binding", () => {
    const { brief, table, output } = portalDecomposition();
    const elements = admitPlanningDecomposition({ output, table, brief: portalV1Brief(), canonicalBrief: brief });
    const graph = finalizePlanningElementGraph(elements);
    try {
      validatePlannerRequirementCoverage({ REQ_001: { planningElementIds: ["PE_014"], semanticEvidence: "Wrong kind target." } }, table, {}, stagedElementDescriptorIndex(elements));
      throw new Error("expected host admission failure");
    } catch (error) {
      expect(error).toMatchObject({ reasonCode: "PLANNING_COVERAGE_KIND_INCOMPATIBLE", coverageDiagnostics: { requirementToken: "REQ_001", actualKind: "SECURITY", admissibleTargetCount: expect.any(Number) } });
    }
    const targetTable = portalTargetTable(table, elements, graph);
    expect(() => assertAdmissibleCoverageTargetTableCurrent({ targetTable, table, elements: elements.map((element) => element.elementId === "PE_001" ? { ...element, title: "Changed typed target" } : element), graph, binding: targetTable.binding })).toThrowError(expect.objectContaining({ reasonCode: "PLANNING_COVERAGE_TARGETS_NOT_CURRENT" }));
    const impossible = { ...targetTable, admissibleCoverageTargetsByRequirement: { ...targetTable.admissibleCoverageTargetsByRequirement, REQ_001: [] } };
    expect(() => assertAdmissibleCoverageTargetCounts({ table, targetTable: impossible })).toThrowError(expect.objectContaining({ reasonCode: "PLANNING_COVERAGE_NO_ADMISSIBLE_TARGETS" }));
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
    expectFailure(() => admitPlanningCoverage({ output: { ...valid, coverageByRequirement: { ...valid.coverageByRequirement, REQ_001: { planningElementIds: ["PE_014"], semanticEvidence: "Wrong security target." } } }, table, elements }), { code: "PLANNING_REQUIREMENT_COVERAGE_INVALID", reasonCode: "PLANNING_COVERAGE_KIND_INCOMPATIBLE" });
    expectFailure(() => validatePlannerRequirementCoverage({ REQ_001: { planningElementIds: ["PE_014"], semanticEvidence: "Wrong security target." } }, table, {}, stagedElementDescriptorIndex(elements)), { reasonCode: "PLANNING_COVERAGE_KIND_INCOMPATIBLE" });
    expectFailure(() => validatePlannerRequirementCoverage({ REQ_001: { planningElementIds: ["PE_016"], semanticEvidence: "Traceability only." } }, table, {}, stagedElementDescriptorIndex(elements)), { reasonCode: "PLANNING_COVERAGE_GENERIC_CATCH_ALL" });
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
        return { schemaVersion: 1, providerContractVersion: PLANNER_DECOMPOSITION_CONTRACT_VERSION, complete: true, elements: [
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

  it("records one correlated decomposition transport failure and preserves it through Workbench", async () => {
    const correlationId = "22222222-2222-4222-8222-222222222222";
    const { service, input, database } = await stagedService({
      async plan() { throw new Error("legacy path must not be called"); },
      async decompose() {
        throw new AiProviderError("AI_NETWORK_ERROR", "private transport detail", undefined, { stage: "api_request", requestAttempted: true, apiResponseReceived: false, responseReceived: false, schemaName: PLANNER_DECOMPOSITION_PROVIDER_SCHEMA_NAME });
      },
      async assignCoverage() { throw new Error("coverage must not be reached"); },
    });
    let failure: unknown;
    try { await service.planApprovedProject(input, { correlationId }); } catch (error) { failure = error; }
    expect(isStagedPlanningFailure(failure)).toBe(true);
    const stagedFailure = failure! as { details: { stage: string; failureClass: string; reasonCode?: string; providerRequestCount: number; operation: { correlationId: string; providerCallsTotal: number; providerCallsByStage: { decomposition: { attempted: number; started: number; failed: number }; coverage: { attempted: number } }; canonicalPlanningPersisted: boolean; lifecycleMutated: boolean } } };
    expect(stagedFailure.details).toMatchObject({ stage: "DECOMPOSITION_PROVIDER", failureClass: "PROVIDER_TRANSPORT_FAILURE", reasonCode: "AI_NETWORK_ERROR", providerRequestCount: 1 });
    expect(stagedFailure.details.operation).toMatchObject({ correlationId, providerCallsTotal: 1, providerCallsByStage: { decomposition: { attempted: 1, started: 1, failed: 1 }, coverage: { attempted: 0 } }, canonicalPlanningPersisted: false, lifecycleMutated: false });
    expect(getStagedPlanningOperations().at(-1)).toMatchObject({ correlationId, stageFailed: "DECOMPOSITION_PROVIDER", providerCallsTotal: 1 });
    const response = workbenchFailureResponse(failure, { action: "approve-planning", projectId, correlationId });
    expect(response).toMatchObject({ status: 503, response: { code: "PLANNER_PROVIDER_FAILED", failureClass: "PROVIDER_TRANSPORT_FAILURE", stage: "DECOMPOSITION_PROVIDER", reasonCode: "AI_NETWORK_ERROR", providerRequestCount: 1, correlationId } });
    expect(JSON.stringify(response)).not.toContain("private transport detail");
    expect(await new DocumentRepository(database).get(projectId, 1, "planning-package")).toBeNull();
  });

  it("preserves the canonical unknown-reference guard through durable Workbench accounting", async () => {
    const { table, output } = portalDecomposition();
    const valid = validCoverage(table);
    const invalid = {
      ...valid,
      coverageByRequirement: {
        ...valid.coverageByRequirement,
        "REQUIREMENT:not-canonical": valid.coverageByRequirement.REQ_001,
      },
    };
    const { service, input, database } = await stagedService({
      async plan() { throw new Error("legacy path must not be called"); },
      async decompose(_input, _skills, _identity, providerInvocation) {
        await providerInvocation?.invocation?.beforeTransport();
        return output;
      },
      async assignCoverage(_input, _skills, _identity, providerInvocation) {
        await providerInvocation?.invocation?.beforeTransport();
        return invalid;
      },
    });
    const correlationId = "23232323-2323-4232-8232-232323232323";
    const ledger = new WorkbenchOperationLedger(database, projectId, `workbench-planning:${projectId}`, correlationId);
    await ledger.bindCurrentness({ projectVersion: 1, rowVersion: 1, briefChecksum: canonicalBriefChecksum(input.canonicalBrief) });
    await ledger.reserve();
    let failure: unknown;
    try {
      await service.planApprovedProject(input, { correlationId, providerInvocationLedger: ledger });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ details: { reasonCode: "PLANNING_TRACEABILITY_UNKNOWN_REFERENCE", operation: { providerCallsTotal: 2, providerCallsByStage: { decomposition: { attempted: 1 }, coverage: { attempted: 1 } }, canonicalPlanningPersisted: false, lifecycleMutated: false } } });
    const outerFailure = await ledger.fail(failure);
    const response = workbenchFailureResponse(outerFailure, { action: "approve-planning", projectId, correlationId });
    expect(response.response).toMatchObject({ code: "PLANNING_PACKAGE_INVALID", reasonCode: "PLANNING_TRACEABILITY_UNKNOWN_REFERENCE", providerRequestCount: 2, canonicalPlanningPersisted: false, lifecycleMutated: false });
    expect(await new DocumentRepository(database).get(projectId, 1, "planning-package")).toBeNull();
  });

  it("does not fabricate a provider attempt when an uninstrumented failure crosses the provider boundary", async () => {
    const { service, input } = await stagedService({
      async plan() { throw new Error("legacy path must not be called"); },
      async decompose() {
        throw new Error("un-instrumented provider failure");
      },
      async assignCoverage() { throw new Error("coverage must not be reached"); },
    });
    let failure: unknown;
    try {
      await service.planApprovedProject(input);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ details: {
      stage: "DECOMPOSITION_PROVIDER",
      failureClass: "PROVIDER_TRANSPORT_FAILURE",
      providerRequestCountExact: false,
      providerRequestCount: 0,
      operation: {
        providerRequestCountExact: false,
        providerRequestAttempted: false,
        providerRequestCount: 0,
        providerCallsTotal: 0,
        providerCallsByStage: { decomposition: { attempted: 0, started: 0, responseReceived: 0, failed: 1 } },
      },
    } });
  });

  it("attributes provider structured-output failure to decomposition parsing", async () => {
    const { service, input } = await stagedService({
      async plan() { throw new Error("legacy path must not be called"); },
      async decompose() {
        throw new AiProviderError("AI_OUTPUT_DOMAIN_INVALID", "private schema detail", undefined, { stage: "domain_validation", outputStage: "TRANSPORT_SCHEMA_VALIDATION_FAILED", requestAttempted: true, apiResponseReceived: true, responseReceived: true, schemaName: PLANNER_DECOMPOSITION_PROVIDER_SCHEMA_NAME, issueCode: "INVALID_TYPE", fieldPath: "elements[0].title" });
      },
      async assignCoverage() { throw new Error("coverage must not be reached"); },
    });
    await expect(service.planApprovedProject(input)).rejects.toMatchObject({ details: { stage: "DECOMPOSITION_PARSE", failureClass: "PROVIDER_STRUCTURED_OUTPUT_FAILURE", operation: { providerRequestCount: 1, providerCallsByStage: { decomposition: { attempted: 1, responseReceived: 1, structuredParsePassed: 0, failed: 1 } } } } });
  });

  it("stops after deterministic decomposition admission and retains the offending route token", async () => {
    const { service, input } = await stagedService({
      async plan() { throw new Error("legacy path must not be called"); },
      async decompose() { const output = portalDecomposition().output; return { ...output, elements: output.elements.map((element, index) => index === 1 ? { ...element, routeTokens: ["ROUTE_999"] } : element) }; },
      async assignCoverage() { throw new Error("coverage must not be reached"); },
    });
    await expect(service.planApprovedProject(input)).rejects.toMatchObject({ details: { stage: "DECOMPOSITION_ADMISSION", failureClass: "STAGED_REFERENTIAL_INTEGRITY_FAILURE", reasonCode: "PLANNING_DECOMPOSITION_ROUTE_UNKNOWN", safeToken: "ROUTE_999", operation: { providerRequestCount: 1, providerCallsByStage: { coverage: { attempted: 0 } } } } });
  });

  it("classifies non-referential decomposition admission failures separately", async () => {
    const { service, input } = await stagedService({
      async plan() { throw new Error("legacy path must not be called"); },
      async decompose() { const output = portalDecomposition().output; return { ...output, elements: output.elements.slice(0, 1) }; },
      async assignCoverage() { throw new Error("coverage must not be reached"); },
    });
    await expect(service.planApprovedProject(input)).rejects.toMatchObject({ details: { stage: "DECOMPOSITION_ADMISSION", failureClass: "STAGED_DECOMPOSITION_FAILURE", reasonCode: "PLANNING_DECOMPOSITION_MINIMUM_ELEMENTS", operation: { providerRequestCount: 1, providerCallsByStage: { coverage: { attempted: 0 } } } } });
  });

  it("rejects provider-declared dependency cycles before Coverage and retains graph diagnostics", async () => {
    const { service, input } = await stagedService({
      async plan() { throw new Error("legacy path must not be called"); },
      async decompose() { const output = portalDecomposition().output; return { ...output, elements: output.elements.map((element, index) => index === 0 ? { ...element, dependencies: [1] } : index === 1 ? { ...element, dependencies: [0] } : element) }; },
      async assignCoverage() { throw new Error("coverage must not be reached"); },
    });
    let failure: unknown;
    try {
      await service.planApprovedProject(input);
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ details: {
      stage: "DECOMPOSITION_ADMISSION",
      failureClass: "STAGED_DECOMPOSITION_FAILURE",
      reasonCode: "PLANNING_GRAPH_CYCLE",
      graphCycleDiagnostics: {
        cycleLength: 2,
        cyclePeTokens: ["PE_001", "PE_002"],
        cycleEdges: [
          { fromPE: "PE_001", toPE: "PE_002", relationshipType: "DEPENDS_ON", source: "PROVIDER_DECLARED" },
          { fromPE: "PE_002", toPE: "PE_001", relationshipType: "DEPENDS_ON", source: "PROVIDER_DECLARED" },
        ],
      },
      operation: { providerRequestCount: 1, providerCallsByStage: { decomposition: { attempted: 1 }, coverage: { attempted: 0 } } },
    } });
    const response = workbenchFailureResponse(failure, { action: "approve-planning", projectId, correlationId: "77777777-7777-4777-8777-777777777777" });
    expect(response.response).toMatchObject({
      reasonCode: "PLANNING_GRAPH_CYCLE",
      graphCycleDiagnostics: { cycleLength: 2, cyclePeTokens: ["PE_001", "PE_002"] },
    });
  });

  it("rejects a nonexistent coverage PE at the v2 provider boundary", async () => {
    const { service, input } = await stagedService({
      async plan() { throw new Error("legacy path must not be called"); },
      async decompose() { return portalDecomposition().output; },
      async assignCoverage(stageInput) { const valid = validCoverage(stageInput.plannerReferenceTable); return { ...valid, coverageByRequirement: { ...valid.coverageByRequirement, REQ_001: { planningElementIds: ["PE_999"], semanticEvidence: "A substantive synthetic target." } } }; },
    });
    await expect(service.planApprovedProject(input)).rejects.toMatchObject({ details: { stage: "COVERAGE_ADMISSION", failureClass: "STAGED_COVERAGE_FAILURE", reasonCode: "PLANNING_COVERAGE_ELEMENT_NOT_FOUND", safeToken: "PE_999", providerRequestCount: 2, operation: { providerCallsTotal: 2, providerCallsByStage: { decomposition: { attempted: 1, semanticAdmissionPassed: 1 }, coverage: { attempted: 1, completed: 1, semanticAdmissionPassed: 0 } } } } });
  });

  it("records a coverage provider transport failure with exact staged accounting", async () => {
    const { service, input } = await stagedService({
      async plan() { throw new Error("legacy path must not be called"); },
      async decompose() { return portalDecomposition().output; },
      async assignCoverage() {
        throw new AiProviderError("AI_NETWORK_ERROR", "private coverage transport detail", undefined, { stage: "api_request", requestAttempted: true, apiResponseReceived: false, responseReceived: false, schemaName: "planning-coverage-v2" });
      },
    });
    await expect(service.planApprovedProject(input)).rejects.toMatchObject({ details: { stage: "COVERAGE_PROVIDER", failureClass: "PROVIDER_TRANSPORT_FAILURE", reasonCode: "AI_NETWORK_ERROR", providerRequestCount: 2, operation: { providerCallsTotal: 2, providerCallsByStage: { decomposition: { attempted: 1, completed: 1 }, coverage: { attempted: 1, started: 1, responseReceived: 0, structuredParsePassed: 0, failed: 1 } } } } });
  });

  it("keeps internal staged boundaries typed and telemetry reads non-mutating", () => {
    const identity = { operationId: "synthetic-telemetry", operationChecksum: "c".repeat(64), correlationId: "55555555-5555-4555-8555-555555555555", projectId, briefChecksum: "d".repeat(64) };
    const assignmentTelemetry = new StagedPlanningOperationTelemetry(identity);
    assignmentTelemetry.enter("PE_ASSIGNMENT");
    const assignmentFailure = assignmentTelemetry.fail({ stage: "PE_ASSIGNMENT", outerCode: "PLANNING_PACKAGE_INVALID", failureClass: "FACTORY_PROTOCOL_DEFECT", reasonCode: "PLANNING_PE_ASSIGNMENT_FAILED", message: "private internal detail" });
    expect(assignmentFailure.details).toMatchObject({ stage: "PE_ASSIGNMENT", failureClass: "FACTORY_PROTOCOL_DEFECT", providerRequestCount: 0 });

    const finalTelemetry = new StagedPlanningOperationTelemetry({ ...identity, operationId: "synthetic-final-assembly", correlationId: "66666666-6666-4666-8666-666666666666" });
    const finalFailure = finalTelemetry.fail({ stage: "FINAL_ASSEMBLY", outerCode: "PLANNING_PACKAGE_INVALID", failureClass: "STAGED_FINAL_ASSEMBLY_FAILURE", reasonCode: "PLANNING_FINAL_ASSEMBLY_FAILED", message: "private assembly detail" });
    expect(finalFailure.details.stage).toBe("FINAL_ASSEMBLY");

    const firstRead = getStagedPlanningOperations();
    expect(firstRead).toHaveLength(2);
    firstRead[0]!.providerCallsByStage.decomposition.attempted = 99;
    const secondRead = getStagedPlanningOperations();
    expect(secondRead[0]!.providerCallsByStage.decomposition.attempted).toBe(0);
    expect(getStagedPlanningOperations()).toHaveLength(2);
  });

  it("records persistence failure without reporting a canonical Planning write", async () => {
    const inner = new InMemoryPersistenceDatabase();
    const canonicalBrief = portalBrief();
    const approvedBrief = portalV1Brief();
    const timestamp = "2026-01-01T00:00:00.000Z";
    await new ProjectRepository(inner).create(FactoryProjectSchema.parse({ schemaVersion: 1, documentType: "factory-project", projectId, projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, id: projectId, slug: "staged-persistence-failure", originalPrompt: "Synthetic persistence failure fixture.", currentVersion: 1, workflowState: "AWAITING_PLANNING_GENERATION" }));
    await new ProjectVersionRepository(inner).create({ id: "77777777-7777-4777-8777-777777777777", projectId, versionNumber: 1, state: "AWAITING_PLANNING_GENERATION", memoryRootPath: null, requirementsChecksum: canonicalBriefChecksum(canonicalBrief), selectedDesignChecksum: null, architectureChecksum: null, releasedAt: null, immutable: false, createdAt: timestamp, updatedAt: timestamp, rowVersion: 1 });
    const document = createBriefV3Document({ projectId, projectVersion: 1, brief: canonicalBrief, createdAt: timestamp, updatedAt: timestamp });
    await new DocumentRepository(inner).save(BriefV3DocumentSchema.parse({ ...document, approval: { approved: true, approvedAt: timestamp, approvedBy: "synthetic-user", approvedCanonicalChecksum: document.briefChecksum } }));
    const service = new PlannerArchitectService({ database: failingPlanningDatabase(inner), memory: new FakePlannerMemoryPort(), provider: { async plan() { throw new Error("legacy path must not be called"); }, async decompose() { return portalDecomposition().output; }, async assignCoverage(stageInput) { return validCoverage(stageInput.plannerReferenceTable); } } });
    await expect(service.planApprovedProject(portalInput(approvedBrief, canonicalBrief))).rejects.toMatchObject({ details: { stage: "PERSISTENCE", failureClass: "RUNTIME_PERSISTENCE_FAILURE", providerRequestCount: 2, operation: { canonicalPlanningPersisted: false, lifecycleMutated: false } } });
    expect(await new DocumentRepository(inner).get(projectId, 1, "planning-package")).toBeNull();
  });
});
