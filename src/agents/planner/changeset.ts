import { createHash } from "node:crypto";
import { z } from "zod";
import { BackendPrioritySchema } from "@/domain/architecture/schema";
import { CanonicalBriefV3Schema, type CanonicalBriefV3, type CanonicalRequirement, type RequirementCategory } from "@/domain/requirements/v3/schema";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import type { ArchitectureReviewResult } from "@/domain/review/schema";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { NonEmptyStringSchema, ProjectVersionSchema, UuidSchema } from "@/domain/shared/schemas";
import {
  FormFieldContractSchema,
  FormSubmissionMechanismSchema,
  PlanningPackageSchema,
  type PlanningPackage,
} from "./contracts";
import { planningSemanticChecksum } from "./deterministic";
import type { PlanningRefreshDomain } from "./refresh-admission";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const RequirementReferencesSchema = z.array(NonEmptyStringSchema).min(1).max(64);
const StringListSchema = z.array(NonEmptyStringSchema).max(128);

const ProductScopeFieldChangeSchema = z.discriminatedUnion("field", [
  z.object({ kind: z.literal("set-product-scope-field"), field: z.literal("purpose"), value: NonEmptyStringSchema, requirementReferences: RequirementReferencesSchema }).strict(),
  z.object({ kind: z.literal("set-product-scope-field"), field: z.enum(["primaryOutcomes", "secondaryOutcomes", "inScopeCapabilities", "outOfScopeCapabilities", "userRoles", "majorEntities", "majorWorkflows", "externalIntegrations", "assumptions", "constraints"]), value: StringListSchema, requirementReferences: RequirementReferencesSchema }).strict(),
]);

const RouteValueSchema = z.object({
  id: NonEmptyStringSchema,
  requirementReferences: RequirementReferencesSchema,
  path: z.string().regex(/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/),
  titlePurpose: NonEmptyStringSchema,
  pageType: z.enum(["landing", "content", "form", "dashboard", "auth", "legal", "application"]),
  visibility: z.enum(["public", "protected"]),
  intendedUser: NonEmptyStringSchema,
  primaryGoal: NonEmptyStringSchema,
  primaryCta: NonEmptyStringSchema.nullable(),
  contentResponsibilities: StringListSchema,
  dataDependencies: StringListSchema,
  formDependencies: StringListSchema,
  authRequired: z.boolean(),
  seoRelevant: z.boolean(),
  parentId: NonEmptyStringSchema.nullable(),
  navigationVisible: z.boolean(),
}).strict();

const PageValueSchema = z.object({
  id: NonEmptyStringSchema,
  requirementReferences: RequirementReferencesSchema,
  routeId: NonEmptyStringSchema,
  purpose: NonEmptyStringSchema,
  targetAudience: NonEmptyStringSchema,
  userIntent: NonEmptyStringSchema,
  contentBlocks: StringListSchema,
  functionalComponents: StringListSchema,
  forms: StringListSchema,
  dataReads: StringListSchema,
  dataWrites: StringListSchema,
  loadingStates: StringListSchema,
  emptyStates: StringListSchema,
  errorStates: StringListSchema,
  successStates: StringListSchema,
  seoMetadata: StringListSchema,
  assetRequirements: StringListSchema,
  acceptanceCriteria: StringListSchema,
}).strict();

const FormValueSchema = z.object({
  id: NonEmptyStringSchema,
  requirementReferences: RequirementReferencesSchema,
  route: NonEmptyStringSchema,
  purpose: NonEmptyStringSchema,
  fields: z.array(FormFieldContractSchema).max(64),
  businessValidation: StringListSchema,
  consentRequirements: StringListSchema,
  submissionMechanism: FormSubmissionMechanismSchema,
  databaseWrite: NonEmptyStringSchema,
  emailBehavior: NonEmptyStringSchema,
  successState: NonEmptyStringSchema,
  errorState: NonEmptyStringSchema,
  rateLimitRequired: z.boolean(),
  spamProtectionRequired: z.boolean(),
}).strict();

