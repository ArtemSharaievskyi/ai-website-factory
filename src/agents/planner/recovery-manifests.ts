import { CanonicalBriefV3Schema, CanonicalRequirementSchema, RequirementCategorySchema, RoutePolicySchema, SemanticPageIdSchema, SemanticRequirementIdSchema, type CanonicalBriefV3, type CanonicalRequirement, type RequirementCategory } from "@/domain/requirements/v3/schema";
import { canonicalRequirementEntries, isLegacyRequirementId, isV3RequirementId } from "@/domain/requirements/v3/identity";
import { CUSTOMER_UX_SOURCE_REF } from "@/domain/requirements/v3/customer-ux-direction";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { NonEmptyStringSchema } from "@/domain/shared/schemas";
import type { PlanningPackage } from "./contracts";
import { z } from "zod";

const RoutePathSchema = z.string().regex(/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/);
const HandleSchema = NonEmptyStringSchema.max(320).regex(/^planning-(?:route|page|requirement):/);
const SourceRefListSchema = z.array(NonEmptyStringSchema.max(200)).min(1);

export const PlanningRouteHandleSchema = HandleSchema.regex(/^planning-route:/);
export const PlanningPageHandleSchema = HandleSchema.regex(/^planning-page:/);
// Read compatibility: historical persisted manifests used the canonical ID
// after this prefix. New manifests are generated with opaque R### handles.
export const PlanningRequirementHandleSchema = HandleSchema.regex(/^planning-requirement:/);
export const PlanningTargetHandleSchema = NonEmptyStringSchema.max(320).regex(/^planning-target:T\d{3,}$/);

const RouteSeoMetadataSchema = z.object({
  route: NonEmptyStringSchema.max(160),
  title: z.string().trim().max(300).nullable(),
  metaDescription: z.string().trim().max(1000).nullable(),
  keywords: z.array(NonEmptyStringSchema.max(300)),
  sourceRefs: SourceRefListSchema,
}).strict();

export const CanonicalPlanningRouteManifestEntrySchema = z.object({
  routeHandle: PlanningRouteHandleSchema,
  pageHandle: PlanningPageHandleSchema,
  routeId: NonEmptyStringSchema,
  planningPageId: NonEmptyStringSchema,
  pageId: SemanticPageIdSchema,
  path: RoutePathSchema,
  pagePurpose: NonEmptyStringSchema.max(2000),
  pageRole: z.enum(["content", "legal"]),
  legal: z.boolean(),
  required: z.boolean(),
  parentPageId: SemanticPageIdSchema.nullable(),
  navigation: z.object({
    participation: z.enum(["REQUIRED", "NOT_SPECIFIED"]),
    requirementIds: z.array(SemanticRequirementIdSchema),
  }).strict(),
  seo: z.object({
    required: z.boolean(),
    metadata: z.array(RouteSeoMetadataSchema),
    requirementIds: z.array(SemanticRequirementIdSchema),
  }).strict(),
  requirementIds: z.array(SemanticRequirementIdSchema),
}).strict();
export type CanonicalPlanningRouteManifestEntry = z.infer<typeof CanonicalPlanningRouteManifestEntrySchema>;

