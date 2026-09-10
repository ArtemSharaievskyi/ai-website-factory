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
  createPlanningDecompositionProviderWireSchema,
  normalizePlanningDecompositionProviderOutput,
  PlanningDecompositionProviderOutputSchema,
} from "./staged-contracts";
import { admitPlanningDecomposition, admitPlanningDecompositionSemantics, finalizePlanningElementGraph } from "./staged-admission";
import { PLANNER_ELEMENT_KINDS_BY_DOMAIN, PlannerCoverageDomainSchema, PlannerCoverageElementKindSchema } from "./coverage-contract";
import { OpenAiPlannerProvider } from "@/integrations/openai/adapters";
import { OpenAiStructuredClient, buildProductionResponseFormat, type StructuredRequest } from "@/integrations/openai/client";

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

function exactFrontendWire(canonicalBrief = cleanBriefV3) {
  const table = tableFor(canonicalBrief);
  return {
    schemaVersion: 1 as const,
    providerContractVersion: PLANNER_DECOMPOSITION_CONTRACT_VERSION,
    complete: true as const,
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

  it("rejects below-minimum v3 wire output before normalization and still rejects a direct host bypass", () => {
    const canonicalBrief = cleanBriefV3;
    const table = tableFor(canonicalBrief);
    const minimum = createDecompositionMinimumContract({ brief: frontendLegacyBrief, canonicalBrief });
    const below = { ...exactFrontendWire(canonicalBrief), frontendElements: [proposal("PRODUCT_SCOPE", "FRONTEND", "Undersized scope")] };
    expect(createPlanningDecompositionProviderWireSchema(minimum).safeParse(below).success).toBe(false);

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
    const schema = createPlanningDecompositionProviderWireSchema(minimum);
    const exact = schema.parse(exactFrontendWire(canonicalBrief));
    const normalizedExact = normalizePlanningDecompositionProviderOutput(exact, minimum);
    expect(normalizedExact.elements).toHaveLength(2);
    expect(admitPlanningDecomposition({ output: normalizedExact, table, brief: frontendLegacyBrief, canonicalBrief })).toHaveLength(2);

    const above = { ...exactFrontendWire(canonicalBrief), frontendElements: [...exactFrontendWire(canonicalBrief).frontendElements, proposal("CONTENT", "FRONTEND", "Additional content responsibility")] };
    expect(() => admitPlanningDecomposition({ output: normalizePlanningDecompositionProviderOutput(schema.parse(above), minimum), table, brief: frontendLegacyBrief, canonicalBrief })).not.toThrow();
  });

  it("enforces required domains structurally while allowing optional domains to remain empty", () => {
    const fullStack = statefulCanonicalBrief();
    const table = tableFor(fullStack);
    const minimum = createDecompositionMinimumContract({ brief: legacyBrief, canonicalBrief: fullStack });
    const schema = createPlanningDecompositionProviderWireSchema(minimum);
    const missingBackend = { ...exactFullStackWire(fullStack), backendElements: [] };
    expect(schema.safeParse(missingBackend).success).toBe(false);
    const exact = normalizePlanningDecompositionProviderOutput(schema.parse(exactFullStackWire(fullStack)), minimum);
    expect(admitPlanningDecomposition({ output: exact, table, brief: legacyBrief, canonicalBrief: fullStack })).toHaveLength(5);

    const frontendMinimum = createDecompositionMinimumContract({ brief: frontendLegacyBrief, canonicalBrief: cleanBriefV3 });
    const frontendSchema = createPlanningDecompositionProviderWireSchema(frontendMinimum);
    expect(frontendSchema.parse(exactFrontendWire(cleanBriefV3))).toEqual(expect.objectContaining({ backendElements: [], databaseElements: [], securityElements: [], qaElements: [], lifecycleElements: [], integrationElements: [] }));
  });

  it("preserves the 47 allowed kind/domain pairs and rejects all 100 disallowed pairs at the v3 bucket boundary", () => {
    const minimum = createDecompositionMinimumContract({ brief: frontendLegacyBrief, canonicalBrief: cleanBriefV3 });
    const schema = createPlanningDecompositionProviderWireSchema(minimum);
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

  it("emits bounded safe minimum diagnostics and keeps the provider adapter on v3", async () => {
    const canonicalBrief = cleanBriefV3;
    const table = tableFor(canonicalBrief);
    const minimum = createDecompositionMinimumContract({ brief: frontendLegacyBrief, canonicalBrief });
    let sent: StructuredRequest<unknown> | undefined;
    const client = new OpenAiStructuredClient({ apiKey: "test", model: "test", modelLabel: "test", maxRetries: 0, maxConcurrentRequests: 1 }, {
      executor: async <T>(request: StructuredRequest<T>) => {
        sent = request as StructuredRequest<unknown>;
        return { value: exactFrontendWire(canonicalBrief) as T, requestId: "req_decomposition_v3" };
      },
    });
    const output = await new OpenAiPlannerProvider(client).decompose({ approvedBrief: frontendLegacyBrief, plannerReferenceTable: table, canonicalBrief, minimumContract: minimum });
    expect(output.providerContractVersion).toBe(PLANNER_DECOMPOSITION_CONTRACT_VERSION);
    expect(output.elements).toHaveLength(2);
    expect(sent?.schemaName).toBe("planning-decomposition-v3");
    expect(sent?.system).toContain("minimum contract");
    expect(sent?.system).not.toContain("REQUIREMENT:");
    const response = buildProductionResponseFormat(sent!.schema, sent!.schemaName) as unknown as { json_schema: { schema: { properties: Record<string, { minItems?: number }> } } };
    expect(response.json_schema.schema.properties.frontendElements.minItems).toBe(2);
    const v2SchemaBytes = Buffer.byteLength(JSON.stringify(buildProductionResponseFormat(PlanningDecompositionProviderOutputV2Schema, "planning-decomposition-v2")), "utf8");
    const v3SchemaBytes = Buffer.byteLength(JSON.stringify(response), "utf8");
    const redactedInputBytes = Buffer.byteLength(JSON.stringify({ approvedBrief: frontendLegacyBrief, minimumContract: minimum, domainBucketOrder: Object.keys(response.json_schema.schema.properties) }), "utf8");
    expect(v3SchemaBytes).toBeGreaterThan(v2SchemaBytes);
    expect(v3SchemaBytes).toBeLessThan(384_000);
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
    expect(graph.elements).toHaveLength(2);
  });
});