const ArchitectureFieldChangeSchema = z.discriminatedUnion("field", [
  z.object({ kind: z.literal("set-architecture-field"), field: z.literal("applicationProfile"), value: z.enum(["marketing-site", "business-site", "web-application"]), requirementReferences: RequirementReferencesSchema }).strict(),
  z.object({ kind: z.literal("set-architecture-field"), field: z.literal("backendPriority"), value: BackendPrioritySchema, requirementReferences: RequirementReferencesSchema }).strict(),
  z.object({ kind: z.literal("set-architecture-field"), field: z.enum(["componentBoundaries", "serverActions", "routeHandlers", "supabaseDatabaseRequirements", "schemaPlan", "rlsRequirements", "testStrategy", "securityControls", "rejectedInfrastructure"]), value: StringListSchema, requirementReferences: RequirementReferencesSchema }).strict(),
  z.object({ kind: z.literal("set-architecture-field"), field: z.enum(["authenticationPlan", "storagePlan", "emailPlan"]), value: NonEmptyStringSchema, requirementReferences: RequirementReferencesSchema }).strict(),
  z.object({ kind: z.literal("set-architecture-field"), field: z.literal("routes"), value: z.array(z.object({ path: NonEmptyStringSchema, responsibility: NonEmptyStringSchema }).strict()).max(128), requirementReferences: RequirementReferencesSchema }).strict(),
  z.object({ kind: z.literal("set-architecture-field"), field: z.literal("componentDecisions"), value: z.array(z.object({ area: NonEmptyStringSchema, serverOrClient: z.enum(["server", "client"]), rationale: NonEmptyStringSchema }).strict()).max(128), requirementReferences: RequirementReferencesSchema }).strict(),
  z.object({ kind: z.literal("set-architecture-field"), field: z.literal("environmentVariables"), value: z.array(z.object({ name: z.string().regex(/^[A-Z][A-Z0-9_]*$/), required: z.boolean(), public: z.boolean() }).strict()).max(128), requirementReferences: RequirementReferencesSchema }).strict(),
  z.object({ kind: z.literal("set-architecture-field"), field: z.literal("dependencies"), value: z.array(z.object({ name: NonEmptyStringSchema, purpose: NonEmptyStringSchema }).strict()).max(64), requirementReferences: RequirementReferencesSchema }).strict(),
  z.object({ kind: z.literal("set-architecture-field"), field: z.literal("npmScripts"), value: z.array(z.object({ name: NonEmptyStringSchema, command: NonEmptyStringSchema }).strict()).max(64), requirementReferences: RequirementReferencesSchema }).strict(),
]);

export const PlanningChangeOperationSchema = z.union([
  ProductScopeFieldChangeSchema,
  ArchitectureFieldChangeSchema,
  z.object({ kind: z.literal("upsert-route"), value: RouteValueSchema }).strict(),
  z.object({ kind: z.literal("remove-route"), routeId: NonEmptyStringSchema, requirementReferences: RequirementReferencesSchema }).strict(),
  z.object({ kind: z.literal("upsert-page"), value: PageValueSchema }).strict(),
  z.object({ kind: z.literal("remove-page"), pageId: NonEmptyStringSchema, requirementReferences: RequirementReferencesSchema }).strict(),
  z.object({ kind: z.literal("upsert-form"), value: FormValueSchema }).strict(),
  z.object({ kind: z.literal("remove-form"), formId: NonEmptyStringSchema, requirementReferences: RequirementReferencesSchema }).strict(),
]);
export type PlanningChangeOperation = z.infer<typeof PlanningChangeOperationSchema>;

export const PlanningChangeSetProviderOutputSchema = z.object({
  contractVersion: z.literal(1),
  changes: z.array(PlanningChangeOperationSchema).max(64),
}).strict();
export type PlanningChangeSetProviderOutput = z.infer<typeof PlanningChangeSetProviderOutputSchema>;

export const PlanningBriefDeltaChangeSchema = z.object({
  target: z.enum(["requirement", "page", "asset", "decision", "scope", "brand", "seo", "legal", "localization", "summary"]),
  operation: z.enum(["ADD", "REMOVE", "UPDATE"]),
  targetId: NonEmptyStringSchema,
  category: z.string().optional(),
  beforeChecksum: Sha256Schema.optional(),
  afterChecksum: Sha256Schema.optional(),
}).strict();
export type PlanningBriefDeltaChange = z.infer<typeof PlanningBriefDeltaChangeSchema>;

