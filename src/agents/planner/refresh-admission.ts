import { createHash } from "node:crypto";
import { CanonicalBriefV3Schema, type CanonicalBriefV3, type CanonicalRequirement, type RequirementCategory } from "@/domain/requirements/v3/schema";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { PlanningPackageSchema, type PlanningPackage } from "./contracts";

/**
 * These are the semantic areas owned by Planning. The list is deliberately
 * explicit: a provider may propose values in these areas, but it may not
 * decide which areas are in scope for a refresh.
 */
export type PlanningRefreshDomain =
  | "profile"
  | "product-scope"
  | "routes"
  | "pages"
  | "flows"
  | "forms"
  | "data-model"
  | "authentication"
  | "backend"
  | "email"
  | "storage"
  | "administration"
  | "content"
  | "assets"
  | "architecture"
  | "environment"
  | "dependencies"
  | "tests"
  | "security"
  | "traceability"
  | "blockers"
  | "database-decision";

export type PlanningRequirementCoverage = {
  requirementId: string;
  category: RequirementCategory;
  statement: string;
  reason: "MISSING_REFERENCE" | "MISSING_SEMANTIC_EVIDENCE";
};

export type PlanningRefreshAdmission = {
  candidate: PlanningPackage;
  blockers: string[];
  changedDomains: PlanningRefreshDomain[];
  introducedRequirementIds: string[];
  removedRequirementIds: string[];
  coverage: PlanningRequirementCoverage[];
};

export class PlanningAdmissionError extends Error {
  constructor(readonly code: string, readonly reference?: string) {
    super(reference ? `${code}:${reference}` : code);
    this.name = "PlanningAdmissionError";
  }
}

/** Requirements owned by a later lifecycle stage are not silently treated as Planning loss. */
export const PLANNING_NON_OWNED_REQUIREMENT_CATEGORIES = new Set<RequirementCategory>([
  "LEGAL_FACT",
  "LOGO_METADATA",
  "IMAGE_NOTE",
  "RECOMMENDATION",
]);

const REF_ALIASES: Record<string, readonly RequirementCategory[]> = {
  "businessgoals": ["BUSINESS_GOAL"],
  "targetaudiences": ["AUDIENCE"],
  "userroles": ["USER_ROLE"],
  "features": ["FEATURE"],
  "forms": ["FORM", "FORM_INTERACTION"],
  "contentrequirements": ["CONTENT", "OTHER"],
  "backendrequirements": ["BACKEND"],
  "supabaserequirements": ["DATABASE"],
  "seorequirements": ["SEO"],
  "useracceptancecriteria": ["ACCEPTANCE"],
  constraints: ["TECHNICAL", "UX_RESPONSIVE", "LEGAL_CONSTRAINT"],
  "explicitexclusions": ["EXCLUSION", "PROHIBITED"],
  "contactfacts": ["CONTACT_FACT"],
  "legalfacts": ["LEGAL_FACT"],
  "brandfacts": ["BRAND_FACT"],
};

const REF_DECISIONS: Record<string, string> = {
  authenticationdecision: "auth",
  storagedecision: "storage",
  emaildecision: "email",
  administrationdecision: "administration",
  protectedfunctionalityrequired: "protected-functionality",
  formbehaviorrequirements: "form-behavior",
};

const REF_HOST_DECISIONS = new Set([
  "database",
  "auth",
  "analytics",
  "route-policy",
  "storage",
  "email",
  "administration",
  "protected-functionality",
  "form-behavior",
]);

const domainForTopLevel: Record<string, PlanningRefreshDomain> = {
  profile: "profile",
  productScope: "product-scope",
  sitemap: "routes",
  navigation: "routes",
  pages: "pages",
  userFlows: "flows",
  forms: "forms",
  dataModel: "data-model",
  authentication: "authentication",
  supabase: "backend",
  email: "email",
  storage: "storage",
  administration: "administration",
  content: "content",
  assets: "assets",
  architecture: "architecture",
  environment: "environment",
  dependencies: "dependencies",
  testStrategy: "tests",
  security: "security",
  traceability: "traceability",
  blockers: "blockers",
  databaseRecommendation: "database-decision",
};

