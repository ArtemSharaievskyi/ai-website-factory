import { createHash } from "node:crypto";
import { z } from "zod";
import { createV3RequirementId } from "./identity";
import { CanonicalRequirementSchema, CanonicalRequirementValueSchema, CustomerUxDirectionSchema, type CanonicalRequirement, type CustomerUxDirection } from "./schema";
import { stableSerialize, compareStrings } from "./serialization";

const CustomerUxDirectionDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const CUSTOMER_UX_SOURCE_REF = "customer-confirmation:ux-direction";

export const CustomerUxDirectionCorrectionInputSchema = z.object({
  kind: z.literal("DETERMINISTIC_CUSTOMER_UX_DIRECTION"),
  direction: CustomerUxDirectionSchema,
  expectedPreviousDigest: CustomerUxDirectionDigestSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.direction.metadata.status !== "ACTIVE") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["direction", "metadata", "status"], message: "A current customer UX direction must be ACTIVE." });
  }
}).transform((value) => ({
  ...value,
  direction: normalizeCustomerUxDirection(value.direction),
}));
export type CustomerUxDirectionCorrectionInput = z.infer<typeof CustomerUxDirectionCorrectionInputSchema>;

const uniqueSorted = (values: readonly string[]) => [...new Set(values)].sort(compareStrings);

/** Normalize only unordered semantic collections; section order remains explicit. */
export function normalizeCustomerUxDirection(input: unknown): CustomerUxDirection {
  const parsed = CustomerUxDirectionSchema.parse(input);
  const sortList = (values: readonly string[]) => uniqueSorted(values);
  return CustomerUxDirectionSchema.parse({
    ...parsed,
    metadata: {
      ...parsed.metadata,
      ...(parsed.metadata.evidenceRefs ? { evidenceRefs: sortList(parsed.metadata.evidenceRefs) } : {}),
    },
    visual: {
      ...parsed.visual,
      presentationAttributes: sortList(parsed.visual.presentationAttributes),
      avoidedPatterns: sortList(parsed.visual.avoidedPatterns),
    },
    audienceAndPositioning: {
      ...parsed.audienceAndPositioning,
      audienceSegments: sortList(parsed.audienceAndPositioning.audienceSegments),
      desiredPerception: sortList(parsed.audienceAndPositioning.desiredPerception),
      prohibitedUnsupportedClaims: sortList(parsed.audienceAndPositioning.prohibitedUnsupportedClaims),
    },
    informationArchitecture: {
      ...parsed.informationArchitecture,
      sections: [...parsed.informationArchitecture.sections].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)),
    },
    conversionPolicy: {
      ...parsed.conversionPolicy,
      allowedChannels: [...parsed.conversionPolicy.allowedChannels].sort(),
      forbiddenChannels: [...parsed.conversionPolicy.forbiddenChannels].sort(),
    },
    trustPolicy: {
      allowedTrustSignals: sortList(parsed.trustPolicy.allowedTrustSignals),
      forbiddenUnsupportedTrustSignals: sortList(parsed.trustPolicy.forbiddenUnsupportedTrustSignals),
    },
    motionAndInteraction: {
      ...parsed.motionAndInteraction,
      allowedInteractionPatterns: sortList(parsed.motionAndInteraction.allowedInteractionPatterns),
      avoidedInteractionPatterns: sortList(parsed.motionAndInteraction.avoidedInteractionPatterns),
    },
    mobileAccessibility: {
      ...parsed.mobileAccessibility,
      screenReaderKeyboardConsiderations: sortList(parsed.mobileAccessibility.screenReaderKeyboardConsiderations),
    },
    creativeFreedom: {
      ...parsed.creativeFreedom,
      hardCustomerInvariants: sortList(parsed.creativeFreedom.hardCustomerInvariants),
      creativeDirections: sortList(parsed.creativeFreedom.creativeDirections),
      implementationFreedom: sortList(parsed.creativeFreedom.implementationFreedom),
      boundedBy: sortList(parsed.creativeFreedom.boundedBy),
    },
  });
}

export function customerUxDirectionDigest(input: CustomerUxDirection): string {
  return createHash("sha256").update(stableSerialize(normalizeCustomerUxDirection(input)), "utf8").digest("hex");
}

export function customerUxDirectionCorrectionInstruction(input: CustomerUxDirectionCorrectionInput): string {
  const parsed = CustomerUxDirectionCorrectionInputSchema.parse(input);
  return `Deterministic customer UX direction correction:sha256:${customerUxDirectionDigest(parsed.direction)}${parsed.expectedPreviousDigest ? `:previous:${parsed.expectedPreviousDigest}` : ""}`;
}

const requirementGroups = [
  ["UX_VISUAL_DIRECTION", "BRAND_VISUAL", "visual", "Visual direction"],
  ["UX_AUDIENCE_AND_POSITIONING", "AUDIENCE", "audienceAndPositioning", "Audience, positioning, and confirmed local/SEO direction"],
  ["UX_INFORMATION_ARCHITECTURE", "CONTENT", "informationArchitecture", "Information architecture"],
  ["UX_CONVERSION_POLICY", "FORM", "conversionPolicy", "Conversion policy"],
  ["UX_IMAGE_EVIDENCE_POLICY", "IMAGE_NOTE", "imageEvidencePolicy", "Image and evidence policy"],
  ["UX_TRUST_POLICY", "PROHIBITED", "trustPolicy", "Trust-evidence policy"],
  ["UX_MOTION_AND_INTERACTION", "UX_RESPONSIVE", "motionAndInteraction", "Motion and interaction policy"],
  ["UX_MOBILE_ACCESSIBILITY", "UX_RESPONSIVE", "mobileAccessibility", "Mobile and accessibility objectives"],
  ["UX_PERFORMANCE", "TECHNICAL", "performance", "Performance objectives"],
  ["UX_CREATIVE_FREEDOM", "UX_RESPONSIVE", "creativeFreedom", "Creative-freedom boundary"],
] as const;

type RequirementGroupCategory = z.infer<typeof CanonicalRequirementValueSchema>["category"];

/** Derive a small stable Planning ledger from the structured direction. */
export function deriveCustomerUxDirectionRequirements(input: {
  direction: CustomerUxDirection;
  projectId: string;
  projectVersion: number;
}): readonly CanonicalRequirement[] {
  const direction = normalizeCustomerUxDirection(input.direction);
  const sourceRefs = uniqueSorted([CUSTOMER_UX_SOURCE_REF, ...(direction.metadata.evidenceRefs ?? [])]);
  return requirementGroups.map(([key, category, field, label]) => {
    const id = createV3RequirementId({ projectId: input.projectId, projectVersion: input.projectVersion, stableSemanticKey: `customer-ux-direction:${key}` });
    const projection = key === "UX_AUDIENCE_AND_POSITIONING"
      ? { audienceAndPositioning: direction.audienceAndPositioning, seoAndLocalDirection: direction.seoAndLocalDirection }
      : direction[field as keyof CustomerUxDirection];
    const statement = `Customer-confirmed ${label}; preserve the structured canonical direction exactly: ${stableSerialize(projection)}.`;
    return CanonicalRequirementSchema.parse({ id, category: category as RequirementGroupCategory, statement, sourceRefs });
  });
}

export const CUSTOMER_UX_DIRECTION_REQUIREMENT_KEYS = requirementGroups.map(([key]) => key);
export { CUSTOMER_UX_SOURCE_REF };
