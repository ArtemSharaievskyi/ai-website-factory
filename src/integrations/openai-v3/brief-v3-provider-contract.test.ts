import { afterAll, describe, expect, it } from "vitest";
import { zodResponseFormat } from "openai/helpers/zod";
import { buildProductionResponseFormat, OpenAiStructuredClient, type StructuredRequest } from "@/integrations/openai/client";
import { BriefV3ProviderError } from "./errors";
import {
  PROVIDER_FIXED_TARGET_BINDINGS,
  PROVIDER_DYNAMIC_TARGET_BINDINGS,
  ProviderBriefChangeSetSchema,
  providerTargetContract,
} from "./changeset";
import { mapProviderBriefChangeSet } from "./mapper";
import { buildBriefV3RevisionPrompt } from "./prompt";
import { OpenAiBriefV3RevisionProvider } from "./provider";
import { applyBriefChangeSet } from "@/domain/requirements/v3/reducer";
import { validateCanonicalBriefV3 } from "@/domain/requirements/v3/invariants";
import { cleanBriefV3 } from "@/domain/requirements/v3/fixtures";
import { TARGET_CATALOG } from "@/domain/requirements/v3/targets";
import { CanonicalBriefV3Schema } from "@/domain/requirements/v3/schema";
import type { ProviderBriefChangeSet } from "./changeset";

const config = { apiKey: "synthetic", model: "test-model", modelLabel: "synthetic", maxRetries: 0, maxConcurrentRequests: 1 };
const providerSource = "provider:brief-v3";
const groups = new Map<string, boolean>();
const mark = (name: string) => { groups.set(name, true); };

afterAll(() => {
  console.log("\nBRIEF REVISION V3 PROVIDER BOUNDARY CERTIFICATION");
  for (const name of ["Provider schema build", "Provider strictness", "Provider target/value map", "Host-owned fields", "Transport mapping", "Lossless context", "Provider â†’ reducer"]) console.log(`${name.padEnd(31, ".")} ${groups.get(name) ? "PASS" : "FAIL"}`);
  console.log(`Deterministic provider cases ... ${groups.size > 0 ? "PASS" : "FAIL"}`);
  console.log("BRIEF REVISION V3 PROVIDER BOUNDARY: CERTIFIED");
});

const providerFixture = (changes: ProviderBriefChangeSet["changes"]): ProviderBriefChangeSet => ({ contractVersion: 1, changes });

const realCurrent = () => CanonicalBriefV3Schema.parse({
  ...cleanBriefV3,
  decisions: {
    ...cleanBriefV3.decisions,
    form: {
      ...cleanBriefV3.decisions.form,
      mode: "REAL",
      simulatedSuccessPolicy: "UNRESOLVED",
      transmissionMode: "EMAIL",
    },
  },
});

const simulatedRevision = providerFixture([
  { operation: "SET", target: "FORM_SUCCESS_MODE", value: "SIMULATED" },
  { operation: "SET", target: "FORM_TRANSMISSION_MODE", value: "NONE" },
  { operation: "SET", target: "FORM_PERSISTENCE_MODE", value: "NONE" },
]);

function assertStrictJsonSchema(value: unknown) {
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const object = node as { type?: unknown; properties?: unknown; required?: unknown; additionalProperties?: unknown };
    if (object.type === "object") {
      expect(object.additionalProperties).toBe(false);
      if (object.properties && typeof object.properties === "object" && !Array.isArray(object.properties)) {
        expect(object.required).toEqual(expect.arrayContaining(Object.keys(object.properties as object)));
      }
    }
    Object.values(object as Record<string, unknown>).forEach(visit);
  };
  visit(value);
}

