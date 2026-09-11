import { createHash } from "node:crypto";
import { z } from "zod";
import { DocumentBaseSchema, IsoDateTimeSchema, NonEmptyStringSchema, UuidSchema } from "@/domain/shared/schemas";
import { decideDependency, type DependencyAuthorityContext } from "@/dependencies/authority";

export const DESIGN_CAPABILITY_POLICY_VERSION = "professional-design-capability-v1" as const;
export const DESIGN_CONTRACT_SCHEMA_VERSION = 1 as const;
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const DesignCapabilityAvailabilitySchema = z.enum([
  "AVAILABLE",
  "AUTH_REQUIRED",
  "AUTH_INVALID",
  "RATE_LIMITED",
  "UNAVAILABLE",
  "API_ERROR",
  "CONTRACT_ERROR",
]);
export type DesignCapabilityAvailability = z.infer<typeof DesignCapabilityAvailabilitySchema>;

export const DesignToolIdSchema = z.enum([
  "fontpair",
  "impeccable",
  "emil-design-eng",
  "emil-animation-review",
  "transitions-dev",
  "twenty-first-dev",
  "react-bits",
  "magic-ui",
  "shadcn-ui",
  "motion-for-react",
  "host-deterministic",
]);
export type DesignToolId = z.infer<typeof DesignToolIdSchema>;

export const DesignToolProvenanceSchema = z.object({
  toolId: DesignToolIdSchema,
  status: DesignCapabilityAvailabilitySchema,
  source: z.enum(["official-api", "official-public-read-only", "official-registry", "approved-skill-registry", "official-package", "host-deterministic"]),
  sourceRef: z.string().url().optional(),
  sourceVersion: NonEmptyStringSchema.optional(),
  sourceChecksum: HashSchema.optional(),
  retrievedAt: IsoDateTimeSchema,
  liveEvidence: z.boolean(),
  contentTrust: z.enum(["UNTRUSTED_EXTERNAL", "HOST_VALIDATED"]),
  redacted: z.boolean(),
}).strict();
export type DesignToolProvenance = z.infer<typeof DesignToolProvenanceSchema>;

export const DesignCapabilityPassEvidenceSchema = z.object({
  capabilityId: z.enum([
    "fontpair-normalization",
    "fontpair-multiple-candidates",
    "twenty-first-discovery",
    "react-bits-discovery",
    "magic-ui-discovery",
    "shadcn-base-discovery",
    "impeccable-semantic-skill",
    "impeccable-critique",
    "impeccable-antipattern-detector",
    "emil-design-review",
    "emil-animation-opportunities",
    "emil-animation-review",
    "transitions-pattern-mapping",
    "transitions-polish",
    "motion-suitability",
  ]),
  status: z.enum(["PASS", "FAIL", "NOT_RUN"]),
  evidenceId: NonEmptyStringSchema,
  summary: NonEmptyStringSchema,
  sourceChecksum: HashSchema.optional(),
  checkedAt: IsoDateTimeSchema,
}).strict();
export type DesignCapabilityPassEvidence = z.infer<typeof DesignCapabilityPassEvidenceSchema>;

const DesignComponentEvidenceSchema = z.object({
  source: z.enum(["twenty-first-dev", "react-bits", "magic-ui", "shadcn-ui"]),
  query: NonEmptyStringSchema,
  sourceReference: z.string().url(),
  sourceChecksum: HashSchema,
  liveEvidence: z.boolean(),
  writeAuthority: z.literal("NONE"),
  candidates: z.array(z.object({
    candidateId: z.string().regex(/^[a-z0-9-]+$/),
    componentIdentity: NonEmptyStringSchema,
    disposition: z.enum(["USED_FOR_RESEARCH_NOT_SELECTED", "USED_AND_SELECTED", "USED_AND_REJECTED_WITH_REASON", "NOT_APPLICABLE_AFTER_ANALYSIS"]),
    decisionReason: NonEmptyStringSchema,
    dependencies: z.array(z.string().max(160)).max(20),
  }).strict()).min(1).max(12),
  deduplicatedCandidateCount: z.number().int().positive().max(48),
}).strict();
export type DesignComponentEvidence = z.infer<typeof DesignComponentEvidenceSchema>;

const ColorTokenSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  value: NonEmptyStringSchema,
  contrastRole: z.enum(["canvas", "surface", "text", "muted-text", "brand", "accent", "border", "feedback"]),
}).strict();

export const VisualSystemContractSchema = z.object({
  schemaVersion: z.literal(DESIGN_CONTRACT_SCHEMA_VERSION),
  contractId: UuidSchema,
  tokenChecksum: HashSchema,
  colorTokens: z.array(ColorTokenSchema).min(4).max(80),
  layout: z.object({
    grid: NonEmptyStringSchema,
    container: NonEmptyStringSchema,
    spacingScale: z.array(NonEmptyStringSchema).min(3).max(20),
    breakpoints: z.array(z.object({ name: NonEmptyStringSchema, minWidth: z.number().int().nonnegative() }).strict()).min(1).max(6),
    density: z.enum(["low", "moderate", "high"]),
  }).strict(),
  componentRules: z.array(NonEmptyStringSchema).min(2).max(30),
  logoRules: z.array(NonEmptyStringSchema).min(1).max(12),
  antiTemplateRules: z.array(NonEmptyStringSchema).min(1).max(20),
}).strict();
export type VisualSystemContract = z.infer<typeof VisualSystemContractSchema>;

export const TypographyDecisionSchema = z.object({
  schemaVersion: z.literal(DESIGN_CONTRACT_SCHEMA_VERSION),
  decisionId: UuidSchema,
  displayFamily: NonEmptyStringSchema,
  bodyFamily: NonEmptyStringSchema,
  fallbackStack: z.array(NonEmptyStringSchema).min(2).max(8),
  normalizedPair: z.object({ display: NonEmptyStringSchema, body: NonEmptyStringSchema }).strict(),
  source: z.enum(["fontpair", "supplied-brand", "system-approved"]),
  sourceEvidenceChecksum: HashSchema,
  weights: z.array(z.number().int().positive()).min(1).max(12),
  loadingStrategy: z.enum(["existing-project-fonts", "local-assets", "google-fonts-css", "system-stack"]),
  usageRules: z.array(NonEmptyStringSchema).min(2).max(20),
  checksum: HashSchema,
}).strict();
export type TypographyDecision = z.infer<typeof TypographyDecisionSchema>;

export const MotionSuitabilitySchema = z.enum(["NONE", "CSS_NATIVE", "MOTION"]);
export type MotionSuitability = z.infer<typeof MotionSuitabilitySchema>;

