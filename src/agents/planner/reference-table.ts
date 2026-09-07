import { z } from "zod";
import { CanonicalBriefV3Schema, RequirementCategorySchema, SemanticPageIdSchema, SemanticRequirementIdSchema, type CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import { canonicalRequirementEntries } from "@/domain/requirements/v3/identity";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { NonEmptyStringSchema } from "@/domain/shared/schemas";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { createCanonicalPlanningRouteManifest, createPlanningOwnedRequirementManifest } from "./recovery-manifests";

const PlannerRequirementTokenSchema = z.string().regex(/^REQ_\d{3,}$/);
const PlannerPageTokenSchema = z.string().regex(/^PAGE_\d{3,}$/);
const PlannerRouteTokenSchema = z.string().regex(/^ROUTE_\d{3,}$/);
const RoutePathSchema = z.string().regex(/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/);
const ChecksumSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const PLANNER_PROVIDER_CONTRACT_VERSION = "planner.v3" as const;

export const PlannerReferenceTableRequirementSchema = z.object({
  token: PlannerRequirementTokenSchema,
  canonicalRequirementId: SemanticRequirementIdSchema,
  summary: NonEmptyStringSchema.max(4000),
  category: RequirementCategorySchema,
  mandatory: z.boolean(),
}).strict();

export const PlannerReferenceTablePageSchema = z.object({
  token: PlannerPageTokenSchema,
  canonicalPageId: SemanticPageIdSchema,
  planningPageId: NonEmptyStringSchema,
  path: RoutePathSchema,
  purpose: NonEmptyStringSchema.max(2000),
}).strict();

export const PlannerReferenceTableRouteSchema = z.object({
  token: PlannerRouteTokenSchema,
  canonicalRouteId: NonEmptyStringSchema,
  pageToken: PlannerPageTokenSchema,
  canonicalPageId: SemanticPageIdSchema,
  parentPageId: SemanticPageIdSchema.nullable(),
  path: RoutePathSchema,
  purpose: NonEmptyStringSchema.max(2000),
}).strict();

export const PlannerReferenceTableSchema = z.object({
  schemaVersion: z.literal(1),
  providerContractVersion: z.literal(PLANNER_PROVIDER_CONTRACT_VERSION),
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  approvedBriefChecksum: ChecksumSchema,
  operationChecksum: ChecksumSchema,
  requirements: z.array(PlannerReferenceTableRequirementSchema).min(1).max(512),
  pages: z.array(PlannerReferenceTablePageSchema).min(1).max(256),
  routes: z.array(PlannerReferenceTableRouteSchema).min(1).max(256),
  referenceTableChecksum: ChecksumSchema,
}).strict().superRefine((value, context) => {
  const unique = (path: string, values: readonly string[]) => {
    if (new Set(values).size !== values.length)
      context.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: `Planner reference table contains duplicate ${path}.` });
  };
  unique("requirements.token", value.requirements.map((entry) => entry.token));
  unique("requirements.canonicalRequirementId", value.requirements.map((entry) => entry.canonicalRequirementId));
  unique("pages.token", value.pages.map((entry) => entry.token));
  unique("pages.canonicalPageId", value.pages.map((entry) => entry.canonicalPageId));
  unique("routes.token", value.routes.map((entry) => entry.token));
  unique("routes.canonicalRouteId", value.routes.map((entry) => entry.canonicalRouteId));
  unique("routes.path", value.routes.map((entry) => entry.path));
  const pages = new Set(value.pages.map((entry) => entry.token));
  if (value.routes.some((entry) => !pages.has(entry.pageToken)))
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["routes"], message: "Every Planner route token must bind to a current Planner page token." });
});
export type PlannerReferenceTable = z.infer<typeof PlannerReferenceTableSchema>;

export const PlannerProviderReferenceProtocolSchema = z.object({
  protocolVersion: z.literal(PLANNER_PROVIDER_CONTRACT_VERSION),
  requirements: z.array(z.object({ token: PlannerRequirementTokenSchema, summary: NonEmptyStringSchema.max(4000), category: RequirementCategorySchema, mandatory: z.boolean() }).strict()).min(1).max(512),
  pages: z.array(z.object({ token: PlannerPageTokenSchema, path: RoutePathSchema, purpose: NonEmptyStringSchema.max(2000) }).strict()).min(1).max(256),
  routes: z.array(z.object({ token: PlannerRouteTokenSchema, pageToken: PlannerPageTokenSchema, path: RoutePathSchema, purpose: NonEmptyStringSchema.max(2000) }).strict()).min(1).max(256),
  requiredRequirementTokens: z.array(PlannerRequirementTokenSchema).max(512),
}).strict();
export type PlannerProviderReferenceProtocol = z.infer<typeof PlannerProviderReferenceProtocolSchema>;

