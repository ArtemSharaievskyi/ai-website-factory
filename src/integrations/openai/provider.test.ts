import { describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { buildProductionResponseFormat, OpenAiStructuredClient, parseProviderWireContent, type StructuredRequest } from "./client";
import { AiProviderError } from "./errors";
import { FifoConcurrencyLimiter } from "./limiter";
import { zodResponseFormat } from "openai/helpers/zod";
import { BriefDraftStructuredOutputSchema, DesignDirectionStructuredOutputSchema, ImplementationChangeProposalStructuredOutputSchema, OpenAiImplementationProvider, OpenAiLeadProvider, OpenAiPlannerProvider, PlannerReferenceBindingError, PlanningPackageStructuredOutputSchema, PlanningRecoveryProviderSchemaDefinitions, createPlanningRecoveryProviderWireSchema, createTokenizedPlanningProviderWireSchema, isWorkflowApprovalBlocker, normalizeTokenizedPlanningPackage, plannerProviderPromptInput, validatePlannerRequirementCoverage } from "./adapters";
import { readAiProviderConfig } from "./config";
import { ArchitectureReviewProviderOutputSchema, CodeIntegrationReviewProviderOutputSchema, ContractAuditProviderOutputSchema, SecurityReviewProviderOutputSchema, TestQualityReviewProviderOutputSchema } from "@/domain/review/schema";
import { analyzePromptDeterministically } from "@/agents/lead/deterministic";
import { ClarificationPlanProviderOutputSchema, LeadAnalysisProviderOutputSchema } from "@/agents/lead/contracts";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { emptyBriefV2Fields } from "@/domain/requirements/brief";
import { buildPlanningPackage, validatePlanningAdmission } from "@/agents/planner/deterministic";
import { canonicalBriefToPlannerBrief } from "@/agents/planner/brief-context";
import { cleanBriefV3 } from "@/domain/requirements/v3/fixtures";
import { CanonicalBriefV3Schema } from "@/domain/requirements/v3/schema";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { createCanonicalPlanningRouteManifest, createPlanningOwnedRequirementManifest, createPlanningTargetCatalog } from "@/agents/planner/recovery-manifests";
import { createPlannerReferenceTable, measurePlannerProviderInput } from "@/agents/planner/reference-table";
import { deriveCoverageRepresentabilityPlan } from "@/agents/planner/coverage-representability";
import { PLANNER_DECOMPOSITION_CONTRACT_VERSION, PLANNER_DECOMPOSITION_PROVIDER_SCHEMA_NAME, PlanningDecompositionProviderOutputSchema } from "@/agents/planner/staged-contracts";
import { createDecompositionMinimumContract } from "@/agents/planner/decomposition-minimum";
import { PLANNER_ELEMENT_KINDS_BY_DOMAIN, PlannerCoverageDomainSchema } from "@/agents/planner/coverage-contract";
import type { SafeProviderEvent } from "./usage";

const config = { apiKey: "test", model: "test-model", modelLabel: "GPT-5.6 Luna", maxRetries: 1, maxConcurrentRequests: 1 };
const schema = z.object({ ok: z.boolean(), summary: z.string() }).strict();
const plannerCoverageElementByCategory: Record<string, string> = {
  ACCEPTANCE: "testStrategy",
  ADMINISTRATION: "administration",
  AUDIENCE: "profile",
  BACKEND: "architecture",
  BRAND_FACT: "profile",
  BUSINESS_GOAL: "productScope",
  CONTENT: "content",
  DATABASE: "dataModel",
  DECISION: "architecture",
  DEFERRED_INTEGRATION: "dependencies",
  EXCLUSION: "productScope",
  FEATURE: "productScope",
  FORM: "forms",
  FORM_INTERACTION: "forms",
  LEGAL_CONSTRAINT: "security",
  PROHIBITED: "productScope",
  SEO: "sitemap",
  TECHNICAL: "architecture",
  USER_ROLE: "authentication",
  UX_RESPONSIVE: "pages",
};
const hostOwnedPaths = (value: unknown, path = "root", includeDocumentMetadata = false): string[] => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const node = value as { properties?: Record<string, unknown>; items?: unknown; anyOf?: unknown[]; oneOf?: unknown[] };
  const paths = Object.entries(node.properties ?? []).flatMap(([name, child]) => [
    ...(new Set(["projectId", "projectVersion", "taskId", "taskAttempt", "taskContractId", "taskContractChecksum", "taskGraphChecksum", ...(includeDocumentMetadata ? ["createdAt", "updatedAt"] : []), "briefChecksum", "decisionId", "approval", "approvedAt", "approvedBy", "currentness", "history", "trace"]).has(name) ? [path + "." + name] : []),
    ...hostOwnedPaths(child, path + "." + name, includeDocumentMetadata),
  ]);
  if (node.items) paths.push(...hostOwnedPaths(node.items, path + "[]", includeDocumentMetadata));
  for (const child of [...(node.anyOf ?? []), ...(node.oneOf ?? [])]) paths.push(...hostOwnedPaths(child, path + ".variant", includeDocumentMetadata));
  return paths;
};
const request = { role: "test", promptVersion: "test.v1", system: "policy", user: "{}", schemaName: "test-output", schema, idempotencyKey: "same" };
const validExecutor = async <T>() => ({ value: { ok: true, summary: "bounded" } as T, requestId: "req_test" });

const noBackendPlannerTransport = () => {
  const projectId = randomUUID();
  const v2 = emptyBriefV2Fields();
  const brief = RequirementSpecificationSchema.parse({
    schemaVersion: 1, documentType: "requirements", projectId, projectVersion: 1, createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z",
    projectSummary: "A public information site", protectedFunctionalityRequired: false, imagesRequired: false, businessGoals: ["Explain the offer"], targetAudiences: ["Visitors"], pages: [{ slug: "home", purpose: "Explain the offer" }, { slug: "contact", purpose: "Contact form" }], userRoles: ["public visitor"], features: ["Local contact form"], forms: ["Contact form"], contentRequirements: [], backendRequirements: [], supabaseRequirements: [], authenticationDecision: "no-authentication-guest-first", storageDecision: "not-needed", emailDecision: "not-needed", administrationDecision: "not-needed", seoRequirements: [], localization: { locales: ["en"], defaultLocale: "en" }, imageSourceDecision: "user-supplied", suppliedBrandInformation: { status: "missing" }, suppliedLogoLocation: { status: "missing" }, technicalConstraints: [], explicitExclusions: [], userAcceptanceCriteria: ["Visitors can submit the local form"], unresolvedItems: [], approval: { approved: true, approvedRequirementsChecksum: "a".repeat(64) }, briefStatus: "approved", briefVersion: 1,
    ...v2, formBehaviorRequirements: { ...v2.formBehaviorRequirements, formPresent: true, validation: "ACTIVE", successUx: "SIMULATED", dataTransmission: "NONE", persistence: "NONE", thirdParty: "NONE", privacyCheckbox: "REQUIRED" },
  });
  const input = { projectId, projectVersion: 1, approvedBrief: brief, approvedBriefChecksum: checksumPersistedDocument(brief), originalPromptReference: "original-prompt.md", clarificationEvidenceReferences: [], currentWorkflowState: "AWAITING_DESIGN_SELECTION" as const, existingDecisions: [], suppliedFiles: [], allowedSkills: [], idempotencyKey: "provider-no-backend", expectedRowVersion: 1 };
  const canonical = buildPlanningPackage(input);
  const stripIdentity = (value: unknown): unknown => Array.isArray(value) ? value.map(stripIdentity) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key, nested]) => key !== "projectId" && key !== "projectVersion" && key !== "semanticChecksumPolicyVersion" && key !== "approvedBriefChecksum" && key !== "accepted" && key !== "acceptance" && key !== "decisionId" && key !== "routePolicy" && nested !== undefined).map(([key, nested]) => [key, stripIdentity(nested)])) : value;
  const transport = JSON.parse(JSON.stringify(stripIdentity(canonical))) as Record<string, unknown>;
  transport.databaseRecommendation = null;
  const architecture = transport.architecture as Record<string, unknown>;
  architecture.backendPriority = ["server-actions", "route-handlers", "supabase-services"];
  architecture.npmScripts = Object.entries(canonical.architecture.npmScripts).map(([name, command]) => ({ name, command }));
  for (const key of ["productScope", "sitemap", "navigation", "pages", "userFlows", "forms", "dataModel", "authentication", "supabase", "email", "storage", "administration", "traceability"]) {
    const node = transport[key];
    if (Array.isArray(node)) transport[key] = node.map((entry) => ({ ...(entry as Record<string, unknown>), unresolvedDependency: null }));
    else if (node && typeof node === "object" && Array.isArray((node as Record<string, unknown>).traceability)) (node as Record<string, unknown>).traceability = ((node as Record<string, unknown>).traceability as unknown[]).map((entry) => ({ ...(entry as Record<string, unknown>), unresolvedDependency: null }));
  }
  const sitemap = transport.sitemap as Record<string, unknown>;
  sitemap.routes = (sitemap.routes as Array<Record<string, unknown>>).map((route) => ({ ...route, primaryCta: route.primaryCta ?? null, parentId: route.parentId ?? null }));
  const userFlows = transport.userFlows as Record<string, unknown>;
  userFlows.flows = (userFlows.flows as Array<Record<string, unknown>>).map((flow) => ({ ...flow, steps: (flow.steps as Array<Record<string, unknown>>).map((step) => ({ ...step, routeId: step.routeId ?? null, decision: step.decision ?? null })) }));
  PlanningPackageStructuredOutputSchema.parse(transport);
  return { brief, input, transport };
};

function tokenizablePlannerTransport(canonical: ReturnType<typeof buildPlanningPackage>) {
  const stripIdentity = (value: unknown): unknown => Array.isArray(value) ? value.map(stripIdentity) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key, nested]) => key !== "projectId" && key !== "projectVersion" && key !== "semanticChecksumPolicyVersion" && key !== "approvedBriefChecksum" && key !== "accepted" && key !== "acceptance" && key !== "decisionId" && key !== "routePolicy" && nested !== undefined).map(([key, nested]) => [key, stripIdentity(nested)])) : value;
  const transport = JSON.parse(JSON.stringify(stripIdentity(canonical))) as Record<string, unknown>;
  transport.databaseRecommendation = null;
  const architecture = transport.architecture as Record<string, unknown>;
  architecture.backendPriority = ["server-actions", "route-handlers", "supabase-services"];
  architecture.npmScripts = Object.entries(canonical.architecture.npmScripts).map(([name, command]) => ({ name, command }));
  for (const key of ["productScope", "sitemap", "navigation", "pages", "userFlows", "forms", "dataModel", "authentication", "supabase", "email", "storage", "administration", "traceability"]) {
    const node = transport[key];
    if (Array.isArray(node)) transport[key] = node.map((entry) => ({ ...(entry as Record<string, unknown>), unresolvedDependency: null }));
    else if (node && typeof node === "object" && Array.isArray((node as Record<string, unknown>).traceability)) (node as Record<string, unknown>).traceability = ((node as Record<string, unknown>).traceability as unknown[]).map((entry) => ({ ...(entry as Record<string, unknown>), unresolvedDependency: null }));
  }
  const sitemap = transport.sitemap as Record<string, unknown>;
  sitemap.routes = (sitemap.routes as Array<Record<string, unknown>>).map((route) => ({ ...route, primaryCta: route.primaryCta ?? null, parentId: route.parentId ?? null }));
  const userFlows = transport.userFlows as Record<string, unknown>;
  userFlows.flows = (userFlows.flows as Array<Record<string, unknown>>).map((flow) => ({ ...flow, steps: (flow.steps as Array<Record<string, unknown>>).map((step) => ({ ...step, routeId: step.routeId ?? null, decision: step.decision ?? null })) }));
  const assets = transport.assets as Record<string, unknown>;
  assets.entries = (assets.entries as Array<Record<string, unknown>>).map((entry) => ({ ...entry, consistencyGroup: entry.consistencyGroup ?? null }));
  return PlanningPackageStructuredOutputSchema.parse(transport);
}