export const CanonicalPlanningRouteManifestSchema = z.object({
  schemaVersion: z.literal(1),
  routePolicy: RoutePolicySchema,
  routes: z.array(CanonicalPlanningRouteManifestEntrySchema),
  manifestChecksum: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine((value, context) => {
  const checks: readonly [string, readonly string[]][] = [
    ["routeHandle", value.routes.map((route) => route.routeHandle)],
    ["pageHandle", value.routes.map((route) => route.pageHandle)],
    ["routeId", value.routes.map((route) => route.routeId)],
    ["pageId", value.routes.map((route) => route.pageId)],
    ["path", value.routes.map((route) => route.path)],
  ];
  for (const [field, values] of checks) if (new Set(values).size !== values.length) context.addIssue({ code: "custom", path: ["routes"], message: `Canonical route manifest contains duplicate ${field}.` });
});
export type CanonicalPlanningRouteManifest = z.infer<typeof CanonicalPlanningRouteManifestSchema>;

export const PlanningOwnedRequirementManifestEntrySchema = z.object({
  requirementHandle: PlanningRequirementHandleSchema,
  requirementId: SemanticRequirementIdSchema,
  category: RequirementCategorySchema,
  statement: NonEmptyStringSchema.max(4000),
  sourceRefs: SourceRefListSchema,
  origin: z.enum(["brief.requirements", "decisions.form.interactionStates", "seo.locationTargeting"]),
  evidencePolicy: z.literal("SEMANTIC_EVIDENCE_REQUIRED"),
  traceabilityPolicy: z.literal("TRACEABILITY_REFERENCE_REQUIRED"),
}).strict();
export type PlanningOwnedRequirementManifestEntry = z.infer<typeof PlanningOwnedRequirementManifestEntrySchema>;

export const PlanningOwnedRequirementManifestSchema = z.object({
  schemaVersion: z.literal(1),
  requirements: z.array(PlanningOwnedRequirementManifestEntrySchema).max(512),
  manifestChecksum: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine((value, context) => {
  const ids = value.requirements.map((entry) => entry.requirementId);
  const handles = value.requirements.map((entry) => entry.requirementHandle);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["requirements"], message: "Requirement manifest contains duplicate identities." });
  if (new Set(handles).size !== handles.length) context.addIssue({ code: "custom", path: ["requirements"], message: "Requirement manifest contains duplicate handles." });
});
export type PlanningOwnedRequirementManifest = z.infer<typeof PlanningOwnedRequirementManifestSchema>;

/**
 * A provider's semantic responsibility for one host-issued Planning
 * requirement.  The domain is deliberately the canonical V3 category rather
 * than a second Planning taxonomy; the disposition describes how Planning
 * handled that category.
 */
export const PlanningRequirementDispositionSchema = z.enum([
  "PAGE_RESPONSIBILITY",
  "ROUTE_RESPONSIBILITY",
  "ARCHITECTURE_CONSTRAINT",
  "FORM_CONSTRAINT",
  "CONTENT_REQUIREMENT",
  "SEO_REQUIREMENT",
  "ASSET_REQUIREMENT",
  "INTERACTION_REQUIREMENT",
  "NON_FUNCTIONAL_CONSTRAINT",
  "EXPLICIT_EXCLUSION",
  "OTHER_PLANNING_RESPONSIBILITY",
]);
export type PlanningRequirementDisposition = z.infer<typeof PlanningRequirementDispositionSchema>;

export const PlanningTargetSectionSchema = z.enum([
  "profile",
  "productScope",
  "sitemap",
  "navigation",
  "pages",
  "userFlows",
  "forms",
  "dataModel",
  "authentication",
  "supabase",
  "email",
  "storage",
  "administration",
  "content",
  "assets",
  "architecture",
  "environment",
  "dependencies",
  "testStrategy",
  "security",
  "traceability",
]);
export type PlanningTargetSection = z.infer<typeof PlanningTargetSectionSchema>;

/**
 * Planning targets are host-issued references into the candidate package. A
 * requirement handle is deliberately not a target: it identifies the input
 * requirement, not the Planning responsibility that represents it.
 */
export const PlanningTargetRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("route"), routeHandle: PlanningRouteHandleSchema }).strict(),
  z.object({ kind: z.literal("page"), pageHandle: PlanningPageHandleSchema }).strict(),
  z.object({ kind: z.literal("section"), section: PlanningTargetSectionSchema }).strict(),
]);
export type PlanningTargetRef = z.infer<typeof PlanningTargetRefSchema>;

/**
 * OpenAI strict Structured Outputs does not support the `anyOf`/`allOf`
 * combination produced for a discriminated union containing refined handle
 * strings. The transport keeps the same typed discriminator and makes the
 * inactive fields explicit nulls; the host converts it to PlanningTargetRef
 * before admission.
 */
export const PlanningTargetRefTransportSchema = z.object({
  kind: z.enum(["route", "page", "section"]),
  routeHandle: z.string().max(320).nullable(),
  pageHandle: z.string().max(320).nullable(),
  section: PlanningTargetSectionSchema.nullable(),
}).strict();
export type PlanningTargetRefTransport = z.infer<typeof PlanningTargetRefTransportSchema>;

