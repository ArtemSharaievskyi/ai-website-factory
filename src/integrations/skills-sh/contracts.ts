import { z } from "zod";

export const SKILLS_SH_SOURCE_ID = "skills-sh" as const;
export const SKILLS_SH_ORIGIN = "https://skills.sh" as const;
const ExternalId = z
  .string()
  .regex(/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+){1,3}$/);
const Hash = z.string().regex(/^[a-f0-9]{64}$/i);
export const SkillsShSourceSchema = z
  .object({
    sourceId: z.literal(SKILLS_SH_SOURCE_ID),
    sourceKind: z.literal("external-skill-catalog"),
    displayName: z.literal("skills.sh"),
    originPolicy: z.literal(SKILLS_SH_ORIGIN),
    fetchPolicy: z
      .object({
        maxResponseBytes: z.number().int().positive(),
        maxFiles: z.number().int().positive(),
        maxFileBytes: z.number().int().positive(),
        timeoutMs: z.number().int().positive(),
        maxRetries: z.number().int().nonnegative(),
        maxRedirects: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type SkillsShSource = z.infer<typeof SkillsShSourceSchema>;
export const SkillsShDescriptorSchema = z
  .object({
    externalSkillId: ExternalId,
    sourceId: z.literal(SKILLS_SH_SOURCE_ID),
    name: z.string().min(1).max(200),
    slug: z.string().min(1).max(120),
    summary: z.string().max(2000).optional(),
    source: z.string().min(1).max(300),
    sourceVersion: z.string().max(200).optional(),
    canonicalSourceRef: z.string().url(),
    contentChecksum: Hash.optional(),
    discoveredAt: z.string().datetime(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type SkillsShDescriptor = z.infer<typeof SkillsShDescriptorSchema>;
export const SkillsShSkillSummarySchema = z
  .object({
    id: ExternalId,
    slug: z.string().min(1).max(120),
    name: z.string().min(1).max(200),
    source: z.string().min(1).max(300),
    installs: z.number().int().nonnegative(),
    sourceType: z.enum(["github", "well-known"]),
    installUrl: z.string().url().nullable(),
    url: z.string().url(),
    isDuplicate: z.boolean().optional(),
    installsYesterday: z.number().int().nonnegative().optional(),
    change: z.number().int().optional(),
  })
  .strict();
export type SkillsShSkillSummary = z.infer<typeof SkillsShSkillSummarySchema>;
export const SkillsShPaginationSchema = z
  .object({
    page: z.number().int().nonnegative(),
    perPage: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  })
  .strict();
export type SkillsShPagination = z.infer<typeof SkillsShPaginationSchema>;
export const SkillsShListResponseSchema = z
  .object({
    data: z.array(SkillsShSkillSummarySchema),
    pagination: SkillsShPaginationSchema,
  })
  .strict();
export type SkillsShListResponse = z.infer<typeof SkillsShListResponseSchema>;
export const SkillsShSearchResponseSchema = z
  .object({
    data: z.array(SkillsShSkillSummarySchema),
    query: z.string(),
    count: z.number().int().nonnegative(),
    searchType: z.enum(["fuzzy", "semantic"]),
    durationMs: z.number().nonnegative(),
  })
  .strict();
export type SkillsShSearchResponse = z.infer<
  typeof SkillsShSearchResponseSchema
>;
export const SkillsShFileSchema = z
  .object({ path: z.string().min(1).max(500), contents: z.string() })
  .strict();
export const SkillsShDetailResponseSchema = z
  .object({
    id: ExternalId,
    source: z.string().min(1),
    slug: z.string().min(1),
    installs: z.number().int().nonnegative(),
    hash: z.string().min(1).nullable(),
    files: z.array(SkillsShFileSchema).nullable(),
  })
  .strict();
export type SkillsShDetailResponse = z.infer<
  typeof SkillsShDetailResponseSchema
>;
export const SkillsShAuditEntrySchema = z
  .object({
    provider: z.string().min(1),
    slug: z.string().min(1),
    status: z.enum(["pass", "warn", "fail"]),
    summary: z.string().max(2000),
    auditedAt: z.string().datetime({ offset: true, local: true }),
    riskLevel: z
      .enum(["SAFE", "NONE", "LOW", "MEDIUM", "HIGH", "CRITICAL"])
      .nullable()
      .optional(),
    categories: z.array(z.string()).optional(),
  })
  .strict();
export type SkillsShAuditEntry = z.infer<typeof SkillsShAuditEntrySchema>;
export const SkillsShAuditResponseSchema = z
  .object({
    id: ExternalId,
    source: z.string().min(1),
    slug: z.string().min(1),
    audits: z.array(SkillsShAuditEntrySchema),
  })
  .strict();
export type SkillsShAuditResponse = z.infer<
  typeof SkillsShAuditResponseSchema
>;
export const SkillsShAuditResultSchema = z
  .object({
    available: z.boolean(),
    response: SkillsShAuditResponseSchema.optional(),
    reason: z.string().max(500).optional(),
  })
  .strict();
export type SkillsShAuditResult = z.infer<typeof SkillsShAuditResultSchema>;
export const SkillsShCandidateSchema = z
  .object({
    descriptor: SkillsShDescriptorSchema,
    files: z.array(SkillsShFileSchema).min(1),
    retrievedAt: z.string().datetime(),
    retrievedContentChecksum: Hash,
    normalizedContentChecksum: Hash,
  })
  .strict();
export type SkillsShCandidate = z.infer<typeof SkillsShCandidateSchema>;

export type SkillsShHttpResponse = {
  status: number;
  headers: Record<string, string | undefined>;
  body: string;
};
export type SkillsShHttpTransport = (
  url: string,
  input: { signal: AbortSignal; headers?: Record<string, string> },
) => Promise<SkillsShHttpResponse>;
export const DEFAULT_SKILLS_SH_SOURCE = SkillsShSourceSchema.parse({
  sourceId: SKILLS_SH_SOURCE_ID,
  sourceKind: "external-skill-catalog",
  displayName: "skills.sh",
  originPolicy: SKILLS_SH_ORIGIN,
  fetchPolicy: {
    maxResponseBytes: 2_000_000,
    maxFiles: 100,
    maxFileBytes: 500_000,
    timeoutMs: 10_000,
    maxRetries: 2,
    maxRedirects: 0,
  },
});