export const PlanningBriefDeltaSchema = z.object({
  baseBriefChecksum: Sha256Schema,
  targetBriefChecksum: Sha256Schema,
  changes: z.array(PlanningBriefDeltaChangeSchema).max(512),
  authorizedDomains: z.array(z.string().min(1)).max(32),
  authorizedRequirementIds: z.array(NonEmptyStringSchema).max(512),
  authorizationScopeChecksum: Sha256Schema,
}).strict();
export type PlanningBriefDelta = z.infer<typeof PlanningBriefDeltaSchema>;

export const PlanningChangeSetSchema = PlanningChangeSetProviderOutputSchema.extend({
  projectId: UuidSchema,
  projectVersion: ProjectVersionSchema,
  basePlanningSemanticChecksum: Sha256Schema,
  baseBriefChecksum: Sha256Schema,
  targetBriefChecksum: Sha256Schema,
  authorizationScopeChecksum: Sha256Schema,
}).strict();
export type PlanningChangeSet = z.infer<typeof PlanningChangeSetSchema>;

const requirementDomainMap: Record<RequirementCategory | "PAGE" | "ASSET", readonly PlanningRefreshDomain[]> = {
  BUSINESS_GOAL: ["product-scope", "content", "tests"],
  AUDIENCE: ["product-scope", "pages", "content"],
  USER_ROLE: ["product-scope", "flows", "authentication", "pages", "security"],
  FEATURE: ["product-scope", "flows", "pages", "content", "tests"],
  FORM: ["product-scope", "forms", "flows", "pages", "tests"],
  FORM_INTERACTION: ["forms", "flows", "tests"],
  CONTENT: ["product-scope", "content", "pages", "tests"],
  BACKEND: ["product-scope", "backend", "data-model", "architecture", "security", "environment", "tests"],
  DATABASE: ["product-scope", "database-decision", "data-model", "backend", "architecture", "security", "environment", "dependencies", "tests"],
  SEO: ["routes", "pages", "content", "tests"],
  TECHNICAL: ["architecture", "dependencies", "environment", "tests"],
  EXCLUSION: ["product-scope", "architecture", "security"],
  ACCEPTANCE: ["product-scope", "flows", "pages", "forms", "tests"],
  CONTACT_FACT: ["content", "forms"],
  LEGAL_FACT: [],
  BRAND_FACT: ["content", "assets"],
  LOGO_METADATA: [],
  IMAGE_NOTE: [],
  RECOMMENDATION: [],
  BRAND_VISUAL: ["content", "assets"],
  UX_RESPONSIVE: ["pages", "architecture", "tests"],
  LEGAL_CONSTRAINT: ["pages", "forms", "content", "security"],
  PROHIBITED: ["product-scope", "architecture", "security"],
  DEFERRED_INTEGRATION: ["backend", "architecture", "dependencies"],
  DECISION: ["architecture"],
  ADMINISTRATION: ["administration", "authentication", "security", "architecture"],
  OTHER: ["product-scope", "content", "tests"],
  PAGE: ["routes", "pages", "flows"],
  ASSET: ["assets", "content"],
};

const requirementEntries = (brief: CanonicalBriefV3) => [
  ...brief.requirements,
  ...brief.decisions.form.interactionStates,
  ...brief.seo.locationTargeting,
];

const checksum = (value: unknown) => checksumPersistedDocument(value);
const entriesById = <T extends { id: string }>(entries: readonly T[]) => new Map(entries.map((entry) => [entry.id, entry]));

function compareEntries<T extends { id: string }>(target: PlanningBriefDeltaChange["target"], before: readonly T[], after: readonly T[], category?: (entry: T) => string | undefined): PlanningBriefDeltaChange[] {
  const beforeById = entriesById(before);
  const afterById = entriesById(after);
  const changes: PlanningBriefDeltaChange[] = [];
  for (const [id, next] of afterById) {
    const previous = beforeById.get(id);
    if (!previous) changes.push({ target, operation: "ADD", targetId: id, ...(category?.(next) ? { category: category(next) } : {}), afterChecksum: checksum(next) });
    else if (checksum(previous) !== checksum(next)) changes.push({ target, operation: "UPDATE", targetId: id, ...(category?.(next) ? { category: category(next) } : {}), beforeChecksum: checksum(previous), afterChecksum: checksum(next) });
  }
  for (const [id, previous] of beforeById) if (!afterById.has(id)) changes.push({ target, operation: "REMOVE", targetId: id, ...(category?.(previous) ? { category: category(previous) } : {}), beforeChecksum: checksum(previous) });
  return changes;
}