/** Host-issued target catalog. Providers return only targetHandle values. */
export const PlanningTargetCatalogEntrySchema = z.object({
  targetHandle: PlanningTargetHandleSchema,
  kind: z.enum(["route", "page", "section"]),
  label: NonEmptyStringSchema.max(300),
  path: RoutePathSchema.nullable(),
  routeHandle: PlanningRouteHandleSchema.nullable(),
  pageHandle: PlanningPageHandleSchema.nullable(),
  section: PlanningTargetSectionSchema.nullable(),
}).strict();
export type PlanningTargetCatalogEntry = z.infer<typeof PlanningTargetCatalogEntrySchema>;

export const PlanningTargetCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  targets: z.array(PlanningTargetCatalogEntrySchema).max(2048),
  catalogChecksum: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine((value, context) => {
  const handles = value.targets.map((target) => target.targetHandle);
  if (new Set(handles).size !== handles.length) context.addIssue({ code: "custom", path: ["targets"], message: "Planning target catalog contains duplicate handles." });
});
export type PlanningTargetCatalog = z.infer<typeof PlanningTargetCatalogSchema>;

export const PlanningTargetHandleRefSchema = z.object({ targetHandle: PlanningTargetHandleSchema }).strict();
export type PlanningTargetHandleRef = z.infer<typeof PlanningTargetHandleRefSchema>;

/** Provider payload: one keyed entry per host manifest handle, with no canonical identity. */
export const PlanningRecoverySemanticAccountingEntrySchema = z.object({
  disposition: PlanningRequirementDispositionSchema,
  planningTargetRefs: z.array(PlanningTargetHandleRefSchema).max(16),
  semanticEvidence: NonEmptyStringSchema.max(2000),
}).strict();
export type PlanningRecoverySemanticAccountingEntry = z.infer<typeof PlanningRecoverySemanticAccountingEntrySchema>;

/** Generic persistence/type boundary; production provider calls use the exact factory below. */
export const PlanningRecoverySemanticAccountingSchema = z.record(PlanningRequirementHandleSchema, PlanningRecoverySemanticAccountingEntrySchema);
export type PlanningRecoverySemanticAccounting = z.infer<typeof PlanningRecoverySemanticAccountingSchema>;

/** Read-only compatibility for the pre-keyed historical recovery envelope. */
export const PlanningRecoveryLegacySemanticAccountingEntrySchema = z.object({
  disposition: PlanningRequirementDispositionSchema,
  planningTargetRefs: z.array(PlanningTargetRefTransportSchema).min(1).max(16),
  semanticEvidence: NonEmptyStringSchema.max(2000),
}).strict();
export const PlanningRecoveryLegacySemanticAccountingSchema = z.array(PlanningRecoveryLegacySemanticAccountingEntrySchema).max(512);
export type PlanningRecoveryLegacySemanticAccounting = z.infer<typeof PlanningRecoveryLegacySemanticAccountingSchema>;

export function createPlanningRecoverySemanticAccountingSchema(manifest: Pick<PlanningOwnedRequirementManifest, "requirements">) {
  const shape: Record<string, typeof PlanningRecoverySemanticAccountingEntrySchema> = {};
  for (const entry of manifest.requirements) shape[entry.requirementHandle] = PlanningRecoverySemanticAccountingEntrySchema;
  return z.object(shape).strict();
}

/** Host-bound accounting. `requirementId` is added only after manifest binding. */
export const PlanningRecoveryRequirementAccountingEntrySchema = z.object({
  requirementId: SemanticRequirementIdSchema,
  requirementDomain: RequirementCategorySchema,
  disposition: PlanningRequirementDispositionSchema,
  planningTargetRefs: z.array(PlanningTargetRefSchema).min(1).max(16),
  semanticEvidence: NonEmptyStringSchema.max(2000),
}).strict();
export type PlanningRecoveryRequirementAccountingEntry = z.infer<typeof PlanningRecoveryRequirementAccountingEntrySchema>;

export const PlanningRecoveryRequirementAccountingSchema = z.array(PlanningRecoveryRequirementAccountingEntrySchema).max(512);
export type PlanningRecoveryRequirementAccounting = z.infer<typeof PlanningRecoveryRequirementAccountingSchema>;

