import { RequirementSpecificationSchema, type RequirementSpecification } from "../schema";

export type ReadLegacyHistoryEntry = NonNullable<RequirementSpecification["requirementHistory"]>[number];

/** Read retained legacy provenance without placing it into V3 current state. */
export function readLegacyRequirementHistory(input: unknown): readonly ReadLegacyHistoryEntry[] {
  const brief = RequirementSpecificationSchema.parse(input);
  return brief.requirementHistory ?? [];
}
