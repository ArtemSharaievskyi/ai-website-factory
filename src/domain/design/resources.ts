import { createHash } from "node:crypto";
import { z } from "zod";
import { IsoDateTimeSchema, NonEmptyStringSchema, UuidSchema } from "@/domain/shared/schemas";

export const FRONTEND_DESIGN_RESOURCE_POLICY_VERSION = "frontend-design-resource-policy-v1" as const;
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const HexColorSchema = z.string().regex(/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i);

export const TypographySourceSchema = z.enum(["GOOGLE_FONTS", "CLIENT_SUPPLIED", "LOCAL", "OTHER_APPROVED"]);
export type TypographySource = z.infer<typeof TypographySourceSchema>;
export const TypographyImplementationSchema = z.enum(["NEXT_FONT_GOOGLE_SELF_HOSTED", "NEXT_FONT_LOCAL", "OTHER_APPROVED"]);
export type TypographyImplementation = z.infer<typeof TypographyImplementationSchema>;

export const TypographySelectionSchema = z.object({
  primaryFamily: NonEmptyStringSchema,
  secondaryFamily: NonEmptyStringSchema.optional(),
  source: TypographySourceSchema,
  rationale: z.string().min(12).max(1_000),
  headingUse: NonEmptyStringSchema,
  bodyUse: NonEmptyStringSchema,
  weights: z.array(z.number().int().positive().max(1_000)).min(1).max(6),
  variableFont: z.boolean(),
  languageCoverage: z.array(NonEmptyStringSchema).min(1).max(20),
  implementation: TypographyImplementationSchema,
  fallbackStack: z.array(NonEmptyStringSchema).min(2).max(8),
  approvedByDesign: z.boolean(),
  runtimeExternalRequest: z.literal(false),
}).strict().superRefine((selection, context) => {
  if (new Set(selection.weights).size !== selection.weights.length) context.addIssue({ code: "custom", path: ["weights"], message: "Typography weights must be unique." });
  if (selection.source === "GOOGLE_FONTS" && selection.implementation !== "NEXT_FONT_GOOGLE_SELF_HOSTED") context.addIssue({ code: "custom", path: ["implementation"], message: "Google Fonts must use the self-hosted next/font implementation by default." });
});
export type TypographySelection = z.infer<typeof TypographySelectionSchema>;

export const TypographyCandidateSchema = z.object({
  family: NonEmptyStringSchema,
  category: NonEmptyStringSchema,
  visualPersonality: NonEmptyStringSchema,
  readabilityNotes: NonEmptyStringSchema,
  languageCoverage: z.array(NonEmptyStringSchema).min(1).max(20),
  availableWeights: z.array(z.number().int().positive().max(1_000)).min(1).max(30),
  variableFont: z.boolean(),
  performanceNotes: NonEmptyStringSchema,
  sourceChecksum: HashSchema,
}).strict();
export type TypographyCandidate = z.infer<typeof TypographyCandidateSchema>;

export const TypographyValidationFindingSchema = z.object({
  code: z.enum(["TYPOGRAPHY_RATIONALE_REQUIRED", "TYPOGRAPHY_NOT_APPROVED", "TYPOGRAPHY_WEIGHT_UNAVAILABLE", "TYPOGRAPHY_LANGUAGE_UNSUPPORTED", "TYPOGRAPHY_RUNTIME_REQUEST"]),
  severity: z.enum(["WARNING", "BLOCKING"]),
  summary: NonEmptyStringSchema,
}).strict();
export type TypographyValidationFinding = z.infer<typeof TypographyValidationFindingSchema>;

