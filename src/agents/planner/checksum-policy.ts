import { z } from "zod";

/**
 * Planning packages created before the checksum-domain repair do not carry a
 * policy discriminator. Their historical semantic checksums remain readable
 * through the legacy projection selected by an absent value.
 */
export const PLANNING_SEMANTIC_CHECKSUM_POLICY_LEGACY = "planning-semantic-v1-envelope-inclusive" as const;
export const PLANNING_SEMANTIC_CHECKSUM_POLICY_CURRENT = "planning-semantic-v2-semantic-only" as const;

export const PlanningSemanticChecksumPolicyVersionSchema = z.enum([
  PLANNING_SEMANTIC_CHECKSUM_POLICY_LEGACY,
  PLANNING_SEMANTIC_CHECKSUM_POLICY_CURRENT,
]);

export type PlanningSemanticChecksumPolicyVersion = z.infer<typeof PlanningSemanticChecksumPolicyVersionSchema>;
