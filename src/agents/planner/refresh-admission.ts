import { createHash } from "node:crypto";
import { CanonicalBriefV3Schema, type CanonicalBriefV3, type CanonicalRequirement, type RequirementCategory } from "@/domain/requirements/v3/schema";
import { CUSTOMER_UX_SOURCE_REF } from "@/domain/requirements/v3/customer-ux-direction";
import { isLegalAuxiliarySlug } from "@/domain/requirements/v3/consistency";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { PlanningPackageSchema, type PlanningPackage } from "./contracts";
import { CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY } from "./semantic-checksum";
import { PlanningFinalCoverageIssueSchema, type PlanningFinalCoverageIssue } from "./final-admission-diagnostics";
import type { PlannerCoverageDiagnostics } from "./coverage-contract";
import {
  bindPlanningRecoverySemanticAccounting,
  canonicalPagePath,
  createPlanningOwnedRequirementManifest,
  type CanonicalPlanningRouteManifest,
  type PlanningOwnedRequirementManifest,
  type PlanningRecoveryRequirementAccounting,
  type PlanningTargetCatalog,
  type PlanningTargetRef,
  validatePlanningRecoveryRequirementAccounting,
} from "./recovery-manifests";

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
  reason: "MISSING_REFERENCE" | "MISSING_SEMANTIC_EVIDENCE" | "MISSING_TRACEABILITY";
};

export type PlanningAcceptanceCoverageEntry = {
  requirementId: string;
  category: RequirementCategory;
  statement: string;
  planningTargetRefs: PlanningTargetRef[];
  semanticEvidence: string;
};

export type PlanningAcceptanceCoverageProjection = {
  source: "RECOVERY_ACCOUNTING";
  entries: PlanningAcceptanceCoverageEntry[];
  coverage: PlanningRequirementCoverage[];
  blockers: string[];
  accounting: PlanningRecoveryRequirementAccounting;
  accountingValidation: ReturnType<typeof validatePlanningRecoveryRequirementAccounting>;
};

export type PlanningRecoveryRequirementCoverage = PlanningRequirementCoverage | {
  requirementId: string;
  category: RequirementCategory;
  statement: string;
  reason: "MISSING_TRACEABILITY";
};

export type PlanningCoverageEvidence = {
  requirementId: string;
  category: RequirementCategory;
  statement: string;
  referencePresent: boolean;
  semanticEvidence: "FULL" | "PARTIAL" | "NONE";
  semanticEvidenceScore: number;
  ambiguity: "NONE" | "AMBIGUOUS";
  validatorFinding?: "MISSING_REFERENCE" | "MISSING_SEMANTIC_EVIDENCE";
};

export type PlanningRefreshAdmission = {
  candidate: PlanningPackage;
  blockers: string[];
  changedDomains: PlanningRefreshDomain[];
  introducedRequirementIds: string[];
  removedRequirementIds: string[];
  coverage: PlanningRequirementCoverage[];
  coverageDiagnostics: PlanningFinalCoverageIssue[];
};

export class PlanningAdmissionError extends Error {
  constructor(readonly code: string, readonly reference?: string, readonly reasonCode?: string, safeToken?: string, readonly coverageDiagnostics?: PlannerCoverageDiagnostics) {
    super(reference ? `${code}:${reference}` : code);
    this.name = "PlanningAdmissionError";
    this.safeToken = typeof safeToken === "string" && /^(?:REQ|PE|PAGE|ROUTE)_\d{3,}$/.test(safeToken) ? safeToken : undefined;
  }
  readonly safeToken?: string;
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
  "brandvisualrequirements": ["BRAND_VISUAL"],
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
const semanticExcludedKeys = new Set(["requirementReferences", "decisionId", "rationale", "category", "confidence", "systemConstraintReferences", "userConfirmationRequired", "blockers"]);
const stableSemanticValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableSemanticValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !semanticMetadataKeys.has(key)).map(([key, nested]) => [key, stableSemanticValue(nested)]));
};