export type PlanningRecoveryRequirementAccountingIssueCode =
  | "INVALID_ACCOUNTING_ENTRY"
  | "MISSING_REQUIREMENT_ID"
  | "DUPLICATE_REQUIREMENT_ID"
  | "MISSING_REQUIREMENT_ID_ACCOUNTING"
  | "LEGACY_REQUIREMENT_ID"
  | "ORPHAN_REQUIREMENT_ID"
  | "INVENTED_REQUIREMENT_ID"
  | "INVALID_REQUIREMENT_DOMAIN"
  | "MISSING_DISPOSITION"
  | "INVALID_DISPOSITION"
  | "MISSING_SEMANTIC_EVIDENCE"
  | "INVALID_COVERAGE_REFERENCE"
  | "ACCOUNTING_CARDINALITY_MISMATCH"
  | "INVALID_PLANNING_TARGET_REF"
  | "TARGET_NOT_IN_CANDIDATE"
  | "TARGET_TYPE_INCOMPATIBLE"
  | "TARGET_RELATIONSHIP_INVALID"
  | "PLACEHOLDER_SEMANTIC_EVIDENCE";

export type PlanningRecoveryRequirementAccountingIssue = {
  code: PlanningRecoveryRequirementAccountingIssueCode;
  requirementId?: string;
};

export type PlanningRecoveryRequirementAccountingValidation = {
  expectedRequirementCount: number;
  accountedRequirementCount: number;
  missingRequirementIds: string[];
  duplicateIdCount: number;
  legacyIdCount: number;
  orphanIdCount: number;
  issues: PlanningRecoveryRequirementAccountingIssue[];
};

export type PlanningRecoverySemanticAccountingBinding = {
  accounting: PlanningRecoveryRequirementAccounting;
  validation: PlanningRecoveryRequirementAccountingValidation;
};

const PLACEHOLDER_SEMANTIC_EVIDENCE = new Set(["covered", "implemented", "handled", "see plan", "same as requirement"]);

function normalizedEvidence(value: string) {
  return value.trim().toLocaleLowerCase("en").replace(/[.!?,;:]+$/g, "").replace(/\s+/g, " ");
}

function targetRefExistsInCandidate(input: {
  ref: PlanningTargetRef;
  candidate?: PlanningPackage;
  routeManifest?: Pick<CanonicalPlanningRouteManifest, "routes">;
}) {
  const ref = input.ref;
  if (ref.kind === "section") return !input.candidate || input.candidate[ref.section] !== undefined;
  const manifestRoute = ref.kind === "route"
    ? input.routeManifest?.routes.find((route) => route.routeHandle === ref.routeHandle)
    : ref.kind === "page"
      ? input.routeManifest?.routes.find((route) => route.pageHandle === ref.pageHandle)
      : undefined;
  if (!manifestRoute) return false;
  if (!input.candidate) return true;
  return ref.kind === "route"
    ? input.candidate.sitemap.routes.some((route) => route.path === manifestRoute.path)
    : input.candidate.pages.pages.some((page) => page.routeId === manifestRoute.routeId);
}

function bindPlanningTargetRef(value: PlanningTargetRefTransport): unknown {
  if (value.kind === "route" && value.routeHandle !== null && value.pageHandle === null && value.section === null) return { kind: "route", routeHandle: value.routeHandle };
  if (value.kind === "page" && value.routeHandle === null && value.pageHandle !== null && value.section === null) return { kind: "page", pageHandle: value.pageHandle };
  if (value.kind === "section" && value.routeHandle === null && value.pageHandle === null && value.section !== null) return { kind: "section", section: value.section };
  return value;
}

function targetRefKey(ref: PlanningTargetRef): string {
  return ref.kind === "route" ? `route:${ref.routeHandle}` : ref.kind === "page" ? `page:${ref.pageHandle}` : `section:${ref.section}`;
}

/**
 * Structural target compatibility only. A route is a first-class Planning
 * host for form dependencies and user-flow starts/steps, so interaction and
 * form responsibilities may be attached to it as well as to their page or
 * section representation. This does not infer semantic suitability.
 */
export const PLANNING_TARGET_KINDS_BY_DISPOSITION: Record<PlanningRequirementDisposition, readonly PlanningTargetRef["kind"][]> = {
  PAGE_RESPONSIBILITY: ["page", "section"],
  ROUTE_RESPONSIBILITY: ["route", "page"],
  ARCHITECTURE_CONSTRAINT: ["section"],
  FORM_CONSTRAINT: ["route", "page", "section"],
  CONTENT_REQUIREMENT: ["page", "section"],
  SEO_REQUIREMENT: ["route", "page", "section"],
  ASSET_REQUIREMENT: ["page", "section"],
  INTERACTION_REQUIREMENT: ["route", "page", "section"],
  NON_FUNCTIONAL_CONSTRAINT: ["section", "page"],
  EXPLICIT_EXCLUSION: ["section", "page"],
  OTHER_PLANNING_RESPONSIBILITY: ["route", "page", "section"],
};

