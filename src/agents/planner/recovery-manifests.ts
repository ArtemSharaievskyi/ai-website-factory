import { CanonicalBriefV3Schema, CanonicalRequirementSchema, RequirementCategorySchema, RoutePolicySchema, SemanticPageIdSchema, SemanticRequirementIdSchema, type CanonicalBriefV3, type CanonicalRequirement, type RequirementCategory } from "@/domain/requirements/v3/schema";
import { canonicalRequirementEntries, isLegacyRequirementId, isV3RequirementId } from "@/domain/requirements/v3/identity";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { NonEmptyStringSchema } from "@/domain/shared/schemas";
import { z } from "zod";

const RoutePathSchema = z.string().regex(/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/);
const HandleSchema = NonEmptyStringSchema.max(320).regex(/^planning-(?:route|page|requirement):/);
const SourceRefListSchema = z.array(NonEmptyStringSchema.max(200)).min(1);

export const PlanningRouteHandleSchema = HandleSchema.regex(/^planning-route:/);
export const PlanningPageHandleSchema = HandleSchema.regex(/^planning-page:/);
export const PlanningRequirementHandleSchema = HandleSchema.regex(/^planning-requirement:/);

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

export const PlanningRecoveryRequirementAccountingEntrySchema = z.object({
  requirementId: SemanticRequirementIdSchema,
  requirementDomain: RequirementCategorySchema,
  disposition: PlanningRequirementDispositionSchema,
  coveredBy: z.array(NonEmptyStringSchema.max(240)).min(1).max(16),
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
  | "INVALID_COVERAGE_REFERENCE";

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

/**
 * Validate the runtime identity binding that a static provider schema cannot
 * encode.  Semantic evidence is intentionally checked only for presence;
 * its quality remains the provider's semantic responsibility.
 */
export function validatePlanningRecoveryRequirementAccounting(input: {
  accounting: unknown;
  manifest: Pick<PlanningOwnedRequirementManifest, "requirements">;
  allowedCoverageRefs?: readonly string[];
}): PlanningRecoveryRequirementAccountingValidation {
  const expected = new Map(input.manifest.requirements.map((entry) => [entry.requirementId, entry]));
  const allowedCoverageRefs = new Set([
    ...input.manifest.requirements.map((entry) => entry.requirementHandle),
    ...(input.allowedCoverageRefs ?? []),
  ]);
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
    const coveredBy = value.coveredBy;
    if (!Array.isArray(coveredBy) || coveredBy.length === 0 || coveredBy.some((reference) => typeof reference !== "string" || !reference.trim() || !allowedCoverageRefs.has(reference))) issues.push({ code: "INVALID_COVERAGE_REFERENCE", requirementId });
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
  const entries = canonicalRequirementEntries(brief).filter((entry) => !PLANNING_NON_OWNED_CATEGORIES.has(entry.category)).map((entry) => ({
    requirementHandle: `planning-requirement:${entry.id}`,
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