export class PlannerReferenceTableError extends Error {
  constructor(readonly code: "PLANNER_REFERENCE_TABLE_INVALID" | "PLANNER_REFERENCE_TABLE_STALE") {
    super(code);
    this.name = "PlannerReferenceTableError";
  }
}

const token = (prefix: "REQ" | "PAGE" | "ROUTE", index: number) => `${prefix}_${String(index + 1).padStart(3, "0")}`;

export function createPlannerReferenceTable(input: {
  projectId: string;
  projectVersion: number;
  approvedBriefChecksum: string;
  idempotencyKey: string;
  expectedRowVersion: number;
  canonicalBrief: CanonicalBriefV3;
}): PlannerReferenceTable {
  const brief = CanonicalBriefV3Schema.parse(input.canonicalBrief);
  if (canonicalBriefChecksum(brief) !== input.approvedBriefChecksum)
    throw new PlannerReferenceTableError("PLANNER_REFERENCE_TABLE_INVALID");
  const planningRequirements = new Set(createPlanningOwnedRequirementManifest(brief).requirements.map((entry) => entry.requirementId));
  const requirements = canonicalRequirementEntries(brief)
    .slice()
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((entry, index) => ({ token: token("REQ", index), canonicalRequirementId: entry.id, summary: entry.statement, category: entry.category, mandatory: planningRequirements.has(entry.id) }));
  const manifestRoutes = createCanonicalPlanningRouteManifest(brief).routes
    .slice()
    .sort((left, right) => left.path.localeCompare(right.path) || left.pageId.localeCompare(right.pageId));
  const pages = manifestRoutes.map((route, index) => ({ token: token("PAGE", index), canonicalPageId: route.pageId, planningPageId: route.planningPageId, path: route.path, purpose: route.pagePurpose }));
  const pageTokenById = new Map(pages.map((page) => [page.canonicalPageId, page.token]));
  const routes = manifestRoutes.map((route, index) => ({ token: token("ROUTE", index), canonicalRouteId: route.routeId, pageToken: pageTokenById.get(route.pageId)!, canonicalPageId: route.pageId, parentPageId: route.parentPageId, path: route.path, purpose: route.pagePurpose }));
  const operationChecksum = checksumPersistedDocument({ idempotencyKey: input.idempotencyKey, expectedRowVersion: input.expectedRowVersion });
  const payload = {
    schemaVersion: 1 as const,
    providerContractVersion: PLANNER_PROVIDER_CONTRACT_VERSION,
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    approvedBriefChecksum: input.approvedBriefChecksum,
    operationChecksum,
    requirements,
    pages,
    routes,
  };
  return PlannerReferenceTableSchema.parse({ ...payload, referenceTableChecksum: checksumPersistedDocument(payload) });
}

/** Exact host comparison; no aliases, prefixes, or best-effort repairs are accepted. */
export function assertPlannerReferenceTableCurrent(table: PlannerReferenceTable, input: Parameters<typeof createPlannerReferenceTable>[0]) {
  const parsed = PlannerReferenceTableSchema.safeParse(table);
  if (!parsed.success) throw new PlannerReferenceTableError("PLANNER_REFERENCE_TABLE_INVALID");
  const expected = createPlannerReferenceTable(input);
  if (parsed.data.referenceTableChecksum !== expected.referenceTableChecksum || checksumPersistedDocument(parsed.data) !== checksumPersistedDocument(expected))
    throw new PlannerReferenceTableError("PLANNER_REFERENCE_TABLE_STALE");
  return parsed.data;
}

/** This is the only reference material sent to the Planner provider. */
export function plannerProviderReferenceProtocol(table: PlannerReferenceTable): PlannerProviderReferenceProtocol {
  const parsed = PlannerReferenceTableSchema.parse(table);
  return PlannerProviderReferenceProtocolSchema.parse({
    protocolVersion: PLANNER_PROVIDER_CONTRACT_VERSION,
    requirements: parsed.requirements.map(({ token: requirementToken, summary, category, mandatory }) => ({ token: requirementToken, summary, category, mandatory })),
    pages: parsed.pages.map(({ token: pageToken, path, purpose }) => ({ token: pageToken, path, purpose })),
    routes: parsed.routes.map(({ token: routeToken, pageToken, path, purpose }) => ({ token: routeToken, pageToken, path, purpose })),
    requiredRequirementTokens: parsed.requirements.filter((entry) => entry.mandatory).map((entry) => entry.token),
  });
}

export const PlannerRequirementToken = PlannerRequirementTokenSchema;
export const PlannerPageToken = PlannerPageTokenSchema;
export const PlannerRouteToken = PlannerRouteTokenSchema;