const normalizeSearchText = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("de").replace(/[^a-z0-9]+/g, " ").trim();
const stopWords = new Set(["a", "an", "and", "auf", "be", "bei", "das", "der", "die", "ein", "eine", "für", "from", "in", "mit", "of", "oder", "on", "the", "to", "und", "von", "zu"]);
const semanticTokens = (value: string) => normalizeSearchText(value).split(/\s+/).filter((token) => token.length >= 3 && !stopWords.has(token)).map((token) => token.length > 6 ? token.slice(0, 6) : token);

function semanticMatchedTokens(corpus: string[], tokens: string[]): string[] {
  if (tokens.length >= 6) {
    const joined = corpus.join(" ");
    return tokens.filter((token) => joined.includes(token));
  }
  return corpus.reduce<string[]>((best, value) => {
    const matched = tokens.filter((token) => value.includes(token));
    return matched.length > best.length ? matched : best;
  }, []);
}

function semanticEvidenceCorpus(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => semanticEvidenceCorpus(item, output));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (semanticMetadataKeys.has(key) || semanticExcludedKeys.has(key)) continue;
      semanticEvidenceCorpus(child, output);
    }
  }
  return output;
}

function hasSemanticEvidence(candidate: PlanningPackage, requirement: CanonicalRequirement): boolean {
  return semanticEvidenceScore(candidate, requirement) >= 0.75;
}

function semanticEvidenceScore(candidate: PlanningPackage, requirement: CanonicalRequirement): number {
  const statement = normalizeSearchText(requirement.statement);
  const corpus = semanticEvidenceCorpus(stableSemanticValue(candidate)).map(normalizeSearchText);
  if (corpus.some((value) => value.includes(statement))) return 1;
  const tokens = semanticTokens(requirement.statement);
  if (tokens.length === 0) return 0;
  return semanticMatchedTokens(corpus, tokens).length / tokens.length;
}

function semanticEvidenceEvaluation(candidate: PlanningPackage, requirement: CanonicalRequirement) {
  const stable = stableSemanticValue(candidate) as Record<string, unknown>;
  const statement = normalizeSearchText(requirement.statement);
  const rawCorpus = semanticEvidenceCorpus(stable);
  const corpus = rawCorpus.map(normalizeSearchText);
  const tokens = semanticTokens(requirement.statement);
  const exactMatch = corpus.some((value) => value.includes(statement));
  const matchedTokens = semanticMatchedTokens(corpus, tokens);
  const unmatchedTokens = tokens.filter((token) => !matchedTokens.includes(token));
  const matchedTokenCount = matchedTokens.length;
  const score = exactMatch ? 1 : tokens.length === 0 ? 0 : matchedTokenCount / tokens.length;
  const evaluatedFieldPaths = Object.entries(stable)
    .filter(([key, value]) => !semanticMetadataKeys.has(key) && !semanticExcludedKeys.has(key) && semanticEvidenceCorpus(value).length > 0)
    .map(([key]) => key)
    .slice(0, 32);
  return {
    status: score >= 0.75 ? "FULL" as const : score > 0 ? "PARTIAL" as const : "NONE" as const,
    score: Number(score.toFixed(6)),
    requiredTokenCount: tokens.length,
    matchedTokenCount,
    requiredTokens: tokens.slice(0, 32),
    matchedTokens: matchedTokens.slice(0, 32),
    unmatchedTokens: unmatchedTokens.slice(0, 32),
    tokenListTruncated: tokens.length > 32,
    evaluatedFieldPaths,
    normalizedCorpusChecksum: checksumPersistedDocument(corpus),
  };
}