export const TypographyImplementationPlanSchema = z.object({
  implementation: TypographyImplementationSchema,
  importPath: z.enum(["next/font/google", "next/font/local", "approved-font-loader"]),
  family: NonEmptyStringSchema,
  secondaryFamily: NonEmptyStringSchema.optional(),
  requestedWeights: z.array(z.number().int().positive().max(1_000)).min(1).max(6),
  fallbackStack: z.array(NonEmptyStringSchema).min(2).max(8),
  subsets: z.array(NonEmptyStringSchema).min(1).max(20),
  runtimeExternalRequest: z.literal(false),
  browserProviderRequests: z.literal(false),
  onlyRequiredWeights: z.literal(true),
}).strict();
export type TypographyImplementationPlan = z.infer<typeof TypographyImplementationPlanSchema>;

export const GoogleFontResearchSchema = z.object({
  source: z.literal("GOOGLE_FONTS"),
  query: z.string().max(160),
  sourceReference: z.string().url(),
  sourceChecksum: HashSchema,
  retrievedAt: IsoDateTimeSchema,
  liveEvidence: z.boolean(),
  writeAuthority: z.literal("NONE"),
  candidates: z.array(TypographyCandidateSchema).min(1).max(20),
}).strict();
export type GoogleFontResearch = z.infer<typeof GoogleFontResearchSchema>;

export const SemanticColorTokenNameSchema = z.enum(["background", "surface", "surfaceElevated", "foreground", "mutedForeground", "border", "primary", "primaryForeground", "secondary", "accent", "focus", "success", "warning", "danger"]);
export type SemanticColorTokenName = z.infer<typeof SemanticColorTokenNameSchema>;
export const SemanticColorSystemSchema = z.object({
  background: HexColorSchema.optional(),
  surface: HexColorSchema.optional(),
  surfaceElevated: HexColorSchema.optional(),
  foreground: HexColorSchema.optional(),
  mutedForeground: HexColorSchema.optional(),
  border: HexColorSchema.optional(),
  primary: HexColorSchema.optional(),
  primaryForeground: HexColorSchema.optional(),
  secondary: HexColorSchema.optional(),
  accent: HexColorSchema.optional(),
  focus: HexColorSchema.optional(),
  success: HexColorSchema.optional(),
  warning: HexColorSchema.optional(),
  danger: HexColorSchema.optional(),
}).strict().superRefine((tokens, context) => {
  if (Object.values(tokens).filter(Boolean).length < 4) context.addIssue({ code: "custom", path: [], message: "A semantic color system must contain at least four mapped tokens." });
  if (tokens.background && !tokens.foreground) context.addIssue({ code: "custom", path: ["foreground"], message: "A background token requires a foreground token for contrast validation." });
  if (tokens.primary && !tokens.primaryForeground) context.addIssue({ code: "custom", path: ["primaryForeground"], message: "A primary token requires a primaryForeground token for contrast validation." });
});
export type SemanticColorSystem = z.infer<typeof SemanticColorSystemSchema>;

export const PaletteContrastCheckSchema = z.object({
  foregroundToken: SemanticColorTokenNameSchema,
  backgroundToken: SemanticColorTokenNameSchema,
  ratio: z.number().finite().min(1).max(21),
  requiredRatio: z.number().finite().min(1).max(21),
  passes: z.boolean(),
}).strict();
export type PaletteContrastCheck = z.infer<typeof PaletteContrastCheckSchema>;

export const PaletteAccessibilityEvidenceSchema = z.object({
  status: z.enum(["PASS", "FAIL"]),
  checks: z.array(PaletteContrastCheckSchema).min(1).max(20),
  standard: z.literal("WCAG_CONTRAST_ORIENTED"),
}).strict();
export type PaletteAccessibilityEvidence = z.infer<typeof PaletteAccessibilityEvidenceSchema>;

export const ColorHuntPaletteSchema = z.object({
  paletteId: z.string().regex(/^[a-z0-9-]+$/),
  colors: z.array(HexColorSchema).min(3).max(8),
  characteristics: z.array(NonEmptyStringSchema).max(8),
  sourceReference: z.string().url(),
  sourceChecksum: HashSchema,
  retrievedAt: IsoDateTimeSchema,
  liveEvidence: z.boolean(),
  writeAuthority: z.literal("NONE"),
  inspirationOnly: z.literal(true),
}).strict();
export type ColorHuntPalette = z.infer<typeof ColorHuntPaletteSchema>;