function hostPreboundTargetRefs(requirementId: string, routeManifest?: Pick<CanonicalPlanningRouteManifest, "routes">): PlanningTargetRef[] {
  return (routeManifest?.routes ?? [])
    .filter((route) => [route.requirementIds, route.navigation.requirementIds, route.seo.requirementIds].some((requirements) => requirements.includes(requirementId)))
    .map((route) => ({ kind: "route" as const, routeHandle: route.routeHandle }));
}

function targetRoute(routeManifest: Pick<CanonicalPlanningRouteManifest, "routes"> | undefined, ref: PlanningTargetRef) {
  if (ref.kind === "route") return routeManifest?.routes.find((route) => route.routeHandle === ref.routeHandle);
  if (ref.kind === "page") return routeManifest?.routes.find((route) => route.pageHandle === ref.pageHandle);
  return undefined;
}

export function createPlanningTargetCatalog(routeManifest: Pick<CanonicalPlanningRouteManifest, "routes">): PlanningTargetCatalog {
  const targets: PlanningTargetCatalogEntry[] = [];
  const add = (entry: Omit<PlanningTargetCatalogEntry, "targetHandle">) => {
    const targetHandle = `planning-target:T${String(targets.length).padStart(3, "0")}`;
    targets.push(PlanningTargetCatalogEntrySchema.parse({ targetHandle, ...entry }));
  };
  for (const route of routeManifest.routes.filter((entry) => entry.required)) {
    add({ kind: "page", label: `Page ${route.path}`, path: route.path, routeHandle: null, pageHandle: route.pageHandle, section: null });
    add({ kind: "route", label: `Route ${route.path}`, path: route.path, routeHandle: route.routeHandle, pageHandle: null, section: null });
  }
  for (const section of PlanningTargetSectionSchema.options) {
    add({ kind: "section", label: `Planning section ${section}`, path: null, routeHandle: null, pageHandle: null, section });
  }
  const payload = { schemaVersion: 1 as const, targets };
  return PlanningTargetCatalogSchema.parse({ ...payload, catalogChecksum: checksumPersistedDocument(payload) });
}

function targetRefFromCatalogHandle(handle: string, catalog: PlanningTargetCatalog): PlanningTargetRef | undefined {
  const target = catalog.targets.find((entry) => entry.targetHandle === handle);
  if (!target) return undefined;
  return PlanningTargetRefSchema.safeParse(
    target.kind === "route" ? { kind: "route", routeHandle: target.routeHandle } : target.kind === "page" ? { kind: "page", pageHandle: target.pageHandle } : { kind: "section", section: target.section },
  ).data;
}

/**
 * Bind a keyed provider payload to the immutable host manifest. The provider
 * cannot supply, replace, omit, or append a canonical identity. Historical
 * positional payloads remain readable only for offline compatibility.
 */