const domainCauses: Record<PlanningRefreshDomain, readonly (RequirementCategory | "PAGE" | "ASSET")[]> = {
  profile: ["BUSINESS_GOAL", "FEATURE", "FORM", "BACKEND", "DATABASE", "USER_ROLE"],
  "product-scope": ["BUSINESS_GOAL", "AUDIENCE", "USER_ROLE", "FEATURE", "FORM", "CONTENT", "BACKEND", "DATABASE", "ACCEPTANCE", "OTHER", "ADMINISTRATION"],
  routes: ["PAGE", "SEO", "FORM", "LEGAL_CONSTRAINT"],
  pages: ["PAGE", "SEO", "FORM", "CONTENT", "ACCEPTANCE", "LEGAL_CONSTRAINT"],
  flows: ["FEATURE", "FORM", "FORM_INTERACTION", "ACCEPTANCE", "BACKEND", "DATABASE", "USER_ROLE"],
  forms: ["FORM", "FORM_INTERACTION", "FEATURE", "CONTACT_FACT", "LEGAL_CONSTRAINT"],
  "data-model": ["BACKEND", "DATABASE", "FORM"],
  authentication: ["USER_ROLE", "BACKEND", "DATABASE"],
  backend: ["BACKEND", "DATABASE", "FORM"],
  email: ["FORM", "CONTACT_FACT", "BACKEND"],
  storage: ["DATABASE", "BACKEND", "ASSET", "FORM"],
  administration: ["ADMINISTRATION", "USER_ROLE", "BACKEND", "DATABASE"],
  content: ["BUSINESS_GOAL", "AUDIENCE", "FEATURE", "CONTENT", "LEGAL_CONSTRAINT", "ACCEPTANCE", "OTHER"],
  assets: ["ASSET", "IMAGE_NOTE", "BRAND_FACT", "BRAND_VISUAL", "FEATURE", "PAGE"],
  architecture: ["BACKEND", "DATABASE", "USER_ROLE", "FORM", "TECHNICAL", "UX_RESPONSIVE"],
  environment: ["BACKEND", "DATABASE", "FORM"],
  dependencies: ["BACKEND", "DATABASE", "FORM", "TECHNICAL"],
  tests: ["BUSINESS_GOAL", "FEATURE", "FORM", "CONTENT", "BACKEND", "DATABASE", "ACCEPTANCE", "PAGE"],
  security: ["USER_ROLE", "FORM", "BACKEND", "DATABASE", "TECHNICAL", "LEGAL_CONSTRAINT"],
  traceability: ["BUSINESS_GOAL", "AUDIENCE", "USER_ROLE", "FEATURE", "FORM", "FORM_INTERACTION", "CONTENT", "BACKEND", "DATABASE", "SEO", "TECHNICAL", "EXCLUSION", "ACCEPTANCE", "CONTACT_FACT", "LEGAL_FACT", "BRAND_FACT", "IMAGE_NOTE", "BRAND_VISUAL", "UX_RESPONSIVE", "LEGAL_CONSTRAINT", "PROHIBITED", "DEFERRED_INTEGRATION", "DECISION", "ADMINISTRATION", "OTHER", "PAGE", "ASSET"],
  blockers: ["BACKEND", "DATABASE", "FORM", "FEATURE", "LEGAL_CONSTRAINT", "ASSET", "PAGE"],
  "database-decision": ["BACKEND", "DATABASE", "FORM"],
};

const semanticMetadataKeys = new Set(["projectId", "projectVersion", "createdAt", "updatedAt", "approvedBriefChecksum", "accepted", "acceptance", "decisionId"]);
const stableSemanticValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableSemanticValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !semanticMetadataKeys.has(key)).map(([key, nested]) => [key, stableSemanticValue(nested)]));
};

const normalizeSearchText = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("de").replace(/[^a-z0-9]+/g, " ").trim();
const stopWords = new Set(["a", "an", "and", "auf", "be", "bei", "das", "der", "die", "ein", "eine", "für", "from", "in", "mit", "of", "oder", "on", "the", "to", "und", "von", "zu"]);
const semanticTokens = (value: string) => normalizeSearchText(value).split(/\s+/).filter((token) => token.length >= 3 && !stopWords.has(token)).map((token) => token.length > 6 ? token.slice(0, 6) : token);

function semanticEvidenceCorpus(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => semanticEvidenceCorpus(item, output));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (semanticMetadataKeys.has(key) || ["requirementReferences", "decisionId", "rationale", "category", "confidence", "systemConstraintReferences", "userConfirmationRequired", "blockers"].includes(key)) continue;
      semanticEvidenceCorpus(child, output);
    }
  }
  return output;
}