export const ColorHuntResearchSchema = z.object({
  source: z.literal("COLOR_HUNT"),
  query: z.array(NonEmptyStringSchema).max(8),
  sourceReference: z.string().url(),
  sourceChecksum: HashSchema,
  retrievedAt: IsoDateTimeSchema,
  liveEvidence: z.boolean(),
  writeAuthority: z.literal("NONE"),
  candidates: z.array(ColorHuntPaletteSchema).min(1).max(20),
  inspirationOnly: z.literal(true),
}).strict();
export type ColorHuntResearch = z.infer<typeof ColorHuntResearchSchema>;

export const PaletteSelectionSchema = z.object({
  source: z.enum(["COLOR_HUNT", "CLIENT_PROVIDED", "FACTORY_APPROVED"]),
  candidateId: z.string().regex(/^[a-z0-9-]+$/),
  candidateChecksum: HashSchema,
  semanticTokens: SemanticColorSystemSchema,
  rationale: z.string().min(12).max(1_000),
  adjustments: z.array(NonEmptyStringSchema).max(12),
  accessibility: PaletteAccessibilityEvidenceSchema,
  approvedByDesign: z.boolean(),
  approvedBrandMatch: z.boolean(),
  blindCopy: z.boolean(),
}).strict();
export type PaletteSelection = z.infer<typeof PaletteSelectionSchema>;

export const ThirdPartyAssetEntitlementSchema = z.object({
  source: NonEmptyStringSchema,
  resourceIdentifier: NonEmptyStringSchema,
  tier: z.enum(["FREE", "PREMIUM", "UNKNOWN"]),
  entitlementVerified: z.boolean(),
  usageScope: NonEmptyStringSchema,
  projectId: UuidSchema.optional(),
  verificationEvidence: NonEmptyStringSchema.optional(),
}).strict().superRefine((entitlement, context) => {
  if (entitlement.entitlementVerified && !entitlement.verificationEvidence) context.addIssue({ code: "custom", path: ["verificationEvidence"], message: "Verified third-party entitlement requires bounded verification evidence." });
});
export type ThirdPartyAssetEntitlement = z.infer<typeof ThirdPartyAssetEntitlementSchema>;

export const AceternityComponentCandidateSchema = z.object({
  source: z.literal("ACETERNITY_UI"),
  registryNamespace: z.literal("@aceternity"),
  componentName: z.string().regex(/^[a-z0-9-]+$/),
  kind: z.enum(["COMPONENT", "BLOCK", "TEMPLATE"]),
  description: NonEmptyStringSchema,
  sourceReference: z.string().url(),
  sourceChecksum: HashSchema,
  retrievedAt: IsoDateTimeSchema,
  liveEvidence: z.boolean(),
  writeAuthority: z.literal("NONE"),
  dependencies: z.array(z.string().max(160)).max(30),
  registryDependencies: z.array(z.string().max(160)).max(30),
  motionCharacteristics: NonEmptyStringSchema,
  clientJsCost: z.enum(["NONE", "MINIMAL_CLIENT_ISLAND", "SUBSTANTIAL_CLIENT_SURFACE"]),
  entitlement: ThirdPartyAssetEntitlementSchema,
  licenseReference: z.string().url(),
  disposition: z.enum(["INSPECTED_NOT_SELECTED", "PROPOSED_FOR_ADAPTATION", "REJECTED", "NOT_APPLICABLE"]),
  decisionReason: NonEmptyStringSchema,
}).strict();
export type AceternityComponentCandidate = z.infer<typeof AceternityComponentCandidateSchema>;

