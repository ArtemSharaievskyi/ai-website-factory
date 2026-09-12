import { describe, expect, it } from "vitest";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { emptyBriefV2Fields } from "@/domain/requirements/brief";
import { CanonicalBriefV3Schema, type CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import { cleanBriefV3, representativeV1Brief } from "@/domain/requirements/v3/fixtures";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { createPlannerReferenceTable } from "./reference-table";
import {
  createDecompositionMinimumContract,
  DecompositionMinimumDiagnosticsSchema,
} from "./decomposition-minimum";
import {
  DECOMPOSITION_DOMAIN_BUCKET_BY_DOMAIN,
  PLANNER_DECOMPOSITION_CONTRACT_VERSION,
  PlanningDecompositionProviderOutputV2Schema,
  createHistoricalPlanningDecompositionProviderWireSchemaV3,
  normalizeHistoricalPlanningDecompositionProviderOutputV3,
  createPlanningDecompositionProviderWireSchema,
  normalizePlanningDecompositionProviderOutput,
  PlanningDecompositionProviderOutputSchema,
} from "./staged-contracts";
import { admitPlanningDecomposition, admitPlanningDecompositionSemantics, finalizePlanningElementGraph } from "./staged-admission";
import { deriveCoverageRepresentabilityPlan, type CoverageRepresentabilityPlan } from "./coverage-representability";
import { PLANNER_ELEMENT_KINDS_BY_DOMAIN, PlannerCoverageDomainSchema, PlannerCoverageElementKindSchema } from "./coverage-contract";
import { OpenAiPlannerProvider } from "@/integrations/openai/adapters";
import { OpenAiStructuredClient, buildProductionResponseFormat, type StructuredRequest } from "@/integrations/openai/client";
import { PlanningAdmissionFailurePredicateSchema } from "./staged-admission-diagnostics";

const projectId = "99999999-9999-4999-8999-999999999999";
const legacyBrief = RequirementSpecificationSchema.parse({ ...representativeV1Brief, projectId, projectVersion: 1 });
const legacyDefaults = emptyBriefV2Fields();
const frontendLegacyBrief = RequirementSpecificationSchema.parse({
  ...legacyBrief,
  formBehaviorRequirements: {
    ...legacyDefaults.formBehaviorRequirements,
    formPresent: true,
    validation: "ACTIVE",
    successUx: "SIMULATED",
    dataTransmission: "NONE",
    persistence: "NONE",
    thirdParty: "NONE",
    privacyCheckbox: "OPTIONAL",
    interactionStates: [],
  },
});

function statefulCanonicalBrief(): CanonicalBriefV3 {
  return CanonicalBriefV3Schema.parse({
    ...cleanBriefV3,
    scope: { ...cleanBriefV3.scope, protectedFunctionality: true },
    decisions: {
      ...cleanBriefV3.decisions,
      form: {
        ...cleanBriefV3.decisions.form,
        mode: "REAL",
        simulatedSuccessPolicy: "FORBIDDEN",
        transmissionMode: "API",
        persistenceMode: "DATABASE",
        serverProcessingMode: "SERVER",
      },
      database: { mode: "SUPABASE" },
      auth: { mode: "REQUIRED" },
    },
  });
}

function tableFor(canonicalBrief: CanonicalBriefV3) {
  return createPlannerReferenceTable({
    projectId,
    projectVersion: 1,
    approvedBriefChecksum: canonicalBriefChecksum(canonicalBrief),
    idempotencyKey: "decomposition-minimum-test",
    expectedRowVersion: 1,
    canonicalBrief,
  });
}

function proposal(kind: string, domain: string, title: string, pageTokens: string[] | null = null, routeTokens: string[] | null = null) {
  return { kind, domain, title, description: `Meaningful synthetic responsibility for ${title}.`, pageTokens, routeTokens, dependencies: null, negativeEvidence: null, negativeOnly: null };
}

function anchorProposals(plan: CoverageRepresentabilityPlan) {
  return Object.fromEntries(plan.anchors.map((anchor) => {
    const obligation = plan.obligations.find((candidate) => candidate.obligationToken === anchor.obligationToken)!;
    const domain = obligation.allowedDomains.find((candidate) => obligation.allowedKinds.some((kind) => PLANNER_ELEMENT_KINDS_BY_DOMAIN[candidate].includes(kind)))!;
    const kind = obligation.allowedKinds.find((candidate) => PLANNER_ELEMENT_KINDS_BY_DOMAIN[domain].includes(candidate))!;
    return [anchor.anchorToken, { ...proposal(kind, domain, `${anchor.anchorToken} substantive ${obligation.obligationToken}`, obligation.requiredPageTokens.length ? [...obligation.requiredPageTokens] : null, obligation.requiredRouteTokens.length ? [...obligation.requiredRouteTokens] : null), negativeEvidence: obligation.negativeEvidenceRequired ? true : null, negativeOnly: obligation.positiveRequirement ? false : null }];
  }));
}

function exactFrontendWire(canonicalBrief = cleanBriefV3) {
  const table = tableFor(canonicalBrief);
  const plan = deriveCoverageRepresentabilityPlan(table);
  return {
    schemaVersion: 1 as const,
    providerContractVersion: PLANNER_DECOMPOSITION_CONTRACT_VERSION,
    complete: true as const,
    anchors: anchorProposals(plan),
    frontendElements: [
      proposal("PRODUCT_SCOPE", "FRONTEND", "Synthetic product scope"),
      proposal("PAGE", "FRONTEND", "Synthetic home page", [table.pages[0]!.token], [table.routes[0]!.token]),
    ],
    backendElements: [],
    databaseElements: [],
    integrationElements: [],
    qaElements: [],
    securityElements: [],
    lifecycleElements: [],
  };
}

function exactFullStackWire(canonicalBrief = statefulCanonicalBrief()) {
  return {
    ...exactFrontendWire(canonicalBrief),
    backendElements: [proposal("ARCHITECTURE", "BACKEND", "Synthetic server boundary")],
    databaseElements: [proposal("DATABASE_MODEL", "DATABASE", "Synthetic persistence model")],
    securityElements: [proposal("AUTHENTICATION", "SECURITY", "Synthetic authentication boundary")],
  };
}

describe("Planner decomposition minimum contract", () => {
  it("derives the existing minimum semantics from capability authority", () => {
    const frontendOnly = createDecompositionMinimumContract({ brief: frontendLegacyBrief, canonicalBrief: cleanBriefV3 });
    expect(frontendOnly).toMatchObject({ minimumTotalElements: 2, requiredDomains: ["FRONTEND"], requiredKinds: ["PRODUCT_SCOPE"] });
    expect(frontendOnly.minimumByDomain).toMatchObject({ FRONTEND: 2, BACKEND: 0, DATABASE: 0, SECURITY: 0, QA: 0, LIFECYCLE: 0, INTEGRATION: 0 });

    const fullStack = createDecompositionMinimumContract({ brief: legacyBrief, canonicalBrief: statefulCanonicalBrief() });
    expect(fullStack).toMatchObject({ minimumTotalElements: 5, requiredDomains: ["BACKEND", "DATABASE", "FRONTEND", "SECURITY"] });
    expect(fullStack.minimumByDomain).toMatchObject({ FRONTEND: 2, BACKEND: 1, DATABASE: 1, SECURITY: 1, QA: 0, LIFECYCLE: 0, INTEGRATION: 0 });
    expect(fullStack.minimumByKind.PRODUCT_SCOPE).toBe(1);
    expect(fullStack.requiredKindGroups).toEqual([{ group: "PAGE_OR_ROUTE", kinds: ["PAGE", "ROUTE"], minimum: 1 }]);
  });

  it("keeps historical v2 wire readable while host admission rejects below-minimum structure", () => {
    const canonicalBrief = cleanBriefV3;
    const table = tableFor(canonicalBrief);
    const historical = PlanningDecompositionProviderOutputV2Schema.parse({
      schemaVersion: 1,
      providerContractVersion: "planner.decomposition.v2",
      complete: true,
      elements: [proposal("PRODUCT_SCOPE", "FRONTEND", "Historical undersized scope")],
    });
    expect(historical.elements).toHaveLength(1);
    let failure: unknown;
    try { admitPlanningDecomposition({ output: historical, table, brief: frontendLegacyBrief, canonicalBrief }); } catch (error) { failure = error; }
    expect(failure).toMatchObject({
      reasonCode: "PLANNING_DECOMPOSITION_MINIMUM_ELEMENTS",
      minimumDiagnostics: expect.objectContaining({ actualElementCount: 1, minimumElementCount: 2 }),
    });
  });

  it("keeps historical bucketed v3 evidence readable while reserving v4 for new requests", () => {
    const canonicalBrief = cleanBriefV3;
    const table = tableFor(canonicalBrief);
    const minimum = createDecompositionMinimumContract({ brief: frontendLegacyBrief, canonicalBrief });
    const current = exactFrontendWire(canonicalBrief);
    const historical = {
      schemaVersion: 1 as const,
      providerContractVersion: "planner.decomposition.v3" as const,
      complete: true as const,
      frontendElements: current.frontendElements,
      backendElements: [],
      databaseElements: [],
      integrationElements: [],
      qaElements: [],
      securityElements: [],
      lifecycleElements: [],
    };
    const parsed = createHistoricalPlanningDecompositionProviderWireSchemaV3(minimum).parse(historical);
    const normalized = normalizeHistoricalPlanningDecompositionProviderOutputV3(parsed, minimum);
    expect(normalized.providerContractVersion).toBe("planner.decomposition.v3");
    expect(admitPlanningDecomposition({ output: normalized, table, brief: frontendLegacyBrief, canonicalBrief })).toHaveLength(2);
  });

  it("rejects below-minimum v3 wire output before normalization and still rejects a direct host bypass", () => {
    const canonicalBrief = cleanBriefV3;
    const table = tableFor(canonicalBrief);
    const minimum = createDecompositionMinimumContract({ brief: frontendLegacyBrief, canonicalBrief });
    const below = { ...exactFrontendWire(canonicalBrief), frontendElements: [proposal("PRODUCT_SCOPE", "FRONTEND", "Undersized scope")] };
    expect(createPlanningDecompositionProviderWireSchema(minimum, deriveCoverageRepresentabilityPlan(table)).safeParse(below).success).toBe(false);

    const direct = PlanningDecompositionProviderOutputSchema.parse({
      schemaVersion: 1,
      providerContractVersion: PLANNER_DECOMPOSITION_CONTRACT_VERSION,
      complete: true,
      elements: below.frontendElements,
    });
    let failure: unknown;
    try { admitPlanningDecompositionSemantics({ output: direct, table, brief: frontendLegacyBrief, canonicalBrief }); } catch (error) { failure = error; }
    expect(failure).toMatchObject({
      reasonCode: "PLANNING_DECOMPOSITION_MINIMUM_ELEMENTS",
      minimumDiagnostics: expect.objectContaining({ actualElementCount: 1, minimumElementCount: 2 }),
    });
  });

  it("passes exact and above-minimum meaningful frontend-only structure", () => {
    const canonicalBrief = cleanBriefV3;
    const table = tableFor(canonicalBrief);
    const minimum = createDecompositionMinimumContract({ brief: frontendLegacyBrief, canonicalBrief });
    const schema = createPlanningDecompositionProviderWireSchema(minimum, deriveCoverageRepresentabilityPlan(table));
    const exact = schema.parse(exactFrontendWire(canonicalBrief));
    const normalizedExact = normalizePlanningDecompositionProviderOutput(exact, minimum, deriveCoverageRepresentabilityPlan(table));
    expect(normalizedExact.elements).toHaveLength(2 + deriveCoverageRepresentabilityPlan(table).anchors.length);
    expect(admitPlanningDecomposition({ output: normalizedExact, table, brief: frontendLegacyBrief, canonicalBrief })).toHaveLength(2 + deriveCoverageRepresentabilityPlan(table).anchors.length);

    const above = { ...exactFrontendWire(canonicalBrief), frontendElements: [...exactFrontendWire(canonicalBrief).frontendElements, proposal("CONTENT", "FRONTEND", "Additional content responsibility")] };
    expect(() => admitPlanningDecomposition({ output: normalizePlanningDecompositionProviderOutput(schema.parse(above), minimum, deriveCoverageRepresentabilityPlan(table)), table, brief: frontendLegacyBrief, canonicalBrief })).not.toThrow();
  });

  it("enforces required domains structurally while allowing optional domains to remain empty", () => {
    const fullStack = statefulCanonicalBrief();
    const table = tableFor(fullStack);
    const minimum = createDecompositionMinimumContract({ brief: legacyBrief, canonicalBrief: fullStack });
    const schema = createPlanningDecompositionProviderWireSchema(minimum, deriveCoverageRepresentabilityPlan(table));
    const missingBackend = { ...exactFullStackWire(fullStack), backendElements: [] };
    expect(schema.safeParse(missingBackend).success).toBe(false);
    const exact = normalizePlanningDecompositionProviderOutput(schema.parse(exactFullStackWire(fullStack)), minimum, deriveCoverageRepresentabilityPlan(table));
    expect(admitPlanningDecomposition({ output: exact, table, brief: legacyBrief, canonicalBrief: fullStack })).toHaveLength(5 + deriveCoverageRepresentabilityPlan(table).anchors.length);

    const frontendMinimum = createDecompositionMinimumContract({ brief: frontendLegacyBrief, canonicalBrief: cleanBriefV3 });
    const frontendSchema = createPlanningDecompositionProviderWireSchema(frontendMinimum, deriveCoverageRepresentabilityPlan(tableFor(cleanBriefV3)));
    expect(frontendSchema.parse(exactFrontendWire(cleanBriefV3))).toEqual(expect.objectContaining({ backendElements: [], databaseElements: [], securityElements: [], qaElements: [], lifecycleElements: [], integrationElements: [] }));
  });

  it("preserves the 47 allowed kind/domain pairs and rejects all 100 disallowed pairs at the v4 bucket boundary", () => {
    const minimum = createDecompositionMinimumContract({ brief: frontendLegacyBrief, canonicalBrief: cleanBriefV3 });
    const schema = createPlanningDecompositionProviderWireSchema(minimum, deriveCoverageRepresentabilityPlan(tableFor(cleanBriefV3)));
    const base = exactFrontendWire(cleanBriefV3);
    let allowed = 0;
    for (const domain of PlannerCoverageDomainSchema.options) {
      for (const kind of PLANNER_ELEMENT_KINDS_BY_DOMAIN[domain]) {
        allowed += 1;
        const bucket = DECOMPOSITION_DOMAIN_BUCKET_BY_DOMAIN[domain];
        const candidate = { ...base, [bucket]: [...(base[bucket] as unknown[]), proposal(kind, domain, `Allowed ${domain} ${kind}`)] };
        expect(schema.safeParse(candidate).success).toBe(true);
      }
    }
    expect(allowed).toBe(47);
    let rejected = 0;
    for (const domain of PlannerCoverageDomainSchema.options) {
      for (const kind of PlannerCoverageElementKindSchema.options) {
        if (PLANNER_ELEMENT_KINDS_BY_DOMAIN[domain].includes(kind)) continue;
        rejected += 1;
        const bucket = DECOMPOSITION_DOMAIN_BUCKET_BY_DOMAIN[domain];
        const candidate = { ...base, [bucket]: [...(base[bucket] as unknown[]), proposal(kind, domain, `Rejected ${domain} ${kind}`)] };
        expect(schema.safeParse(candidate).success).toBe(false);
      }
    }
    expect(rejected).toBe(100);
  });

  it("emits bounded safe minimum diagnostics and keeps the provider adapter on v4", async () => {
    const canonicalBrief = cleanBriefV3;
    const table = tableFor(canonicalBrief);
    const minimum = createDecompositionMinimumContract({ brief: frontendLegacyBrief, canonicalBrief });
    let sent: StructuredRequest<unknown> | undefined;
    const client = new OpenAiStructuredClient({ apiKey: "test", model: "test", modelLabel: "test", maxRetries: 0, maxConcurrentRequests: 1 }, {
      executor: async <T>(request: StructuredRequest<T>) => {
        sent = request as StructuredRequest<unknown>;
        return { value: exactFrontendWire(canonicalBrief) as T, requestId: "req_decomposition_v4" };
      },
    });
    const output = await new OpenAiPlannerProvider(client).decompose({ approvedBrief: frontendLegacyBrief, plannerReferenceTable: table, canonicalBrief, minimumContract: minimum, coverageRepresentabilityPlan: deriveCoverageRepresentabilityPlan(table) });
    expect(output.providerContractVersion).toBe(PLANNER_DECOMPOSITION_CONTRACT_VERSION);
    expect(output.elements).toHaveLength(2 + deriveCoverageRepresentabilityPlan(table).anchors.length);
    expect(sent?.schemaName).toBe("planning-decomposition-v4");
    expect(sent?.system).toContain("minimum contract");
    expect(sent?.system).not.toContain("REQUIREMENT:");
    const response = buildProductionResponseFormat(sent!.schema, sent!.schemaName) as unknown as { json_schema: { schema: { properties: Record<string, { minItems?: number }> } } };
    expect(response.json_schema.schema.properties.frontendElements.minItems).toBe(2);
    const priorWire = {
      schemaVersion: 1 as const,
      providerContractVersion: "planner.decomposition.v3" as const,
      complete: true as const,
      frontendElements: exactFrontendWire(canonicalBrief).frontendElements,
      backendElements: [],
      databaseElements: [],
      integrationElements: [],
      qaElements: [],
      securityElements: [],
      lifecycleElements: [],
    };
    const priorSchemaBytes = Buffer.byteLength(JSON.stringify(buildProductionResponseFormat(createHistoricalPlanningDecompositionProviderWireSchemaV3(minimum), "planning-decomposition-v3")), "utf8");
    const repairedSchemaBytes = Buffer.byteLength(JSON.stringify(response), "utf8");
    const redactedInputBytes = Buffer.byteLength(JSON.stringify({ system: sent!.system, user: sent!.user }), "utf8");
    expect(createHistoricalPlanningDecompositionProviderWireSchemaV3(minimum).safeParse(priorWire).success).toBe(true);
    expect(repairedSchemaBytes).toBeGreaterThan(priorSchemaBytes);
    expect(repairedSchemaBytes).toBeLessThan(384_000);
    expect(redactedInputBytes).toBeLessThan(384_000);

    const directFailure = (() => {
      try {
        admitPlanningDecompositionSemantics({ output: PlanningDecompositionProviderOutputSchema.parse({ schemaVersion: 1, providerContractVersion: PLANNER_DECOMPOSITION_CONTRACT_VERSION, complete: true, elements: [proposal("PRODUCT_SCOPE", "FRONTEND", "Too small")] }), table, brief: frontendLegacyBrief, canonicalBrief });
      } catch (error) {
        return error;
      }
      return undefined;
    })();
    expect(DecompositionMinimumDiagnosticsSchema.safeParse((directFailure as { minimumDiagnostics?: unknown }).minimumDiagnostics).success).toBe(true);
    expect(JSON.stringify((directFailure as { minimumDiagnostics?: unknown }).minimumDiagnostics)).not.toContain("Too small");

    const graph = finalizePlanningElementGraph(admitPlanningDecomposition({ output, table, brief: frontendLegacyBrief, canonicalBrief }));
    expect(graph.elements).toHaveLength(2 + deriveCoverageRepresentabilityPlan(table).anchors.length);
  });

  it("records an exact bounded predicate for every minimum failure shape", () => {
    const frontendTable = tableFor(cleanBriefV3);
    const boundPage = frontendTable.pages[0]!.token;
    const boundRoute = frontendTable.routes[0]!.token;
    const failureFor = (elements: ReturnType<typeof proposal>[], brief = frontendLegacyBrief, canonicalBrief = cleanBriefV3) => {
      let failure: unknown;
      try {
        admitPlanningDecompositionSemantics({ output: PlanningDecompositionProviderOutputSchema.parse({ schemaVersion: 1, providerContractVersion: PLANNER_DECOMPOSITION_CONTRACT_VERSION, complete: true, elements }), table: tableFor(canonicalBrief), brief, canonicalBrief });
      } catch (error) {
        failure = error;
      }
      return failure as { admissionEvidence?: { failurePredicate: string; parsedElementCount: number; normalizedElementCount: number; productScopePresent: boolean; pageOrRoutePresent: boolean; pageRouteBindingCount: number; unboundPageRouteCount: number; hostIssuedAnchorCount: number; hostIssuedAnchorCoverageCount: number } };
    };
    const cases = [
      { name: "missing PRODUCT_SCOPE", elements: [proposal("PAGE", "FRONTEND", "Bound page", [boundPage], [boundRoute]), proposal("CONTENT", "FRONTEND", "Content responsibility")], expected: "MISSING_PRODUCT_SCOPE" },
      { name: "missing PAGE/ROUTE", elements: [proposal("PRODUCT_SCOPE", "FRONTEND", "Product scope"), proposal("CONTENT", "FRONTEND", "Content responsibility")], expected: "MISSING_PAGE_ROUTE" },
      { name: "missing page/route binding", elements: [proposal("PRODUCT_SCOPE", "FRONTEND", "Product scope"), proposal("PAGE", "FRONTEND", "Unbound page")], expected: "PAGE_ROUTE_BINDING_MISSING" },
      { name: "insufficient frontend", elements: [proposal("PRODUCT_SCOPE", "FRONTEND", "Product scope")], expected: "INSUFFICIENT_FRONTEND_ELEMENTS" },
      { name: "insufficient backend", elements: [proposal("PRODUCT_SCOPE", "FRONTEND", "Product scope"), proposal("PAGE", "FRONTEND", "Bound page", [boundPage], [boundRoute]), proposal("DATABASE_MODEL", "DATABASE", "Persistence model"), proposal("AUTHENTICATION", "SECURITY", "Authentication boundary")], brief: legacyBrief, canonicalBrief: statefulCanonicalBrief(), expected: "INSUFFICIENT_BACKEND_ELEMENTS" },
      { name: "insufficient security", elements: [proposal("PRODUCT_SCOPE", "FRONTEND", "Product scope"), proposal("PAGE", "FRONTEND", "Bound page", [boundPage], [boundRoute]), proposal("ARCHITECTURE", "BACKEND", "Server boundary"), proposal("DATABASE_MODEL", "DATABASE", "Persistence model")], brief: legacyBrief, canonicalBrief: statefulCanonicalBrief(), expected: "INSUFFICIENT_SECURITY_ELEMENTS" },
    ];
    for (const testCase of cases) {
      const failure = failureFor(testCase.elements, testCase.brief, testCase.canonicalBrief);
      expect(failure.admissionEvidence, testCase.name).toBeDefined();
      expect(PlanningAdmissionFailurePredicateSchema.parse(failure.admissionEvidence!.failurePredicate)).toBe(testCase.expected);
    }
    const frontendSuccess = normalizePlanningDecompositionProviderOutput(exactFrontendWire(cleanBriefV3), createDecompositionMinimumContract({ brief: frontendLegacyBrief, canonicalBrief: cleanBriefV3 }), deriveCoverageRepresentabilityPlan(frontendTable));
    expect(() => admitPlanningDecompositionSemantics({ output: frontendSuccess, table: frontendTable, brief: frontendLegacyBrief, canonicalBrief: cleanBriefV3 })).not.toThrow();
    const evidence = failureFor([proposal("PRODUCT_SCOPE", "FRONTEND", "Product scope")]).admissionEvidence!;
    expect(evidence).toMatchObject({ parsedElementCount: 1, normalizedElementCount: 1, productScopePresent: true, pageOrRoutePresent: false, pageRouteBindingCount: 0, unboundPageRouteCount: 0, hostIssuedAnchorCount: 0, hostIssuedAnchorCoverageCount: 0 });
    expect(JSON.stringify(evidence)).not.toContain("Product scope");
  });
});