function hasSemanticEvidence(candidate: PlanningPackage, requirement: CanonicalRequirement): boolean {
  const statement = normalizeSearchText(requirement.statement);
  const corpus = semanticEvidenceCorpus(stableSemanticValue(candidate)).map(normalizeSearchText);
  if (corpus.some((value) => value.includes(statement))) return true;
  const tokens = semanticTokens(requirement.statement);
  if (tokens.length < 6) return false;
  const joined = corpus.join(" ");
  const matched = tokens.filter((token) => joined.includes(token));
  return matched.length / tokens.length >= 0.75;
}

function canonicalRequirementEntries(brief: CanonicalBriefV3) {
  return [
    ...brief.requirements,
    ...brief.decisions.form.interactionStates,
    ...brief.seo.locationTargeting,
  ];
}

function canonicalReferences(brief: CanonicalBriefV3) {
  const requirements = canonicalRequirementEntries(brief);
  const aliases = new Map<string, string[]>();
  for (const [field, categories] of Object.entries(REF_ALIASES)) {
    aliases.set(field, requirements.filter((entry) => categories.includes(entry.category)).map((entry) => entry.id));
  }
  aliases.set("pages", brief.pages.map((page) => page.id));
  aliases.set("assets", brief.assets.map((asset) => asset.id));
  const allowed = new Set([...requirements.map((entry) => entry.id), ...brief.pages.map((page) => page.id), ...brief.assets.map((asset) => asset.id)]);
  return { requirements, aliases, allowed };
}

function resolveReference(reference: string, brief: CanonicalBriefV3): string[] {
  const { aliases, allowed } = canonicalReferences(brief);
  if (/legacy(?:[-_ ]?v?1)/i.test(reference)) throw new PlanningAdmissionError("PLANNING_TRACEABILITY_LEGACY_REFERENCE", reference);
  if (allowed.has(reference)) return [reference];
  if (/^REQUIREMENT:/i.test(reference) || /^PAGE:/i.test(reference) || /^ASSET(?::|_)/i.test(reference)) throw new PlanningAdmissionError("PLANNING_TRACEABILITY_UNKNOWN_REFERENCE", reference);
  const briefMatch = /^brief:(.+)$/i.exec(reference);
  if (briefMatch) {
    const field = briefMatch[1]!.replace(/[^a-z0-9]/gi, "").toLocaleLowerCase("en");
    const decision = REF_DECISIONS[field];
    if (decision) return [`PLANNING:DECISION:${decision}`];
    const resolved = aliases.get(field);
    if (!resolved) throw new PlanningAdmissionError("PLANNING_TRACEABILITY_UNKNOWN_REFERENCE", reference);
    return resolved.length ? resolved : [`PLANNING:BRIEF_FIELD:${field}`];
  }
  const decisionMatch = /^canonical-v3:decisions\.(.+)$/i.exec(reference);
  if (decisionMatch) {
    const key = decisionMatch[1]!.replace(/[^a-z0-9-]/gi, "").toLocaleLowerCase("en");
    if (!REF_HOST_DECISIONS.has(key)) throw new PlanningAdmissionError("PLANNING_TRACEABILITY_UNKNOWN_REFERENCE", reference);
    return [`PLANNING:DECISION:${key}`];
  }
  const planningMatch = /^PLANNING:(DECISION|BRIEF_FIELD):([A-Za-z0-9_.-]+)$/.exec(reference);
  if (planningMatch) {
    const key = planningMatch[2]!.toLocaleLowerCase("en");
    if (planningMatch[1] === "DECISION" && REF_HOST_DECISIONS.has(key)) return [reference];
    if (planningMatch[1] === "BRIEF_FIELD" && (Object.hasOwn(REF_ALIASES, key) || key === "pages" || key === "assets" || Object.hasOwn(REF_DECISIONS, key))) return [reference];
  }
  throw new PlanningAdmissionError("PLANNING_TRACEABILITY_UNKNOWN_REFERENCE", reference);
}

const hostDecisionId = (value: Record<string, unknown>, path: string) => {
  const digest = createHash("sha256").update(`${path}:${checksumPersistedDocument({ ...value, decisionId: undefined })}`).digest("hex");
  const bytes = Buffer.from(digest.slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  return `${bytes.toString("hex").slice(0, 8)}-${bytes.toString("hex").slice(8, 12)}-${bytes.toString("hex").slice(12, 16)}-${bytes.toString("hex").slice(16, 20)}-${bytes.toString("hex").slice(20)}`;
};

function bindPlanningIdentity(value: unknown, projectId: string, projectVersion: number): unknown {
  if (Array.isArray(value)) return value.map((item) => bindPlanningIdentity(item, projectId, projectVersion));
  if (!value || typeof value !== "object") return value;
  const result = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, bindPlanningIdentity(child, projectId, projectVersion)]));
  if (typeof result.documentType === "string") {
    result.projectId = projectId;
    result.projectVersion = projectVersion;
  }
  return result;
}