export const AceternityDiscoverySchema = z.object({
  source: z.literal("ACETERNITY_UI"),
  registryNamespace: z.literal("@aceternity"),
  query: z.string().min(1).max(160),
  sourceReference: z.string().url(),
  sourceChecksum: HashSchema,
  retrievedAt: IsoDateTimeSchema,
  liveEvidence: z.boolean(),
  writeAuthority: z.literal("NONE"),
  candidates: z.array(AceternityComponentCandidateSchema).min(1).max(12),
}).strict();
export type AceternityDiscovery = z.infer<typeof AceternityDiscoverySchema>;

export const AceternityComponentSelectionSchema = z.object({
  candidate: AceternityComponentCandidateSchema,
  approvedDesignFit: z.boolean(),
  interactionPurpose: NonEmptyStringSchema,
  accessibilityNotes: NonEmptyStringSchema,
  responsiveNotes: NonEmptyStringSchema,
  performanceNotes: NonEmptyStringSchema,
  dependencyNotes: NonEmptyStringSchema,
  dependencyReview: z.object({ status: z.enum(["PENDING", "APPROVED", "BLOCKED"]), evidenceRef: NonEmptyStringSchema }).strict(),
  visualDistinctiveness: NonEmptyStringSchema,
  contentFit: NonEmptyStringSchema,
  adaptationNotes: z.array(NonEmptyStringSchema).min(3).max(15),
  clientBoundary: z.enum(["SERVER_SAFE", "MINIMAL_CLIENT_ISLAND"]),
  motionNormalization: z.literal("CANONICAL_MOTION_TOKENS"),
  reducedMotionFallback: NonEmptyStringSchema,
  installationDisposition: z.enum(["DISCOVERY_ONLY", "TASK_AUTHORIZED"]),
  taskAuthorityReference: NonEmptyStringSchema.optional(),
}).strict().superRefine((selection, context) => {
  if (!selection.approvedDesignFit) context.addIssue({ code: "custom", path: ["approvedDesignFit"], message: "Aceternity installation requires explicit Design fit." });
  if (selection.installationDisposition === "TASK_AUTHORIZED" && !selection.taskAuthorityReference) context.addIssue({ code: "custom", path: ["taskAuthorityReference"], message: "Component installation requires a task authority reference." });
  if (selection.candidate.kind !== "COMPONENT") context.addIssue({ code: "custom", path: ["candidate", "kind"], message: "Blocks and templates require a separate approved route; component discovery is the bounded default." });
  if (selection.installationDisposition === "TASK_AUTHORIZED" && selection.dependencyReview.status !== "APPROVED") context.addIssue({ code: "custom", path: ["dependencyReview", "status"], message: "DependencyGuardian approval is required before installation." });
  if (selection.installationDisposition === "TASK_AUTHORIZED" && selection.candidate.entitlement.tier !== "FREE" && !selection.candidate.entitlement.entitlementVerified) context.addIssue({ code: "custom", path: ["candidate", "entitlement"], message: "A non-free component requires verified license or entitlement evidence before installation." });
});
export type AceternityComponentSelection = z.infer<typeof AceternityComponentSelectionSchema>;

export const FrontendDesignResourceActivationSchema = z.object({
  typography: z.enum(["NOT_NEEDED", "DISCOVERY_AVAILABLE", "DISCOVERY_REQUIRED", "CLIENT_SUPPLIED"]),
  palette: z.enum(["NOT_NEEDED", "DISCOVERY_AVAILABLE", "DISCOVERY_REQUIRED", "CLIENT_SUPPLIED"]),
  components: z.enum(["NOT_NEEDED", "DISCOVERY_AVAILABLE", "DISCOVERY_REQUIRED"]),
  componentQuery: z.string().max(160).optional(),
}).strict();
export type FrontendDesignResourceActivation = z.infer<typeof FrontendDesignResourceActivationSchema>;