function decisionChanges(base: CanonicalBriefV3, target: CanonicalBriefV3): PlanningBriefDeltaChange[] {
  const changes: PlanningBriefDeltaChange[] = [];
  const decisions: Array<[string, unknown, unknown]> = [
    ["decisions.form", base.decisions.form, target.decisions.form],
    ["decisions.database", base.decisions.database, target.decisions.database],
    ["decisions.auth", base.decisions.auth, target.decisions.auth],
    ["decisions.analytics", base.decisions.analytics, target.decisions.analytics],
    ["decisions.routePolicy", base.decisions.routePolicy, target.decisions.routePolicy],
  ];
  for (const [targetId, before, after] of decisions) if (checksum(before) !== checksum(after)) changes.push({ target: "decision", operation: "UPDATE", targetId, beforeChecksum: checksum(before), afterChecksum: checksum(after) });
  const other: Array<[PlanningBriefDeltaChange["target"], string, unknown, unknown]> = [
    ["scope", "scope", base.scope, target.scope],
    ["brand", "brand", base.brand, target.brand],
    ["seo", "seo", base.seo, target.seo],
    ["legal", "legal", base.legal, target.legal],
    ["localization", "localization", base.localization, target.localization],
    ["summary", "summary", base.summary, target.summary],
  ];
  for (const [targetType, targetId, before, after] of other) if (checksum(before) !== checksum(after)) changes.push({ target: targetType, operation: "UPDATE", targetId, beforeChecksum: checksum(before), afterChecksum: checksum(after) });
  return changes;
}

function scopeForChanges(brief: CanonicalBriefV3, changes: readonly PlanningBriefDeltaChange[]) {
  const allEntries = new Map<string, CanonicalRequirement | { id: string; category: "PAGE" | "ASSET" }>([
    ...requirementEntries(brief).map((entry) => [entry.id, entry] as const),
    ...brief.pages.map((entry) => [entry.id, { id: entry.id, category: "PAGE" as const }] as const),
    ...brief.assets.map((entry) => [entry.id, { id: entry.id, category: "ASSET" as const }] as const),
  ]);
  const domains = new Set<PlanningRefreshDomain>();
  const ids = new Set<string>();
  for (const change of changes) {
    const entry = allEntries.get(change.targetId);
    if (entry) {
      ids.add(entry.id);
      for (const domain of requirementDomainMap[entry.category]) domains.add(domain);
    } else if (change.target === "decision") {
      if (change.targetId === "decisions.form") ["forms", "flows", "backend", "data-model", "architecture", "security", "environment", "tests"].forEach((domain) => domains.add(domain as PlanningRefreshDomain));
      else if (change.targetId === "decisions.database") ["database-decision", "data-model", "backend", "architecture", "security", "environment", "dependencies", "tests"].forEach((domain) => domains.add(domain as PlanningRefreshDomain));
      else if (change.targetId === "decisions.auth") ["authentication", "administration", "routes", "pages", "architecture", "security"].forEach((domain) => domains.add(domain as PlanningRefreshDomain));
      else if (change.targetId === "decisions.analytics") ["content", "pages", "architecture", "tests"].forEach((domain) => domains.add(domain as PlanningRefreshDomain));
      else if (change.targetId === "decisions.routePolicy") ["routes", "pages", "flows"].forEach((domain) => domains.add(domain as PlanningRefreshDomain));
    } else if (["scope", "summary"].includes(change.target)) domains.add("product-scope");
    else if (change.target === "seo") ["routes", "pages", "content"].forEach((domain) => domains.add(domain as PlanningRefreshDomain));
    else if (change.target === "legal") ["pages", "forms", "content", "security"].forEach((domain) => domains.add(domain as PlanningRefreshDomain));
    else if (change.target === "brand") ["content", "assets"].forEach((domain) => domains.add(domain as PlanningRefreshDomain));
    else if (change.target === "localization") ["content", "pages"].forEach((domain) => domains.add(domain as PlanningRefreshDomain));
  }
  return { authorizedDomains: [...domains].sort(), authorizedRequirementIds: [...ids].sort() };
}