function coverageDiagnosticFor(input: {
  candidate: PlanningPackage;
  references: ReadonlySet<string>;
  entry: PlanningRequirementCoverage;
  canonicalEntry?: CanonicalRequirement;
}): PlanningFinalCoverageIssue | undefined {
  if (input.entry.reason !== "MISSING_REFERENCE" && input.entry.reason !== "MISSING_SEMANTIC_EVIDENCE") return undefined;
  if (!input.canonicalEntry || input.entry.requirementId !== input.canonicalEntry.id) return undefined;
  const canonicalReferencePresent = input.references.has(input.entry.requirementId);
  const evaluation = canonicalReferencePresent
    ? semanticEvidenceEvaluation(input.candidate, input.canonicalEntry)
    : undefined;
  const diagnostic = PlanningFinalCoverageIssueSchema.safeParse({
    canonicalRequirementId: input.canonicalEntry.id,
    category: input.canonicalEntry.category,
    ownership: "PLANNING",
    kind: input.entry.reason === "MISSING_REFERENCE" ? "ABSENT_MAPPING" : "SEMANTIC_MISSING",
    reason: input.entry.reason,
    referenceStatus: canonicalReferencePresent ? "PRESENT" : "ABSENT",
    canonicalReferencesPresent: canonicalReferencePresent ? [input.entry.requirementId] : [],
    normalizedEvidence: evaluation ?? {
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
    explanation: input.entry.reason === "MISSING_REFERENCE" ? "CANONICAL_REFERENCE_ABSENT" : "SEMANTIC_EVIDENCE_BELOW_THRESHOLD",
  });
  return diagnostic.success ? diagnostic.data : undefined;
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
  const customerUxRequirementIds = requirements
    .filter((entry) => entry.sourceRefs.includes(CUSTOMER_UX_SOURCE_REF))
    .map((entry) => entry.id);
  if (customerUxRequirementIds.length > 0 || brief.customerUxDirection) aliases.set("customeruxdirection", customerUxRequirementIds);
  if (brief.contact?.publicPhone) aliases.set("contactpublicphone", []);
  if (brief.contact?.publicEmail) aliases.set("contactpublicemail", []);
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
    if (planningMatch[1] === "BRIEF_FIELD" && (Object.hasOwn(REF_ALIASES, key) || aliases.has(key) || key === "pages" || key === "assets" || Object.hasOwn(REF_DECISIONS, key))) return [reference];
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
  validateRoutePolicy?: boolean;
}): PlanningPackage {
  const canonical = input.canonicalBrief ? CanonicalBriefV3Schema.parse(input.canonicalBrief) : undefined;
  const identityBound = bindPlanningIdentity(input.candidate, input.projectId, input.projectVersion);
  const referenceBound = canonical ? normalizeHostReferences(identityBound, canonical) : identityBound;
  const normalized = normalizeHostDecisionIds(referenceBound) as PlanningPackage;
  if (canonical && input.validateRoutePolicy !== false && normalized.routePolicy !== undefined && normalized.routePolicy !== canonical.decisions.routePolicy.mode)
    throw new PlanningAdmissionError("PLANNING_ROUTE_POLICY_PROVIDER_MISMATCH", normalized.routePolicy);
  const createdAt = input.current?.createdAt ?? input.timestamp ?? normalized.createdAt;
  const updatedAt = input.timestamp ?? normalized.updatedAt;
  return PlanningPackageSchema.parse({
    ...normalized,
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    createdAt,
    updatedAt,
    approvedBriefChecksum: input.approvedBriefChecksum,
    semanticChecksumPolicyVersion: CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY,
    ...(canonical ? { routePolicy: canonical.decisions.routePolicy.mode } : normalized.routePolicy === undefined ? {} : { routePolicy: normalized.routePolicy }),
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

function traceabilityReferencesOf(value: unknown, result = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => traceabilityReferencesOf(item, result));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "traceability" && Array.isArray(child)) {
        for (const entry of child) {
          if (!entry || typeof entry !== "object") continue;
          const references = (entry as { requirementReferences?: unknown }).requirementReferences;
          if (Array.isArray(references)) for (const reference of references) if (typeof reference === "string") result.add(reference);
        }
      } else traceabilityReferencesOf(child, result);
    }
  }
  return result;
}

/**
 * Project the already-admitted, host-bound recovery accounting into the
 * acceptance coverage view. Acceptance must not ask the provider to repeat
 * semantic evidence in a second package-owned array. The manifest supplies
 * canonical identity and statement; accounting supplies the accepted
 * responsibility, target refs, and evidence text.
 */