export const FrontendDesignResourceProvenanceSchema = z.object({
  resource: z.enum(["GOOGLE_FONTS", "COLOR_HUNT", "ACETERNITY_UI", "OFFICIAL_SHADCN"]),
  sourceReference: z.string().url(),
  sourceChecksum: HashSchema,
  retrievedAt: IsoDateTimeSchema,
  access: z.enum(["READ_ONLY_DISCOVERY", "READ_ONLY_INSPECTION"]),
  contentTrust: z.literal("UNTRUSTED_EXTERNAL"),
}).strict();
export type FrontendDesignResourceProvenance = z.infer<typeof FrontendDesignResourceProvenanceSchema>;

export const FrontendDesignResourcePlanSchema = z.object({
  policyVersion: z.literal(FRONTEND_DESIGN_RESOURCE_POLICY_VERSION),
  authority: z.literal("APPROVED_DESIGN"),
  directionChecksum: HashSchema,
  activation: FrontendDesignResourceActivationSchema,
  typography: z.object({ research: GoogleFontResearchSchema.optional(), selection: TypographySelectionSchema.optional(), implementation: TypographyImplementationPlanSchema.optional() }).strict().optional(),
  palette: z.object({ research: ColorHuntResearchSchema.optional(), selection: PaletteSelectionSchema.optional() }).strict().optional(),
  components: z.object({ discovery: AceternityDiscoverySchema.optional(), selection: AceternityComponentSelectionSchema.optional() }).strict().optional(),
  provenance: z.array(FrontendDesignResourceProvenanceSchema).max(12),
  adaptationNotes: z.array(NonEmptyStringSchema).min(1).max(20),
  writeAuthority: z.literal("NONE"),
  currentness: z.object({ status: z.enum(["CURRENT", "STALE"]), checkedAt: IsoDateTimeSchema, reason: z.string().max(300).optional() }).strict(),
}).strict().superRefine((plan, context) => {
  if (plan.activation.typography === "DISCOVERY_REQUIRED" && !plan.typography?.research) context.addIssue({ code: "custom", path: ["typography", "research"], message: "Required typography discovery evidence is missing." });
  if (plan.activation.palette === "DISCOVERY_REQUIRED" && !plan.palette?.research) context.addIssue({ code: "custom", path: ["palette", "research"], message: "Required palette discovery evidence is missing." });
  if (plan.activation.components === "DISCOVERY_REQUIRED" && !plan.components?.discovery) context.addIssue({ code: "custom", path: ["components", "discovery"], message: "Required component discovery evidence is missing." });
  if (plan.activation.typography === "CLIENT_SUPPLIED" && plan.typography?.research) context.addIssue({ code: "custom", path: ["typography", "research"], message: "Client-supplied typography must not be replaced by external discovery." });
  if (plan.activation.palette === "CLIENT_SUPPLIED" && plan.palette?.research) context.addIssue({ code: "custom", path: ["palette", "research"], message: "Client-supplied brand colors must not be replaced by external discovery." });
});
export type FrontendDesignResourcePlan = z.infer<typeof FrontendDesignResourcePlanSchema>;

const DEFAULT_FAMILY_PATTERN = /^(inter|geist|space grotesk|roboto)$/i;
const normalizeHex = (value: string) => {
  const raw = value.slice(1).toLowerCase();
  return raw.length === 3 ? raw.split("").map((char) => `${char}${char}`).join("") : raw;
};
const luminance = (value: string) => {
  const rgb = [0, 2, 4].map((offset) => parseInt(normalizeHex(value).slice(offset, offset + 2), 16) / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
};
export function colorContrastRatio(foreground: string, background: string) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
}