export function computePlanningBriefDelta(baseInput: CanonicalBriefV3, targetInput: CanonicalBriefV3): PlanningBriefDelta {
  const base = CanonicalBriefV3Schema.parse(baseInput);
  const target = CanonicalBriefV3Schema.parse(targetInput);
  const changes = [
    ...compareEntries("requirement", requirementEntries(base), requirementEntries(target), (entry) => entry.category),
    ...compareEntries("page", base.pages, target.pages),
    ...compareEntries("asset", base.assets, target.assets),
    ...decisionChanges(base, target),
  ].sort((left, right) => left.targetId.localeCompare(right.targetId) || left.operation.localeCompare(right.operation));
  const scope = scopeForChanges(target, changes);
  const baseBriefChecksum = canonicalBriefChecksum(base);
  const targetBriefChecksum = canonicalBriefChecksum(target);
  const authorizationScopeChecksum = checksum({ baseBriefChecksum, targetBriefChecksum, ...scope });
  return PlanningBriefDeltaSchema.parse({ baseBriefChecksum, targetBriefChecksum, changes, ...scope, authorizationScopeChecksum });
}

/**
 * Reconstruct the bounded authorization surface when only append-only Brief
 * provenance is available. Values remain in the canonical current Brief; the
 * history rows contribute only target/operation/fingerprint evidence.
 */
export function computePlanningBriefDeltaFromHistory(input: {
  baseBriefChecksum: string;
  targetBrief: CanonicalBriefV3;
  history: readonly { previousCurrentChecksum: string; nextCurrentChecksum: string; entries: readonly unknown[] }[];
}): PlanningBriefDelta {
  const targetBrief = CanonicalBriefV3Schema.parse(input.targetBrief);
  const chain = [...input.history].sort((left, right) => left.previousCurrentChecksum.localeCompare(right.previousCurrentChecksum));
  const relevant: typeof chain = [];
  let cursor = input.baseBriefChecksum;
  for (const row of chain) {
    if (row.previousCurrentChecksum !== cursor) continue;
    relevant.push(row);
    cursor = row.nextCurrentChecksum;
    if (cursor === canonicalBriefChecksum(targetBrief)) break;
  }
  if (cursor !== canonicalBriefChecksum(targetBrief) || relevant.length === 0) throw new Error("PLANNING_REFRESH_BASE_BRIEF_UNAVAILABLE");
  const currentRequirements = requirementEntries(targetBrief);
  const changes: PlanningBriefDeltaChange[] = [];
  const add = (target: PlanningBriefDeltaChange["target"], targetId: string, operation: PlanningBriefDeltaChange["operation"], category?: string) => changes.push({ target, targetId, operation, ...(category ? { category } : {}) });
  for (const row of relevant) for (const raw of row.entries) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as { target?: unknown; operation?: unknown };
    const target = typeof entry.target === "string" ? entry.target : "";
    const operation = entry.operation === "REMOVE" ? "REMOVE" : entry.operation === "UPSERT" ? "ADD" : "UPDATE";
    if (target.startsWith("REQUIREMENT:")) {
      const requirement = currentRequirements.find((candidate) => candidate.id === target);
      add("requirement", target, operation, requirement?.category);
    } else if (target.startsWith("PAGE:")) add("page", target, operation);
    else if (target.startsWith("ASSET:") || target === "ASSET_COMPANY_LOGO") add("asset", target, operation);
    else if (target === "DATABASE_MODE") add("decision", "decisions.database", "UPDATE");
    else if (target === "AUTH_MODE") add("decision", "decisions.auth", "UPDATE");
    else if (target === "ANALYTICS_MODE") add("decision", "decisions.analytics", "UPDATE");
    else if (target === "ROUTE_POLICY") add("decision", "decisions.routePolicy", "UPDATE");
    else if (target.startsWith("FORM_")) add("decision", "decisions.form", "UPDATE");
    else if (target.startsWith("SEO_")) add("seo", "seo", "UPDATE");
    else if (target.startsWith("LEGAL_")) add("legal", "legal", "UPDATE");
    else if (target.startsWith("BRAND_")) add("brand", "brand", "UPDATE");
    else if (target === "IMAGE_SOURCE_STRATEGY") add("scope", "scope.images", "UPDATE");
  }
  const uniqueChanges = changes.filter((change, index, values) => values.findIndex((candidate) => candidate.target === change.target && candidate.targetId === change.targetId && candidate.operation === change.operation) === index);
  const scope = scopeForChanges(targetBrief, uniqueChanges);
  // A fixed decision target authorizes its current, typed evidence set, not
  // arbitrary requirements from the whole Brief.
  for (const change of uniqueChanges.filter((candidate) => candidate.target === "decision")) {
    const categories = change.targetId === "decisions.form" ? new Set(["FORM", "FORM_INTERACTION"])
      : change.targetId === "decisions.database" ? new Set(["DATABASE", "BACKEND"])
        : change.targetId === "decisions.auth" ? new Set(["USER_ROLE", "BACKEND", "DATABASE"])
          : new Set<string>();
    for (const entry of currentRequirements) if (categories.has(entry.category)) scope.authorizedRequirementIds.push(entry.id);
  }
  scope.authorizedRequirementIds = [...new Set(scope.authorizedRequirementIds)].sort();
  const baseBriefChecksum = input.baseBriefChecksum;
  const targetBriefChecksum = canonicalBriefChecksum(targetBrief);
  const authorizationScopeChecksum = planningAuthorizationScopeChecksum({ baseBriefChecksum, targetBriefChecksum, ...scope });
  return PlanningBriefDeltaSchema.parse({ baseBriefChecksum, targetBriefChecksum, changes: uniqueChanges, ...scope, authorizationScopeChecksum });
}