const MotionDurationTokenSchema = z.object({ durationMs: z.number().int().min(0).max(2000), easing: NonEmptyStringSchema }).strict();
const MotionSpringTokenSchema = z.object({ stiffness: z.number().finite().min(1).max(1000), damping: z.number().finite().min(0).max(200), mass: z.number().finite().positive().max(20) }).strict();
export const MotionTokenSetSchema = z.object({
  fast: MotionDurationTokenSchema,
  standard: MotionDurationTokenSchema,
  slow: MotionDurationTokenSchema,
  enter: MotionDurationTokenSchema,
  exit: MotionDurationTokenSchema,
  standardEasing: NonEmptyStringSchema,
  gentleSpring: MotionSpringTokenSchema,
  expressiveSpring: MotionSpringTokenSchema,
}).strict();
export type MotionTokenSet = z.infer<typeof MotionTokenSetSchema>;
export const DEFAULT_MOTION_TOKEN_SET = Object.freeze(MotionTokenSetSchema.parse({
  fast: { durationMs: 120, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
  standard: { durationMs: 200, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
  slow: { durationMs: 360, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  enter: { durationMs: 240, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
  exit: { durationMs: 160, easing: "cubic-bezier(0.4, 0, 1, 1)" },
  standardEasing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  gentleSpring: { stiffness: 260, damping: 30, mass: 1 },
  expressiveSpring: { stiffness: 420, damping: 24, mass: 0.8 },
}));

export const MotionDecisionSchema = z.object({
  schemaVersion: z.literal(DESIGN_CONTRACT_SCHEMA_VERSION),
  decisionId: UuidSchema,
  suitability: MotionSuitabilitySchema,
  purpose: NonEmptyStringSchema,
  navigation: NonEmptyStringSchema,
  sectionEntrance: NonEmptyStringSchema,
  microinteractions: NonEmptyStringSchema,
  reducedMotionFallback: NonEmptyStringSchema,
  transitionPattern: NonEmptyStringSchema,
  tokens: MotionTokenSetSchema.optional(),
  dependency: z.object({ packageName: z.literal("motion"), versionSpec: z.literal("12.43.0") }).strict().optional(),
  checksum: HashSchema,
}).strict().superRefine((value, context) => {
  if (value.suitability === "MOTION" && !value.dependency) context.addIssue({ code: "custom", path: ["dependency"], message: "MOTION suitability requires the approved motion dependency." });
  if (value.suitability !== "MOTION" && value.dependency) context.addIssue({ code: "custom", path: ["dependency"], message: "Only MOTION suitability may request the motion dependency." });
});
export type MotionDecision = z.infer<typeof MotionDecisionSchema>;

export const InteractionContractSchema = z.object({
  schemaVersion: z.literal(DESIGN_CONTRACT_SCHEMA_VERSION),
  interactionId: UuidSchema,
  surface: NonEmptyStringSchema,
  trigger: NonEmptyStringSchema,
  states: z.array(NonEmptyStringSchema).min(2).max(12),
  response: NonEmptyStringSchema,
  transitionStrategy: z.enum(["NONE", "CSS_TRANSITION", "CSS_KEYFRAME", "MOTION_SPRING", "MOTION_TWEEN"]),
  keyboardBehavior: NonEmptyStringSchema,
  focusBehavior: NonEmptyStringSchema,
  reducedMotionBehavior: NonEmptyStringSchema,
  requirementReferences: z.array(NonEmptyStringSchema).min(1),
  checksum: HashSchema,
}).strict();
export type InteractionContract = z.infer<typeof InteractionContractSchema>;

export const DirectionDesignCapabilitySchema = z.object({
  visualSystem: VisualSystemContractSchema,
  typography: TypographyDecisionSchema,
  motion: MotionDecisionSchema,
  interactions: z.array(InteractionContractSchema).min(1).max(30),
  componentDiscovery: z.array(DesignComponentEvidenceSchema).length(4),
  toolProvenance: z.array(DesignToolProvenanceSchema).min(1).max(20),
  passEvidence: z.array(DesignCapabilityPassEvidenceSchema).min(1).max(30),
  contractChecksum: HashSchema,
  currentness: z.object({ status: z.enum(["CURRENT", "STALE"]), checkedAt: IsoDateTimeSchema, reason: z.string().optional() }).strict(),
}).strict();
export type DirectionDesignCapability = z.infer<typeof DirectionDesignCapabilitySchema>;

export const DesignCapabilityPackageSchema = DocumentBaseSchema.extend({
  documentType: z.literal("professional-design-capability"),
  capabilityPolicyVersion: z.literal(DESIGN_CAPABILITY_POLICY_VERSION),
  directionSetId: UuidSchema,
  directions: z.array(z.object({ directionId: UuidSchema, capability: DirectionDesignCapabilitySchema }).strict()).length(3),
  dependencyRequests: z.array(z.object({ packageName: z.literal("motion"), versionSpec: z.literal("12.43.0"), reason: NonEmptyStringSchema, directionIds: z.array(UuidSchema).min(1) }).strict()),
  packageChecksum: HashSchema,
}).strict().superRefine((value, context) => {
  if (new Set(value.directions.map((item) => item.directionId)).size !== 3) context.addIssue({ code: "custom", path: ["directions"], message: "The professional design package must bind three distinct directions." });
});
export type DesignCapabilityPackage = z.infer<typeof DesignCapabilityPackageSchema>;

export const SelectedDesignContractBindingSchema = z.object({
  directionSetChecksum: HashSchema,
  selectedDirectionChecksum: HashSchema,
  visualSystemChecksum: HashSchema,
  typographyChecksum: HashSchema,
  motionChecksum: HashSchema,
  interactionChecksum: HashSchema,
  selectedAt: IsoDateTimeSchema,
  currentness: z.object({ status: z.literal("CURRENT"), checkedAt: IsoDateTimeSchema }).strict(),
}).strict();
export type SelectedDesignContractBinding = z.infer<typeof SelectedDesignContractBindingSchema>;

export const DesignDependencyAmendmentSchema = DocumentBaseSchema.extend({
  documentType: z.literal("design-dependency-amendment"),
  amendmentId: UuidSchema,
  directionId: UuidSchema,
  packageName: z.literal("motion"),
  versionSpec: z.literal("12.43.0"),
  section: z.literal("dependencies"),
  authorityCode: z.literal("APPROVED"),
  status: z.enum(["PROPOSED", "USER_APPROVED", "REJECTED"]),
  reason: NonEmptyStringSchema,
  requestedBy: NonEmptyStringSchema,
  requestedAt: IsoDateTimeSchema,
  approvedBy: NonEmptyStringSchema.optional(),
  approvedAt: IsoDateTimeSchema.optional(),
  checksum: HashSchema,
}).strict().superRefine((value, context) => {
  if (value.status === "USER_APPROVED" && (!value.approvedBy || !value.approvedAt)) context.addIssue({ code: "custom", path: ["approvedBy"], message: "An approved design dependency amendment requires an approving actor and timestamp." });
});
export type DesignDependencyAmendment = z.infer<typeof DesignDependencyAmendmentSchema>;

export function buildDesignDependencyAmendment(input: { amendmentId: string; projectId: string; projectVersion: number; directionId: string; reason: string; requestedBy: string; requestedAt: string }, authorityContext: DependencyAuthorityContext = {}) {
  const authority = decideDependency({ operation: "ADD", packageName: "motion", versionSpec: "12.43.0", dependencySection: "dependencies", context: { ...authorityContext, plannedDependencies: authorityContext.plannedDependencies ?? [{ name: "motion@12.43.0", runtime: "runtime", required: true }] } });
  if (!authority.approved) throw new Error(`UNAPPROVED_DESIGN_DEPENDENCY:${authority.code}`);
  const base = { schemaVersion: 1 as const, documentType: "design-dependency-amendment" as const, projectId: input.projectId, projectVersion: input.projectVersion, createdAt: input.requestedAt, updatedAt: input.requestedAt, amendmentId: input.amendmentId, directionId: input.directionId, packageName: "motion" as const, versionSpec: "12.43.0" as const, section: "dependencies" as const, authorityCode: authority.code as "APPROVED", status: "PROPOSED" as const, reason: input.reason, requestedBy: input.requestedBy, requestedAt: input.requestedAt };
  return DesignDependencyAmendmentSchema.parse({ ...base, checksum: stableDesignChecksum(base) });
}

export function approveDesignDependencyAmendment(amendment: DesignDependencyAmendment, input: { approvedBy: string; approvedAt: string }, authorityContext: DependencyAuthorityContext = {}) {
  const authority = decideDependency({ operation: "ADD", packageName: amendment.packageName, versionSpec: amendment.versionSpec, dependencySection: amendment.section, context: { ...authorityContext, plannedDependencies: authorityContext.plannedDependencies ?? [{ name: "motion@12.43.0", runtime: "runtime", required: true }] } });
  if (!authority.approved) throw new Error(`UNAPPROVED_DESIGN_DEPENDENCY:${authority.code}`);
  const base = { ...amendment, updatedAt: input.approvedAt, status: "USER_APPROVED" as const, approvedBy: input.approvedBy, approvedAt: input.approvedAt };
  return DesignDependencyAmendmentSchema.parse({ ...base, checksum: stableDesignChecksum(base) });
}

export function stableDesignChecksum(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export type DesignContractValidationCode = "DESIGN_CONTRACT_STALE" | "TYPOGRAPHY_CONTRACT_MISMATCH" | "UNAPPROVED_DESIGN_DEPENDENCY" | "MOTION_STRATEGY_MISMATCH" | "INTERACTION_CONTRACT_MISSING" | "VISUAL_TOKEN_VIOLATION" | "DESIGN_TOOL_EVIDENCE_MISSING" | "IMPECCABLE_DETECTOR_FAILED" | "COMPONENT_SOURCE_EVIDENCE_MISSING";
export type DesignContractValidationIssue = { code: DesignContractValidationCode; directionId: string; message: string };

export function validateDirectionDesignCapability(directionId: string, capability: DirectionDesignCapability, options: { requireLiveEvidence?: boolean; approvedDependencies?: ReadonlySet<string> } = {}) {
  const issues: DesignContractValidationIssue[] = [];
  if (capability.currentness.status !== "CURRENT") issues.push({ code: "DESIGN_CONTRACT_STALE", directionId, message: "The direction design contract is stale." });
  if (capability.typography.normalizedPair.display !== capability.typography.displayFamily || capability.typography.normalizedPair.body !== capability.typography.bodyFamily) issues.push({ code: "TYPOGRAPHY_CONTRACT_MISMATCH", directionId, message: "Typography normalized pair does not match the selected families." });
  if (capability.visualSystem.colorTokens.length < 4) issues.push({ code: "VISUAL_TOKEN_VIOLATION", directionId, message: "The visual system does not define enough semantic color tokens." });
  if (!capability.interactions.length) issues.push({ code: "INTERACTION_CONTRACT_MISSING", directionId, message: "At least one interaction contract is required." });
  if (capability.motion.suitability === "MOTION" && (!capability.motion.dependency || !(options.approvedDependencies?.has("motion@12.43.0") ?? false))) issues.push({ code: "UNAPPROVED_DESIGN_DEPENDENCY", directionId, message: "Motion was selected without an approved Dependency Authority decision." });
  if (capability.motion.suitability !== "MOTION" && capability.motion.dependency) issues.push({ code: "MOTION_STRATEGY_MISMATCH", directionId, message: "The motion dependency is present for a non-Motion strategy." });
  const requiredPass: DesignCapabilityPassEvidence["capabilityId"][] = ["fontpair-normalization", "fontpair-multiple-candidates", "twenty-first-discovery", "react-bits-discovery", "magic-ui-discovery", "shadcn-base-discovery", "impeccable-semantic-skill", "impeccable-critique", "impeccable-antipattern-detector", "emil-design-review", "emil-animation-opportunities", "emil-animation-review", "transitions-pattern-mapping", "transitions-polish", "motion-suitability"];
  for (const capabilityId of requiredPass) {
    const pass = capability.passEvidence.find((item) => item.capabilityId === capabilityId);
    if (!pass || pass.status !== "PASS") issues.push({ code: capabilityId === "impeccable-antipattern-detector" ? "IMPECCABLE_DETECTOR_FAILED" : "DESIGN_TOOL_EVIDENCE_MISSING", directionId, message: `${capabilityId} does not have passing evidence.` });
  }
  if (capability.componentDiscovery.length !== 4 || new Set(capability.componentDiscovery.map((item) => item.source)).size !== 4 || capability.componentDiscovery.some((item) => !item.candidates.length || item.writeAuthority !== "NONE")) issues.push({ code: "COMPONENT_SOURCE_EVIDENCE_MISSING", directionId, message: "Every direction must include bounded read-only evidence from 21st.dev, React Bits, Magic UI, and shadcn/ui." });
  if (options.requireLiveEvidence && capability.toolProvenance.some((item) => item.status !== "AVAILABLE" || !item.liveEvidence)) issues.push({ code: "DESIGN_TOOL_EVIDENCE_MISSING", directionId, message: "Every required professional design tool must have live available evidence." });
  return { valid: issues.length === 0, issues };
}

export function validateExactThreeDesignCapabilities(directions: ReadonlyArray<{ id: string; professionalDesign?: DirectionDesignCapability }>, options: { requireLiveEvidence?: boolean; approvedDependencies?: ReadonlySet<string> } = {}) {
  const issues: DesignContractValidationIssue[] = [];
  if (directions.length !== 3) return { valid: false, issues: [{ code: "DESIGN_CONTRACT_STALE" as const, directionId: "set", message: "Exactly three design directions are required." }] };
  for (const direction of directions) {
    if (!direction.professionalDesign) issues.push({ code: "DESIGN_CONTRACT_STALE", directionId: direction.id, message: "The direction has no professional design contract." });
    else issues.push(...validateDirectionDesignCapability(direction.id, direction.professionalDesign, options).issues);
  }
  if (new Set(directions.map((direction) => direction.professionalDesign?.visualSystem.tokenChecksum)).size !== 3) issues.push({ code: "VISUAL_TOKEN_VIOLATION", directionId: "set", message: "The three directions must have distinct visual token contracts." });
  return { valid: issues.length === 0, issues };
}