export function validateTypographySelection(selectionRaw: TypographySelection, candidate?: TypographyCandidate, approvedDesignText = "") {
  const selection = TypographySelectionSchema.parse(selectionRaw);
  const findings: TypographyValidationFinding[] = [];
  const deliberate = new RegExp(`${selection.primaryFamily.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.{0,120}(?:approved|brand|design|deliberate|fit|specified)`, "i");
  if (!selection.approvedByDesign) findings.push({ code: "TYPOGRAPHY_NOT_APPROVED", severity: "BLOCKING", summary: "Typography cannot enter implementation without Design approval." });
  if (DEFAULT_FAMILY_PATTERN.test(selection.primaryFamily) && !deliberate.test(approvedDesignText) && !/(?:approved|brand|design|deliberate|fit|specified)/i.test(selection.rationale)) findings.push({ code: "TYPOGRAPHY_RATIONALE_REQUIRED", severity: "BLOCKING", summary: "A familiar default font requires a project-specific Design rationale." });
  if (candidate && selection.weights.some((weight) => !candidate.availableWeights.includes(weight))) findings.push({ code: "TYPOGRAPHY_WEIGHT_UNAVAILABLE", severity: "BLOCKING", summary: "The typography selection requests a weight unavailable from the discovered font metadata." });
  if (candidate && selection.languageCoverage.some((language) => !candidate.languageCoverage.includes(language))) findings.push({ code: "TYPOGRAPHY_LANGUAGE_UNSUPPORTED", severity: "BLOCKING", summary: "The typography selection does not cover every approved language/script requirement." });
  if (selection.runtimeExternalRequest) findings.push({ code: "TYPOGRAPHY_RUNTIME_REQUEST", severity: "BLOCKING", summary: "The selected font implementation would make a runtime external font request." });
  return { valid: !findings.some((finding) => finding.severity === "BLOCKING"), findings };
}

export function createNextFontGoogleImplementation(selectionRaw: TypographySelection, candidate?: TypographyCandidate): TypographyImplementationPlan {
  const selection = TypographySelectionSchema.parse(selectionRaw);
  if (selection.source !== "GOOGLE_FONTS" || selection.implementation !== "NEXT_FONT_GOOGLE_SELF_HOSTED") throw new Error("GOOGLE_FONT_SELF_HOST_REQUIREMENT_FAILED");
  const weights = [...new Set(selection.weights)].sort((left, right) => left - right);
  if (candidate && weights.some((weight) => !candidate.availableWeights.includes(weight))) throw new Error("GOOGLE_FONT_WEIGHT_NOT_AVAILABLE");
  return TypographyImplementationPlanSchema.parse({ implementation: selection.implementation, importPath: "next/font/google", family: selection.primaryFamily, ...(selection.secondaryFamily ? { secondaryFamily: selection.secondaryFamily } : {}), requestedWeights: weights, fallbackStack: selection.fallbackStack, subsets: selection.languageCoverage, runtimeExternalRequest: false, browserProviderRequests: false, onlyRequiredWeights: true });
}

export function validateGoogleFontRuntimePrivacy(files: ReadonlyArray<{ path: string; content: string }>) {
  const findings = files.filter((file) => /fonts\.googleapis\.com|fonts\.gstatic\.com|fonts\.google\.com\/css/i.test(file.content)).map((file) => ({ path: file.path, code: "RUNTIME_GOOGLE_FONT_REQUEST" as const, summary: "The production source contains a runtime Google Fonts request; use next/font self-hosting or approved local fonts." }));
  return { status: findings.length ? "BLOCK" as const : "PASS" as const, runtimeGoogleRequest: findings.length > 0, findings };
}

export function validateSemanticColorSystem(tokensRaw: SemanticColorSystem) {
  const tokens = SemanticColorSystemSchema.parse(tokensRaw);
  const pairs: Array<[SemanticColorTokenName, SemanticColorTokenName, number]> = [];
  if (tokens.foreground && tokens.background) pairs.push(["foreground", "background", 4.5]);
  if (tokens.mutedForeground && tokens.background) pairs.push(["mutedForeground", "background", 4.5]);
  if (tokens.primaryForeground && tokens.primary) pairs.push(["primaryForeground", "primary", 4.5]);
  const checks = pairs.map(([foregroundToken, backgroundToken, requiredRatio]) => ({ foregroundToken, backgroundToken, ratio: colorContrastRatio(tokens[foregroundToken]!, tokens[backgroundToken]!), requiredRatio, passes: colorContrastRatio(tokens[foregroundToken]!, tokens[backgroundToken]!) >= requiredRatio }));
  return PaletteAccessibilityEvidenceSchema.parse({ status: checks.every((check) => check.passes) ? "PASS" : "FAIL", checks, standard: "WCAG_CONTRAST_ORIENTED" });
}

