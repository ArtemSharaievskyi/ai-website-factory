import { FrontendDesignResourceActivationSchema, type FrontendDesignResourceActivation } from "@/domain/design/resources";

/**
 * These are procedural capability descriptors, not Approved Skills Registry
 * entries. They keep resource discovery attached to the existing
 * FrontendImplementationAgent and never grant write or install authority.
 */
export const TypographyDiscoverySkill = Object.freeze({
  id: "typography-discovery",
  ownerAgentId: "implementation" as const,
  source: "GOOGLE_FONTS" as const,
  capability: "design.google-fonts-read" as const,
  discoveryOnly: true as const,
  defaultImplementation: "NEXT_FONT_GOOGLE_SELF_HOSTED" as const,
});

export const PaletteDiscoverySkill = Object.freeze({
  id: "palette-discovery",
  ownerAgentId: "implementation" as const,
  source: "COLOR_HUNT" as const,
  capability: "design.color-hunt-read" as const,
  discoveryOnly: true as const,
  canonicalAuthority: "APPROVED_DESIGN" as const,
});

export const AceternityComponentDiscoverySkill = Object.freeze({
  id: "aceternity-component-discovery",
  ownerAgentId: "implementation" as const,
  source: "ACETERNITY_UI" as const,
  capability: "design.aceternity-read" as const,
  discoveryOnly: true as const,
  inspectionOnlyUntilTaskAuthority: true as const,
  installationRequires: ["approvedDesignFit", "taskAuthority", "dependencyReview", "licenseOrEntitlement"] as const,
});

export const FrontendDesignResourceCapabilities = Object.freeze([TypographyDiscoverySkill, PaletteDiscoverySkill, AceternityComponentDiscoverySkill]);

export function resolveFrontendDesignResourceActivation(raw: FrontendDesignResourceActivation) {
  return FrontendDesignResourceActivationSchema.parse(raw);
}