function recoveryNormalizationFixture(canonicalBriefOverride?: z.infer<typeof CanonicalBriefV3Schema>) {
  const base = noBackendPlannerTransport();
  const canonicalBrief = canonicalBriefOverride ?? CanonicalBriefV3Schema.parse({
    ...cleanBriefV3,
    pages: [...cleanBriefV3.pages, { id: "PAGE:contact", slug: "contact", purpose: "Provide the synthetic contact interaction.", sourceRefs: ["fixture:contact"] }],
    decisions: { ...cleanBriefV3.decisions, routePolicy: { mode: "MULTI_PAGE" }, form: { ...cleanBriefV3.decisions.form, interactionStates: [] } },
  });
  const sourceTransport = canonicalBriefOverride
    ? tokenizablePlannerTransport(buildPlanningPackage({
        ...base.input,
        approvedBrief: { ...canonicalBriefToPlannerBrief(canonicalBrief, base.input.approvedBrief), administrationDecision: "not-needed" },
        canonicalBrief: undefined,
        approvedBriefChecksum: canonicalBriefChecksum(canonicalBrief),
      }))
    : base.transport;
  const routeManifest = createCanonicalPlanningRouteManifest(canonicalBrief);
  const requirementManifest = createPlanningOwnedRequirementManifest(canonicalBrief);
  const targetCatalog = createPlanningTargetCatalog(routeManifest);
  const traceabilityTarget = targetCatalog.targets.find((entry) => entry.kind === "section" && entry.section === "traceability")!;
  const firstRequirementHandle = requirementManifest.requirements[0]!.requirementHandle;
  type JsonObject = Record<string, unknown>;
  const handleizeReferences = (value: unknown, key = ""): unknown => {
    if (key === "requirementReferences" && Array.isArray(value)) return value.map(() => firstRequirementHandle);
    if (Array.isArray(value)) return value.map((child) => handleizeReferences(child));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value as JsonObject).map(([childKey, child]) => [childKey, handleizeReferences(child, childKey)]));
  };
  const removeProviderDocumentMetadata = (value: unknown): unknown => Array.isArray(value)
    ? value.map(removeProviderDocumentMetadata)
    : value && typeof value === "object"
      ? Object.fromEntries(Object.entries(value as JsonObject).filter(([key]) => key !== "createdAt" && key !== "updatedAt").map(([key, child]) => [key, removeProviderDocumentMetadata(child)]))
      : value;
  const transport = removeProviderDocumentMetadata(handleizeReferences(JSON.parse(JSON.stringify(sourceTransport)))) as JsonObject;
  const sitemap = transport.sitemap as JsonObject;
  const routeRows = sitemap.routes as JsonObject[];
  const legacyRouteIds = new Map(routeRows.map((route, index) => [String(route.id), routeManifest.routes[index]! ]));
  const routeForValue = (value: unknown) => routeManifest.routes.find((route) => route.path === value) ?? legacyRouteIds.get(String(value)) ?? routeManifest.routes[0]!;
  sitemap.routes = routeRows.map((route, index) => {
    const manifestRoute = routeManifest.routes[index]!;
    const fields = Object.fromEntries(Object.entries(route).filter(([key]) => key !== "id" && key !== "parentId"));
    return { ...fields, routeHandle: manifestRoute.routeHandle, pageHandle: manifestRoute.pageHandle, parentPageHandle: null };
  });
  const pages = transport.pages as JsonObject;
  pages.pages = (pages.pages as JsonObject[]).map((page, index) => {
    const manifestRoute = routeManifest.routes[index]!;
    const fields = Object.fromEntries(Object.entries(page).filter(([key]) => key !== "id" && key !== "routeId"));
    return { ...fields, pageHandle: manifestRoute.pageHandle, routeHandle: manifestRoute.routeHandle };
  });
  const navigation = transport.navigation as JsonObject;
  for (const key of ["primary", "secondary", "footer", "contextual", "protected", "routeReferences"]) {
    navigation[key] = (navigation[key] as unknown[]).map((value) => routeForValue(value).routeHandle);
  }
  const userFlows = transport.userFlows as JsonObject;
  userFlows.flows = (userFlows.flows as JsonObject[]).map((flow) => {
    const { startRoute, ...fields } = flow;
    return {
      ...fields,
      startRouteHandle: routeForValue(startRoute).routeHandle,
      steps: (flow.steps as JsonObject[]).map((step) => {
        const { routeId, ...stepFields } = step;
        return { ...stepFields, routeHandle: routeId === null ? null : routeForValue(routeId).routeHandle };
      }),
    };
  });
  const forms = transport.forms as JsonObject;
  forms.forms = (forms.forms as JsonObject[]).map((form) => {
    const { route, ...fields } = form;
    return { ...fields, routeHandle: routeForValue(route).routeHandle };
  });
  const architecture = transport.architecture as JsonObject;
  architecture.routes = (architecture.routes as JsonObject[]).map((route) => ({ routeHandle: routeForValue(route.path).routeHandle, responsibility: route.responsibility }));
  transport.requirementAccounting = Object.fromEntries(requirementManifest.requirements.map((entry) => [entry.requirementHandle, {
    disposition: "OTHER_PLANNING_RESPONSIBILITY",
    planningTargetRefs: [{ targetHandle: traceabilityTarget.targetHandle }],
    semanticEvidence: "The current Planning package records the approved responsibility in its traceability section.",
  }])) as Record<string, unknown>;
  createPlanningRecoveryProviderWireSchema(requirementManifest).parse(transport);
  return {
    transport,
    input: {
      authority: "PLANNING_RECOVERY",
      mode: "FULL_PLANNING_REBUILD",
      plan: { recoveryReason: "UNRECOVERABLE_CURRENT_PLANNING_STATE", routePolicy: "MULTI_PAGE" },
      canonicalBrief,
      canonicalRouteManifest: routeManifest,
      planningRequirementManifest: requirementManifest,
      planningTargetCatalog: targetCatalog,
      planningOwnedRequirements: requirementManifest.requirements.map(({ requirementId, category, statement, sourceRefs }) => ({ id: requirementId, category, statement, sourceRefs })),
      plannerInput: { ...base.input, canonicalBrief },
      currentPlanningEvidence: { structuralSummary: { routeCount: 2, pageCount: 2, formCount: 1, assetCount: 0, dependencyCount: 1, structuralChecksum: "a".repeat(64) } },
      outputPolicy: { schemaVersion: 1, maxBytes: 512_000, maxEstimatedTokens: 64_000, complete: true, truncation: "REJECT" },
    },
  };
}

function tokenizedPlannerFixture(canonicalBriefOverride?: z.infer<typeof CanonicalBriefV3Schema>) {
  const recovery = recoveryNormalizationFixture(canonicalBriefOverride);
  const canonicalBrief = recovery.input.canonicalBrief;
  const baseInput = recovery.input.plannerInput;
  const approvedBriefChecksum = canonicalBriefChecksum(canonicalBrief);
  const table = createPlannerReferenceTable({
    projectId: baseInput.projectId,
    projectVersion: baseInput.projectVersion,
    approvedBriefChecksum,
    idempotencyKey: baseInput.idempotencyKey,
    expectedRowVersion: baseInput.expectedRowVersion,
    canonicalBrief,
  });
  type JsonObject = Record<string, unknown>;
  const transport = JSON.parse(JSON.stringify(recovery.transport)) as JsonObject;
  const routeByRecoveryHandle = new Map(createCanonicalPlanningRouteManifest(canonicalBrief).routes.map((route) => [route.routeHandle, route]));
  const routeByRecoveryPageHandle = new Map(createCanonicalPlanningRouteManifest(canonicalBrief).routes.map((route) => [route.pageHandle, route]));
  const routeTokenByPath = new Map(table.routes.map((route) => [route.path, route.token]));
  const pageTokenByPath = new Map(table.pages.map((page) => [page.path, page.token]));
  const requirementTokenById = new Map(table.requirements.map((entry) => [entry.canonicalRequirementId, entry.token]));
  const requirementIdByRecoveryHandle = new Map(createPlanningOwnedRequirementManifest(canonicalBrief).requirements.map((entry) => [entry.requirementHandle, entry.requirementId]));
  const tokenForRouteHandle = (handle: unknown) => {
    const route = routeByRecoveryHandle.get(String(handle));
    return route ? routeTokenByPath.get(route.path)! : routeTokenByPath.get(String(handle))!;
  };
  const tokenForPageHandle = (handle: unknown) => {
    const route = routeByRecoveryPageHandle.get(String(handle));
    return route ? pageTokenByPath.get(route.path)! : pageTokenByPath.get(String(handle))!;
  };
  const tokenizeReferences = (value: unknown, key = ""): unknown => {
    if (key === "requirementReferences" && Array.isArray(value)) return value.map((reference) => {
      const requirementId = requirementIdByRecoveryHandle.get(String(reference)) ?? String(reference);
      const requirementToken = requirementTokenById.get(requirementId);
      if (!requirementToken) throw new Error("Synthetic Planner fixture contains an unmapped requirement reference.");
      return requirementToken;
    });
    if (Array.isArray(value)) return value.map((entry) => tokenizeReferences(entry));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value as JsonObject).map(([childKey, child]) => [childKey, tokenizeReferences(child, childKey)]));
  };
  const tokenized = tokenizeReferences(transport) as JsonObject;
  const sitemap = tokenized.sitemap as JsonObject;
  sitemap.routes = (sitemap.routes as JsonObject[]).map((route) => {
    const routeToken = tokenForRouteHandle(route.routeHandle);
    const pageToken = tokenForPageHandle(route.pageHandle);
    const fields = Object.fromEntries(Object.entries(route).filter(([key]) => !["routeHandle", "pageHandle", "parentPageHandle", "path"].includes(key)));
    return { ...fields, routeToken, pageToken };
  });
  const pages = tokenized.pages as JsonObject;
  pages.pages = (pages.pages as JsonObject[]).map((page) => {
    const fields = Object.fromEntries(Object.entries(page).filter(([key]) => !["pageHandle", "routeHandle"].includes(key)));
    return { ...fields, pageToken: tokenForPageHandle(page.pageHandle), routeToken: tokenForRouteHandle(page.routeHandle) };
  });
  const navigation = tokenized.navigation as JsonObject;
  for (const key of ["primary", "secondary", "footer", "contextual", "protected", "routeReferences"])
    navigation[key] = (navigation[key] as unknown[]).map(tokenForRouteHandle);
  const userFlows = tokenized.userFlows as JsonObject;
  userFlows.flows = (userFlows.flows as JsonObject[]).map((flow) => {
    const { startRouteHandle, ...fields } = flow;
    return { ...fields, startRouteToken: tokenForRouteHandle(startRouteHandle), steps: (flow.steps as JsonObject[]).map((step) => { const { routeHandle, ...stepFields } = step; return { ...stepFields, routeToken: routeHandle === null ? null : tokenForRouteHandle(routeHandle) }; }) };
  });
  const forms = tokenized.forms as JsonObject;
  forms.forms = (forms.forms as JsonObject[]).map((form) => { const { routeHandle, ...fields } = form; return { ...fields, routeToken: tokenForRouteHandle(routeHandle) }; });
  const architecture = tokenized.architecture as JsonObject;
  architecture.routes = (architecture.routes as JsonObject[]).map((route) => ({ routeToken: tokenForRouteHandle(route.routeHandle), responsibility: route.responsibility }));
  const toRouteTokens = (value: unknown) => Array.isArray(value) ? value.map((entry) => routeTokenByPath.get(String(entry)) ?? tokenForRouteHandle(entry)) : [];
  const authentication = tokenized.authentication as JsonObject;
  authentication.protectedRoutes = toRouteTokens(authentication.protectedRoutes);
  const administration = tokenized.administration as JsonObject;
  administration.protectedRoutes = toRouteTokens(administration.protectedRoutes);
  delete tokenized.requirementAccounting;
  tokenized.coverageByRequirement = Object.fromEntries(table.requirements.filter((entry) => entry.mandatory).map((entry) => {
    const planningElementId = plannerCoverageElementByCategory[entry.category] ?? "traceability";
    return [entry.token, { planningElementIds: [planningElementId], semanticEvidence: `The plan records ${entry.token} in the ${planningElementId} responsibility and the host resolves it exactly.` }];
  }));
  createTokenizedPlanningProviderWireSchema(table).parse(tokenized);
  return {
    input: { ...baseInput, canonicalBrief, approvedBriefChecksum, plannerReferenceTable: table },
    table,
    transport: tokenized,
  };
}

function exact87CanonicalBrief() {
  return CanonicalBriefV3Schema.parse({
    ...cleanBriefV3,
    pages: [...cleanBriefV3.pages, { id: "PAGE:contact-exact-coverage", slug: "contact", purpose: "Provide the synthetic contact interaction.", sourceRefs: ["fixture:exact-coverage:contact"] }],
    decisions: { ...cleanBriefV3.decisions, routePolicy: { mode: "MULTI_PAGE" } },
    requirements: Array.from({ length: 87 }, (_, index) => ({
      id: `REQUIREMENT:synthetic-exact-coverage-${String(index + 1).padStart(3, "0")}`,
      category: "FEATURE" as const,
      statement: `Preserve synthetic mandatory Planning responsibility ${index + 1}.`,
      sourceRefs: [`fixture:exact-coverage:${index + 1}`],
    })),
    seo: { ...cleanBriefV3.seo, locationTargeting: [] },
  });
}

function exact87ReferenceTable() {
  const canonicalBrief = exact87CanonicalBrief();
  return createPlannerReferenceTable({
    projectId: "22222222-2222-4222-8222-222222222222",
    projectVersion: 1,
    approvedBriefChecksum: canonicalBriefChecksum(canonicalBrief),
    idempotencyKey: "synthetic-exact-87-coverage",
    expectedRowVersion: 1,
    canonicalBrief,
  });
}

const syntheticCoverageCategories = [
  "ACCEPTANCE", "ADMINISTRATION", "AUDIENCE", "BACKEND", "BRAND_FACT", "BUSINESS_GOAL", "CONTENT", "DATABASE", "DECISION", "DEFERRED_INTEGRATION", "EXCLUSION", "FEATURE", "FORM", "FORM_INTERACTION", "PROHIBITED", "SEO", "TECHNICAL", "USER_ROLE", "UX_RESPONSIVE",
] as const;

function synthetic117CanonicalBrief() {
  return CanonicalBriefV3Schema.parse({
    ...cleanBriefV3,
    pages: [...cleanBriefV3.pages, { id: "PAGE:synthetic-secondary", slug: "secondary", purpose: "Provide the synthetic secondary page.", sourceRefs: ["fixture:semantic-coverage:secondary-page"] }],
    requirements: Array.from({ length: 117 }, (_, index) => ({
      id: `REQUIREMENT:synthetic-coverage-${String(index + 1).padStart(3, "0")}`,
      category: syntheticCoverageCategories[index % syntheticCoverageCategories.length]!,
      statement: `Synthetic mandatory Planning responsibility ${index + 1}.`,
      sourceRefs: [`fixture:semantic-coverage:${index + 1}`],
    })),
  });
}