export function bindPlanningRecoverySemanticAccounting(input: {
  semanticAccounting: unknown;
  manifest: Pick<PlanningOwnedRequirementManifest, "requirements">;
  candidate?: PlanningPackage;
  routeManifest?: Pick<CanonicalPlanningRouteManifest, "routes">;
  targetCatalog?: PlanningTargetCatalog;
}): PlanningRecoverySemanticAccountingBinding {
  const expected = input.manifest.requirements;
  const targetCatalog = input.targetCatalog ?? createPlanningTargetCatalog(input.routeManifest ?? { routes: [] });
  const keyed = createPlanningRecoverySemanticAccountingSchema(input.manifest).safeParse(input.semanticAccounting);
  const legacy = PlanningRecoveryLegacySemanticAccountingSchema.safeParse(input.semanticAccounting);
  if (!keyed.success && !legacy.success) {
    const raw = input.semanticAccounting && typeof input.semanticAccounting === "object" && !Array.isArray(input.semanticAccounting) ? input.semanticAccounting as Record<string, unknown> : {};
    const present = expected.filter((entry) => Object.prototype.hasOwnProperty.call(raw, entry.requirementHandle));
    const missingRequirementIds = expected.filter((entry) => !Object.prototype.hasOwnProperty.call(raw, entry.requirementHandle)).map((entry) => entry.requirementId);
    return {
      accounting: [],
      validation: {
        expectedRequirementCount: expected.length,
        accountedRequirementCount: present.length,
        missingRequirementIds,
        duplicateIdCount: 0,
        legacyIdCount: 0,
        orphanIdCount: 0,
        issues: [
          { code: "INVALID_ACCOUNTING_ENTRY" },
          ...missingRequirementIds.map((requirementId) => ({ code: "MISSING_REQUIREMENT_ID_ACCOUNTING" as const, requirementId })),
          ...((Object.keys(raw).length !== expected.length) ? [{ code: "ACCOUNTING_CARDINALITY_MISMATCH" as const }] : []),
        ],
      },
    };
  }
  const legacyEntries = legacy.success ? legacy.data : [];
  const accounting = expected.map((manifestEntry, index) => {
    const providerEntry = keyed.success ? keyed.data[manifestEntry.requirementHandle] : legacyEntries[index];
    const providerTargets = providerEntry?.planningTargetRefs ?? [];
    const boundTargets = PlanningTargetRefSchema.array().safeParse(providerTargets.map((target) => {
      if ("targetHandle" in target) return targetRefFromCatalogHandle(target.targetHandle, targetCatalog) ?? { kind: "route", routeHandle: "planning-route:unbound-target" };
      return bindPlanningTargetRef(target);
    }).filter((target): target is PlanningTargetRef => Boolean(target)));
    const prebound = hostPreboundTargetRefs(manifestEntry.requirementId, input.routeManifest);
    const targets = [...prebound, ...(boundTargets.success ? boundTargets.data : [])].filter((ref, targetIndex, refs) => refs.findIndex((candidate) => targetRefKey(candidate) === targetRefKey(ref)) === targetIndex);
    return {
      requirementId: manifestEntry.requirementId,
      requirementDomain: manifestEntry.category,
      disposition: providerEntry?.disposition,
      planningTargetRefs: targets,
      semanticEvidence: providerEntry?.semanticEvidence,
    };
  });
  const validation = validatePlanningRecoveryRequirementAccounting({
    accounting,
    manifest: input.manifest,
    candidate: input.candidate,
    routeManifest: input.routeManifest,
  });
  if (legacy.success && legacy.data.length !== expected.length) validation.issues.push({ code: "ACCOUNTING_CARDINALITY_MISMATCH" });
  return { accounting, validation };
}

/**
 * Validate the runtime identity binding that a static provider schema cannot
 * encode.  Semantic evidence is intentionally checked only for presence;
 * its quality remains the provider's semantic responsibility.
 */