export function planningAuthorizationScopeChecksum(input: Pick<PlanningBriefDelta, "baseBriefChecksum" | "targetBriefChecksum" | "authorizedDomains" | "authorizedRequirementIds">) {
  return checksum({ baseBriefChecksum: input.baseBriefChecksum, targetBriefChecksum: input.targetBriefChecksum, authorizedDomains: [...input.authorizedDomains].sort(), authorizedRequirementIds: [...input.authorizedRequirementIds].sort() });
}

/** Build a host-owned authorization envelope for a non-Brief correction. */
export function createPlanningAuthorizationDelta(input: {
  canonicalBrief: CanonicalBriefV3;
  authorizedDomains: readonly PlanningRefreshDomain[];
  authorizedRequirementIds?: readonly string[];
}): PlanningBriefDelta {
  const brief = CanonicalBriefV3Schema.parse(input.canonicalBrief);
  const briefChecksum = canonicalBriefChecksum(brief);
  const authorizedDomains = [...new Set(input.authorizedDomains)].sort();
  const authorizedRequirementIds = [...new Set(input.authorizedRequirementIds ?? [])].sort();
  return PlanningBriefDeltaSchema.parse({
    baseBriefChecksum: briefChecksum,
    targetBriefChecksum: briefChecksum,
    changes: [],
    authorizedDomains,
    authorizedRequirementIds,
    authorizationScopeChecksum: planningAuthorizationScopeChecksum({
      baseBriefChecksum: briefChecksum,
      targetBriefChecksum: briefChecksum,
      authorizedDomains,
      authorizedRequirementIds,
    }),
  });
}

const allAllowedReferenceIds = (brief: CanonicalBriefV3) => new Set([
  ...requirementEntries(brief).map((entry) => entry.id),
  ...brief.pages.map((page) => page.id),
  ...brief.assets.map((asset) => asset.id),
]);

const operationDomain = (operation: PlanningChangeOperation): PlanningRefreshDomain => {
  if (operation.kind === "set-product-scope-field") return "product-scope";
  if (operation.kind === "set-architecture-field") return "architecture";
  if (operation.kind === "upsert-route" || operation.kind === "remove-route") return "routes";
  if (operation.kind === "upsert-page" || operation.kind === "remove-page") return "pages";
  return "forms";
};