export function projectPlanningAcceptanceCoverageFromRecoveryAccounting(input: {
  candidate: PlanningPackage;
  canonicalBrief: CanonicalBriefV3;
  semanticAccounting: unknown;
  planningRequirementManifest?: PlanningOwnedRequirementManifest;
  routeManifest: Pick<CanonicalPlanningRouteManifest, "routes">;
  targetCatalog: PlanningTargetCatalog;
}): PlanningAcceptanceCoverageProjection {
  const brief = CanonicalBriefV3Schema.parse(input.canonicalBrief);
  const manifest = input.planningRequirementManifest ?? createPlanningOwnedRequirementManifest(brief);
  const binding = bindPlanningRecoverySemanticAccounting({
    semanticAccounting: input.semanticAccounting,
    manifest,
    candidate: input.candidate,
    routeManifest: input.routeManifest,
    targetCatalog: input.targetCatalog,
  });
  const accounting = binding.accounting;
  const accountingValidation = validatePlanningRecoveryRequirementAccounting({
    accounting,
    manifest,
    candidate: input.candidate,
    routeManifest: input.routeManifest,
  });
  const issues = [...binding.validation.issues, ...accountingValidation.issues].filter((issue, index, all) =>
    all.findIndex((candidate) => candidate.code === issue.code && candidate.requirementId === issue.requirementId) === index,
  );
  const accountingByRequirementId = new Map(accounting.map((entry) => [entry.requirementId, entry]));
  const references = referencesOf(input.candidate);
  const traceabilityReferences = traceabilityReferencesOf(input.candidate);
  const coverage: PlanningRequirementCoverage[] = [];
  const entries: PlanningAcceptanceCoverageEntry[] = [];

  for (const manifestEntry of manifest.requirements) {
    const evidence = accountingByRequirementId.get(manifestEntry.requirementId);
    if (!references.has(manifestEntry.requirementId)) {
      coverage.push({ requirementId: manifestEntry.requirementId, category: manifestEntry.category, statement: manifestEntry.statement, reason: "MISSING_REFERENCE" });
      continue;
    }
    if (!traceabilityReferences.has(manifestEntry.requirementId)) {
      coverage.push({ requirementId: manifestEntry.requirementId, category: manifestEntry.category, statement: manifestEntry.statement, reason: "MISSING_TRACEABILITY" });
      continue;
    }
    if (!evidence?.semanticEvidence?.trim()) {
      coverage.push({ requirementId: manifestEntry.requirementId, category: manifestEntry.category, statement: manifestEntry.statement, reason: "MISSING_SEMANTIC_EVIDENCE" });
      continue;
    }
    entries.push({
      requirementId: manifestEntry.requirementId,
      category: manifestEntry.category,
      statement: manifestEntry.statement,
      planningTargetRefs: evidence.planningTargetRefs,
      semanticEvidence: evidence.semanticEvidence,
    });
  }

  const issueBlockers = issues
    .filter((issue) => issue.code !== "MISSING_REQUIREMENT_ID_ACCOUNTING" && issue.code !== "MISSING_SEMANTIC_EVIDENCE")
    .map((issue) => issue.requirementId ? `PLANNING_REQUIREMENT_ACCOUNTING_INVALID:${issue.requirementId}:${issue.code}` : `PLANNING_REQUIREMENT_ACCOUNTING_INVALID:${issue.code}`);
  return {
    source: "RECOVERY_ACCOUNTING",
    entries,
    coverage,
    blockers: [...new Set(issueBlockers)],
    accounting,
    accountingValidation,
  };
}

function representedRequirementIds(candidate: PlanningPackage, brief: CanonicalBriefV3): Set<string> {
  const refs = referencesOf(candidate);
  return new Set(canonicalRequirementEntries(brief).filter((entry) => refs.has(entry.id) && hasSemanticEvidence(candidate, entry)).map((entry) => entry.id));
}