function syntheticCoverageCandidate() {
  return {
    profile: {}, productScope: {}, sitemap: { routes: [{ routeToken: "ROUTE_001", pageToken: "PAGE_001" }] }, navigation: {}, pages: { pages: [{ pageToken: "PAGE_001", routeToken: "ROUTE_001" }] }, userFlows: { flows: [{ id: "synthetic-flow" }] }, forms: { forms: [{ id: "synthetic-form" }] }, dataModel: { entities: [{ id: "synthetic-entity" }] }, authentication: {}, supabase: {}, email: {}, storage: {}, administration: {}, content: {}, assets: { entries: [] }, architecture: {}, environment: {}, dependencies: {}, testStrategy: {}, security: {}, traceability: [],
  };
}

const coverageSectionByKind: Record<string, string> = {
  PROFILE: "profile", PRODUCT_SCOPE: "productScope", ROUTE: "sitemap", PAGE: "pages", NAVIGATION: "navigation", USER_FLOW: "userFlows", FORM: "forms", DATABASE_MODEL: "dataModel", AUTHENTICATION: "authentication", SUPABASE: "supabase", EMAIL: "email", STORAGE: "storage", ADMINISTRATION: "administration", CONTENT: "content", ASSET: "assets", ARCHITECTURE: "architecture", ENVIRONMENT: "environment", DEPENDENCY: "dependencies", TEST_STRATEGY: "testStrategy", SECURITY: "security", TRACEABILITY: "traceability",
};