const operationReferences = (operation: PlanningChangeOperation) => operation.kind === "set-product-scope-field" || operation.kind === "set-architecture-field"
  ? operation.requirementReferences
  : operation.kind === "upsert-route" || operation.kind === "upsert-page" || operation.kind === "upsert-form"
    ? operation.value.requirementReferences
    : operation.requirementReferences;

function refreshDecisionId(operation: PlanningChangeOperation, index: number, targetBriefChecksum: string) {
  const digest = createHash("sha256").update(`${targetBriefChecksum}:${index}:${JSON.stringify(operation)}`).digest("hex");
  const bytes = Buffer.from(digest.slice(0, 32), "hex");
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  return `${bytes.toString("hex").slice(0, 8)}-${bytes.toString("hex").slice(8, 12)}-${bytes.toString("hex").slice(12, 16)}-${bytes.toString("hex").slice(16, 20)}-${bytes.toString("hex").slice(20)}`;
}

function addRefreshTrace(packageValue: PlanningPackage, operation: PlanningChangeOperation, index: number, targetBriefChecksum: string) {
  const references = operationReferences(operation);
  packageValue.traceability = [...packageValue.traceability, {
    decisionId: refreshDecisionId(operation, index, targetBriefChecksum),
    category: "planning-refresh",
    requirementReferences: [...new Set(references)],
    systemConstraintReferences: ["PLANNING_CHANGESET_HOST_APPLY"],
    rationale: `Host applied bounded ${operation.kind} operation during Planning refresh.`,
    confidence: "high",
    userConfirmationRequired: false,
  }];
}

function replaceById<T extends { id: string }>(entries: readonly T[], next: T): T[] {
  const index = entries.findIndex((entry) => entry.id === next.id);
  if (index < 0) return [...entries, next];
  return entries.map((entry, entryIndex) => entryIndex === index ? next : entry);
}

