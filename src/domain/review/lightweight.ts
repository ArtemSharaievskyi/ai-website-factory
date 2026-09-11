import { z } from "zod";
import { IsoDateTimeSchema, ProjectVersionSchema, UuidSchema } from "@/domain/shared/schemas";
import { ExploratoryQAEvidenceSchema, GermanComplianceResultSchema, SecurityTestEvidenceSchema, SEOImplementationEvidenceSchema } from "@/domain/assurance/contracts";

const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const SafeIdSchema = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/);
const SafeTextSchema = z.string().min(1).max(500);
const RefSchema = z.string().min(1).max(300);
const RelativePathSchema = z.string().min(1).max(300).regex(/^(?![A-Za-z]:[\\/])(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$)).+$/);

export const ReviewAgentIdSchema = z.enum([
  "architecture-reviewer",
  "contract-auditor",
  "code-integration-reviewer",
  "security-reviewer",
  "test-quality-reviewer",
  "browser-qa",
  "accessibility-review",
  "performance-review",
  "visual-regression",
  "release-readiness",
  "seo-review",
  "content-quality",
  "dependency-guardian",
  "documentation",
  "security-test",
  "german-web-compliance",
  "exploratory-qa",
  "ux-critic",
  "product-critic",
  "architecture-critic",
  "design-review",
  "animation-review",
]);
export type ReviewAgentId = z.infer<typeof ReviewAgentIdSchema>;