function normalizeHostReferences(value: unknown, brief: CanonicalBriefV3, path = "$",): unknown {
  if (Array.isArray(value)) return value.map((item, index) => normalizeHostReferences(item, brief, `${path}[${index}]`));
  if (typeof value === "string") {
    if (/(?:REQUIREMENT|PAGE|ASSET)(?::|_)legacy(?:[-_ ]?v?1)/i.test(value))
      throw new PlanningAdmissionError("PLANNING_TRACEABILITY_LEGACY_REFERENCE", value);
    if (/^(?:REQUIREMENT:|PAGE:|ASSET(?::|_)|PLANNING:)/i.test(value))
      return resolveReference(value, brief)[0];
    return value;
  }
  if (!value || typeof value !== "object") return value;
  const node = value as Record<string, unknown>;
  const normalized = Object.fromEntries(Object.entries(node).map(([key, child]) => {
    if (key === "requirementReferences") {
      if (!Array.isArray(child) || child.some((item) => typeof item !== "string")) throw new PlanningAdmissionError("PLANNING_TRACEABILITY_INVALID_REFERENCE", path);
      return [key, [...new Set(child.flatMap((reference) => resolveReference(reference, brief)))]];
    }
    return [key, normalizeHostReferences(child, brief, `${path}.${key}`)];
  }));
  if ("decisionId" in normalized) normalized.decisionId = hostDecisionId(normalized, path);
  return normalized;
}

function normalizeHostDecisionIds(value: unknown, path = "$",): unknown {
  if (Array.isArray(value)) return value.map((item, index) => normalizeHostDecisionIds(item, `${path}[${index}]`));
  if (!value || typeof value !== "object") return value;
  const normalized = Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, normalizeHostDecisionIds(child, `${path}.${key}`)]));
  if ("decisionId" in normalized) normalized.decisionId = hostDecisionId(normalized, path);
  return normalized;
}

export function normalizePlanningPackageForHost(input: {
  candidate: PlanningPackage;
  projectId: string;
  projectVersion: number;
  approvedBriefChecksum: string;
  canonicalBrief?: CanonicalBriefV3;
  current?: PlanningPackage;
  timestamp?: string;
}): PlanningPackage {
  const canonical = input.canonicalBrief ? CanonicalBriefV3Schema.parse(input.canonicalBrief) : undefined;
  const identityBound = bindPlanningIdentity(input.candidate, input.projectId, input.projectVersion);
  const referenceBound = canonical ? normalizeHostReferences(identityBound, canonical) : identityBound;
  const normalized = normalizeHostDecisionIds(referenceBound) as PlanningPackage;
  const createdAt = input.current?.createdAt ?? input.timestamp ?? normalized.createdAt;
  const updatedAt = input.timestamp ?? normalized.updatedAt;
  return PlanningPackageSchema.parse({
    ...normalized,
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    createdAt,
    updatedAt,
    approvedBriefChecksum: input.approvedBriefChecksum,
    accepted: false,
    acceptance: {},
    architecture: { ...normalized.architecture, acceptance: { accepted: false } },
  });
}

function referencesOf(value: unknown): Set<string> {
  const result = new Set<string>();
  if (Array.isArray(value)) value.forEach((item) => referencesOf(item).forEach((reference) => result.add(reference)));
  else if (value && typeof value === "object") for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === "requirementReferences" && Array.isArray(child)) child.filter((item): item is string => typeof item === "string").forEach((reference) => result.add(reference));
    else referencesOf(child).forEach((reference) => result.add(reference));
  }
  return result;
}

function representedRequirementIds(candidate: PlanningPackage, brief: CanonicalBriefV3): Set<string> {
  const refs = referencesOf(candidate);
  return new Set(canonicalRequirementEntries(brief).filter((entry) => refs.has(entry.id) && hasSemanticEvidence(candidate, entry)).map((entry) => entry.id));
}