describe("production AI provider boundary", () => {
  it("constructs every reviewer strict transport schema with required nullable metadata", () => {
    const schemas = [
      ["architecture-review-result", ArchitectureReviewProviderOutputSchema, "REQUIREMENT_TRACEABILITY"],
      ["contract-audit-result", ContractAuditProviderOutputSchema, "REQUIREMENT_NOT_TRACED"],
      ["code-integration-review-result", CodeIntegrationReviewProviderOutputSchema, "CONTRACT_IMPLEMENTATION_MISMATCH"],
      ["security-review-result", SecurityReviewProviderOutputSchema, "TRUST_BOUNDARY"],
      ["test-quality-review-result", TestQualityReviewProviderOutputSchema, "REQUIREMENT_NOT_VERIFIED"],
    ] as const;
    const evidenceId = `E${"0".repeat(16)}-001`;
    for (const [name, schema, category] of schemas) {
      expect(() => zodResponseFormat(schema, name)).not.toThrow();
      const zeroFinding = { verdict: "APPROVED", findings: [], reviewedArtifactRefs: [evidenceId], blockedReason: null };
      expect(schema.safeParse(zeroFinding).success).toBe(true);
      expect(schema.safeParse({ ...zeroFinding, policyVersion: "provider-authored-old-policy" }).success).toBe(false);
      expect(schema.safeParse({ ...zeroFinding, targetWorkflowState: "AWAITING_DESIGN_SELECTION" }).success).toBe(false);
      const oneFinding = { ...zeroFinding, verdict: "CHANGES_REQUIRED", findings: [{ findingId: "finding-1", severity: "INFO", category, summary: "Bounded finding.", evidenceRefs: [evidenceId], affectedArtifacts: [], recommendedAction: "Review the cited evidence.", ...(category === "REQUIREMENT_NOT_TRACED" ? { correctionTarget: "PLANNING" } : {}), ...(category === "CONTRACT_IMPLEMENTATION_MISMATCH" ? { correctionTarget: "IMPLEMENTATION_TASK", ownerTaskId: null } : {}), ...(category === "TRUST_BOUNDARY" ? { correctionTarget: "IMPLEMENTATION_TASK", ownerTaskId: null } : {}), ...(category === "REQUIREMENT_NOT_VERIFIED" ? { correctionTarget: "TEST_TASK", ownerTaskId: null } : {}) }] };
      expect(schema.safeParse(oneFinding).success).toBe(true);
    }
  });
  it("rejects invalid reviewer severity, verdict, and evidence for every reviewer schema", () => {
    const schemas = [
      [ArchitectureReviewProviderOutputSchema, "REQUIREMENT_TRACEABILITY"],
      [ContractAuditProviderOutputSchema, "REQUIREMENT_NOT_TRACED"],
      [CodeIntegrationReviewProviderOutputSchema, "CONTRACT_IMPLEMENTATION_MISMATCH"],
      [SecurityReviewProviderOutputSchema, "TRUST_BOUNDARY"],
      [TestQualityReviewProviderOutputSchema, "REQUIREMENT_NOT_VERIFIED"],
    ] as const;
    for (const [schema, category] of schemas) {
      const finding = {
        findingId: "finding-1",
        severity: "INFO",
        category,
        summary: "Bounded finding.",
        evidenceRefs: ["file:src/app.ts"],
        affectedArtifacts: [],
        recommendedAction: "Review the cited evidence.",
        ...(category === "REQUIREMENT_NOT_TRACED" ? { correctionTarget: "PLANNING" } : {}),
        ...(category === "CONTRACT_IMPLEMENTATION_MISMATCH" ? { correctionTarget: "IMPLEMENTATION_TASK", ownerTaskId: null } : {}),
        ...(category === "TRUST_BOUNDARY" ? { correctionTarget: "IMPLEMENTATION_TASK", ownerTaskId: null } : {}),
        ...(category === "REQUIREMENT_NOT_VERIFIED" ? { correctionTarget: "TEST_TASK", ownerTaskId: null } : {}),
      };
      const valid = { verdict: "CHANGES_REQUIRED", findings: [finding], reviewedArtifactRefs: ["file:src/app.ts"], blockedReason: null };
      expect(schema.safeParse({ ...valid, findings: [{ ...finding, severity: "SEVERE" }] }).success).toBe(false);
      expect(schema.safeParse({ ...valid, verdict: "UNKNOWN" }).success).toBe(false);
      expect(schema.safeParse({ ...valid, findings: [{ ...finding, evidenceRefs: [] }] }).success).toBe(false);
    }
  });
  it("uses a strict Brief transport schema while preserving nullable optional domain values", () => {
    expect(() => zodResponseFormat(BriefDraftStructuredOutputSchema, "brief-draft")).not.toThrow();
  });
  it("uses a strict Lead transport schema with nullable provider observations", () => {
    expect(() => zodResponseFormat(LeadAnalysisProviderOutputSchema, "lead-analysis")).not.toThrow();
    const transport = { languageObservation: null, directlyStatedFacts: [], userPreferences: [], inferredRecommendations: [], unresolvedQuestions: [], contradictions: [], unsupportedAssumptions: [], confirmationRequired: [], provider: { name: "synthetic", model: null, used: true, inputTokens: null, outputTokens: null } };
    expect(LeadAnalysisProviderOutputSchema.safeParse(transport).success).toBe(true);
    expect(LeadAnalysisProviderOutputSchema.safeParse({ ...transport, languageObservation: undefined }).success).toBe(false);
  });
  it("does not treat approval as a Brief validation blocker", () => {
    expect(isWorkflowApprovalBlocker("Explicit Project Brief approval has not yet been recorded.")).toBe(true);
    expect(isWorkflowApprovalBlocker("The finalized Project Brief has not yet been explicitly approved before Planner runs.")).toBe(true);
    expect(isWorkflowApprovalBlocker("The finalized Brief is ready for the explicit approval stage.")).toBe(false);
    expect(isWorkflowApprovalBlocker("The Project Brief has not been explicitly approved.")).toBe(true);
  });
  it("uses a strict Planner transport schema without weakening the canonical package", () => {
    expect(() => zodResponseFormat(PlanningPackageStructuredOutputSchema, "planning-package")).not.toThrow();
    const schema = (zodResponseFormat(PlanningPackageStructuredOutputSchema, "planning-package") as unknown as { json_schema: { schema: { properties: Record<string, { properties?: Record<string, unknown>; items?: { properties?: Record<string, unknown> } }> } } }).json_schema.schema;
    expect(schema.properties).not.toHaveProperty("approvedBriefChecksum");
    expect(schema.properties).not.toHaveProperty("accepted");
    expect(schema.properties).not.toHaveProperty("acceptance");
    expect(schema.properties.architecture?.properties).not.toHaveProperty("acceptance");
    expect(schema.properties.traceability.items?.properties).not.toHaveProperty("decisionId");
  });
  it("uses a separate strict recovery transport with host-free identity and exact handle fields", () => {
    const fixture = recoveryNormalizationFixture();
    const recoverySchema = createPlanningRecoveryProviderWireSchema(fixture.input.planningRequirementManifest);
    expect(() => zodResponseFormat(recoverySchema, "planning-recovery-package")).not.toThrow();
    expect(recoverySchema.safeParse({ projectId: randomUUID() }).success).toBe(false);
    const schema = (zodResponseFormat(recoverySchema, "planning-recovery-package") as unknown as { json_schema: { schema: { properties: Record<string, { properties?: Record<string, unknown>; items?: { properties?: Record<string, unknown> } }> } } }).json_schema.schema;
    const routeProperties = ((schema.properties.sitemap?.properties?.routes as { items?: { properties?: Record<string, unknown> } } | undefined)?.items?.properties);
    expect(schema.properties).not.toHaveProperty("accepted");
    expect(schema.properties).not.toHaveProperty("sourceHead");
    expect(schema.properties).not.toHaveProperty("routePolicy");
    const accountingProperties = schema.properties.requirementAccounting?.properties as Record<string, { properties?: Record<string, unknown>; items?: unknown }> | undefined;
    expect(accountingProperties).toBeDefined();
    const firstAccounting = accountingProperties?.[fixture.input.planningRequirementManifest.requirements[0]!.requirementHandle];
    expect(firstAccounting?.properties).not.toHaveProperty("requirementId");
    expect(firstAccounting?.properties).not.toHaveProperty("requirementDomain");
    expect(firstAccounting?.properties).toHaveProperty("planningTargetRefs");
    expect(firstAccounting?.properties).toHaveProperty("semanticEvidence");
    const targetProperties = (firstAccounting?.properties?.planningTargetRefs as { items?: { properties?: Record<string, unknown> } } | undefined)?.items?.properties;
    expect(targetProperties).toEqual({ targetHandle: expect.anything() });
    const accounting = fixture.transport.requirementAccounting as Record<string, unknown>;
    expect(recoverySchema.safeParse({ ...fixture.transport, requirementAccounting: Object.fromEntries(Object.entries(accounting).slice(0, -1)) }).success).toBe(false);
    expect(recoverySchema.safeParse({ ...fixture.transport, requirementAccounting: { ...accounting, "planning-requirement:R999": accounting[fixture.input.planningRequirementManifest.requirements[0]!.requirementHandle] } }).success).toBe(false);
    expect(routeProperties).toHaveProperty("routeHandle");
    expect(routeProperties).toHaveProperty("pageHandle");
    expect(routeProperties).not.toHaveProperty("id");
    expect(hostOwnedPaths((zodResponseFormat(recoverySchema, "planning-recovery-package") as { json_schema: { schema: unknown } }).json_schema.schema, "root", true)).toEqual([]);
    expect(JSON.stringify((zodResponseFormat(recoverySchema, "planning-recovery-package") as { json_schema: { schema: unknown } }).json_schema.schema)).not.toMatch(/"(?:createdAt|updatedAt)"|date-time/);
  });
  it("normalizes a complete recovery response from opaque handles before canonical package validation", async () => {
    const fixture = recoveryNormalizationFixture();
    const client = new OpenAiStructuredClient(config, { executor: async <T>() => ({ value: fixture.transport as T, requestId: "req_recovery_handle_binding" }) });
    const result = await new OpenAiPlannerProvider(client).planRecovery(fixture.input as never, [], "none", "2026-08-31T00:00:00.000Z");
    expect(result.planningPackage.sitemap.routes.map((route) => route.path)).toEqual(["/", "/contact"]);
    expect(Object.keys(result.requirementAccounting)).toHaveLength(fixture.input.planningRequirementManifest.requirements.length);
    expect(Object.values(result.requirementAccounting as Record<string, unknown>).every((entry) => !entry || typeof entry !== "object" || !("requirementId" in entry))).toBe(true);
    expect(result.planningPackage.traceability.some((entry) => entry.requirementReferences.includes(fixture.input.planningRequirementManifest.requirements[0]!.requirementId))).toBe(true);
    expect(result.planningPackage.createdAt).toBe("2026-08-31T00:00:00.000Z");
    expect(result.planningPackage.updatedAt).toBe("2026-08-31T00:00:00.000Z");
    expect(result.planningPackage.sitemap.createdAt).toBe("2026-08-31T00:00:00.000Z");
    expect(result.planningPackage.architecture.updatedAt).toBe("2026-08-31T00:00:00.000Z");
    expect(createPlanningRecoveryProviderWireSchema(fixture.input.planningRequirementManifest).safeParse({ ...fixture.transport, createdAt: "2026-08-30T00:00:00.000Z" }).success).toBe(false);
  });
  it("replays the exact 11-route and 118-requirement recovery wire shape without network access", () => {
    const fixture = recoveryNormalizationFixture();
    const replay = JSON.parse(JSON.stringify(fixture.transport)) as Record<string, unknown>;
    const sitemap = replay.sitemap as Record<string, unknown>;
    const baseRoute = (sitemap.routes as Array<Record<string, unknown>>)[0]!;
    sitemap.routes = Array.from({ length: 11 }, (_, index) => ({ ...baseRoute, routeHandle: `planning-route:replay-${String(index + 1).padStart(3, "0")}`, pageHandle: `planning-page:replay-${String(index + 1).padStart(3, "0")}`, path: index === 0 ? "/" : `/replay-${index}` }));
    const pages = replay.pages as Record<string, unknown>;
    const basePage = (pages.pages as Array<Record<string, unknown>>)[0]!;
    pages.pages = Array.from({ length: 11 }, (_, index) => ({ ...basePage, pageHandle: `planning-page:replay-${String(index + 1).padStart(3, "0")}`, routeHandle: `planning-route:replay-${String(index + 1).padStart(3, "0")}` }));
    const architecture = replay.architecture as Record<string, unknown>;
    const baseArchitectureRoute = (architecture.routes as Array<Record<string, unknown>>)[0]!;
    architecture.routes = Array.from({ length: 11 }, (_, index) => ({ ...baseArchitectureRoute, routeHandle: `planning-route:replay-${String(index + 1).padStart(3, "0")}` }));
    const accounting = replay.requirementAccounting as Record<string, Record<string, unknown>>;
    const contractManifestRequirements = Array.from({ length: 118 }, (_, index) => ({ requirementHandle: `planning-requirement:R${String(index).padStart(3, "0")}` }));
    const contractManifest = { requirements: contractManifestRequirements };
    const baseAccounting = Object.values(accounting)[0]!;
    replay.requirementAccounting = Object.fromEntries(contractManifestRequirements.map((entry, index) => [entry.requirementHandle, { ...baseAccounting, semanticEvidence: `Synthetic replay evidence position ${index}.` }]));
    const recoverySchema = createPlanningRecoveryProviderWireSchema(contractManifest as never);
    recoverySchema.parse(replay);
    const responseFormat = buildProductionResponseFormat(recoverySchema, "planning-recovery-package", { schemaDefinitions: PlanningRecoveryProviderSchemaDefinitions }) as unknown as { type: string; json_schema: { name: string; strict: boolean; schema: unknown } };
    const parsed = parseProviderWireContent({
      content: JSON.stringify(replay),
      schema: recoverySchema,
      response: {
        requestId: "req_manual_replay",
        inputTokens: 11,
        outputTokens: 118,
        diagnostic: { stage: "api_response", requestAttempted: true, apiResponseReceived: true, responseReceived: true, schemaName: "planning-recovery-package", requestId: "req_manual_replay", choicesCount: 1, finishReason: "stop", contentPresent: true, outputComplete: false },
      },
    });
    expect(responseFormat).toMatchObject({ type: "json_schema", json_schema: { name: "planning-recovery-package", strict: true } });
    expect(JSON.stringify(responseFormat.json_schema)).not.toContain("$parseRaw");
    expect(parsed.value.sitemap.routes).toHaveLength(11);
    expect(Object.keys(parsed.value.requirementAccounting)).toHaveLength(118);
    expect(parsed.diagnostic).toMatchObject({ jsonParseSucceeded: true, rawContentBytes: expect.any(Number), rawContentChecksum: expect.stringMatching(/^[a-f0-9]{64}$/), outputComplete: true });
  });
  it("normalizes a provider backend priority to no-backend when the approved Brief requires frontend-only behavior", async () => {
    const fixture = noBackendPlannerTransport();
    const client = new OpenAiStructuredClient(config, { executor: async <T>() => ({ value: fixture.transport as T, requestId: "req_no_backend_planner" }) });
    const result = await new OpenAiPlannerProvider(client).plan(fixture.input);
    expect(result.architecture.backendPriority).toEqual([]);
    expect(result.forms.forms[0]?.submissionMechanism).toBe("client-only");
  });
  it("uses token-only initial Planner references and resolves them to host-owned canonical identities", async () => {
    const fixture = tokenizedPlannerFixture();
    let sent: StructuredRequest<unknown> | undefined;
    const client = new OpenAiStructuredClient(config, { executor: async <T>(request: StructuredRequest<T>) => { sent = request as StructuredRequest<unknown>; return { value: fixture.transport as T, requestId: "req_planner_traceability_allowlist" }; } });
    const result = await new OpenAiPlannerProvider(client).plan(fixture.input);
    const firstCanonicalRequirementId = fixture.table.requirements[0]!.canonicalRequirementId;
    expect(sent?.promptVersion).toBe("planner.v5");
    expect(sent?.schemaName).toBe("planning-package-v5");
    expect(sent?.system).toContain("REQ_001");
    expect(sent?.system).toContain("host-issued and opaque");
    expect(sent?.system).not.toContain(firstCanonicalRequirementId);
    expect(sent?.user).not.toContain(firstCanonicalRequirementId);
    expect(result.providerContractVersion).toBe("planner.v5");
    expect(JSON.stringify(result)).toContain(firstCanonicalRequirementId);
    expect(result.sitemap.routes[0]?.id).toBe(fixture.table.routes[0]?.canonicalRouteId);
    expect(result.sitemap.routes[0]?.path).toBe(fixture.table.routes[0]?.path);
    expect(result.pages.pages[0]?.id).toBe(fixture.table.pages[0]?.planningPageId);
    expect(sent?.retryPolicy).toEqual({ maxRetries: 0, corrections: 0 });
  });
  it("generates exact host-owned required coverage slots for the current reference table", () => {
    const fixture = tokenizedPlannerFixture();
    const response = zodResponseFormat(createTokenizedPlanningProviderWireSchema(fixture.table), "planning-package-v5") as unknown as { json_schema: { schema: { properties: Record<string, { properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean }> } } };
    const coverage = response.json_schema.schema.properties.coverageByRequirement;
    const requiredTokens = fixture.table.requirements.filter((entry) => entry.mandatory).map((entry) => entry.token);
    expect(Object.keys(coverage?.properties ?? {})).toEqual(requiredTokens);
    expect(coverage?.required).toEqual(requiredTokens);
    expect(coverage?.additionalProperties).toBe(false);
  });
  it("requires REQ_087 in the exact 87-requirement structured-output contract and rejects its empty value", async () => {
    const table = exact87ReferenceTable();
    const requiredTokens = table.requirements.filter((entry) => entry.mandatory).map((entry) => entry.token);
    const response = zodResponseFormat(createTokenizedPlanningProviderWireSchema(table), "planning-package-v5") as unknown as { json_schema: { schema: { properties: Record<string, { properties?: Record<string, unknown>; required?: string[]; additionalProperties?: boolean }> } } };
    const coverage = response.json_schema.schema.properties.coverageByRequirement;
    expect(requiredTokens).toHaveLength(87);
    expect(requiredTokens.at(-1)).toBe("REQ_087");
    expect(coverage?.required).toEqual(requiredTokens);
    expect(coverage?.properties).toHaveProperty("REQ_087");
    const fixture = tokenizedPlannerFixture(exact87CanonicalBrief());
    const empty = JSON.parse(JSON.stringify(fixture.transport)) as Record<string, unknown>;
    ((empty.coverageByRequirement as Record<string, Record<string, unknown>>).REQ_087!).planningElementIds = [];
    const planner = new OpenAiPlannerProvider(new OpenAiStructuredClient(config, { executor: async <T>() => ({ value: empty as T, requestId: "req_exact_87_empty_coverage" }) }));
    await expect(planner.plan(fixture.input)).rejects.toMatchObject({ code: "PLANNING_REQUIREMENT_COVERAGE_INVALID" } satisfies Partial<PlannerReferenceBindingError>);
  });
  it("admits a synthetic complete 117/117 coverage candidate through the strict wire and normalization boundary", () => {
    const brief = synthetic117CanonicalBrief();
    const fixture = tokenizedPlannerFixture(brief);
    const required = fixture.table.requirements.filter((entry) => entry.mandatory);
    const wire = createTokenizedPlanningProviderWireSchema(fixture.table).parse(fixture.transport);
    const normalized = normalizeTokenizedPlanningPackage(wire, { projectId: fixture.input.projectId, projectVersion: fixture.input.projectVersion, approvedBriefChecksum: fixture.input.approvedBriefChecksum }, fixture.input.approvedBrief, fixture.table);
    expect(required).toHaveLength(117);
    expect(new Set(required.map((entry) => entry.category))).toEqual(new Set(syntheticCoverageCategories));
    const metrics = measurePlannerProviderInput(fixture.table, plannerProviderPromptInput(fixture.input, fixture.table));
    expect(metrics.coverageSchemaBytes).toBeGreaterThan(metrics.requirementSemanticsBytes);
    expect(metrics.totalPlannerInputBytes).toBeLessThan(384_000);
    expect(metrics.estimatedInputTokens).toBe(Math.ceil(metrics.totalPlannerInputBytes / 4));
    expect(validatePlanningAdmission(normalized).ready).toBe(true);
  });
  it("gives REQ_001 precise semantic admission reasons without changing the stable outer guard", () => {
    const brief = CanonicalBriefV3Schema.parse({ ...cleanBriefV3, requirements: [{ id: "REQUIREMENT:synthetic-feature", category: "FEATURE", statement: "Provide the synthetic request feature.", sourceRefs: ["fixture:req-001"] }] });
    const table = createPlannerReferenceTable({ projectId: "44444444-4444-4444-8444-444444444444", projectVersion: 1, approvedBriefChecksum: canonicalBriefChecksum(brief), idempotencyKey: "synthetic-req-001", expectedRowVersion: 1, canonicalBrief: brief });
    const valid = { REQ_001: { planningElementIds: ["productScope"], semanticEvidence: "The product scope records the approved synthetic request feature." } };
    expect(() => validatePlannerRequirementCoverage(valid, table, syntheticCoverageCandidate())).not.toThrow();
    const wrongDomainTable = { ...table, requirements: table.requirements.map((entry) => ({ ...entry, coverageConstraints: { ...entry.coverageConstraints, allowedDomains: ["QA"] as const, allowedElementKinds: ["PRODUCT_SCOPE"] as const } })) } as typeof table;
    expect(() => validatePlannerRequirementCoverage(valid, wrongDomainTable, syntheticCoverageCandidate())).toThrowError(expect.objectContaining({ code: "PLANNING_REQUIREMENT_COVERAGE_INVALID", reasonCode: "PLANNING_COVERAGE_DOMAIN_INCOMPATIBLE" }));
    expect(() => validatePlannerRequirementCoverage({ REQ_001: { planningElementIds: ["testStrategy"], semanticEvidence: "The test strategy records the approved synthetic request feature." } }, table, syntheticCoverageCandidate())).toThrowError(expect.objectContaining({ code: "PLANNING_REQUIREMENT_COVERAGE_INVALID", reasonCode: "PLANNING_COVERAGE_KIND_INCOMPATIBLE" }));
    const negativeOnlyCandidate = { ...syntheticCoverageCandidate(), productScope: { inScopeCapabilities: [], outOfScopeCapabilities: ["Synthetic feature"] } };
    expect(() => validatePlannerRequirementCoverage(valid, table, negativeOnlyCandidate)).toThrowError(expect.objectContaining({ code: "PLANNING_REQUIREMENT_COVERAGE_INVALID", reasonCode: "PLANNING_COVERAGE_EXCLUSION_CANNOT_SATISFY" }));
    const collidingIdCandidate = { ...syntheticCoverageCandidate(), forms: { forms: [{ id: "productScope" }] } };
    expect(() => validatePlannerRequirementCoverage(valid, table, collidingIdCandidate)).toThrowError(expect.objectContaining({ code: "PLANNING_REQUIREMENT_COVERAGE_INVALID", reasonCode: "PLANNING_COVERAGE_ELEMENT_ID_COLLISION" }));
    expect(() => validatePlannerRequirementCoverage({ REQ_001: { planningElementIds: ["productScope"], semanticEvidence: "covered" } }, table, syntheticCoverageCandidate())).toThrowError(expect.objectContaining({ code: "PLANNING_REQUIREMENT_COVERAGE_INVALID", reasonCode: "PLANNING_COVERAGE_PLACEHOLDER_EVIDENCE" }));
    try {
      validatePlannerRequirementCoverage({ REQ_001: { planningElementIds: ["traceability"], semanticEvidence: "The feature is covered by the plan." } }, table, syntheticCoverageCandidate());
      throw new Error("expected semantic admission failure");
    } catch (error) {
      expect(error).toMatchObject({ code: "PLANNING_REQUIREMENT_COVERAGE_INVALID", reasonCode: "PLANNING_COVERAGE_GENERIC_CATCH_ALL", fieldPath: "coverageByRequirement.REQ_001" });
    }
  });
  it("rejects cross-domain and cross-kind coverage rather than accepting a shared catch-all", () => {
    const brief = CanonicalBriefV3Schema.parse({ ...cleanBriefV3, requirements: [
      { id: "REQUIREMENT:synthetic-form", category: "FORM", statement: "Provide the synthetic request form.", sourceRefs: ["fixture:form"] },
      { id: "REQUIREMENT:synthetic-database", category: "DATABASE", statement: "Persist synthetic request records.", sourceRefs: ["fixture:database"] },
      { id: "REQUIREMENT:synthetic-technical", category: "TECHNICAL", statement: "Use the approved synthetic runtime boundary.", sourceRefs: ["fixture:technical"] },
    ] });
    const table = createPlannerReferenceTable({ projectId: "55555555-5555-4555-8555-555555555555", projectVersion: 1, approvedBriefChecksum: canonicalBriefChecksum(brief), idempotencyKey: "synthetic-cross-domain", expectedRowVersion: 1, canonicalBrief: brief });
    const candidate = syntheticCoverageCandidate();
    const baselineCoverage = Object.fromEntries(table.requirements.filter((entry) => entry.mandatory).map((entry) => [entry.token, { planningElementIds: [coverageSectionByKind[entry.coverageConstraints.allowedElementKinds[0]!]!], semanticEvidence: `Synthetic evidence for ${entry.token}.` }]));
    const expectReason = (token: string, planningElementId: string, reasonCode: string, candidateTable = table, candidateCoverage = baselineCoverage) => {
      try {
        validatePlannerRequirementCoverage({ ...candidateCoverage, [token]: { planningElementIds: [planningElementId], semanticEvidence: `Synthetic evidence for ${token}.` } }, candidateTable, candidate);
        throw new Error("expected semantic admission failure");
      } catch (error) {
        expect(error).toMatchObject({ code: "PLANNING_REQUIREMENT_COVERAGE_INVALID", reasonCode });
      }
    };
    expectReason("REQ_001", "forms", "PLANNING_COVERAGE_KIND_INCOMPATIBLE");
    expectReason("REQ_002", "dataModel", "PLANNING_COVERAGE_KIND_INCOMPATIBLE");
    expectReason("REQ_003", "content", "PLANNING_COVERAGE_KIND_INCOMPATIBLE");
    const domainOnlyConstraint = { ...table, requirements: table.requirements.map((entry) => entry.token === "REQ_002" ? { ...entry, coverageConstraints: { ...entry.coverageConstraints, allowedDomains: ["DATABASE"] as const, allowedElementKinds: ["FORM"] as const } } : entry) } as unknown as typeof table;
    expectReason("REQ_002", "forms", "PLANNING_COVERAGE_DOMAIN_INCOMPATIBLE", domainOnlyConstraint, baselineCoverage);
  });
  it("requires structured negative evidence for exclusions and prohibitions", () => {
    const brief = CanonicalBriefV3Schema.parse({ ...cleanBriefV3, requirements: [
      { id: "REQUIREMENT:synthetic-exclusion", category: "EXCLUSION", statement: "Exclude the synthetic capability.", sourceRefs: ["fixture:exclusion"] },
      { id: "REQUIREMENT:synthetic-prohibition", category: "PROHIBITED", statement: "Prohibit the synthetic infrastructure.", sourceRefs: ["fixture:prohibition"] },
    ] });
    const table = createPlannerReferenceTable({ projectId: "77777777-7777-4777-8777-777777777777", projectVersion: 1, approvedBriefChecksum: canonicalBriefChecksum(brief), idempotencyKey: "synthetic-negative-evidence", expectedRowVersion: 1, canonicalBrief: brief });
    const entries = table.requirements.filter((entry) => entry.mandatory);
    expect(entries.map((entry) => entry.coverageConstraints.negativeEvidenceRequired)).toEqual([true, true]);
    const validCoverage = { REQ_001: { planningElementIds: ["productScope"], semanticEvidence: "The product scope records the excluded capability outside the approved scope." }, REQ_002: { planningElementIds: ["architecture"], semanticEvidence: "The architecture records the prohibited infrastructure in rejectedInfrastructure." } };
    const validCandidate = { ...syntheticCoverageCandidate(), productScope: { inScopeCapabilities: ["Synthetic approved capability"], outOfScopeCapabilities: ["Synthetic excluded capability"] }, architecture: { rejectedInfrastructure: ["Synthetic prohibited infrastructure"] } };
    expect(() => validatePlannerRequirementCoverage(validCoverage, table, validCandidate)).not.toThrow();
    expect(() => validatePlannerRequirementCoverage(validCoverage, table, syntheticCoverageCandidate())).toThrowError(expect.objectContaining({ code: "PLANNING_REQUIREMENT_COVERAGE_INVALID", reasonCode: "PLANNING_COVERAGE_NEGATIVE_EVIDENCE_MISSING" }));
    const exclusionOnly = { REQ_001: validCoverage.REQ_001 };
    const exclusionTable = { ...table, requirements: [table.requirements.find((entry) => entry.canonicalRequirementId === "REQUIREMENT:synthetic-exclusion")!] } as typeof table;
    expect(() => validatePlannerRequirementCoverage(exclusionOnly, exclusionTable, { ...syntheticCoverageCandidate(), productScope: { inScopeCapabilities: ["Synthetic approved capability"], outOfScopeCapabilities: ["Synthetic excluded capability"] } })).not.toThrow();
    const prohibitionTable = { ...table, requirements: [table.requirements.find((entry) => entry.canonicalRequirementId === "REQUIREMENT:synthetic-prohibition")!] } as typeof table;
    expect(() => validatePlannerRequirementCoverage({ REQ_002: validCoverage.REQ_002 }, prohibitionTable, { ...syntheticCoverageCandidate(), architecture: { rejectedInfrastructure: ["Synthetic prohibited infrastructure"] } })).not.toThrow();
  });
  it("enforces exact host page and route binding constraints", () => {
    const brief = CanonicalBriefV3Schema.parse({ ...cleanBriefV3, requirements: [{ id: "REQUIREMENT:synthetic-route-bound", category: "FEATURE", statement: "Bind the synthetic feature to its approved route.", sourceRefs: ["fixture:route-bound"] }], pages: [...cleanBriefV3.pages, { id: "PAGE:synthetic-secondary", slug: "secondary", purpose: "Provide the synthetic secondary page.", sourceRefs: ["fixture:secondary-page"] }] });
    const table = createPlannerReferenceTable({ projectId: "66666666-6666-4666-8666-666666666666", projectVersion: 1, approvedBriefChecksum: canonicalBriefChecksum(brief), idempotencyKey: "synthetic-route-binding", expectedRowVersion: 1, canonicalBrief: brief });
    const pageRestrictedTable = { ...table, requirements: table.requirements.map((entry) => ({ ...entry, coverageConstraints: { ...entry.coverageConstraints, requiredPageTokens: [], allowedPageTokens: ["PAGE_002"] } })) } as typeof table;
    expect(() => validatePlannerRequirementCoverage({ REQ_001: { planningElementIds: ["PAGE_001"], semanticEvidence: "The approved feature page is the bounded Planning target." } }, pageRestrictedTable, syntheticCoverageCandidate())).toThrowError(expect.objectContaining({ code: "PLANNING_REQUIREMENT_COVERAGE_INVALID", reasonCode: "PLANNING_COVERAGE_PAGE_BINDING_MISMATCH" }));
    const routeRestrictedTable = { ...table, requirements: table.requirements.map((entry) => ({ ...entry, coverageConstraints: { ...entry.coverageConstraints, requiredRouteTokens: [], allowedRouteTokens: ["ROUTE_002"] } })) } as typeof table;
    expect(() => validatePlannerRequirementCoverage({ REQ_001: { planningElementIds: ["ROUTE_001"], semanticEvidence: "The approved feature route is the bounded Planning target." } }, routeRestrictedTable, syntheticCoverageCandidate())).toThrowError(expect.objectContaining({ code: "PLANNING_REQUIREMENT_COVERAGE_INVALID", reasonCode: "PLANNING_COVERAGE_ROUTE_BINDING_MISMATCH" }));
  });
  it("rejects unknown, mutated, missing, empty, duplicate, and invalid Planner coverage without repair", async () => {
    const fixture = tokenizedPlannerFixture();
    const planner = (transport: Record<string, unknown>) => new OpenAiPlannerProvider(new OpenAiStructuredClient(config, { executor: async <T>() => ({ value: transport as T, requestId: "req_token_rejection" }) })).plan(fixture.input);
    const coverageKeys = () => Object.keys((fixture.transport.coverageByRequirement ?? {}) as Record<string, unknown>);
    const unknown = JSON.parse(JSON.stringify(fixture.transport)) as Record<string, unknown>;
    const unknownCoverage = unknown.coverageByRequirement as Record<string, unknown>;
    unknownCoverage.REQ_999 = unknownCoverage[coverageKeys()[0]!]!;
    await expect(planner(unknown)).rejects.toMatchObject({ code: "PLANNING_TRACEABILITY_UNKNOWN_REFERENCE" } satisfies Partial<PlannerReferenceBindingError>);
    const mutated = JSON.parse(JSON.stringify(fixture.transport)) as Record<string, unknown>;
    const mutatedCoverage = mutated.coverageByRequirement as Record<string, unknown>;
    mutatedCoverage.REQ_0011 = mutatedCoverage[coverageKeys()[0]!]!;
    delete mutatedCoverage[coverageKeys()[0]!];
    await expect(planner(mutated)).rejects.toMatchObject({ code: "PLANNING_TRACEABILITY_UNKNOWN_REFERENCE" } satisfies Partial<PlannerReferenceBindingError>);
    const missing = JSON.parse(JSON.stringify(fixture.transport)) as Record<string, unknown>;
    const missingCoverage = missing.coverageByRequirement as Record<string, unknown>;
    delete missingCoverage[coverageKeys().at(-1)!];
    await expect(planner(missing)).rejects.toMatchObject({ code: "PLANNING_REQUIREMENT_COVERAGE_MISSING" } satisfies Partial<PlannerReferenceBindingError>);
    const empty = JSON.parse(JSON.stringify(fixture.transport)) as Record<string, unknown>;
    const emptyCoverage = empty.coverageByRequirement as Record<string, Record<string, unknown>>;
    emptyCoverage[coverageKeys()[0]!]!.planningElementIds = [];
    await expect(planner(empty)).rejects.toMatchObject({ code: "PLANNING_REQUIREMENT_COVERAGE_INVALID" } satisfies Partial<PlannerReferenceBindingError>);
    const duplicate = JSON.parse(JSON.stringify(fixture.transport)) as Record<string, unknown>;
    duplicate.coverageByRequirement = [
      { requirementToken: coverageKeys()[0], planningElementIds: ["traceability"], semanticEvidence: "duplicate" },
      { requirementToken: coverageKeys()[0], planningElementIds: ["traceability"], semanticEvidence: "duplicate" },
    ];
    expect(createTokenizedPlanningProviderWireSchema(fixture.table).safeParse(duplicate).success).toBe(false);
    await expect(planner(duplicate)).rejects.toMatchObject({ code: "PLANNING_REQUIREMENT_COVERAGE_INVALID" } satisfies Partial<PlannerReferenceBindingError>);
    const illegalSlot = JSON.parse(JSON.stringify(fixture.transport)) as Record<string, unknown>;
    const illegalCoverage = illegalSlot.coverageByRequirement as Record<string, unknown>;
    illegalCoverage.REQ_999 = illegalCoverage[coverageKeys()[0]!]!;
    expect(createTokenizedPlanningProviderWireSchema(fixture.table).safeParse(illegalSlot).success).toBe(false);
    await expect(planner(illegalSlot)).rejects.toMatchObject({ code: "PLANNING_TRACEABILITY_UNKNOWN_REFERENCE" } satisfies Partial<PlannerReferenceBindingError>);
    const invalidElement = JSON.parse(JSON.stringify(fixture.transport)) as Record<string, unknown>;
    const invalidElementCoverage = invalidElement.coverageByRequirement as Record<string, Record<string, unknown>>;
    for (const token of coverageKeys()) invalidElementCoverage[token]!.planningElementIds = ["not-a-planning-element"];
    await expect(planner(invalidElement)).rejects.toMatchObject({ code: "PLANNING_REQUIREMENT_COVERAGE_INVALID", reasonCode: "PLANNING_COVERAGE_ELEMENT_NOT_FOUND" } satisfies Partial<PlannerReferenceBindingError>);
    const collidingElement = JSON.parse(JSON.stringify(fixture.transport)) as Record<string, unknown>;
    const collidingForms = collidingElement.forms as Record<string, unknown>;
    ((collidingForms.forms as Array<Record<string, unknown>>)[0]!).id = "productScope";
    expect(createTokenizedPlanningProviderWireSchema(fixture.table).safeParse(collidingElement).success).toBe(true);
    await expect(planner(collidingElement)).rejects.toMatchObject({ code: "PLANNING_REQUIREMENT_COVERAGE_INVALID", reasonCode: "PLANNING_COVERAGE_ELEMENT_ID_COLLISION" } satisfies Partial<PlannerReferenceBindingError>);
    const genericCatchall = JSON.parse(JSON.stringify(fixture.transport)) as Record<string, unknown>;
    const genericCoverage = genericCatchall.coverageByRequirement as Record<string, Record<string, unknown>>;
    for (const token of coverageKeys()) genericCoverage[token]!.planningElementIds = ["traceability"];
    await expect(planner(genericCatchall)).rejects.toMatchObject({ code: "PLANNING_REQUIREMENT_COVERAGE_INVALID", reasonCode: "PLANNING_COVERAGE_GENERIC_CATCH_ALL" } satisfies Partial<PlannerReferenceBindingError>);
    const placeholderEvidence = JSON.parse(JSON.stringify(fixture.transport)) as Record<string, unknown>;
    const placeholderCoverage = placeholderEvidence.coverageByRequirement as Record<string, Record<string, unknown>>;
    placeholderCoverage[coverageKeys()[0]!]!.semanticEvidence = "covered";
    await expect(planner(placeholderEvidence)).rejects.toMatchObject({ code: "PLANNING_REQUIREMENT_COVERAGE_INVALID", reasonCode: "PLANNING_COVERAGE_PLACEHOLDER_EVIDENCE" } satisfies Partial<PlannerReferenceBindingError>);
    const unknownRoute = JSON.parse(JSON.stringify(fixture.transport)) as Record<string, unknown>;
    const routes = (unknownRoute.sitemap as Record<string, unknown>).routes as Array<Record<string, unknown>>;
    routes[0]!.routeToken = "ROUTE_999";
    await expect(planner(unknownRoute)).rejects.toMatchObject({ code: "PLANNING_ROUTE_POLICY_MISMATCH" } satisfies Partial<PlannerReferenceBindingError>);
    const unknownPage = JSON.parse(JSON.stringify(fixture.transport)) as Record<string, unknown>;
    const pages = (unknownPage.pages as Record<string, unknown>).pages as Array<Record<string, unknown>>;
    pages[0]!.pageToken = "PAGE_999";
    await expect(planner(unknownPage)).rejects.toMatchObject({ code: "PLANNING_ROUTE_POLICY_MISMATCH" } satisfies Partial<PlannerReferenceBindingError>);
    const canonicalLike = JSON.parse(JSON.stringify(fixture.transport)) as Record<string, unknown>;
    const profile = canonicalLike.profile as Record<string, unknown>;
    profile.requirementReferences = ["REQUIREMENT:v3-2298ba13cee1b3b171dc97890232a392cffc8f31001e4b517157231e4b5171572318ff875b99"];
    await expect(planner(canonicalLike)).rejects.toMatchObject({ code: "PLANNING_TRACEABILITY_UNKNOWN_REFERENCE" } satisfies Partial<PlannerReferenceBindingError>);
  });
  it("uses a strict Design transport schema without weakening the canonical direction set", () => {
    expect(() => zodResponseFormat(DesignDirectionStructuredOutputSchema, "design-direction-set")).not.toThrow();
  });
  it("uses a strict Implementation transport schema and normalizes nullable optional fields", async () => {
    expect(() => zodResponseFormat(ImplementationChangeProposalStructuredOutputSchema, "implementation-change-proposal")).not.toThrow();
    const client = new OpenAiStructuredClient(config, { executor: async <T>() => ({ value: { proposalId: "11111111-1111-4111-8111-111111111111", taskId: "99999999-9999-4999-8999-999999999999", taskAttempt: 1, summary: "proposal", operations: [{ type: "create-file", relativePath: "src/app/page.tsx", expectedPriorChecksum: null, expectedResultChecksum: "a".repeat(64), encoding: "utf-8", reason: "approved", requirementReferences: ["requirement"], planningReferences: ["planning"], selectedDesignReferences: [], content: "export default function Page() {}" }], expectedChangedFiles: ["src/app/page.tsx"], expectedCreatedFiles: ["src/app/page.tsx"], expectedDeletedFiles: [], validationPlan: ["build"], requirementReferences: ["requirement"], planningReferences: ["planning"], selectedDesignReferences: [], providerMetadata: { provider: "openai", inputTokens: null, outputTokens: null }, generatedAt: "2026-08-07T00:00:00.000Z" } as T, requestId: "req_implementation" }) });
    const result = await new OpenAiImplementationProvider(client).proposeTaskChanges({ task: { id: "33333333-3333-4333-8333-333333333333", projectId: "22222222-2222-4222-8222-222222222222", projectVersion: 7, attempt: 0 }, contextChecksum: "b".repeat(64) } as never);
    expect(result.projectId).toBe("22222222-2222-4222-8222-222222222222");
    expect(result.projectVersion).toBe(7);
    expect(result.taskId).toBe("33333333-3333-4333-8333-333333333333");
    expect(result.taskAttempt).toBe(0);
    expect(result.operations[0]).not.toHaveProperty("expectedPriorChecksum");
    expect(result.operations[0]?.expectedResultChecksum).toBe(createHash("sha256").update("export default function Page() {}", "utf8").digest("hex"));
    expect(result.providerMetadata).toEqual({ provider: "openai" });
  });
  it("accepts a text patch when the host does not advertise AST patch capability", async () => {
    const client = new OpenAiStructuredClient(config, { executor: async <T>() => ({ value: { proposalId: "11111111-1111-4111-8111-111111111111", summary: "patch", operations: [{ type: "patch-text", relativePath: "src/app/page.tsx", expectedPriorChecksum: null, expectedResultChecksum: "a".repeat(64), encoding: "utf-8", reason: "approved", requirementReferences: ["requirement"], planningReferences: ["planning"], selectedDesignReferences: [], oldText: "old", newText: "new" }], expectedChangedFiles: ["src/app/page.tsx"], expectedCreatedFiles: [], expectedDeletedFiles: [], validationPlan: ["build"], requirementReferences: ["requirement"], planningReferences: ["planning"], selectedDesignReferences: [], providerMetadata: { provider: "openai", inputTokens: null, outputTokens: null }, generatedAt: "2026-08-07T00:00:00.000Z" } as T, requestId: "req_implementation_patch" }) });
    const result = await new OpenAiImplementationProvider(client).proposeTaskChanges({ task: { id: "33333333-3333-4333-8333-333333333333", projectId: "22222222-2222-4222-8222-222222222222", projectVersion: 7, attempt: 0 }, contextChecksum: "b".repeat(64), files: [{ relativePath: "src/app/page.tsx", sha256: createHash("sha256").update("old", "utf8").digest("hex"), content: "old" }] } as never);
    expect(result.operations[0]?.type).toBe("patch-text");
    expect(result.operations[0]).not.toHaveProperty("expectedPriorChecksum");
    expect(result.operations[0]?.expectedResultChecksum).toBe(createHash("sha256").update("new", "utf8").digest("hex"));
  });
  it("accepts a text patch when the host advertises AST patch capability", async () => {
    const client = new OpenAiStructuredClient(config, { executor: async <T>() => ({ value: { proposalId: "11111111-1111-4111-8111-111111111111", summary: "patch", operations: [{ type: "patch-text", relativePath: "src/app/page.tsx", expectedPriorChecksum: null, expectedResultChecksum: "a".repeat(64), encoding: "utf-8", reason: "approved", requirementReferences: ["requirement"], planningReferences: ["planning"], selectedDesignReferences: [], oldText: "old", newText: "new" }], expectedChangedFiles: ["src/app/page.tsx"], expectedCreatedFiles: [], expectedDeletedFiles: [], validationPlan: ["build"], requirementReferences: ["requirement"], planningReferences: ["planning"], selectedDesignReferences: [], providerMetadata: { provider: "openai", inputTokens: null, outputTokens: null }, generatedAt: "2026-08-07T00:00:00.000Z" } as T, requestId: "req_implementation_ast_patch" }) });
    const result = await new OpenAiImplementationProvider(client).proposeTaskChanges({ task: { id: "33333333-3333-4333-8333-333333333333", projectId: "22222222-2222-4222-8222-222222222222", projectVersion: 7, attempt: 0 }, allowedEditStrategies: ["AST_PATCH_EXISTING"], contextChecksum: "b".repeat(64), files: [{ relativePath: "src/app/page.tsx", sha256: createHash("sha256").update("old", "utf8").digest("hex"), content: "old" }] } as never);
    expect(result.operations[0]?.type).toBe("patch-text");
    expect(result.operations[0]?.expectedResultChecksum).toBe(createHash("sha256").update("new", "utf8").digest("hex"));
  });
  it("binds Implementation Phase 7C proposal fields to the host task contract", async () => {
    const client = new OpenAiStructuredClient(config, { executor: async <T>() => ({ value: { proposalId: "11111111-1111-4111-8111-111111111111", taskId: "33333333-3333-4333-8333-333333333333", taskAttempt: 1, summary: "proposal", operations: [{ type: "create-file", relativePath: "src/app/page.tsx", expectedPriorChecksum: null, expectedResultChecksum: "a".repeat(64), encoding: "utf-8", reason: "approved", requirementReferences: ["requirement"], planningReferences: ["planning"], selectedDesignReferences: [], content: "export default function Page() {}" }], expectedChangedFiles: ["src/app/page.tsx"], expectedCreatedFiles: ["src/app/page.tsx"], expectedDeletedFiles: [], validationPlan: ["build"], requirementReferences: ["requirement"], planningReferences: ["planning"], selectedDesignReferences: [], phase7c: { taskContractId: "44444444-4444-4444-8444-444444444444", taskContractChecksum: "e".repeat(64), dataContractIds: [], databaseDecisionId: "55555555-5555-4555-8555-555555555555", databaseDecisionChecksum: "f".repeat(64), dependencyProposalId: null }, providerMetadata: { provider: "openai", inputTokens: null, outputTokens: null }, generatedAt: "2026-08-07T00:00:00.000Z" } as T, requestId: "req_implementation_binding" }) });
    const result = await new OpenAiImplementationProvider(client).proposeTaskChanges({ task: { id: "33333333-3333-4333-8333-333333333333", projectId: "22222222-2222-4222-8222-222222222222", projectVersion: 7, attempt: 0, phase7c: { taskContractId: "66666666-6666-4666-8666-666666666666", taskContractChecksum: "b".repeat(64), dataContractIds: ["77777777-7777-4777-8777-777777777777"], databaseDecisionId: "88888888-8888-4888-8888-888888888888", databaseDecisionChecksum: "c".repeat(64), dependencyProposalId: "99999999-9999-4999-8999-999999999999" } }, contextChecksum: "b".repeat(64) } as never);
    expect(result.phase7c).toEqual({ taskContractId: "66666666-6666-4666-8666-666666666666", taskContractChecksum: "b".repeat(64), dataContractIds: ["77777777-7777-4777-8777-777777777777"], databaseDecisionId: "88888888-8888-4888-8888-888888888888", databaseDecisionChecksum: "c".repeat(64), dependencyProposalId: "99999999-9999-4999-8999-999999999999" });
  });
  it("keeps host identity out of every registered Planner, Design, and Implementation response DTO", () => {
    const contracts = [
      [PlanningPackageStructuredOutputSchema, "planning-package"],
      [DesignDirectionStructuredOutputSchema, "design-direction-set"],
      [ImplementationChangeProposalStructuredOutputSchema, "implementation-change-proposal"],
    ] as const;
    for (const [contract, name] of contracts) expect(hostOwnedPaths((zodResponseFormat(contract, name) as { json_schema: { schema: unknown } }).json_schema.schema)).toEqual([]);
  });
  it("puts selected approved procedural guidance in the actual Lead provider request", async () => {
    let sent: { system: string; user: string; idempotencyKey?: string } | undefined;
    const client = new OpenAiStructuredClient(config, {
      executor: async <T>(request: StructuredRequest<T>) => {
        sent = request;
        return { value: { directlyStatedFacts: [], userPreferences: [], inferredRecommendations: [], unresolvedQuestions: [], contradictions: [], unsupportedAssumptions: [], confirmationRequired: [], provider: { name: "synthetic", model: null, used: false, inputTokens: null, outputTokens: null } } as T, requestId: "req_lead" };
      },
    });
    const selected = {
      skillId: "lead-requirements-completeness",
      approvedChecksum: "a".repeat(64),
      coverageKeys: ["requirements-completeness"],
      skillMarkdown: "SELECTED LEAD PROCEDURE",
      references: [],
    };
    await new OpenAiLeadProvider(client).analyzePrompt(
      { projectId: "11111111-1111-4111-8111-111111111111", projectVersion: 1, originalPrompt: "Synthetic Lead request", suppliedFiles: [], availableAssets: [], knownUserAnswers: {}, currentWorkflowState: "DRAFT", idempotencyKey: "lead-test", operatorLanguage: "en", siteLanguage: "de" },
      [selected],
      "b".repeat(64),
    );
    expect(sent?.system).toContain("SELECTED LEAD PROCEDURE");
    expect(sent?.system).not.toContain("ambiguity-detector");
    expect(sent?.idempotencyKey).toContain("b".repeat(64));
  });
  it("binds host-owned Lead analysis identity after strict provider transport validation", async () => {
    const transport = { directlyStatedFacts: [], userPreferences: [], inferredRecommendations: [], unresolvedQuestions: [], contradictions: [], unsupportedAssumptions: [], confirmationRequired: [], provider: { name: "synthetic", model: null, used: true, inputTokens: null, outputTokens: null } };
    expect(LeadAnalysisProviderOutputSchema.safeParse({ ...transport, projectId: "11111111-1111-4111-8111-111111111111" }).success).toBe(false);
    expect(LeadAnalysisProviderOutputSchema.safeParse({ ...transport, unknownProviderField: "ignored" }).success).toBe(false);
    const client = new OpenAiStructuredClient(config, { executor: async <T>() => ({ value: transport as T, requestId: "req_host_bound_analysis" }) });
    const input = { projectId: "11111111-1111-4111-8111-111111111111", projectVersion: 1, originalPrompt: "  Synthetic\r\nLead request  ", suppliedFiles: [], availableAssets: [], knownUserAnswers: {}, currentWorkflowState: "DRAFT" as const, idempotencyKey: "lead-host-bound", operatorLanguage: "de" as const, siteLanguage: "ru" as const };
    const result = await new OpenAiLeadProvider(client).analyzePrompt(input);
    expect(result.projectId).toBe(input.projectId);
    expect(result.projectVersion).toBe(input.projectVersion);
    expect(result.operatorLanguage).toBe("de");
    expect(result.siteLanguage).toBe("ru");
    expect(result.originalPromptChecksum).toBe(checksumPersistedDocument("Synthetic\nLead request"));
  });
  it("binds host-owned clarification plan identity and rejects host fields in transport", async () => {
    const analysisInput = { projectId: "22222222-2222-4222-8222-222222222222", projectVersion: 3, originalPrompt: "Purpose: synthetic", suppliedFiles: [], availableAssets: [], knownUserAnswers: {}, currentWorkflowState: "DRAFT" as const, idempotencyKey: "plan-host-bound", operatorLanguage: "en" as const, siteLanguage: "de" as const };
    const analysis = analyzePromptDeterministically(analysisInput);
    const transport = { questions: [{ id: "33333333-3333-4333-8333-333333333333", requirementKey: "purpose", category: "business", question: "What is the purpose?", reason: "The brief needs it.", blocking: true, required: true, fingerprint: "v1:business:purpose" }], generatedAt: "2026-08-14T00:00:00.000Z" };
    expect(ClarificationPlanProviderOutputSchema.safeParse({ ...transport, projectId: analysis.projectId }).success).toBe(false);
    const client = new OpenAiStructuredClient(config, { executor: async <T>() => ({ value: transport as T, requestId: "req_host_bound_plan" }) });
    const result = await new OpenAiLeadProvider(client).proposeClarifications({ analysis, operatorLanguage: "ru", siteLanguage: "de", availableAssets: [] });
    expect(result.projectId).toBe(analysis.projectId);
    expect(result.projectVersion).toBe(analysis.projectVersion);
    expect(result.operatorLanguage).toBe("ru");
  });
  it("passes the configured model unchanged through the official structured API", async () => {
    let sent: Record<string, unknown> | undefined;
    const client = new OpenAiStructuredClient(config, { client: { chat: { completions: { parse: async (value: Record<string, unknown>) => { sent = value; return { id: "req_model", choices: [{ message: { parsed: { ok: true, summary: "bounded" } }, finish_reason: "stop" }], usage: {} }; } } } } as never });
    await expect(client.request(request)).resolves.toMatchObject({ value: { ok: true, summary: "bounded" } });
    expect(sent).toMatchObject({ model: "test-model", response_format: expect.anything() });
    expect(sent).not.toHaveProperty("temperature");
  });

  it("uses create with the exact strict zodResponseFormat and captures usage before manual parsing", async () => {
    let sent: Record<string, unknown> | undefined;
    const usage = vi.fn();
    const client = new OpenAiStructuredClient(config, { usageSink: usage, client: { chat: { completions: { create: async (value: Record<string, unknown>) => { sent = value; return { id: "req_manual_valid", choices: [{ message: { content: JSON.stringify({ ok: true, summary: "bounded" }) }, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10, prompt_tokens_details: { cached_tokens: 1 } } }; } } } } as never });
    const result = await client.request({ ...request, parseStrategy: "manual", retryPolicy: { maxRetries: 0, corrections: 0 } });
    expect(result.value).toEqual({ ok: true, summary: "bounded" });
    expect(sent).toMatchObject({ model: "test-model", response_format: { type: "json_schema", json_schema: { name: "test-output", strict: true } } });
    expect(JSON.stringify(sent)).not.toContain("$parseRaw");
    expect((sent?.response_format as { json_schema: { schema: unknown } }).json_schema.schema).toEqual((zodResponseFormat(schema, "test-output") as unknown as { json_schema: { schema: unknown } }).json_schema.schema);
    expect(usage).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 7, cachedInputTokens: 1, outputTokens: 3, totalTokens: 10, actualUsageCaptured: true }));
    expect(result.diagnostic).toMatchObject({ responseReceived: true, jsonParseSucceeded: true, outputComplete: true, rawContentBytes: expect.any(Number), rawContentChecksum: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });

  it("records response usage and bounded wire-schema diagnostics when manual parsing fails without retry", async () => {
    let calls = 0;
    const usage = vi.fn();
    const client = new OpenAiStructuredClient({ ...config, maxRetries: 3 }, { usageSink: usage, client: { chat: { completions: { create: async () => { calls += 1; return { id: "req_manual_invalid", choices: [{ message: { content: JSON.stringify({ ok: "SECRET_PROVIDER_VALUE", summary: "bounded" }) }, finish_reason: "stop" }], usage: { prompt_tokens: 13, completion_tokens: 5, total_tokens: 18 } }; } } } } as never });
    let failure: AiProviderError | undefined;
    try {
      await client.request({ ...request, parseStrategy: "manual", idempotencyKey: "manual-wire-invalid", retryPolicy: { maxRetries: 0, corrections: 0 } });
    } catch (error) {
      failure = error as AiProviderError;
    }
    expect(failure?.code).toBe("AI_OUTPUT_DOMAIN_INVALID");
    expect(calls).toBe(1);
    expect(usage).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 13, outputTokens: 5, totalTokens: 18, actualUsageCaptured: true }));
    expect(failure?.diagnostic).toMatchObject({ stage: "domain_validation", responseReceived: true, apiResponseReceived: true, structuredParsingReached: true, inputTokens: 13, outputTokens: 5, totalTokens: 18, jsonParseSucceeded: true, zodIssueCount: expect.any(Number), zodIssuesBounded: expect.any(Array), completeZodIssuesChecksum: expect.stringMatching(/^[a-f0-9]{64}$/), rawContentBytes: expect.any(Number), rawContentChecksum: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(failure?.failureDiagnostic).toMatchObject({ category: "STRUCTURED_OUTPUT", stage: "PROVIDER_RESPONSE", responseReceived: true, structuredParsingReached: true, inputTokens: 13, outputTokens: 5, totalTokens: 18, jsonParseSucceeded: true, zodIssueCount: expect.any(Number), rawContentChecksum: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(JSON.stringify(failure)).not.toContain("SECRET_PROVIDER_VALUE");
  });

  it("separates invalid JSON from wire-schema validation in the manual parser", () => {
    const response = { requestId: "req_manual_json", inputTokens: 2, outputTokens: 1, diagnostic: { stage: "api_response" as const, requestAttempted: true, apiResponseReceived: true, responseReceived: true, schemaName: "test-output" } };
    expect(() => parseProviderWireContent({ content: "{invalid", schema, response })).toThrowError(AiProviderError);
    try {
      parseProviderWireContent({ content: "{invalid", schema, response });
    } catch (error) {
      expect(error).toMatchObject({ code: "AI_STRUCTURED_PARSE_FAILED", diagnostic: { stage: "structured_parse", responseReceived: true, jsonParseSucceeded: false, rawContentBytes: 8, rawContentChecksum: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    }
  });

  it("classifies local strict-schema construction separately from API failures", async () => {
    const events: Array<Record<string, unknown>> = [];
    const parse = vi.fn();
    const client = new OpenAiStructuredClient(config, { eventSink: (event) => events.push(event), client: { chat: { completions: { parse } } } as never });
    const invalidSchema = z.object({ optional: z.string().optional() }).strict();
    await expect(client.request({ ...request, schema: invalidSchema, schemaName: "invalid-optional-schema" })).rejects.toMatchObject({ code: "AI_REQUEST_SCHEMA_INVALID", diagnostic: { stage: "request_construction", outputStage: "REQUEST_SCHEMA_CONSTRUCTION_FAILED", requestAttempted: false, apiResponseReceived: false, schemaName: "invalid-optional-schema", issueCode: "OPTIONAL_PROPERTY_UNSUPPORTED", fieldPath: "optional", schemaNodeKind: "ZodOptional" } });
    expect(parse).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: "request.failed", code: "AI_REQUEST_SCHEMA_INVALID", diagnostic: { requestAttempted: false, issueCode: "OPTIONAL_PROPERTY_UNSUPPORTED", fieldPath: "optional" } });
  });

  it("classifies other local response-schema construction failures without exposing SDK text", () => {
    const cases = [
      ["transform", z.object({ transformed: z.string().transform((value) => value) }).strict(), "TRANSFORM_UNSUPPORTED", undefined],
      ["record", z.object({ values: z.record(z.string(), z.string()) }).strict(), "INVALID_ADDITIONAL_PROPERTIES", "values"],
      ["root-union", z.union([z.object({ a: z.string() }).strict(), z.object({ b: z.string() }).strict()]), "UNION_UNSUPPORTED", undefined],
    ] as const;
    for (const [schemaName, invalidSchema, issueCode, fieldPath] of cases) {
      try {
        buildProductionResponseFormat(invalidSchema as never, `invalid-${schemaName}`);
        throw new Error(`expected ${schemaName} to fail`);
      } catch (error) {
        expect(error).toMatchObject({ code: "AI_REQUEST_SCHEMA_INVALID", diagnostic: { outputStage: "REQUEST_SCHEMA_CONSTRUCTION_FAILED", requestAttempted: false, schemaName: `invalid-${schemaName}`, issueCode, ...(fieldPath ? { fieldPath } : {}) } });
        expect(JSON.stringify(error)).not.toContain("platform.openai.com");
      }
    }
  });

  it("keeps safe API authentication metadata without raw error contents", async () => {
    const events: Array<Record<string, unknown>> = [];
    const client = new OpenAiStructuredClient(config, { eventSink: (event) => events.push(event), executor: async () => { throw Object.assign(new Error("secret-api-key-value"), { status: 401, requestID: "req_auth", error: { type: "authentication_error", code: "invalid_api_key", param: null } }); } });
    await expect(client.request({ ...request, idempotencyKey: "auth-diagnostic" })).rejects.toMatchObject({ code: "AI_AUTHENTICATION_FAILED", diagnostic: { stage: "api_request", requestAttempted: true, apiResponseReceived: true, httpStatus: 401, requestId: "req_auth", openaiErrorType: "authentication_error", openaiErrorCode: "invalid_api_key" } });
    expect(JSON.stringify(events)).not.toContain("secret-api-key-value");
  });

  it("distinguishes model access rejection, no parsed output, refusal, truncation, and domain invalidity", async () => {
    const modelClient = new OpenAiStructuredClient(config, { executor: async () => { throw Object.assign(new Error("model"), { status: 404, requestID: "req_model_access", error: { type: "invalid_request_error", code: "model_not_found", param: "model" } }); } });
    await expect(modelClient.request({ ...request, idempotencyKey: "model-access-diagnostic" })).rejects.toMatchObject({ code: "AI_MODEL_ACCESS_FAILED", diagnostic: { httpStatus: 404, openaiErrorCode: "model_not_found", openaiErrorParam: "model" } });
    const noParsed = new OpenAiStructuredClient(config, { client: { chat: { completions: { parse: async () => ({ id: "req_no_parsed", choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: {} }) } } } as never });
    await expect(noParsed.request({ ...request, idempotencyKey: "no-parsed-diagnostic" })).rejects.toMatchObject({ code: "AI_OUTPUT_NO_PARSED_OUTPUT", diagnostic: { apiResponseReceived: true, choicesCount: 1, finishReason: "stop", refusalPresent: false, parsedPresent: false, contentPresent: true } });
    const refused = new OpenAiStructuredClient(config, { client: { chat: { completions: { parse: async () => ({ id: "req_refusal", choices: [{ message: { refusal: "refused" }, finish_reason: "stop" }], usage: {} }) } } } as never });
    await expect(refused.request({ ...request, idempotencyKey: "refusal-diagnostic" })).rejects.toMatchObject({ code: "AI_OUTPUT_REFUSED", diagnostic: { refusalPresent: true } });
    const truncated = new OpenAiStructuredClient(config, { client: { chat: { completions: { parse: async () => ({ id: "req_truncated", choices: [{ message: { content: "{}" }, finish_reason: "length" }], usage: {} }) } } } as never });
    await expect(truncated.request({ ...request, idempotencyKey: "truncated-diagnostic" })).rejects.toMatchObject({ code: "AI_OUTPUT_TRUNCATED", diagnostic: { finishReason: "length" } });
    const invalidDomain = new OpenAiStructuredClient(config, { client: { chat: { completions: { parse: async () => ({ id: "req_domain", choices: [{ message: { parsed: { ok: "invalid" } }, finish_reason: "stop" }], usage: {} }) } } } as never });
    await expect(invalidDomain.request({ ...request, idempotencyKey: "domain-diagnostic" })).rejects.toMatchObject({ code: "AI_OUTPUT_DOMAIN_INVALID", diagnostic: { stage: "domain_validation", domainValidationIssuePaths: expect.arrayContaining(["ok"]) } });
  });

  it("maps unsupported request parameters safely without retrying", async () => {
    let calls = 0;
    const client = new OpenAiStructuredClient(config, { executor: async () => { calls++; throw Object.assign(new Error("provider detail"), { status: 400, error: { code: "unsupported_value", param: "temperature" } }); } });
    await expect(client.request({ ...request, idempotencyKey: "unsupported-parameter" })).rejects.toMatchObject({ code: "AI_REQUEST_PARAMETER_UNSUPPORTED" });
    expect(calls).toBe(1);
  });
  it("distinguishes local schema construction failure from a network failure", async () => {
    const localParse = vi.fn();
    const localSchema = z.object({ values: z.record(z.string(), z.string()) }).strict();
    const local = new OpenAiStructuredClient(config, { client: { chat: { completions: { parse: localParse } } } as never });
    await expect(local.request({ ...request, schema: localSchema, schemaName: "local-schema", idempotencyKey: "local-schema" } as never)).rejects.toMatchObject({ code: "AI_REQUEST_SCHEMA_INVALID", diagnostic: { stage: "request_construction", requestAttempted: false, apiResponseReceived: false }, failureDiagnostic: { category: "REQUEST_CONSTRUCTION", stage: "REQUEST_CONSTRUCTION", requestAttempted: false, responseReceived: false, errorCode: "AI_REQUEST_SCHEMA_INVALID" } });
    expect(localParse).not.toHaveBeenCalled();

    const networkParse = vi.fn(async () => { throw Object.assign(new Error("secret network detail"), { code: "ECONNRESET" }); });
    const network = new OpenAiStructuredClient(config, { client: { chat: { completions: { parse: networkParse } } } as never });
    await expect(network.request({ ...request, idempotencyKey: "network-failure", retryPolicy: { maxRetries: 0, corrections: 0 } })).rejects.toMatchObject({ code: "AI_NETWORK_ERROR", diagnostic: { stage: "api_request", requestAttempted: true, apiResponseReceived: false }, failureDiagnostic: { category: "NETWORK", stage: "REQUEST_TRANSPORT", requestAttempted: true, responseReceived: false, errorCode: "AI_NETWORK_ERROR" } });
    expect(networkParse).toHaveBeenCalledTimes(1);
  });

  it("accepts only injected, schema-valid structured output and records safe usage", async () => { const usage = vi.fn(); const client = new OpenAiStructuredClient(config, { executor: async <T>() => ({ value: { ok: true, summary: "bounded" } as T, requestId: "req_1", inputTokens: 4, cachedInputTokens: 1, outputTokens: 3 }), usageSink: usage }); const result = await client.request(request); expect(result.value).toEqual({ ok: true, summary: "bounded" }); expect(usage).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 4, cachedInputTokens: 1, outputTokens: 3, promptVersion: "test.v1" })); });
  it("propagates the staged operation identity through every provider event", async () => {
    const events: SafeProviderEvent[] = [];
    const invocation = { operationId: "staged-operation", correlationId: "44444444-4444-4444-8444-444444444444", stage: "decomposition" as const };
    const client = new OpenAiStructuredClient(config, { eventSink: (event) => events.push(event), executor: validExecutor });
    await client.request({ ...request, idempotencyKey: "staged-operation-request", retryPolicy: { maxRetries: 0, corrections: 0 }, providerInvocation: invocation });
    expect(events).toHaveLength(2);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "request.started", operationId: invocation.operationId, correlationId: invocation.correlationId, operationStage: "decomposition" }),
      expect.objectContaining({ type: "request.completed", operationId: invocation.operationId, correlationId: invocation.correlationId, operationStage: "decomposition" }),
    ]));
  });
  it("preserves the provider response boundary when staged normalization rejects executor output", async () => {
    const fixture = tokenizedPlannerFixture();
    const client = new OpenAiStructuredClient(config, {
      executor: async <T>() => ({
        value: { schemaVersion: 1, providerContractVersion: PLANNER_DECOMPOSITION_CONTRACT_VERSION, complete: true, elements: [{ kind: "PAGE" }] } as T,
        requestId: "req_staged_normalization",
        diagnostic: { stage: "api_response", requestAttempted: true, apiResponseReceived: true, responseReceived: true, outputComplete: true, schemaName: PLANNER_DECOMPOSITION_PROVIDER_SCHEMA_NAME },
      }),
    });
    await expect(new OpenAiPlannerProvider(client).decompose({ approvedBrief: fixture.input.approvedBrief, plannerReferenceTable: fixture.table, minimumContract: createDecompositionMinimumContract({ brief: fixture.input.approvedBrief, canonicalBrief: fixture.input.canonicalBrief }), coverageRepresentabilityPlan: deriveCoverageRepresentabilityPlan(fixture.table) })).rejects.toMatchObject({
      code: "AI_OUTPUT_DOMAIN_INVALID",
      diagnostic: { stage: "domain_validation", outputStage: "TRANSPORT_SCHEMA_VALIDATION_FAILED", requestAttempted: true, apiResponseReceived: true, responseReceived: true, schemaName: PLANNER_DECOMPOSITION_PROVIDER_SCHEMA_NAME },
    });
  });
  it("builds the production decomposition schema from the shared kind/domain authority", async () => {
    type SchemaVariant = { properties: { domain: { const: string }; kind: { enum: string[] } } };
    type DecompositionSchema = { properties: { elements: { items: { anyOf: SchemaVariant[] } } } };
    const responseFormat = buildProductionResponseFormat(PlanningDecompositionProviderOutputSchema, PLANNER_DECOMPOSITION_PROVIDER_SCHEMA_NAME) as unknown as { json_schema: { schema: DecompositionSchema } };
    const variants = responseFormat.json_schema.schema.properties.elements.items.anyOf;
    expect(variants).toHaveLength(PlannerCoverageDomainSchema.options.length);
    for (const variant of variants) expect(variant.properties.kind.enum).toEqual(PLANNER_ELEMENT_KINDS_BY_DOMAIN[variant.properties.domain.const as keyof typeof PLANNER_ELEMENT_KINDS_BY_DOMAIN]);

    const fixture = tokenizedPlannerFixture();
    const invalid = { schemaVersion: 1, providerContractVersion: PLANNER_DECOMPOSITION_CONTRACT_VERSION, complete: true, elements: [{ kind: "DATABASE_MODEL", domain: "FRONTEND", title: "Invalid typed pair", description: "This pair is rejected before deterministic admission.", pageTokens: null, routeTokens: null, dependencies: null, negativeEvidence: null, negativeOnly: null }] };
    expect(PlanningDecompositionProviderOutputSchema.safeParse(invalid).success).toBe(false);
    let sentSchemaName: string | undefined;
    const client = new OpenAiStructuredClient(config, { executor: async <T>(request: StructuredRequest<T>) => { sentSchemaName = request.schemaName; return { value: invalid as T, requestId: "req_decomposition_schema_guard" }; } });
    await expect(new OpenAiPlannerProvider(client).decompose({ approvedBrief: fixture.input.approvedBrief, plannerReferenceTable: fixture.table, minimumContract: createDecompositionMinimumContract({ brief: fixture.input.approvedBrief, canonicalBrief: fixture.input.canonicalBrief }), coverageRepresentabilityPlan: deriveCoverageRepresentabilityPlan(fixture.table) })).rejects.toMatchObject({ code: "AI_OUTPUT_DOMAIN_INVALID" });
    expect(sentSchemaName).toBe(PLANNER_DECOMPOSITION_PROVIDER_SCHEMA_NAME);
  });
  it("retries one transient failure and does not expose raw provider data", async () => { let calls = 0; const client = new OpenAiStructuredClient(config, { executor: async <T>() => { calls++; if (calls === 1) throw Object.assign(new Error("temporary"), { status: 503 }); return { value: { ok: true, summary: "recovered" } as T, requestId: "req_2" }; } }); await expect(client.request({ ...request, idempotencyKey: "retry" })).resolves.toMatchObject({ value: { ok: true } }); expect(calls).toBe(2); });
  it("honors the recovery request boundary with zero retries and zero corrections", async () => {
    let calls = 0;
    const corrections: boolean[] = [];
    const client = new OpenAiStructuredClient({ ...config, maxRetries: 3 }, { executor: async <T>(_request: StructuredRequest<T>, _client: unknown, _config: unknown, correction: boolean) => { calls += 1; corrections.push(correction); throw new AiProviderError("AI_OUTPUT_SCHEMA_MISMATCH", "synthetic schema mismatch"); } });
    await expect(client.request({ ...request, idempotencyKey: "recovery-no-retry", retryPolicy: { maxRetries: 0, corrections: 0 } })).rejects.toMatchObject({ code: "AI_OUTPUT_SCHEMA_MISMATCH" });
    expect(calls).toBe(1);
    expect(corrections).toEqual([false]);
  });
  it("does not silently correct structured output when a request omits an explicit retry policy", async () => {
    let calls = 0;
    const client = new OpenAiStructuredClient({ ...config, maxRetries: 0 }, { executor: async () => { calls += 1; throw new AiProviderError("AI_OUTPUT_SCHEMA_MISMATCH", "synthetic schema mismatch"); } });
    await expect(client.request({ ...request, idempotencyKey: "default-no-correction" })).rejects.toMatchObject({ code: "AI_OUTPUT_SCHEMA_MISMATCH" });
    expect(calls).toBe(1);
  });
  it("passes the recovery output capacity to the single provider request", async () => {
    let completionTokens: number | undefined;
    const client = new OpenAiStructuredClient(config, { client: { chat: { completions: { parse: async (value: Record<string, unknown>) => { completionTokens = value.max_completion_tokens as number; return { id: "req_recovery_capacity", choices: [{ message: { parsed: { ok: true, summary: "bounded" } }, finish_reason: "stop" }], usage: {} }; } } } } as never });
    await client.request({ ...request, schemaName: "planning-recovery-package", maxCompletionTokens: 64_000, retryPolicy: { maxRetries: 0, corrections: 0 } });
    expect(completionTokens).toBe(64_000);
  });
  it("does not abort a slow Planner response at the former Factory timeout", async () => { const started = Date.now(); const client = new OpenAiStructuredClient(config, { executor: async <T>() => { await new Promise((resolve) => setTimeout(resolve, 30)); return { value: { ok: true, summary: "slow-but-valid" } as T, requestId: "req_planner" }; } }); await expect(client.request({ ...request, role: "planner", idempotencyKey: "planner-no-timeout" })).resolves.toMatchObject({ value: { ok: true } }); expect(Date.now() - started).toBeGreaterThanOrEqual(25); });
  it("preserves explicit cancellation and records safe timing metadata", async () => { const events: Array<Record<string, unknown>> = []; const controller = new AbortController(); const client = new OpenAiStructuredClient(config, { eventSink: (event) => events.push(event), executor: async (value: { signal?: AbortSignal }) => await new Promise((_, reject) => { const cancel = () => reject(new AiProviderError("AI_REQUEST_CANCELLED", "AI request was cancelled.")); if (value.signal?.aborted) cancel(); else value.signal?.addEventListener("abort", cancel, { once: true }); }) }); const pending = client.request({ ...request, signal: controller.signal, idempotencyKey: "explicit-cancel" }); await new Promise((resolve) => setTimeout(resolve, 0)); controller.abort(); await expect(pending).rejects.toMatchObject({ code: "AI_REQUEST_CANCELLED" }); expect(events.at(-1)).toMatchObject({ type: "request.failed", code: "AI_REQUEST_CANCELLED", elapsedMs: expect.any(Number), startedAt: expect.any(String), completedAt: expect.any(String) }); });
  it("ignores obsolete AI timeout environment values", () => { const parsed = readAiProviderConfig({ OPENAI_API_KEY: "test-key", OPENAI_MODEL: "test-model", OPENAI_REQUEST_TIMEOUT_MS: "not-a-number", OPENAI_PLANNER_REQUEST_TIMEOUT_MS: "invalid", OPENAI_DESIGN_REQUEST_TIMEOUT_MS: "invalid" }); expect(parsed).not.toHaveProperty("timeoutMs"); expect(parsed).not.toHaveProperty("roleTimeoutMs"); });
  it("rejects an empty provider model instead of constructing an unusable client", () => { expect(() => readAiProviderConfig({ OPENAI_API_KEY: "test-key" })).toThrowError(AiProviderError); });
  it("maps refusal and cancellation to stable errors", async () => { const refused = new OpenAiStructuredClient(config, { executor: async () => { throw new AiProviderError("AI_OUTPUT_REFUSED", "refused"); } }); await expect(refused.request({ ...request, idempotencyKey: "refused" })).rejects.toMatchObject({ code: "AI_OUTPUT_REFUSED" }); const controller = new AbortController(); controller.abort(); const client = new OpenAiStructuredClient(config, { executor: validExecutor }); await expect(client.request({ ...request, signal: controller.signal, idempotencyKey: "cancel" })).rejects.toMatchObject({ code: "AI_REQUEST_CANCELLED" }); });
  it("keeps queued work FIFO and bounds overflow", async () => { const limiter = new FifoConcurrencyLimiter(1, 0); const release = vi.fn(); const first = limiter.run(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); release(); return 1; }); await expect(limiter.run(async () => 2)).rejects.toMatchObject({ code: "AI_CONCURRENCY_LIMIT_REACHED" }); await expect(first).resolves.toBe(1); expect(release).toHaveBeenCalled(); });
  it("removes cancelled queued work without blocking the next waiter", async () => { const limiter = new FifoConcurrencyLimiter(1, 2); let releaseFirst!: () => void; const first = limiter.run(() => new Promise<number>((resolve) => { releaseFirst = () => resolve(1); })); await new Promise((resolve) => setTimeout(resolve, 0)); const controller = new AbortController(); const cancelled = limiter.run(async () => 2, controller.signal); const cancelledExpectation = expect(cancelled).rejects.toMatchObject({ code: "AI_REQUEST_CANCELLED" }); const third = limiter.run(async () => 3); controller.abort(); releaseFirst(); await expect(first).resolves.toBe(1); await cancelledExpectation; await expect(third).resolves.toBe(3); });
});