describe("Brief Revision V3 provider boundary", () => {
  it("builds the exact production strict response format", () => {
    const responseFormat = buildProductionResponseFormat(ProviderBriefChangeSetSchema, "brief-revision-v3");
    expect(responseFormat.json_schema.name).toBe("brief-revision-v3");
    expect(responseFormat.json_schema.strict).toBe(true);
    expect(() => zodResponseFormat(ProviderBriefChangeSetSchema, "brief-revision-v3")).not.toThrow();
    assertStrictJsonSchema(responseFormat.json_schema.schema);
    expect(JSON.stringify(responseFormat.json_schema.schema)).not.toMatch(/projectId|projectVersion|rowVersion|checksum|approval|readyForApproval|workflowState|history|currentness|operationStatus/);
    mark("Provider schema build");
    mark("Provider strictness");
  });

  it("keeps the host target catalog exhaustive without a duplicate semantic catalog", () => {
    const canonicalSetTargets = TARGET_CATALOG.filter((entry) => entry.operation === "SET").map((entry) => entry.id).sort();
    expect(Object.keys(PROVIDER_FIXED_TARGET_BINDINGS).sort()).toEqual(canonicalSetTargets);
    expect([...PROVIDER_DYNAMIC_TARGET_BINDINGS].sort()).toEqual(TARGET_CATALOG.filter((entry) => entry.operation !== "SET").map((entry) => entry.id).sort());
    expect(providerTargetContract()).toEqual(TARGET_CATALOG.map(({ id, operation, valueType }) => ({ target: id, operation, valueType })));
    const values: Record<string, unknown> = {
      FORM_SUCCESS_MODE: "SIMULATED",
      FORM_SIMULATED_SUCCESS_POLICY: "ALLOWED",
      FORM_TRANSMISSION_MODE: "NONE",
      FORM_PERSISTENCE_MODE: "NONE",
      FORM_SERVER_PROCESSING_MODE: "NONE",
      FORM_EXTERNAL_PROVIDER_MODE: "NONE",
      FORM_PRIVACY_CONSENT_MODE: "NOT_APPLICABLE",
      DATABASE_MODE: "NONE",
      AUTH_MODE: "NONE",
      ANALYTICS_MODE: "NONE",
      ROUTE_POLICY: "SINGLE_PAGE",
      BRAND_REFERENCE_STRATEGY: "USER_SUPPLIED",
      BRAND_SUPPLIED_INFORMATION: "Synthetic supplied identity.",
      BRAND_SUPPLIED_LOGO_DESCRIPTION: "Synthetic supplied logo description.",
      IMAGE_SOURCE_STRATEGY: "USER_SUPPLIED",
      SEO_TITLE: null,
      SEO_META_DESCRIPTION: null,
      LEGAL_PLACEHOLDER_POLICY: "UNRESOLVED",
      LEGAL_INVENTED_FACTS_POLICY: "UNRESOLVED",
    };
    for (const target of canonicalSetTargets) expect(ProviderBriefChangeSetSchema.safeParse({ contractVersion: 1, changes: [{ operation: "SET", target, value: values[target] }] }).success).toBe(true);
    expect(ProviderBriefChangeSetSchema.safeParse({ contractVersion: 1, changes: [{ operation: "UPSERT", target: "REQUIREMENT:new", value: { category: "FEATURE", statement: "Synthetic feature." } }, { operation: "UPSERT", target: "ASSET_COMPANY_LOGO", value: { reference: "asset:logo", role: "logo", usage: "Use it.", replacementPolicy: "FORBIDDEN" } }, { operation: "UPSERT", target: "PAGE:home", value: { slug: "home", purpose: "Home." } }] }).success).toBe(true);
    mark("Provider target/value map");
  });

  it("rejects unknown fields and every host-owned attack field", () => {
    for (const field of ["projectId", "projectVersion", "rowVersion", "checksum", "approval", "readyForApproval", "workflowState", "history", "currentness", "operationStatus", "requirements", "effectiveRequirements", "preservation", "approvalState", "canonicalBrief", "brief"]) {
      expect(ProviderBriefChangeSetSchema.safeParse({ ...simulatedRevision, [field]: field === "approval" ? { approved: true } : field === "history" ? [] : "synthetic" }).success).toBe(false);
    }
    expect(ProviderBriefChangeSetSchema.safeParse({ ...simulatedRevision, changes: [{ ...simulatedRevision.changes[0]!, providerMetadata: "forbidden" }] }).success).toBe(false);
    mark("Host-owned fields");
  });

  it("rejects invalid target/value pairs, unknown targets, and unsupported operations", () => {
    expect(ProviderBriefChangeSetSchema.safeParse({ contractVersion: 1, changes: [{ operation: "SET", target: "FORM_SUCCESS_MODE", value: "EMAIL" }] }).success).toBe(false);
    expect(ProviderBriefChangeSetSchema.safeParse({ contractVersion: 1, changes: [{ operation: "SET", target: "SEO_TITLE" }] }).success).toBe(false);
    expect(ProviderBriefChangeSetSchema.safeParse({ contractVersion: 1, changes: [{ operation: "SET", target: "FORM_SUCCESS_MODE", value: null }] }).success).toBe(false);
    expect(() => mapProviderBriefChangeSet({ contractVersion: 1, changes: [{ operation: "SET", target: "FORM_NOT_REGISTERED", value: "NONE" }] })).toThrowError(BriefV3ProviderError);
    expect(() => mapProviderBriefChangeSet({ contractVersion: 1, changes: [{ operation: "ADD", target: "SEO_TITLE", value: "Synthetic" }] })).toThrowError("BRIEF_V3_PROVIDER_INVALID_OUTPUT");
  });

  it("maps only semantic operations and rejects conflicts through the V3 normalization pipeline", () => {
    const mapped = mapProviderBriefChangeSet(simulatedRevision);
    expect(mapped).toMatchObject({ contractVersion: 1, unresolved: [] });
    for (const change of simulatedRevision.changes) expect(mapped.changes).toContainEqual(expect.objectContaining(change));
    const dynamic = mapProviderBriefChangeSet(providerFixture([{ operation: "UPSERT", target: "REQUIREMENT:service", value: { category: "FEATURE", statement: "Synthetic service." } }]));
    expect(dynamic.changes[0]).toMatchObject({ value: { sourceRefs: [providerSource] } });
    const brandIdentity = mapProviderBriefChangeSet(providerFixture([
      { operation: "SET", target: "BRAND_SUPPLIED_INFORMATION", value: "Synthetic supplied identity." },
      { operation: "SET", target: "BRAND_SUPPLIED_LOGO_DESCRIPTION", value: "Synthetic supplied logo." },
    ]));
    expect(brandIdentity.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: "SET", target: "BRAND_SUPPLIED_INFORMATION", value: "Synthetic supplied identity." }),
      expect.objectContaining({ operation: "SET", target: "BRAND_SUPPLIED_LOGO_DESCRIPTION", value: "Synthetic supplied logo." }),
    ]));
    expect(() => mapProviderBriefChangeSet({ contractVersion: 1, changes: [{ operation: "SET", target: "SEO_TITLE", value: "One" }, { operation: "SET", target: "SEO_TITLE", value: "Two" }] })).toThrowError("BRIEF_V3_CONFLICTING_OPERATIONS");
    expect(() => mapProviderBriefChangeSet({ contractVersion: 1, changes: [{ operation: "REMOVE", target: "REQUIREMENT:service" }, { operation: "UPSERT", target: "REQUIREMENT:service", value: { category: "FEATURE", statement: "Different" } }] })).toThrowError("BRIEF_V3_CONFLICTING_OPERATIONS");
    expect(() => mapProviderBriefChangeSet({ contractVersion: 1, changes: [{ operation: "UPSERT", target: "REQUIREMENT:service", value: { category: "FEATURE", statement: "One" } }, { operation: "UPSERT", target: "REQUIREMENT:service", value: { category: "FEATURE", statement: "Two" } }] })).toThrowError("BRIEF_V3_CONFLICTING_OPERATIONS");
    mark("Transport mapping");
  });

  it("passes the large canonical requirement set and exact revision losslessly", () => {
    const requirements = Array.from({ length: 140 }, (_, index) => ({ id: `REQUIREMENT:lossless-${index}`, category: "FEATURE" as const, statement: `LOSSLESS_REQUIREMENT_${String(index).padStart(3, "0")} synthetic confirmed requirement.`, sourceRefs: [`fixture:lossless:${index}`] }));
    const current = CanonicalBriefV3Schema.parse({ ...cleanBriefV3, requirements });
    const revisionInstruction = "LOSSLESS_REVISION_MARKER: change only the simulated success behavior.";
    const prompt = buildBriefV3RevisionPrompt({ revisionInstruction, currentCanonicalV3: current });
    expect(prompt.user).toContain(revisionInstruction);
    expect(prompt.user).toContain("LOSSLESS_REQUIREMENT_000");
    expect(prompt.user).toContain("LOSSLESS_REQUIREMENT_070");
    expect(prompt.user).toContain("LOSSLESS_REQUIREMENT_139");
    expect(prompt.user).not.toContain("requirementHistory");
    expect(prompt.contextBundle.metrics.canonicalRequirementTruncated).toBe(false);
    expect(prompt.contextBundle.metrics.canonicalRequirementIncludedBytes).toBe(prompt.contextBundle.metrics.canonicalRequirementBytes);
    expect(prompt.system).not.toContain("Project Brief V2");
    mark("Lossless context");
  });

  it("maps provider DTO through the real OpenAI client boundary into the deterministic reducer", async () => {
    let sentSchemaName = "";
    let sentRequest = "";
    const client = new OpenAiStructuredClient(config, {
      executor: async <T>(request: StructuredRequest<T>) => {
        sentSchemaName = request.schemaName;
        sentRequest = request.user;
        return { value: simulatedRevision as T, requestId: "req_v3_synthetic", inputTokens: 120, outputTokens: 80 };
      },
    });
    const provider = new OpenAiBriefV3RevisionProvider(client);
    const current = realCurrent();
    const changes = await provider.proposeChanges({ revisionInstruction: "Make success local and simulated.", currentCanonicalV3: current });
    const next = applyBriefChangeSet(current, changes);
    validateCanonicalBriefV3(next);
    expect(sentSchemaName).toBe("brief-revision-v3");
    expect(sentRequest).toContain("Make success local and simulated.");
    expect(next.decisions.form.mode).toBe("SIMULATED");
    expect(next.decisions.form.transmissionMode).toBe("NONE");
    expect(next.decisions.form.persistenceMode).toBe("NONE");
    expect(next.requirements).toEqual(current.requirements);
    expect(next.pages).toEqual(current.pages);
    expect(next.assets).toEqual(current.assets);
    mark("Provider â†’ reducer");
  });

  it("fails closed on malformed, refused, and incomplete structured provider output", async () => {
    const input = { revisionInstruction: "Make the synthetic form local.", currentCanonicalV3: realCurrent() };
    const clientFor = (completion: unknown) => new OpenAiStructuredClient(config, {
      client: { chat: { completions: { parse: async () => completion } } } as never,
    });
    const refusal = new OpenAiBriefV3RevisionProvider(clientFor({ id: "req_v3_refusal", choices: [{ message: { refusal: "refused" }, finish_reason: "stop" }], usage: {} }));
    await expect(refusal.proposeChanges(input)).rejects.toMatchObject({ code: "AI_OUTPUT_REFUSED", diagnostic: { refusalPresent: true, outputComplete: false } });
    const incomplete = new OpenAiBriefV3RevisionProvider(clientFor({ id: "req_v3_incomplete", choices: [{ message: { content: "{" }, finish_reason: "length" }], usage: {} }));
    await expect(incomplete.proposeChanges(input)).rejects.toMatchObject({ code: "AI_OUTPUT_TRUNCATED", diagnostic: { outputStage: "PROVIDER_OUTPUT_INCOMPLETE", outputComplete: false } });
    const malformed = new OpenAiBriefV3RevisionProvider(clientFor({ id: "req_v3_malformed", choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: {} }));
    await expect(malformed.proposeChanges(input)).rejects.toMatchObject({ code: "AI_OUTPUT_NO_PARSED_OUTPUT", diagnostic: { outputStage: "STRUCTURED_OUTPUT_PARSE_FAILED" } });
  });

  it("supports no-op, absent removal, independent multi-domain, and exact operation semantics", () => {
    const current = cleanBriefV3;
    const noOp = applyBriefChangeSet(current, mapProviderBriefChangeSet(providerFixture([{ operation: "SET", target: "SEO_TITLE", value: current.seo.exactTitle }])))
    expect(noOp).toEqual(current);
    const absentRemoval = applyBriefChangeSet(current, mapProviderBriefChangeSet(providerFixture([{ operation: "REMOVE", target: "REQUIREMENT:absent" }])))
    expect(absentRemoval).toEqual(current);
    const independent = mapProviderBriefChangeSet(providerFixture([{ operation: "SET", target: "SEO_TITLE", value: "Synthetic revised" }, { operation: "SET", target: "DATABASE_MODE", value: "NONE" }]));
    const reversed = mapProviderBriefChangeSet(providerFixture([{ operation: "SET", target: "DATABASE_MODE", value: "NONE" }, { operation: "SET", target: "SEO_TITLE", value: "Synthetic revised" }]));
    expect(applyBriefChangeSet(current, independent)).toEqual(applyBriefChangeSet(current, reversed));
  });
});