export function validatePlanningRequirementCoverage(input: { candidate: PlanningPackage; canonicalBrief: CanonicalBriefV3 }): PlanningRequirementCoverage[] {
  const brief = CanonicalBriefV3Schema.parse(input.canonicalBrief);
  const refs = referencesOf(input.candidate);
  return canonicalRequirementEntries(brief).filter((entry) => !PLANNING_NON_OWNED_REQUIREMENT_CATEGORIES.has(entry.category)).flatMap((entry): PlanningRequirementCoverage[] => {
    if (!refs.has(entry.id)) return [{ requirementId: entry.id, category: entry.category, statement: entry.statement, reason: "MISSING_REFERENCE" as const }];
    if (!hasSemanticEvidence(input.candidate, entry)) return [{ requirementId: entry.id, category: entry.category, statement: entry.statement, reason: "MISSING_SEMANTIC_EVIDENCE" as const }];
    return [];
  });
}

function changedDomains(current: PlanningPackage, candidate: PlanningPackage): PlanningRefreshDomain[] {
  return Object.keys(domainForTopLevel).filter((key) => checksumPersistedDocument(stableSemanticValue(current[key as keyof PlanningPackage])) !== checksumPersistedDocument(stableSemanticValue(candidate[key as keyof PlanningPackage]))).map((key) => domainForTopLevel[key]!);
}

function requirementCategorySet(brief: CanonicalBriefV3, ids: readonly string[]): Set<RequirementCategory | "PAGE" | "ASSET"> {
  const byId = new Map<string, RequirementCategory | "PAGE" | "ASSET">([
    ...canonicalRequirementEntries(brief).map((entry) => [entry.id, entry.category] as const),
    ...brief.pages.map((page) => [page.id, "PAGE"] as const),
    ...brief.assets.map((asset) => [asset.id, "ASSET"] as const),
  ]);
  return new Set(ids.map((id) => byId.get(id)).filter((category): category is RequirementCategory | "PAGE" | "ASSET" => Boolean(category)));
}

function introducedAndRemovedRequirements(current: PlanningPackage, candidate: PlanningPackage, brief: CanonicalBriefV3) {
  const currentIds = representedRequirementIds(current, brief);
  const candidateIds = representedRequirementIds(candidate, brief);
  return {
    introduced: [...candidateIds].filter((id) => !currentIds.has(id)),
    removed: [...currentIds].filter((id) => !candidateIds.has(id)),
  };
}

function allowedByCausality(domains: readonly PlanningRefreshDomain[], brief: CanonicalBriefV3, introduced: readonly string[]): PlanningRefreshDomain[] {
  const causes = requirementCategorySet(brief, introduced);
  return domains.filter((domain) => domainCauses[domain].some((cause) => causes.has(cause)));
}

function decisionCausedDomains(brief: CanonicalBriefV3, current: PlanningPackage, candidate: PlanningPackage): PlanningRefreshDomain[] {
  const allowed = new Set<PlanningRefreshDomain>();
  const currentClientOnly = current.forms.forms.length > 0 && current.forms.forms.every((form) => form.submissionMechanism === "client-only");
  const candidateRealForm = candidate.forms.forms.some((form) => form.submissionMechanism !== "client-only");
  if (brief.decisions.form.mode === "REAL" && candidateRealForm && currentClientOnly) {
    ["forms", "flows", "backend", "data-model", "architecture", "security", "environment", "tests"].forEach((domain) => allowed.add(domain as PlanningRefreshDomain));
  }
  const currentStateful = current.dataModel.entities.length > 0 || current.supabase.postgres || current.supabase.auth || current.supabase.storage;
  const candidateStateful = candidate.dataModel.entities.length > 0 || candidate.supabase.postgres || candidate.supabase.auth || candidate.supabase.storage;
  if (brief.decisions.database.mode !== "NONE" && candidateStateful && !currentStateful) {
    ["database-decision", "data-model", "backend", "storage", "architecture", "security", "environment", "dependencies", "tests"].forEach((domain) => allowed.add(domain as PlanningRefreshDomain));
  }
  if (brief.decisions.auth.mode === "REQUIRED" && candidate.authentication.required && !current.authentication.required) {
    ["authentication", "administration", "routes", "pages", "architecture", "security"].forEach((domain) => allowed.add(domain as PlanningRefreshDomain));
  }
  if (brief.decisions.routePolicy.mode === "MULTI_PAGE" && candidate.sitemap.routes.length > current.sitemap.routes.length) {
    ["routes", "pages", "flows"].forEach((domain) => allowed.add(domain as PlanningRefreshDomain));
  }
  return [...allowed];
}