export function validatePlanningRecoveryRequirementAccounting(input: {
  accounting: unknown;
  manifest: Pick<PlanningOwnedRequirementManifest, "requirements">;
  candidate?: PlanningPackage;
  routeManifest?: Pick<CanonicalPlanningRouteManifest, "routes">;
}): PlanningRecoveryRequirementAccountingValidation {
  const expected = new Map(input.manifest.requirements.map((entry) => [entry.requirementId, entry]));
  const issues: PlanningRecoveryRequirementAccountingIssue[] = [];
  const seen = new Map<string, number>();
  const entries = Array.isArray(input.accounting) ? input.accounting : [];
  if (!Array.isArray(input.accounting)) issues.push({ code: "INVALID_ACCOUNTING_ENTRY" });

  for (const raw of entries) {
    const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const requirementId = typeof value.requirementId === "string" ? value.requirementId : undefined;
    if (!requirementId) issues.push({ code: "MISSING_REQUIREMENT_ID" });
    else {
      seen.set(requirementId, (seen.get(requirementId) ?? 0) + 1);
      const expectedEntry = expected.get(requirementId);
      if (isLegacyRequirementId(requirementId)) issues.push({ code: "LEGACY_REQUIREMENT_ID", requirementId });
      else if (!expectedEntry) issues.push({ code: isV3RequirementId(requirementId) ? "INVENTED_REQUIREMENT_ID" : "ORPHAN_REQUIREMENT_ID", requirementId });
      const domain = RequirementCategorySchema.safeParse(value.requirementDomain);
      if (!domain.success || (expectedEntry && domain.data !== expectedEntry.category)) issues.push({ code: "INVALID_REQUIREMENT_DOMAIN", requirementId });
    }
    const disposition = value.disposition;
    if (typeof disposition !== "string" || !disposition.trim()) issues.push({ code: "MISSING_DISPOSITION", requirementId });
    else if (!PlanningRequirementDispositionSchema.safeParse(disposition).success) issues.push({ code: "INVALID_DISPOSITION", requirementId });
    if (typeof value.semanticEvidence !== "string" || !value.semanticEvidence.trim()) issues.push({ code: "MISSING_SEMANTIC_EVIDENCE", requirementId });
    const targetRefs = value.planningTargetRefs;
    const parsedTargets = PlanningTargetRefSchema.array().safeParse(targetRefs);
    if (!parsedTargets.success || parsedTargets.data.length === 0) issues.push({ code: "INVALID_PLANNING_TARGET_REF", requirementId });
    else {
      const missingTarget = parsedTargets.data.some((ref) => !targetRefExistsInCandidate({ ref, candidate: input.candidate, routeManifest: input.routeManifest }));
      if (missingTarget) issues.push({ code: "TARGET_NOT_IN_CANDIDATE", requirementId });
      const expectedEntry = requirementId ? expected.get(requirementId) : undefined;
      if (expectedEntry && typeof disposition === "string" && PlanningRequirementDispositionSchema.safeParse(disposition).success) {
        const allowedKinds = PLANNING_TARGET_KINDS_BY_DISPOSITION[disposition as PlanningRequirementDisposition];
        if (parsedTargets.data.some((ref) => !allowedKinds.includes(ref.kind))) issues.push({ code: "TARGET_TYPE_INCOMPATIBLE", requirementId });
      }
      if (requirementId) {
        const prebound = hostPreboundTargetRefs(requirementId, input.routeManifest);
        const selected = new Set(parsedTargets.data.map(targetRefKey));
        const missingPrebinding = prebound.some((ref) => !selected.has(targetRefKey(ref)));
        const preboundRouteHandles = new Set(prebound.map((ref) => ref.kind === "route" ? ref.routeHandle : ""));
        const contradictoryRoute = parsedTargets.data.some((ref) => {
          const route = targetRoute(input.routeManifest, ref);
          return Boolean(route && prebound.length > 0 && !preboundRouteHandles.has(route.routeHandle));
        });
        if (missingPrebinding || contradictoryRoute) issues.push({ code: "TARGET_RELATIONSHIP_INVALID", requirementId });
      }
    }
    if (typeof value.semanticEvidence === "string" && PLACEHOLDER_SEMANTIC_EVIDENCE.has(normalizedEvidence(value.semanticEvidence))) issues.push({ code: "PLACEHOLDER_SEMANTIC_EVIDENCE", requirementId });
  }

  let duplicateIdCount = 0;
  for (const [requirementId, count] of seen) {
    if (count > 1) {
      duplicateIdCount++;
      issues.push(...Array.from({ length: count - 1 }, () => ({ code: "DUPLICATE_REQUIREMENT_ID" as const, requirementId })));
    }
  }
  const missingRequirementIds = [...expected.keys()].filter((requirementId) => !seen.has(requirementId));
  issues.push(...missingRequirementIds.map((requirementId) => ({ code: "MISSING_REQUIREMENT_ID_ACCOUNTING" as const, requirementId })));
  return {
    expectedRequirementCount: expected.size,
    accountedRequirementCount: [...seen.keys()].filter((requirementId) => expected.has(requirementId)).length,
    missingRequirementIds,
    duplicateIdCount,
    legacyIdCount: issues.filter((issue) => issue.code === "LEGACY_REQUIREMENT_ID").length,
    orphanIdCount: issues.filter((issue) => issue.code === "ORPHAN_REQUIREMENT_ID" || issue.code === "INVENTED_REQUIREMENT_ID").length,
    issues,
  };
}

export const PLANNING_RECOVERY_OUTPUT_POLICY = {
  schemaVersion: 1,
  maxBytes: 512_000,
  maxEstimatedTokens: 64_000,
  complete: true,
  truncation: "REJECT",
} as const;

export const PlanningRecoveryOutputPolicySchema = z.object({
  schemaVersion: z.literal(1),
  maxBytes: z.number().int().positive(),
  maxEstimatedTokens: z.number().int().positive(),
  complete: z.literal(true),
  truncation: z.literal("REJECT"),
}).strict();