export function validatePlanningRequirementCoverage(input: { candidate: PlanningPackage; canonicalBrief: CanonicalBriefV3 }): PlanningRequirementCoverage[] {
  const brief = CanonicalBriefV3Schema.parse(input.canonicalBrief);
  const refs = referencesOf(input.candidate);
  return canonicalRequirementEntries(brief).filter((entry) => !PLANNING_NON_OWNED_REQUIREMENT_CATEGORIES.has(entry.category) || entry.sourceRefs.includes(CUSTOMER_UX_SOURCE_REF)).flatMap((entry): PlanningRequirementCoverage[] => {
    if (!refs.has(entry.id)) return [{ requirementId: entry.id, category: entry.category, statement: entry.statement, reason: "MISSING_REFERENCE" as const }];
    if (!hasSemanticEvidence(input.candidate, entry)) return [{ requirementId: entry.id, category: entry.category, statement: entry.statement, reason: "MISSING_SEMANTIC_EVIDENCE" as const }];
    return [];
  });
}

export function validatePlanningRecoveryRequirementCoverage(input: { candidate: PlanningPackage; manifest: { requirements: readonly { requirementId: string; category: RequirementCategory; statement: string }[] }; accounting?: PlanningRecoveryRequirementAccounting }): PlanningRecoveryRequirementCoverage[] {
  const refs = referencesOf(input.candidate);
  const traceabilityRefs = traceabilityReferencesOf(input.candidate);
  const accountingIds = input.accounting ? new Set(input.accounting.map((entry) => entry.requirementId)) : undefined;
  const blockers: PlanningRecoveryRequirementCoverage[] = [];
  for (const entry of input.manifest.requirements) {
    if (accountingIds) {
      if (!accountingIds.has(entry.requirementId)) blockers.push({ requirementId: entry.requirementId, category: entry.category, statement: entry.statement, reason: "MISSING_TRACEABILITY" });
      continue;
    }
    if (!refs.has(entry.requirementId)) blockers.push({ requirementId: entry.requirementId, category: entry.category, statement: entry.statement, reason: "MISSING_REFERENCE" });
    else if (!input.accounting && !hasSemanticEvidence(input.candidate, { id: entry.requirementId, category: entry.category, statement: entry.statement, sourceRefs: ["host:planning-recovery-manifest"] })) blockers.push({ requirementId: entry.requirementId, category: entry.category, statement: entry.statement, reason: "MISSING_SEMANTIC_EVIDENCE" });
    else if (!traceabilityRefs.has(entry.requirementId)) blockers.push({ requirementId: entry.requirementId, category: entry.category, statement: entry.statement, reason: "MISSING_TRACEABILITY" });
  }
  return blockers;
}

/**
 * Current-state evidence is intentionally separate from PlanningBriefDelta.
 * It measures the current package directly and never claims that a historical
 * Brief transition can be reconstructed.
 */
export function analyzePlanningRequirementCoverage(input: { candidate: PlanningPackage; canonicalBrief: CanonicalBriefV3 }): PlanningCoverageEvidence[] {
  const brief = CanonicalBriefV3Schema.parse(input.canonicalBrief);
  const refs = referencesOf(input.candidate);
  return canonicalRequirementEntries(brief).map((entry): PlanningCoverageEvidence => {
    const score = semanticEvidenceScore(input.candidate, entry);
    return {
      requirementId: entry.id,
      category: entry.category,
      statement: entry.statement,
      referencePresent: refs.has(entry.id),
      semanticEvidence: score >= 0.75 ? "FULL" : score > 0 ? "PARTIAL" : "NONE",
      semanticEvidenceScore: Number(score.toFixed(6)),
      ambiguity: "NONE",
    };
  });
}

function changedDomains(current: PlanningPackage, candidate: PlanningPackage): PlanningRefreshDomain[] {
  return Object.keys(domainForTopLevel).filter((key) => checksumPersistedDocument(stableSemanticValue(current[key as keyof PlanningPackage])) !== checksumPersistedDocument(stableSemanticValue(candidate[key as keyof PlanningPackage]))).map((key) => domainForTopLevel[key]!);
}