function safePagePath(slug: string): string {
  return slug === "home" || slug === "index" ? "/" : `/${slug.replace(/^\//, "").replace(/[^a-z0-9-]/gi, "-").toLocaleLowerCase("en")}`;
}

function validateCanonicalRouteAndFormShape(candidate: PlanningPackage, brief: CanonicalBriefV3): string[] {
  const blockers: string[] = [];
  const expectedPaths = brief.pages.map((page) => safePagePath(page.slug));
  const actualPaths = candidate.sitemap.routes.map((route) => route.path);
  for (const path of actualPaths) if (!expectedPaths.includes(path)) blockers.push(`PLANNING_ROUTE_OUTSIDE_CANONICAL_PAGES:${path}`);
  for (const path of expectedPaths) if (!actualPaths.includes(path)) blockers.push(`PLANNING_ROUTE_MISSING_CANONICAL_PAGE:${path}`);
  const routeIdsByPath = new Map(candidate.sitemap.routes.map((route) => [route.path, route.id]));
  const pageRouteIds = new Set(candidate.pages.pages.map((page) => page.routeId));
  for (const path of expectedPaths) {
    const routeId = routeIdsByPath.get(path);
    if (routeId && !pageRouteIds.has(routeId)) blockers.push(`PLANNING_PAGE_RESPONSIBILITY_MISSING:${path}`);
  }
  const formMode = brief.decisions.form.mode;
  if (formMode === "NONE" && candidate.forms.forms.length > 0) blockers.push("PLANNING_FORM_OUTSIDE_CANONICAL_DECISION");
  if (formMode !== "NONE" && candidate.forms.forms.length === 0) blockers.push("PLANNING_FORM_MISSING_CANONICAL_DECISION");
  return blockers;
}

/**
 * Admit a provider proposal against the current approved Brief and, when this
 * is a refresh, the currently accepted/stale Planning semantics. This is the
 * sole mutation-scope decision; providers only supply the candidate.
 */
export function admitPlanningRefresh(input: {
  candidate: PlanningPackage;
  current?: PlanningPackage;
  canonicalBrief?: CanonicalBriefV3;
  authorizedDomains?: readonly PlanningRefreshDomain[];
  projectId: string;
  projectVersion: number;
  approvedBriefChecksum: string;
  timestamp?: string;
}): PlanningRefreshAdmission {
  const candidate = normalizePlanningPackageForHost(input);
  const blockers: string[] = [];
  let coverage: PlanningRequirementCoverage[] = [];
  let introducedRequirementIds: string[] = [];
  let removedRequirementIds: string[] = [];
  let domains: PlanningRefreshDomain[] = [];
  if (input.canonicalBrief) {
    blockers.push(...validateCanonicalRouteAndFormShape(candidate, input.canonicalBrief));
    coverage = validatePlanningRequirementCoverage({ candidate, canonicalBrief: input.canonicalBrief });
    blockers.push(...coverage.map((item) => `PLANNING_REQUIREMENT_COVERAGE_MISSING:${item.requirementId}:${item.reason}`));
    if (input.current) {
      const normalizedCurrent = normalizePlanningPackageForHost({ ...input, candidate: input.current, current: undefined, timestamp: input.current.updatedAt });
      ({ introduced: introducedRequirementIds, removed: removedRequirementIds } = introducedAndRemovedRequirements(normalizedCurrent, candidate, input.canonicalBrief));
      domains = changedDomains(normalizedCurrent, candidate);
      const allowed = new Set([
        ...allowedByCausality(domains, input.canonicalBrief, introducedRequirementIds),
        ...decisionCausedDomains(input.canonicalBrief, normalizedCurrent, candidate),
        ...(input.authorizedDomains ?? []),
      ]);
      const unexplained = domains.filter((domain) => !allowed.has(domain) && domain !== "traceability");
      if (unexplained.length) blockers.push(`PLANNING_REFRESH_UNAUTHORIZED_DRIFT:${unexplained.join(",")}`);
      if (domains.includes("traceability") && !introducedRequirementIds.length && !removedRequirementIds.length) blockers.push("PLANNING_REFRESH_TRACEABILITY_DRIFT");
    }
  }
  return { candidate, blockers: [...new Set(blockers)], changedDomains: domains, introducedRequirementIds, removedRequirementIds, coverage };
}
