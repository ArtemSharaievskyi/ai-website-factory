import { z } from "zod";
import { DesignCapabilityAvailabilitySchema, DesignToolIdSchema } from "@/domain/design/capability";

export const DesignHttpResponseSchema = z.object({ status: z.number().int().nonnegative(), headers: z.record(z.string(), z.string().optional()), body: z.string() }).strict();
export type DesignHttpResponse = z.infer<typeof DesignHttpResponseSchema>;
export type DesignHttpTransport = (url: string, input: { method: "GET" | "POST"; signal: AbortSignal; headers: Record<string, string>; body?: string }) => Promise<DesignHttpResponse>;

export const DesignAdapterResultSchema = z.object({
  toolId: DesignToolIdSchema,
  status: DesignCapabilityAvailabilitySchema,
  summary: z.string().max(1000),
  evidenceId: z.string().min(1).max(200),
  responseChecksum: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  retrievedAt: z.string().datetime(),
}).strict();
export type DesignAdapterResult = z.infer<typeof DesignAdapterResultSchema>;

export const MagicPatternsArtifactSchema = z.object({
  artifactId: z.string().min(1).max(200),
  editorUrl: z.string().url().optional(),
  previewUrl: z.string().url().optional(),
  sourceFileNames: z.array(z.string().min(1).max(240)).max(100),
  responseChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().datetime(),
}).strict();
export type MagicPatternsArtifact = z.infer<typeof MagicPatternsArtifactSchema>;

export const FontpairNormalizedPairSchema = z.object({
  displayFamily: z.string().min(1).max(120),
  bodyFamily: z.string().min(1).max(120),
  sourceUrl: z.string().url(),
  sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  normalizedChecksum: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type FontpairNormalizedPair = z.infer<typeof FontpairNormalizedPairSchema>;

export const ImpeccableFindingSchema = z.object({ ruleId: z.string().regex(/^[a-z0-9-]+$/), severity: z.enum(["error", "warning", "info"]), path: z.string().min(1).max(240), summary: z.string().max(500) }).strict();
export type ImpeccableFinding = z.infer<typeof ImpeccableFindingSchema>;
export const ImpeccableDetectorResultSchema = z.object({ toolId: z.literal("impeccable"), status: z.enum(["PASS", "FAIL"]), findings: z.array(ImpeccableFindingSchema).max(200), sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/), detectorVersion: z.string().min(1) }).strict();
export type ImpeccableDetectorResult = z.infer<typeof ImpeccableDetectorResultSchema>;

export const ApprovedDesignSkillEvidenceSchema = z.object({
  skillId: z.string().min(1),
  officialRepository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  status: z.enum(["APPROVED_IMMUTABLE", "NOT_AVAILABLE", "CHECKSUM_MISMATCH"]),
  sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  approvedDirectory: z.string().min(1).optional(),
}).strict();
export type ApprovedDesignSkillEvidence = z.infer<typeof ApprovedDesignSkillEvidenceSchema>;