function differsOnlyByHostRefreshTrace(current: PlanningPackage, candidate: PlanningPackage): boolean {
  const isHostRefreshTrace = (value: PlanningPackage["traceability"][number]) => value.category === "planning-refresh" && value.systemConstraintReferences.includes("PLANNING_CHANGESET_HOST_APPLY");
  const currentNonHost = current.traceability.filter((value) => !isHostRefreshTrace(value));
  const candidateNonHost = candidate.traceability.filter((value) => !isHostRefreshTrace(value));
  return candidate.traceability.length > current.traceability.length && checksumPersistedDocument(currentNonHost) === checksumPersistedDocument(candidateNonHost);
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

/**
 * Route shape is an authority of the current CanonicalBriefV3.  Callers must
 * not encode a particular route mode as a universal reconciliation guard.
 */
export function planningRoutePolicyMatchesCanonicalBrief(candidate: PlanningPackage, brief: CanonicalBriefV3): boolean {
  const mode = brief.decisions.routePolicy.mode;
  if (mode === "UNRESOLVED") return false;
  const expectedPaths = brief.pages.map((page) => canonicalPagePath(page.slug)).sort();
  const actualPaths = candidate.sitemap.routes.map((route) => route.path).sort();
  const mainSitePaths = brief.pages
    .filter((page) => !isLegalAuxiliarySlug(canonicalPagePath(page.slug)))
    .map((page) => canonicalPagePath(page.slug));
  const expectedMode = mainSitePaths.length <= 1 ? "SINGLE_PAGE" : "MULTI_PAGE";
  return mode === expectedMode
    && expectedPaths.length === actualPaths.length
    && expectedPaths.every((path, index) => path === actualPaths[index]);
}

function validateCanonicalRouteAndFormShape(candidate: PlanningPackage, brief: CanonicalBriefV3): string[] {
  const blockers: string[] = [];
  if (!planningRoutePolicyMatchesCanonicalBrief(candidate, brief)) blockers.push("PLANNING_ROUTE_POLICY_MISMATCH");
  const expectedPaths = brief.pages.map((page) => canonicalPagePath(page.slug));
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

/** Validate the provider-normalized package against the host-issued recovery route handles. */
export function validatePlanningRecoveryRouteManifest(input: { candidate: PlanningPackage; manifest: CanonicalPlanningRouteManifest }): string[] {
  const required = input.manifest.routes.filter((route) => route.required);
  const blockers: string[] = [];
  const expectedPaths = required.map((route) => route.path).sort();
  const actualPaths = input.candidate.sitemap.routes.map((route) => route.path).sort();
  if (expectedPaths.length !== actualPaths.length || expectedPaths.some((path, index) => path !== actualPaths[index])) blockers.push("PLANNING_RECOVERY_ROUTE_MANIFEST_CARDINALITY");
  const routeByPath = new Map(input.candidate.sitemap.routes.map((route) => [route.path, route]));
  const pageByRouteId = new Map(input.candidate.pages.pages.map((page) => [page.routeId, page]));
  const routeIds = new Set(required.map((route) => route.routeId));
  const expectedRouteIds = required.map((route) => route.routeId).sort();
  const actualRouteIds = input.candidate.sitemap.routes.map((route) => route.id).sort();
  if (expectedRouteIds.length !== actualRouteIds.length || expectedRouteIds.some((id, index) => id !== actualRouteIds[index])) blockers.push("PLANNING_RECOVERY_ROUTE_IDENTITY_SET_MISMATCH");
  const expectedPageIds = required.map((route) => route.planningPageId).sort();
  const actualPageIds = input.candidate.pages.pages.map((page) => page.id).sort();
  if (expectedPageIds.length !== actualPageIds.length || expectedPageIds.some((id, index) => id !== actualPageIds[index])) blockers.push("PLANNING_RECOVERY_PAGE_MANIFEST_CARDINALITY");
  for (const route of required) {
    const actual = routeByPath.get(route.path);
    if (!actual) {
      blockers.push(`PLANNING_RECOVERY_ROUTE_MANIFEST_MISSING:${route.path}`);
      continue;
    }
    if (actual.id !== route.routeId) blockers.push(`PLANNING_RECOVERY_ROUTE_IDENTITY_MISMATCH:${route.path}`);
    const page = pageByRouteId.get(route.routeId);
    if (!page) blockers.push(`PLANNING_RECOVERY_PAGE_MANIFEST_MISSING:${route.path}`);
    else if (page.id !== route.planningPageId) blockers.push(`PLANNING_RECOVERY_PAGE_IDENTITY_MISMATCH:${route.path}`);
    if (route.legal && actual.path !== route.path) blockers.push(`PLANNING_RECOVERY_LEGAL_ROUTE_MISMATCH:${route.path}`);
  }
  for (const reference of input.candidate.navigation.routeReferences) if (!routeIds.has(reference)) blockers.push(`PLANNING_RECOVERY_NAVIGATION_ROUTE_UNKNOWN:${reference}`);
  for (const route of required.filter((entry) => entry.navigation.participation === "REQUIRED")) if (!input.candidate.navigation.routeReferences.includes(route.routeId)) blockers.push(`PLANNING_RECOVERY_NAVIGATION_ROUTE_MISSING:${route.path}`);
  const architecturePaths = input.candidate.architecture.routes.map((route) => route.path).sort();
  if (expectedPaths.length !== architecturePaths.length || expectedPaths.some((path, index) => path !== architecturePaths[index])) blockers.push("PLANNING_RECOVERY_ARCHITECTURE_ROUTE_MANIFEST_MISMATCH");
  for (const form of input.candidate.forms.forms) if (!expectedPaths.includes(form.route)) blockers.push(`PLANNING_RECOVERY_FORM_ROUTE_NOT_CANONICAL:${form.route}`);
  return [...new Set(blockers)];
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
  validateRequirementCoverage?: boolean;
  requirementCoverage?: PlanningRequirementCoverage[];
}): PlanningRefreshAdmission {
  const candidate = normalizePlanningPackageForHost(input);
  const blockers: string[] = [];
  let coverage: PlanningRequirementCoverage[] = [];
  let introducedRequirementIds: string[] = [];
  let removedRequirementIds: string[] = [];
  let domains: PlanningRefreshDomain[] = [];
  let coverageDiagnostics: PlanningFinalCoverageIssue[] = [];
  if (input.canonicalBrief) {
    blockers.push(...validateCanonicalRouteAndFormShape(candidate, input.canonicalBrief));
    if (input.validateRequirementCoverage !== false) {
      coverage = input.requirementCoverage ?? validatePlanningRequirementCoverage({ candidate, canonicalBrief: input.canonicalBrief });
      blockers.push(...coverage.map((item) => `PLANNING_REQUIREMENT_COVERAGE_MISSING:${item.requirementId}:${item.reason}`));
      const references = referencesOf(candidate);
      const canonicalEntriesById = new Map(canonicalRequirementEntries(CanonicalBriefV3Schema.parse(input.canonicalBrief)).map((entry) => [entry.id, entry]));
      coverageDiagnostics = coverage
        .map((entry) => coverageDiagnosticFor({ candidate, references, entry, canonicalEntry: canonicalEntriesById.get(entry.requirementId) }))
        .filter((entry): entry is PlanningFinalCoverageIssue => Boolean(entry));
    }
    if (input.current) {
      const normalizedCurrent = normalizePlanningPackageForHost({ ...input, candidate: input.current, current: undefined, timestamp: input.current.updatedAt, validateRoutePolicy: false });
      ({ introduced: introducedRequirementIds, removed: removedRequirementIds } = introducedAndRemovedRequirements(normalizedCurrent, candidate, input.canonicalBrief));
      domains = changedDomains(normalizedCurrent, candidate);
      const allowed = new Set([
        ...allowedByCausality(domains, input.canonicalBrief, introducedRequirementIds),
        ...decisionCausedDomains(input.canonicalBrief, normalizedCurrent, candidate),
        ...(input.authorizedDomains ?? []),
      ]);
      const unexplained = domains.filter((domain) => !allowed.has(domain) && domain !== "traceability");
      if (unexplained.length) blockers.push(`PLANNING_REFRESH_UNAUTHORIZED_DRIFT:${unexplained.join(",")}`);
      if (domains.includes("traceability") && !introducedRequirementIds.length && !removedRequirementIds.length && !differsOnlyByHostRefreshTrace(normalizedCurrent, candidate)) blockers.push("PLANNING_REFRESH_TRACEABILITY_DRIFT");
    }
  }
  return { candidate, blockers: [...new Set(blockers)], changedDomains: domains, introducedRequirementIds, removedRequirementIds, coverage, coverageDiagnostics };
}
