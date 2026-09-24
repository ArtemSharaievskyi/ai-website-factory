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

export const FontpairNormalizedPairSchema = z.object({
  pairingId: z.string().min(1).max(160),
  displayFamily: z.string().min(1).max(120),
  bodyFamily: z.string().min(1).max(120),
  sourceTypes: z.array(z.enum(["google-fonts", "fontshare", "other-free"])).min(1).max(3),
  styleUseCase: z.string().min(1).max(240),
  sourceUrl: z.string().url(),
  sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  normalizedChecksum: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type FontpairNormalizedPair = z.infer<typeof FontpairNormalizedPairSchema>;

export const DesignSourceCandidateSchema = z.object({
  candidateId: z.string().regex(/^[a-z0-9-]+$/),
  source: z.enum(["twenty-first-dev", "react-bits", "magic-ui", "shadcn-ui"]),
  componentIdentity: z.string().min(1).max(180),
  category: z.string().min(1).max(100),
  purpose: z.string().min(1).max(300),
  dependencies: z.array(z.string().max(160)).max(20),
  motionCharacteristics: z.string().max(240),
  compatibility: z.enum(["compatible", "adaptation-required", "incompatible"]),
  sourceReference: z.string().url(),
  sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  retrievedAt: z.string().datetime(),
  freePolicy: z.enum(["FREE_OPEN_SOURCE", "FREE_PUBLIC_READ_ONLY", "EXISTING_APPROVED"]),
  disposition: z.enum(["USED_FOR_RESEARCH_NOT_SELECTED", "USED_AND_SELECTED", "USED_AND_REJECTED_WITH_REASON", "NOT_APPLICABLE_AFTER_ANALYSIS"]),
  decisionReason: z.string().min(1).max(300),
}).strict();
export type DesignSourceCandidate = z.infer<typeof DesignSourceCandidateSchema>;

export const DesignSourceResearchSchema = z.object({
  source: z.enum(["twenty-first-dev", "react-bits", "magic-ui", "shadcn-ui"]),
  query: z.string().min(1).max(200),
  sourceReference: z.string().url(),
  sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  retrievedAt: z.string().datetime(),
  liveEvidence: z.boolean(),
  writeAuthority: z.literal("NONE"),
  candidates: z.array(DesignSourceCandidateSchema).min(1).max(12),
}).strict();
export type DesignSourceResearch = z.infer<typeof DesignSourceResearchSchema>;

export const ImpeccableFindingSchema = z.object({ ruleId: z.string().regex(/^[a-z0-9-]+$/), severity: z.enum(["error", "warning", "info"]), path: z.string().min(1).max(240), summary: z.string().max(500) }).strict();
export type ImpeccableFinding = z.infer<typeof ImpeccableFindingSchema>;
export const ImpeccableDetectorResultSchema = z.object({ toolId: z.literal("impeccable"), status: z.enum(["PASS", "FAIL"]), findings: z.array(ImpeccableFindingSchema).max(200), sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/), detectorVersion: z.string().min(1) }).strict();
export type ImpeccableDetectorResult = z.infer<typeof ImpeccableDetectorResultSchema>;

export const ApprovedDesignSkillEvidenceSchema = z.object({
  skillId: z.string().min(1),
  officialRepository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  externalSkillId: z.string().min(1).optional(),
  status: z.enum(["APPROVED_IMMUTABLE", "NOT_AVAILABLE", "CHECKSUM_MISMATCH"]),
  sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  normalizedContentChecksum: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  retrievedContentChecksum: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/).optional(),
  license: z.string().min(1).optional(),
  reviewedAt: z.string().datetime().optional(),
  approvedDirectory: z.string().min(1).optional(),
}).strict();
export type ApprovedDesignSkillEvidence = z.infer<typeof ApprovedDesignSkillEvidenceSchema>;