export function evaluatePaletteSelection(input: { candidate: ColorHuntPalette; semanticTokens: SemanticColorSystem; rationale: string; adjustments?: string[]; approvedByDesign: boolean; approvedBrandMatch?: boolean }) {
  const candidate = ColorHuntPaletteSchema.parse(input.candidate);
  const semanticTokens = SemanticColorSystemSchema.parse(input.semanticTokens);
  const accessibility = validateSemanticColorSystem(semanticTokens);
  const tokenValues = Object.values(semanticTokens).filter(Boolean).map((value) => value!.toLowerCase());
  const candidateColors = candidate.colors.map((color) => color.toLowerCase());
  const blindCopy = !input.adjustments?.length && tokenValues.length === candidateColors.length && candidateColors.every((color) => tokenValues.includes(color));
  const approvedBrandMatch = input.approvedBrandMatch ?? false;
  const findings = [
    ...(!input.approvedByDesign ? [{ code: "PALETTE_NOT_APPROVED", severity: "BLOCKING" as const, summary: "Palette candidates require approved Design reasoning before implementation." }] : []),
    ...(!input.rationale.trim() ? [{ code: "PALETTE_RATIONALE_REQUIRED", severity: "BLOCKING" as const, summary: "Color Hunt candidates require product-specific semantic rationale." }] : []),
    ...(blindCopy && !approvedBrandMatch ? [{ code: "PALETTE_BLIND_COPY", severity: "BLOCKING" as const, summary: "A Color Hunt palette must be adapted into semantic project tokens instead of copied unchanged." }] : []),
    ...(accessibility.status === "FAIL" ? [{ code: "PALETTE_CONTRAST_FAILED", severity: "BLOCKING" as const, summary: "The semantic palette does not meet the configured contrast checks." }] : []),
  ];
  return { valid: !findings.some((finding) => finding.severity === "BLOCKING"), blindCopy, accessibility, findings };
}

export function proposeAceternityComponent(input: Omit<AceternityComponentSelection, "installationDisposition" | "taskAuthorityReference">) {
  return AceternityComponentSelectionSchema.parse({ ...input, installationDisposition: "DISCOVERY_ONLY" });
}

export function authorizeAceternityInstallation(selectionRaw: AceternityComponentSelection, input: { taskAuthorized: boolean; taskAuthorityReference: string }) {
  const selection = AceternityComponentSelectionSchema.parse(selectionRaw);
  if (!input.taskAuthorized) throw new Error("ACETERNITY_INSTALL_AUTHORITY_REQUIRED");
  if (!selection.approvedDesignFit) throw new Error("ACETERNITY_DESIGN_AUTHORITY_REQUIRED");
  if (selection.candidate.kind !== "COMPONENT") throw new Error("ACETERNITY_TEMPLATE_OR_BLOCK_NOT_ALLOWED");
  if (selection.dependencyReview.status !== "APPROVED") throw new Error("DEPENDENCY_GUARDIAN_APPROVAL_REQUIRED");
  if (selection.candidate.entitlement.tier !== "FREE" && !selection.candidate.entitlement.entitlementVerified) throw new Error("LICENSE_OR_ENTITLEMENT_REQUIRED");
  return AceternityComponentSelectionSchema.parse({ ...selection, installationDisposition: "TASK_AUTHORIZED", taskAuthorityReference: input.taskAuthorityReference });
}

export const resourceChecksum = (value: unknown) => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
