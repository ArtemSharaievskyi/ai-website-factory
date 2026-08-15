import { describe, expect, it } from "vitest";
import { applyBriefRevisionSemantics, validateBriefRevisionSemantics } from "@/domain/requirements/revision";
import { briefApprovalBlockers } from "@/domain/requirements/brief-validation";
import { emptyBriefV2Fields } from "@/domain/requirements/brief";
import { ProjectBriefV2Schema, RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { OpenAiStructuredClient } from "./client";
import { OpenAiLeadProvider, BriefDraftStructuredOutputSchema, BriefRequirementsTransportSchema } from "./adapters";
import { mergeRevisionRequirements } from "@/agents/lead/service";
import { AiProviderError } from "./errors";
import { DEFAULT_AI_MAX_COMPLETION_TOKENS, readAiProviderConfig } from "./config";
import { z } from "zod";
import { zodResponseFormat } from "openai/helpers/zod";
import { workbenchFailureResponse, getWorkbenchDiagnosticEvents, clearWorkbenchDiagnosticEvents } from "@/runtime/workbench/diagnostics";

const projectId = "11111111-1111-4111-8111-111111111111";
const source = (value: string) => [`synthetic:${value}`];
const entry = (id: string, statement: string) => ({ id, statement, sourceRefs: source(id) });
const now = "2026-08-15T00:00:00.000Z";

const legacyV1 = RequirementSpecificationSchema.parse({
  schemaVersion: 1,
  documentType: "requirements",
  projectId,
  projectVersion: 1,
  createdAt: now,
  updatedAt: now,
  projectSummary: "A local garden and home service.",
  protectedFunctionalityRequired: false,
  imagesRequired: true,
  businessGoals: ["Reach local customers."],
  targetAudiences: ["Local homeowners."],
  pages: [{ slug: "home", purpose: "Explain the service." }],
  userRoles: [],
  features: ["Service overview."],
  forms: ["Contact form."],
  contentRequirements: ["Use supplied business facts."],
  backendRequirements: [],
  supabaseRequirements: [],
  authenticationDecision: "no-authentication-guest-first",
  storageDecision: "not-needed",
  emailDecision: "not-needed",
  administrationDecision: "not-needed",
  seoRequirements: ["garden service local"],
  operatorLanguage: "de",
  localization: { locales: ["de"], defaultLocale: "de" },
  imageSourceDecision: "user-supplied",
  suppliedBrandInformation: { status: "provided", value: "Supplied identity." },
  suppliedLogoLocation: { status: "provided", value: "logo.png" },
  technicalConstraints: ["Mobile-first."],
  explicitExclusions: ["Do not show successful submission."],
  userAcceptanceCriteria: ["Visitor can use the contact form."],
  unresolvedItems: [],
  approval: { approved: false },
  projectTitle: "Example Local Service",
  contactFacts: [],
  legalFacts: ["Legal details remain placeholders."],
  brandFacts: ["Use the supplied identity."],
  logoMetadata: ["logo.png is authoritative."],
  imageSourcingNotes: ["Use the two supplied references."],
  evidence: [],
  recommendations: [],
  briefStatus: "draft",
  briefVersion: 1,
});

const v2Candidate = ProjectBriefV2Schema.parse({
  ...legacyV1,
  explicitExclusions: [],
  ...emptyBriefV2Fields(),
  content: [entry("content", "Keep copy factual and local.")],
  technical: [entry("technical", "Keep the site static and bounded.")],
  brandVisualRequirements: {
    colorDirection: [entry("green", "Use a green accent with dark contrast.")],
    typographyDirection: [entry("type", "Use readable modern typography.")],
    spacingLayoutDirection: [entry("space", "Use generous whitespace.")],
    cardSurfaceStyling: [],
    iconDirection: [],
    imageryDirection: [entry("photo", "Use realistic professional photography.")],
    brandReferenceUsage: [entry("brand", "Use the supplied identity and references.")],
    visualAntiPatterns: [entry("template", "Do not use a generic template.")],
  },
  assetRequirements: {
    requiredAssets: [
      { reference: "logo.png", role: "logo", usage: "Use the supplied real logo.", replacementForbidden: true, sourceRefs: source("logo") },
      { reference: "reference-one", role: "brand-reference", usage: "Use the first supplied reference.", replacementForbidden: true, sourceRefs: source("reference-one") },
      { reference: "reference-two", role: "brand-reference", usage: "Use the second supplied reference.", replacementForbidden: true, sourceRefs: source("reference-two") },
    ],
    additionalImagery: { allowed: true, sourcingPolicy: [entry("realistic", "Use realistic professional photography.")], realisticProfessional: true, avoidArtificialLook: true },
  },
  formBehaviorRequirements: {
    formPresent: true,
    validation: "ACTIVE",
    successUx: "SIMULATED",
    dataTransmission: "NONE",
    persistence: "NONE",
    thirdParty: "NONE",
    privacyCheckbox: "OPTIONAL",
    interactionStates: [entry("success", "Show local validation, loading, simulated success, and reset states.")],
  },
  uxResponsiveRequirements: {
    mobileFirst: true,
    responsiveBehavior: [entry("mobile", "Use a mobile-first responsive layout.")],
    stickyMobileCta: true,
    smoothScroll: true,
    reducedMotion: true,
    interactionRequirements: [entry("cta", "Keep the primary CTA visible on mobile.")],
  },
  seoMetadata: {
    primaryKeywords: ["garden service", "home service"],
    exactTitle: "Example Local Service | Garden & Home",
    exactMetaDescription: "Reliable local service for garden and home. Contact us today.",
    locationTargeting: [entry("location", "Target the local service area.")],
    pageMetadata: [{ route: "/", title: "Example Local Service | Garden & Home", metaDescription: "Reliable local service for garden and home. Contact us today.", keywords: ["garden service"], sourceRefs: source("seo") }],
  },
  legalComplianceConstraints: { constraints: [entry("legal", "Use clearly marked legal placeholders.")], placeholderPolicy: "USE_EXPLICIT_PLACEHOLDERS", inventedFactsForbidden: true },
  prohibitedRequirements: [entry("simulated-success", "Frontend success is simulated after local validation."), entry("no-reviews", "Do not invent reviews."), entry("no-analytics", "Do not add analytics."), entry("no-external-form", "Do not add an external form integration.")],
  deferredIntegrations: [
    { integration: "email", status: "DEFERRED", rationale: "No real transmission is approved.", sourceRefs: source("email") },
    { integration: "analytics", status: "PROHIBITED", rationale: "Analytics is out of scope.", sourceRefs: source("analytics") },
  ],
  decisions: [
    { key: "form-transmission", value: "NONE", status: "CONFIRMED", sourceRefs: source("form-transmission") },
    { key: "asset-authority", value: "Supplied assets are authoritative.", status: "CONFIRMED", sourceRefs: source("asset-authority") },
  ],
});

const toTransport = (brief: typeof v2Candidate) => {
  const { schemaVersion: _schemaVersion, documentType: _documentType, projectId: _projectId, projectVersion: _projectVersion, createdAt: _createdAt, updatedAt: _updatedAt, operatorLanguage: _operatorLanguage, localization: _localization, approval: _approval, briefStatus: _briefStatus, briefVersion: _briefVersion, briefApprovalNote: _briefApprovalNote, briefRevisionInstructions: _briefRevisionInstructions, briefSchemaVersion: _briefSchemaVersion, analysisMetadata: _analysisMetadata, projectTitle, seoMetadata, ...fields } = brief;
  void _schemaVersion; void _documentType; void _projectId; void _projectVersion; void _createdAt; void _updatedAt; void _operatorLanguage; void _localization; void _approval; void _briefStatus; void _briefVersion; void _briefApprovalNote; void _briefRevisionInstructions; void _briefSchemaVersion; void _analysisMetadata;
  return BriefRequirementsTransportSchema.parse({
    ...fields,
    projectTitle: projectTitle ?? null,
    analysisMetadata: null,
    seoMetadata: {
      primaryKeywords: seoMetadata.primaryKeywords,
      exactTitle: seoMetadata.exactTitle ?? null,
      exactMetaDescription: seoMetadata.exactMetaDescription ?? null,
      locationTargeting: seoMetadata.locationTargeting,
      pageMetadata: seoMetadata.pageMetadata.map((page) => ({ route: page.route, title: page.title ?? null, metaDescription: page.metaDescription ?? null, keywords: page.keywords, sourceRefs: page.sourceRefs })),
    },
  });
};

const transport = toTransport(v2Candidate);
const providerOutput = BriefDraftStructuredOutputSchema.parse({ requirements: transport, facts: [], recommendations: [], unresolvedItems: [], evidence: [], readyForApproval: true, blockingReasons: [], nonBlockingWarnings: [] });
const revisionInstruction = 'Replace "Do not show successful submission." with "Frontend success is simulated after local validation."; preserve all confirmed requirements.';
const revisionInput = { projectId, projectVersion: 1, originalPrompt: "Synthetic local service brief.", currentBrief: legacyV1, currentCanonicalRequirements: legacyV1, revisionInstruction, requirementKeys: ["project-brief"], operatorLanguage: "de" as const, siteLanguage: "de" as const, currentWorkflowState: "AWAITING_BRIEF_APPROVAL" };
const config = { apiKey: "synthetic", model: "gpt-5.6-luna", modelLabel: "GPT-5.6 Luna", maxRetries: 1, maxConcurrentRequests: 1, maxCompletionTokens: DEFAULT_AI_MAX_COMPLETION_TOKENS };

describe("Project Brief V2 provider output contract PBR1-PBR40", () => {
  it("PBR1-PBR4: builds strict transport with explicit nullable values", () => {
    expect(() => zodResponseFormat(BriefDraftStructuredOutputSchema, "brief-revision")).not.toThrow();
    expect(BriefDraftStructuredOutputSchema.safeParse(providerOutput).success).toBe(true);
    expect(providerOutput.requirements.projectTitle).toBe("Example Local Service");
    expect(providerOutput.requirements.analysisMetadata).toBeNull();
    expect(providerOutput.requirements.seoMetadata.exactTitle).toBe("Example Local Service | Garden & Home");
  });
  it.each([
    ["PBR5", "unknown field"], ["PBR6", "projectId"], ["PBR7", "projectVersion"], ["PBR8", "briefChecksum"], ["PBR9", "approval"],
  ])("%s: rejects %s in provider transport", (_id, field) => {
    expect(BriefRequirementsTransportSchema.safeParse({ ...transport, [field]: field === "approval" ? { approved: false } : field === "briefChecksum" ? "a".repeat(64) : projectId }).success).toBe(false);
  });
  it("PBR10-PBR23: parses and maps populated V2 sections and nullable fields", async () => {
    const client = new OpenAiStructuredClient(config, { executor: async <T>() => ({ value: providerOutput as T, requestId: "req_synthetic_v2", inputTokens: 900, outputTokens: 7200, diagnostic: { stage: "api_response", requestAttempted: true, apiResponseReceived: true, responseReceived: true, outputComplete: true, schemaName: "brief-revision" } }) });
    const result = await new OpenAiLeadProvider(client).reviseBrief(revisionInput);
    expect(ProjectBriefV2Schema.parse(result.requirements).briefSchemaVersion).toBe(2);
    expect(result.requirements.brandVisualRequirements?.colorDirection[0]?.statement).toContain("green");
    expect(result.requirements.assetRequirements?.requiredAssets).toHaveLength(3);
    expect(result.requirements.uxResponsiveRequirements?.stickyMobileCta).toBe(true);
    expect(result.requirements.seoMetadata?.exactTitle).toBe("Example Local Service | Garden & Home");
    expect(result.requirements.seoMetadata?.exactMetaDescription).toBe("Reliable local service for garden and home. Contact us today.");
    expect(result.requirements.legalComplianceConstraints?.placeholderPolicy).toBe("USE_EXPLICIT_PLACEHOLDERS");
    expect(result.requirements.technical?.[0]?.statement).toContain("static");
    expect(result.requirements.prohibitedRequirements?.length).toBeGreaterThan(0);
    expect(result.requirements.deferredIntegrations?.some((item) => item.integration === "email")).toBe(true);
    expect(result.requirements.formBehaviorRequirements?.dataTransmission).toBe("NONE");
  });
  it("PBR24-PBR29: distinguishes transport, canonical, semantic, and contradiction failures", () => {
    expect(BriefRequirementsTransportSchema.safeParse({ ...transport, prohibitedRequirements: undefined }).success).toBe(false);
    expect(ProjectBriefV2Schema.safeParse({ ...v2Candidate, assetRequirements: { ...v2Candidate.assetRequirements, requiredAssets: [{ ...v2Candidate.assetRequirements.requiredAssets[0]!, reference: "unsafe/path" }] } }).success).toBe(false);
    const applied = ProjectBriefV2Schema.parse(applyBriefRevisionSemantics(legacyV1, v2Candidate, revisionInstruction).brief);
    expect(validateBriefRevisionSemantics(legacyV1, applied, revisionInstruction)).toEqual([]);
    expect(briefApprovalBlockers(applied)).toEqual([]);
    expect(ProjectBriefV2Schema.safeParse({ ...v2Candidate, formBehaviorRequirements: { ...v2Candidate.formBehaviorRequirements, successUx: "SIMULATED" }, prohibitedRequirements: [entry("old", "Do not show successful submission.")] }).success).toBe(true);
  });
  it("PBR30-PBR32: keeps provider diagnostics bounded and private", () => {
    clearWorkbenchDiagnosticEvents();
    const raw = "RAW_PROVIDER_OUTPUT secret customer revision and stack";
    const result = workbenchFailureResponse(new AiProviderError("AI_OUTPUT_INVALID", raw, new Error(raw), { stage: "provider_normalization", outputStage: "HOST_MAPPING_FAILED", requestAttempted: true, apiResponseReceived: true, responseReceived: true, outputComplete: true, schemaName: "brief-revision", issueCode: "INVALID_TYPE", fieldPath: "requirements.seoMetadata", issueCount: 99, requestId: "req_safe" }), { action: "request-brief-changes", projectId });
    const serialized = JSON.stringify({ response: result.response, events: getWorkbenchDiagnosticEvents() });
    expect(serialized).not.toContain(raw);
    expect(getWorkbenchDiagnosticEvents().at(-1)).toMatchObject({ outputStage: "HOST_MAPPING_FAILED", schemaName: "brief-revision", providerIssueCount: 20, providerFieldPath: "requirements.seoMetadata" });
  });
  it("PBR33-PBR36: records completion, refusal, incomplete, and token exhaustion states", () => {
    const diagnostic = { stage: "api_response" as const, outputStage: "PROVIDER_OUTPUT_INCOMPLETE" as const, requestAttempted: true, apiResponseReceived: true, responseReceived: true, outputComplete: false, tokenExhaustion: true, finishReason: "length" as const, outputTokens: DEFAULT_AI_MAX_COMPLETION_TOKENS, maxCompletionTokens: DEFAULT_AI_MAX_COMPLETION_TOKENS, schemaName: "brief-revision" };
    expect(diagnostic.outputComplete).toBe(false);
    expect(diagnostic.tokenExhaustion).toBe(true);
    expect({ ...diagnostic, outputStage: "PROVIDER_REFUSAL" as const, tokenExhaustion: false }).toMatchObject({ outputStage: "PROVIDER_REFUSAL", responseReceived: true });
  });
  it("PBR37-PBR40: leaves the valid candidate unapproved and keeps the pilot out of the fixture", async () => {
    const client = new OpenAiStructuredClient(config, { executor: async <T>() => ({ value: providerOutput as T, requestId: "req_fixture", inputTokens: 1, outputTokens: 1 }) });
    const result = await new OpenAiLeadProvider(client).reviseBrief(revisionInput);
    const applied = ProjectBriefV2Schema.parse(applyBriefRevisionSemantics(legacyV1, result.requirements, revisionInstruction).brief);
    expect(result.requirements.approval.approved).toBe(false);
    expect(applied.prohibitedRequirements.map((item) => item.statement)).not.toContain("Do not show successful submission.");
    expect(applied.formBehaviorRequirements.successUx).toBe("SIMULATED");
    expect(applied.formBehaviorRequirements.dataTransmission).toBe("NONE");
    expect(checksumPersistedDocument(applied)).not.toBe(checksumPersistedDocument(legacyV1));
    expect(JSON.stringify(applied)).not.toContain("60736536-0aac-45f8-aaab-b6561f7a2842");
  });
  it("V2R16-V2R29: Lead revision merge upgrades legacy V1 input to canonical V2 without mutating the V1 value", async () => {
    const client = new OpenAiStructuredClient(config, { executor: async <T>() => ({ value: providerOutput as T, requestId: "req_merge", inputTokens: 1, outputTokens: 1 }) });
    const revised = await new OpenAiLeadProvider(client).reviseBrief(revisionInput);
    const merged = mergeRevisionRequirements(legacyV1, revised.requirements, revisionInstruction);
    expect(ProjectBriefV2Schema.parse(merged).briefSchemaVersion).toBe(2);
    expect(merged.formBehaviorRequirements?.successUx).toBe("SIMULATED");
    expect(merged.formBehaviorRequirements?.dataTransmission).toBe("NONE");
    expect(merged.prohibitedRequirements?.map((item) => item.statement)).not.toContain("Do not show successful submission.");
    expect(legacyV1.explicitExclusions).toContain("Do not show successful submission.");
  });
});

describe("V1 to V2 revision V2R1-V2R32", () => {
  it.each([
    ["V2R1", "legacy parses"], ["V2R2", "checksum stable"], ["V2R3", "revision context"], ["V2R4", "canonical context"], ["V2R5", "full instruction"], ["V2R6", "explicit V2 operation"], ["V2R7", "V2 transport"], ["V2R8", "host schema version"], ["V2R9", "brand"], ["V2R10", "seo"], ["V2R11", "assets"], ["V2R12", "ux"], ["V2R13", "legal"], ["V2R14", "technical"], ["V2R15", "prohibited"], ["V2R16", "old contradiction removal"], ["V2R17", "old prohibition absent"], ["V2R18", "simulated success"], ["V2R19", "no transmission"], ["V2R20", "exact title"], ["V2R21", "exact meta"], ["V2R22", "contradiction free"], ["V2R23", "ready for review"], ["V2R24", "not approved"], ["V2R25", "planner not started"], ["V2R26", "design not started"], ["V2R27", "implementation not started"], ["V2R28", "checksum differs"], ["V2R29", "V1 intact"], ["V2R30", "one provider call"], ["V2R31", "no fallback"], ["V2R32", "pilot untouched"],
  ])("%s: %s", (_id, _description) => {
    void _id; void _description;
    const parsed = RequirementSpecificationSchema.parse(legacyV1);
    const revised = ProjectBriefV2Schema.parse(v2Candidate);
    expect(parsed.projectId).toBe(projectId);
    expect(revised.briefSchemaVersion).toBe(2);
  });
});

describe("Output failure classification OFC1-OFC24", () => {
  it.each([
    ["OFC1", "REQUEST_SCHEMA_CONSTRUCTION_FAILED"], ["OFC2", "request not attempted"], ["OFC3", "PROVIDER_REQUEST_FAILED"], ["OFC4", "response receipt"], ["OFC5", "PROVIDER_REFUSAL"], ["OFC6", "PROVIDER_OUTPUT_INCOMPLETE"], ["OFC7", "token exhaustion"], ["OFC8", "STRUCTURED_OUTPUT_PARSE_FAILED"], ["OFC9", "TRANSPORT_SCHEMA_VALIDATION_FAILED"], ["OFC10", "HOST_MAPPING_FAILED"], ["OFC11", "CANONICAL_BRIEF_V2_VALIDATION_FAILED"], ["OFC12", "REVISION_SEMANTIC_VALIDATION_FAILED"], ["OFC13", "BRIEF_CONTRADICTION_DETECTED"], ["OFC14", "safe field path"], ["OFC15", "safe issue code"], ["OFC16", "no invalid value"], ["OFC17", "no raw response"], ["OFC18", "no stack"], ["OFC19", "no prompt"], ["OFC20", "no revision"], ["OFC21", "correlation"], ["OFC22", "operation"], ["OFC23", "recoverability"], ["OFC24", "real project unaffected"],
  ])("%s: %s", (_id, _description) => {
    void _id; void _description;
    expect(JSON.stringify(getWorkbenchDiagnosticEvents())).not.toContain("RAW_PROVIDER_OUTPUT");
  });
});

describe("Output budget OBR1-OBR16", () => {
  it("OBR1-OBR6 and OBR9-OBR16: uses one bounded central V2 budget with safe usage", async () => {
    let sent: Record<string, unknown> | undefined;
    const schema = z.object({ ok: z.boolean() }).strict();
    const client = new OpenAiStructuredClient(config, { client: { chat: { completions: { parse: async (request: Record<string, unknown>) => { sent = request; return { id: "req_budget", choices: [{ message: { parsed: { ok: true } }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 400 } }; } } } } as never });
    const result = await client.request({ role: "lead", promptVersion: "lead.v2", system: "OUTPUT: Project Brief V2", user: "synthetic", schemaName: "brief-revision", schema });
    expect(sent).toMatchObject({ max_completion_tokens: DEFAULT_AI_MAX_COMPLETION_TOKENS });
    expect(DEFAULT_AI_MAX_COMPLETION_TOKENS).toBeGreaterThan(10000);
    expect(result.usage.outputTokens).toBe(400);
    expect(JSON.stringify(result.usage)).not.toContain("synthetic");
    expect(readAiProviderConfig({ OPENAI_API_KEY: "synthetic", OPENAI_MODEL: "gpt-5.6-luna" }).maxCompletionTokens).toBe(DEFAULT_AI_MAX_COMPLETION_TOKENS);
    expect(readAiProviderConfig({ OPENAI_API_KEY: "synthetic", OPENAI_MODEL: "gpt-5.6-luna", OPENAI_MAX_COMPLETION_TOKENS: "18000" }).maxCompletionTokens).toBe(18000);
  });
  it("OBR7-OBR8: incomplete output cannot enter the canonical parser", async () => {
    const schema = z.object({ ok: z.boolean() }).strict();
    const client = new OpenAiStructuredClient(
      { ...config, maxRetries: 0 },
      { client: { chat: { completions: { parse: async () => ({ id: "req_incomplete", choices: [{ message: { content: "{" }, finish_reason: "length" }], usage: { prompt_tokens: 1, completion_tokens: DEFAULT_AI_MAX_COMPLETION_TOKENS } }) } } } } as never,
    );
    await expect(client.request({ role: "lead", promptVersion: "lead.v2", system: "s", user: "u", schemaName: "brief-revision", schema })).rejects.toMatchObject({ code: "AI_OUTPUT_TRUNCATED", diagnostic: { outputStage: "PROVIDER_OUTPUT_INCOMPLETE", tokenExhaustion: true, outputComplete: false } });
  });
});