export const ReviewFindingSeveritySchema = z.enum(["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type ReviewFindingSeverity = z.infer<typeof ReviewFindingSeveritySchema>;
export const ReviewConfidenceSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export const ReviewFindingSchema = z.object({
  id: SafeIdSchema,
  agent: ReviewAgentIdSchema,
  category: SafeIdSchema,
  severity: ReviewFindingSeveritySchema,
  confidence: ReviewConfidenceSchema,
  title: SafeTextSchema,
  safeSummary: z.string().min(1).max(1000),
  affectedArtifacts: z.array(RefSchema).max(30),
  affectedRoutes: z.array(RefSchema).max(30).optional(),
  affectedFiles: z.array(RelativePathSchema).max(30).optional(),
  evidence: z.array(RefSchema).min(1).max(30),
  blocking: z.boolean(),
  repairRequired: z.boolean(),
  canonicalRequirementRefs: z.array(RefSchema).max(30).optional(),
  architectureRefs: z.array(RefSchema).max(30).optional(),
  designRefs: z.array(RefSchema).max(30).optional(),
  taskRefs: z.array(RefSchema).max(30).optional(),
  operation: SafeIdSchema.optional(),
  invariant: SafeIdSchema.optional(),
}).strict();
export type ReviewFinding = z.infer<typeof ReviewFindingSchema>;

export const AgentReviewStatusSchema = z.enum(["PASS", "WARN", "BLOCK"]);
export const AgentReviewResultSchema = z.object({
  agent: ReviewAgentIdSchema,
  status: AgentReviewStatusSchema,
  findings: z.array(ReviewFindingSchema).max(100),
  checksExecuted: z.array(SafeIdSchema).max(100),
  evidenceRefs: z.array(RefSchema).max(100),
  artifactFingerprint: HashSchema,
}).strict().superRefine((result, context) => {
  if (new Set(result.findings.map((finding) => finding.id)).size !== result.findings.length) context.addIssue({ code: "custom", path: ["findings"], message: "Finding IDs must be unique." });
  if (result.status === "BLOCK" && !result.findings.some((finding) => finding.blocking)) context.addIssue({ code: "custom", path: ["findings"], message: "BLOCK requires a blocking finding." });
  if (result.status !== "BLOCK" && result.findings.some((finding) => finding.blocking)) context.addIssue({ code: "custom", path: ["status"], message: "Blocking findings require BLOCK status." });
});
export type AgentReviewResult = z.infer<typeof AgentReviewResultSchema>;

export const ReviewQualityGateSchema = z.object({
  id: SafeIdSchema,
  status: z.enum(["PASS", "WARN", "FAIL", "NOT_RUN"]),
  evidenceRefs: z.array(RefSchema).max(20),
}).strict();
export type ReviewQualityGate = z.infer<typeof ReviewQualityGateSchema>;

const BrowserIssueSchema = z.object({
  kind: SafeIdSchema,
  route: RefSchema.optional(),
  severity: ReviewFindingSeveritySchema.default("HIGH"),
  safeSummary: z.string().max(500),
  blocking: z.boolean().default(true),
}).strict();

export const ReviewSourceFileSchema = z.object({
  relativePath: RelativePathSchema,
  checksum: HashSchema,
  lineCount: z.number().int().nonnegative(),
  content: z.string().max(12_000).optional(),
  markers: z.array(SafeIdSchema).max(30).default([]),
}).strict();
export type ReviewSourceFile = z.infer<typeof ReviewSourceFileSchema>;

export const ReviewBrowserEvidenceSchema = z.object({
  captured: z.boolean(),
  routes: z.array(RefSchema).max(100),
  screenshots: z.array(RefSchema).max(100),
  consoleErrors: z.array(z.object({ kind: SafeIdSchema, route: RefSchema.optional(), safeSummary: z.string().max(500), approvedNoise: z.boolean().default(false) }).strict()).max(100),
  failedRequests: z.array(z.object({ route: RefSchema.optional(), safeSummary: z.string().max(500) }).strict()).max(100),
  viewports: z.array(z.object({ name: SafeIdSchema, width: z.number().int().positive(), height: z.number().int().positive() }).strict()).max(10),
  navigationFailures: z.array(BrowserIssueSchema).max(100).default([]),
  interactionFailures: z.array(BrowserIssueSchema).max(100).default([]),
  flowFailures: z.array(BrowserIssueSchema).max(100).default([]),
  redirectFailures: z.array(BrowserIssueSchema).max(100).default([]),
  responsiveFailures: z.array(BrowserIssueSchema).max(100).default([]),
  stateFailures: z.array(BrowserIssueSchema).max(100).default([]),
  unexpectedRoutes: z.array(RefSchema).max(100).default([]),
  accessibility: z.array(z.object({ rule: SafeIdSchema, route: RefSchema.optional(), impact: ReviewFindingSeveritySchema, safeSummary: z.string().max(500) }).strict()).max(100).default([]),
  visualComparisons: z.array(z.object({ route: RefSchema, screenshotRef: RefSchema, approvedDesignRef: RefSchema, classification: z.enum(["ACCEPTABLE_IMPLEMENTATION_VARIATION", "DESIGN_CONTRACT_VIOLATION"]), safeSummary: z.string().max(500) }).strict()).max(100).default([]),
}).strict();
export type ReviewBrowserEvidence = z.infer<typeof ReviewBrowserEvidenceSchema>;

export const ReviewDependencyDeltaSchema = z.object({
  packageName: SafeIdSchema,
  change: z.enum(["ADDED", "REMOVED", "UPDATED"]),
  fromVersion: z.string().max(80).optional(),
  toVersion: z.string().max(80).optional(),
  authorized: z.boolean(),
  referenced: z.boolean(),
  architectureRef: RefSchema.optional(),
}).strict();
export const ReviewEvidencePackSchema = z.object({
  implementationChecksum: HashSchema,
  buildGates: z.array(ReviewQualityGateSchema).max(30),
  routeRefs: z.array(RefSchema).max(100),
  sourceFiles: z.array(ReviewSourceFileSchema).max(200),
  browser: ReviewBrowserEvidenceSchema.optional(),
  securityTests: SecurityTestEvidenceSchema.optional(),
  germanCompliance: GermanComplianceResultSchema.optional(),
  exploratory: ExploratoryQAEvidenceSchema.optional(),
  seo: SEOImplementationEvidenceSchema.optional(),
  dependencyDelta: z.array(ReviewDependencyDeltaSchema).max(100).default([]),
  metrics: z.record(z.string().regex(/^[a-z][A-Za-z0-9_.-]*$/), z.number().nonnegative()).default({}),
  evidenceRefs: z.array(RefSchema).max(200),
}).strict();
export type ReviewEvidencePack = z.infer<typeof ReviewEvidencePackSchema>;

export const ReviewCapabilitySchema = z.enum([
  "IMPLEMENTED",
  "PUBLIC_SITE",
  "INDEXABLE_PUBLIC_PAGES",
  "AUTH",
  "DATABASE",
  "STORAGE",
  "UPLOAD",
  "EXTERNAL_API",
  "APPROVED_DESIGN",
  "INTERACTIVE_UI",
  "MOTION",
  "PUBLIC_FACTUAL_CONTENT",
  "DEPENDENCY_DELTA",
  "DOCUMENTATION_REQUEST",
  "GERMAN_PUBLIC_SITE",
  "ECOMMERCE",
  "SENSITIVE_DATA",
]);
export type ReviewCapability = z.infer<typeof ReviewCapabilitySchema>;

export const ReviewSnapshotSchema = z.object({
  snapshotId: SafeIdSchema,
  projectId: UuidSchema,
  projectVersion: ProjectVersionSchema,
  implementationChecksum: HashSchema,
  architectureChecksum: HashSchema.optional(),
  designChecksum: HashSchema.optional(),
  designSystemVersion: SafeIdSchema.optional(),
  motionTokenChecksum: HashSchema.optional(),
  approvedRoutes: z.array(RefSchema).max(100),
  approvedUserFlows: z.array(RefSchema).max(100),
  architectureOperationRefs: z.array(RefSchema).max(100),
  designInteractionRefs: z.array(RefSchema).max(100),
  taskRefs: z.array(RefSchema).max(200),
  capabilities: z.array(ReviewCapabilitySchema).max(30),
  evidencePack: ReviewEvidencePackSchema,
  createdAt: IsoDateTimeSchema,
}).strict().superRefine((snapshot, context) => {
  if (snapshot.evidencePack.implementationChecksum !== snapshot.implementationChecksum) context.addIssue({ code: "custom", path: ["evidencePack", "implementationChecksum"], message: "Evidence must bind to the implementation snapshot." });
  if (snapshot.evidencePack.securityTests && snapshot.evidencePack.securityTests.implementationChecksum !== snapshot.implementationChecksum) context.addIssue({ code: "custom", path: ["evidencePack", "securityTests", "implementationChecksum"], message: "Security-test evidence must bind to the implementation snapshot." });
  if (snapshot.evidencePack.germanCompliance && snapshot.evidencePack.germanCompliance.implementationChecksum !== snapshot.implementationChecksum) context.addIssue({ code: "custom", path: ["evidencePack", "germanCompliance", "implementationChecksum"], message: "German compliance evidence must bind to the implementation snapshot." });
  if (snapshot.evidencePack.exploratory && snapshot.evidencePack.exploratory.implementationChecksum !== snapshot.implementationChecksum) context.addIssue({ code: "custom", path: ["evidencePack", "exploratory", "implementationChecksum"], message: "Exploratory evidence must bind to the implementation snapshot." });
  if (snapshot.evidencePack.seo && snapshot.evidencePack.seo.implementationChecksum !== snapshot.implementationChecksum) context.addIssue({ code: "custom", path: ["evidencePack", "seo", "implementationChecksum"], message: "SEO evidence must bind to the implementation snapshot." });
});
export type ReviewSnapshot = z.infer<typeof ReviewSnapshotSchema>;

export const ReviewActivationSkipSchema = z.object({ agent: ReviewAgentIdSchema, reason: SafeTextSchema }).strict();
export const ReviewActivationPlanSchema = z.object({
  required: z.array(ReviewAgentIdSchema),
  optional: z.array(ReviewAgentIdSchema),
  skipped: z.array(ReviewActivationSkipSchema),
}).strict().superRefine((plan, context) => {
  const all = [...plan.required, ...plan.optional, ...plan.skipped.map((item) => item.agent)];
  if (new Set(all).size !== all.length) context.addIssue({ code: "custom", path: ["required"], message: "Each review agent may appear in only one activation bucket." });
});
export type ReviewActivationPlan = z.infer<typeof ReviewActivationPlanSchema>;

export const ReleaseReadinessResultSchema = z.object({
  implementationChecksum: HashSchema,
  requiredReviews: z.array(ReviewAgentIdSchema),
  completedReviews: z.array(ReviewAgentIdSchema),
  blockingFindings: z.array(SafeIdSchema),
  warnings: z.array(SafeIdSchema),
  missingRequiredReviews: z.array(ReviewAgentIdSchema),
  failedGates: z.array(SafeIdSchema),
  verdict: z.enum(["READY", "READY_WITH_WARNINGS", "BLOCKED"]),
}).strict();
export type ReleaseReadinessResult = z.infer<typeof ReleaseReadinessResultSchema>;

export const ReviewCycleResultSchema = z.object({
  snapshotId: SafeIdSchema,
  implementationChecksum: HashSchema,
  results: z.array(AgentReviewResultSchema),
  releaseReadiness: ReleaseReadinessResultSchema,
  maxConcurrency: z.number().int().positive().max(4),
  providerBudget: z.object({ maxCalls: z.literal(0) }).strict(),
  providerCalls: z.literal(0),
}).strict();
export type ReviewCycleResult = z.infer<typeof ReviewCycleResultSchema>;

export const DesignReviewCategorySchema = z.enum([
  "VISUAL_HIERARCHY",
  "TYPOGRAPHY",
  "SPACING",
  "LAYOUT",
  "SURFACES",
  "COLOR",
  "ICONOGRAPHY",
  "COMPONENT_CONSISTENCY",
  "MOTION",
  "INTERACTION_POLISH",
  "RESPONSIVE_CRAFT",
  "DESIGN_DISTINCTIVENESS",
  "AI_SLOP",
]);
export type DesignReviewCategory = z.infer<typeof DesignReviewCategorySchema>;
export const MotionReviewCategorySchema = z.enum([
  "MOTION_JUSTIFICATION",
  "MOTION_FREQUENCY",
  "MOTION_DURATION",
  "MOTION_EASING",
  "MOTION_ORIGIN",
  "MOTION_SCALE",
  "MOTION_INTERRUPTIBILITY",
  "MOTION_PERFORMANCE",
  "MOTION_REDUCED_MOTION",
  "MOTION_HOVER_GATING",
  "MOTION_COHESION",
  "MOTION_ENTER_EXIT",
]);

const AdvisoryBindingSchema = z.object({
  snapshotId: SafeIdSchema,
  implementationChecksum: HashSchema,
  designChecksum: HashSchema.optional(),
  designSystemVersion: SafeIdSchema.optional(),
  motionTokenChecksum: HashSchema.optional(),
  skillId: SafeIdSchema,
  skillChecksum: HashSchema,
  sourceWriteAuthority: z.literal("NONE"),
  canonicalMutationAuthority: z.literal("NONE"),
  advisoryOnly: z.literal(true),
}).strict();

export const MotionImprovementPlanSchema = z.object({
  planId: SafeIdSchema,
  severity: ReviewFindingSeveritySchema,
  category: MotionReviewCategorySchema,
  affectedFiles: z.array(RelativePathSchema).max(30),
  problem: SafeTextSchema,
  target: SafeTextSchema,
  steps: z.array(SafeTextSchema).min(1).max(8),
  verification: z.array(SafeTextSchema).min(1).max(8),
  binding: AdvisoryBindingSchema,
}).strict();
export type MotionImprovementPlan = z.infer<typeof MotionImprovementPlanSchema>;

export const MotionImprovementResultSchema = z.object({
  binding: AdvisoryBindingSchema,
  plans: z.array(MotionImprovementPlanSchema).max(7),
  verdict: z.enum(["NO_IMPROVEMENTS_RECOMMENDED", "IMPROVEMENTS_RECOMMENDED"]),
}).strict();
export type MotionImprovementResult = z.infer<typeof MotionImprovementResultSchema>;

export const AnimationOpportunitySchema = z.object({
  opportunityId: SafeIdSchema,
  route: RefSchema.optional(),
  affectedFiles: z.array(RelativePathSchema).max(10),
  frequency: z.enum(["100_PLUS_PER_DAY", "TENS_PER_DAY", "OCCASIONAL", "RARE"]),
  purpose: SafeTextSchema,
  suggestedMotion: SafeTextSchema,
  decision: z.enum(["RECOMMEND", "REJECT"]),
  rejectionReason: z.string().max(500).optional(),
  evidence: z.array(RefSchema).min(1).max(10),
}).strict().superRefine((opportunity, context) => {
  if (opportunity.decision === "REJECT" && !opportunity.rejectionReason) context.addIssue({ code: "custom", path: ["rejectionReason"], message: "Rejected opportunities require a gate reason." });
  if (opportunity.decision === "RECOMMEND" && opportunity.rejectionReason) context.addIssue({ code: "custom", path: ["rejectionReason"], message: "Recommended opportunities cannot carry a rejection reason." });
});
export type AnimationOpportunity = z.infer<typeof AnimationOpportunitySchema>;

export const AnimationOpportunityResultSchema = z.object({
  binding: AdvisoryBindingSchema,
  suggestions: z.array(AnimationOpportunitySchema).max(7),
  rejectedCandidates: z.array(AnimationOpportunitySchema).max(7),
  verdict: z.enum(["NO_ADDITIONAL_MOTION_RECOMMENDED", "OPPORTUNITIES_RECOMMENDED"]),
}).strict();
export type AnimationOpportunityResult = z.infer<typeof AnimationOpportunityResultSchema>;