export function applyPlanningChangeSet(input: {
  current: PlanningPackage;
  changeSet: PlanningChangeSet;
  briefDelta: PlanningBriefDelta;
  canonicalBrief: CanonicalBriefV3;
  projectId: string;
  projectVersion: number;
  timestamp: string;
}): PlanningPackage {
  const changeSet = PlanningChangeSetSchema.parse(input.changeSet);
  const brief = CanonicalBriefV3Schema.parse(input.canonicalBrief);
  if (changeSet.projectId !== input.projectId || changeSet.projectVersion !== input.projectVersion) throw new Error("PLANNING_CHANGESET_PROJECT_MISMATCH");
  if (input.current.projectId !== input.projectId || input.current.projectVersion !== input.projectVersion) throw new Error("PLANNING_CHANGESET_BASE_PLANNING_MISMATCH");
  if (changeSet.basePlanningSemanticChecksum !== planningSemanticChecksum(input.current)) throw new Error("PLANNING_CHANGESET_BASE_PLANNING_MISMATCH");
  if (input.current.approvedBriefChecksum !== changeSet.baseBriefChecksum) throw new Error("PLANNING_CHANGESET_BASE_BRIEF_MISMATCH");
  if (changeSet.baseBriefChecksum !== input.briefDelta.baseBriefChecksum || changeSet.targetBriefChecksum !== input.briefDelta.targetBriefChecksum || changeSet.authorizationScopeChecksum !== input.briefDelta.authorizationScopeChecksum) throw new Error("PLANNING_CHANGESET_SCOPE_MISMATCH");
  if (canonicalBriefChecksum(brief) !== input.briefDelta.targetBriefChecksum) throw new Error("PLANNING_CHANGESET_TARGET_BRIEF_MISMATCH");
  if (planningAuthorizationScopeChecksum(input.briefDelta) !== input.briefDelta.authorizationScopeChecksum) throw new Error("PLANNING_CHANGESET_SCOPE_INVALID");
  const allowedReferences = allAllowedReferenceIds(brief);
  const allowedDomains = new Set(input.briefDelta.authorizedDomains as PlanningRefreshDomain[]);
  const next = structuredClone(input.current);
  for (const [index, operation] of changeSet.changes.entries()) {
    const references = operationReferences(operation);
    if (references.some((reference) => /legacy(?:[-_ ]?v?1)/i.test(reference))) throw new Error("PLANNING_TRACEABILITY_LEGACY_REFERENCE");
    if (references.some((reference) => !allowedReferences.has(reference) && !reference.startsWith("PLANNING:"))) throw new Error("PLANNING_TRACEABILITY_UNKNOWN_REFERENCE");
    if (references.some((reference) => !input.briefDelta.authorizedRequirementIds.includes(reference) && !reference.startsWith("PAGE:") && !reference.startsWith("ASSET") && !reference.startsWith("PLANNING:"))) throw new Error("PLANNING_CHANGESET_REFERENCE_OUTSIDE_DELTA");
    if (!allowedDomains.has(operationDomain(operation))) throw new Error(`PLANNING_CHANGESET_DOMAIN_UNAUTHORIZED:${operationDomain(operation)}`);
    if (operation.kind === "set-product-scope-field") {
      if (Array.isArray(operation.value)) {
        // A bounded refresh may add or revise scope, but it cannot use a
        // field replacement to erase existing canonical scope points.
        const currentValues = next.productScope[operation.field] as string[];
        if (currentValues.some((value) => !operation.value.includes(value))) throw new Error("PLANNING_CHANGESET_UNRELATED_SCOPE_LOSS");
      }
      next.productScope = { ...next.productScope, [operation.field]: operation.value };
    }
    else if (operation.kind === "set-architecture-field") next.architecture = { ...next.architecture, [operation.field]: operation.field === "npmScripts" ? Object.fromEntries(operation.value.map((script) => [script.name, script.command])) : operation.value };
    else if (operation.kind === "upsert-route") {
      const { primaryCta, parentId, ...route } = operation.value;
      next.sitemap = { ...next.sitemap, routes: replaceById(next.sitemap.routes, { ...route, ...(primaryCta === null ? {} : { primaryCta }), ...(parentId === null ? {} : { parentId }) }) };
    }
    else if (operation.kind === "remove-route") next.sitemap = { ...next.sitemap, routes: next.sitemap.routes.filter((route) => route.id !== operation.routeId) };
    else if (operation.kind === "upsert-page") next.pages = { ...next.pages, pages: replaceById(next.pages.pages, operation.value) };
    else if (operation.kind === "remove-page") next.pages = { ...next.pages, pages: next.pages.pages.filter((page) => page.id !== operation.pageId) };
    else if (operation.kind === "upsert-form") next.forms = { ...next.forms, forms: replaceById(next.forms.forms, operation.value) };
    else if (operation.kind === "remove-form") next.forms = { ...next.forms, forms: next.forms.forms.filter((form) => form.id !== operation.formId) };
    addRefreshTrace(next, operation, index, input.briefDelta.targetBriefChecksum);
  }
  return PlanningPackageSchema.parse({
    ...next,
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    approvedBriefChecksum: input.briefDelta.targetBriefChecksum,
    createdAt: input.current.createdAt,
    updatedAt: input.timestamp,
    accepted: false,
    acceptance: {},
    architecture: { ...next.architecture, acceptance: { accepted: false } },
  });
}

export type PlannerRefreshProviderInput = {
  projectId: string;
  projectVersion: number;
  idempotencyKey: string;
  approvedBriefChecksum: string;
  canonicalBrief: CanonicalBriefV3;
  currentPlanningPackage: PlanningPackage;
  briefDelta: PlanningBriefDelta;
  authorizationScopeChecksum: string;
  architectureReview?: ArchitectureReviewResult;
  correctionOnly?: boolean;
};

export function providerChangeSetToHostChangeSet(input: {
  providerOutput: PlanningChangeSetProviderOutput;
  projectId: string;
  projectVersion: number;
  basePlanningSemanticChecksum: string;
  baseBriefChecksum: string;
  targetBriefChecksum: string;
  authorizationScopeChecksum: string;
}): PlanningChangeSet {
  const { providerOutput, ...host } = input;
  return PlanningChangeSetSchema.parse({ ...providerOutput, ...host });
}

export function isPlanningRefreshOperation(value: unknown): value is PlanningChangeOperation {
  return PlanningChangeOperationSchema.safeParse(value).success;
}