const PLANNING_NON_OWNED_CATEGORIES = new Set<RequirementCategory>(["LEGAL_FACT", "LOGO_METADATA", "IMAGE_NOTE", "RECOMMENDATION"]);

export function canonicalPagePath(slug: string): string {
  return slug === "home" || slug === "index" ? "/" : `/${slug.replace(/^\//, "").replace(/[^a-z0-9-]/gi, "-").toLocaleLowerCase("en")}`;
}

function planningRouteId(path: string): string {
  return `route-${path === "/" ? "home" : path.slice(1).replaceAll("/", "-")}`;
}

function planningPageId(path: string): string {
  return `page-${planningRouteId(path)}`;
}

function legalPage(slug: string, purpose: string): boolean {
  return /(?:legal|privacy|imprint|terms|compliance|notice|recht|datenschutz|impressum)/i.test(`${slug} ${purpose}`);
}

function routeMetadata(brief: CanonicalBriefV3, path: string) {
  return brief.seo.pageMetadata.filter((metadata) => metadata.route === path);
}

export function createCanonicalPlanningRouteManifest(input: CanonicalBriefV3): CanonicalPlanningRouteManifest {
  const brief = CanonicalBriefV3Schema.parse(input);
  const routes = brief.pages.map((page) => {
    const path = canonicalPagePath(page.slug);
    const legal = legalPage(page.slug, page.purpose);
    const metadata = routeMetadata(brief, path);
    const metadataRequirementIds: string[] = [];
    return CanonicalPlanningRouteManifestEntrySchema.parse({
      routeHandle: `planning-route:${page.id}`,
      pageHandle: `planning-page:${page.id}`,
      routeId: planningRouteId(path),
      planningPageId: planningPageId(path),
      pageId: page.id,
      path,
      pagePurpose: page.purpose,
      pageRole: legal ? "legal" : "content",
      legal,
      required: true,
      parentPageId: null,
      navigation: { participation: "NOT_SPECIFIED", requirementIds: [] },
      seo: { required: metadata.length > 0, metadata, requirementIds: metadataRequirementIds },
      requirementIds: [],
    });
  });
  const payload = { schemaVersion: 1 as const, routePolicy: brief.decisions.routePolicy.mode, routes };
  return CanonicalPlanningRouteManifestSchema.parse({ ...payload, manifestChecksum: checksumPersistedDocument(payload) });
}

function requirementOrigin(brief: CanonicalBriefV3, id: string): "brief.requirements" | "decisions.form.interactionStates" | "seo.locationTargeting" {
  if (brief.requirements.some((entry) => entry.id === id)) return "brief.requirements";
  if (brief.decisions.form.interactionStates.some((entry) => entry.id === id)) return "decisions.form.interactionStates";
  return "seo.locationTargeting";
}

export function createPlanningOwnedRequirementManifest(input: CanonicalBriefV3): PlanningOwnedRequirementManifest {
  const brief = CanonicalBriefV3Schema.parse(input);
  const entries = canonicalRequirementEntries(brief).filter((entry) => !PLANNING_NON_OWNED_CATEGORIES.has(entry.category) || entry.sourceRefs.includes(CUSTOMER_UX_SOURCE_REF)).map((entry, position) => ({
    requirementHandle: `planning-requirement:R${String(position).padStart(3, "0")}`,
    requirementId: entry.id,
    category: entry.category,
    statement: entry.statement,
    sourceRefs: [...entry.sourceRefs],
    evidencePolicy: "SEMANTIC_EVIDENCE_REQUIRED" as const,
    traceabilityPolicy: "TRACEABILITY_REFERENCE_REQUIRED" as const,
    origin: requirementOrigin(brief, entry.id),
  }));
  const payload = { schemaVersion: 1 as const, requirements: entries };
  return PlanningOwnedRequirementManifestSchema.parse({ ...payload, manifestChecksum: checksumPersistedDocument(payload) });
}

export function requirementManifestAsCanonicalRequirements(manifest: PlanningOwnedRequirementManifest): CanonicalRequirement[] {
  return manifest.requirements.map((entry) => CanonicalRequirementSchema.parse({ id: entry.requirementId, category: entry.category, statement: entry.statement, sourceRefs: entry.sourceRefs }));
}
