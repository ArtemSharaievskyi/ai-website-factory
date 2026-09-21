import { z } from "zod";
import { RequirementCategorySchema, SemanticRequirementIdSchema } from "@/domain/requirements/v3/schema";

export const PlanningAdmissionBoundarySchema = z.enum(["FINAL_ASSEMBLY", "FINAL_ADMISSION"]);
export type PlanningAdmissionBoundary = z.infer<typeof PlanningAdmissionBoundarySchema>;

export const PlanningAdmissionValidatorSchema = z.enum([
  "ASSEMBLE_STAGED_PLANNING_CANDIDATE",
  "NORMALIZE_PLANNING_PACKAGE",
  "ADMIT_PLANNING_REFRESH",
  "VALIDATE_PLANNING_ADMISSION",
  "VALIDATE_PLANNING_PACKAGE_AGAINST_BRIEF",
  "FINAL_CURRENTNESS",
]);
export type PlanningAdmissionValidator = z.infer<typeof PlanningAdmissionValidatorSchema>;

export const PlanningAdmissionIssueCategorySchema = z.enum([
  "ASSEMBLY",
  "SCHEMA",
  "TRACEABILITY",
  "COVERAGE",
  "ROUTE",
  "CURRENTNESS",
  "DEPENDENCY",
  "CAPABILITY",
  "STRUCTURE",
  "OTHER",
]);
export type PlanningAdmissionIssueCategory = z.infer<typeof PlanningAdmissionIssueCategorySchema>;

const SafeOpaqueTokenSchema = z.string().regex(/^(?:REQ|PE|PAGE|ROUTE)_\d{3,}$/).max(32);
const SafeRequirementTokenSchema = z.string().regex(/^REQ_\d{3,}$/).max(32);
const SafePlanningElementTokenSchema = z.string().regex(/^PE_\d{3,}$/).max(32);
const SafeNormalizedEvidenceTokenSchema = z.string().regex(/^[a-z0-9]+$/).max(32);
const SafeReasonCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]+$/).max(120);
const ChecksumSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const PlanningFinalCoverageIssueKindSchema = z.enum([
  "ABSENT_MAPPING",
  "INVALID_MAPPING",
  "SEMANTIC_MISSING",
  "DIAGNOSTIC_UNAVAILABLE",
]);
export type PlanningFinalCoverageIssueKind = z.infer<typeof PlanningFinalCoverageIssueKindSchema>;

export const PlanningFinalCoverageReferenceStatusSchema = z.enum(["ABSENT", "PRESENT", "INVALID", "UNAVAILABLE"]);
export type PlanningFinalCoverageReferenceStatus = z.infer<typeof PlanningFinalCoverageReferenceStatusSchema>;

export const PlanningFinalCoverageEvidenceStatusSchema = z.enum(["NOT_EVALUATED", "NONE", "PARTIAL", "FULL"]);
export type PlanningFinalCoverageEvidenceStatus = z.infer<typeof PlanningFinalCoverageEvidenceStatusSchema>;

export const PlanningFinalCoverageEvidenceSchema = z.object({
  status: PlanningFinalCoverageEvidenceStatusSchema,
  score: z.number().min(0).max(1).nullable(),
  requiredTokenCount: z.number().int().nonnegative(),
  matchedTokenCount: z.number().int().nonnegative(),
  requiredTokens: z.array(SafeNormalizedEvidenceTokenSchema).max(32),
  matchedTokens: z.array(SafeNormalizedEvidenceTokenSchema).max(32),
  unmatchedTokens: z.array(SafeNormalizedEvidenceTokenSchema).max(32),
  tokenListTruncated: z.boolean(),
  evaluatedFieldPaths: z.array(z.string().regex(/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/).max(120)).max(32),
  normalizedCorpusChecksum: ChecksumSchema.nullable(),
}).strict();
export type PlanningFinalCoverageEvidence = z.infer<typeof PlanningFinalCoverageEvidenceSchema>;

export const PlanningFinalCoverageIssueSchema = z.object({
  canonicalRequirementId: SemanticRequirementIdSchema,
  category: RequirementCategorySchema,
  ownership: z.literal("PLANNING"),
  kind: PlanningFinalCoverageIssueKindSchema,
  reason: z.enum(["MISSING_REFERENCE", "MISSING_SEMANTIC_EVIDENCE"]),
  referenceStatus: PlanningFinalCoverageReferenceStatusSchema,
  canonicalReferencesPresent: z.array(SemanticRequirementIdSchema).max(8),
  stagedRequirementToken: SafeRequirementTokenSchema.optional(),
  planningElementIds: z.array(SafePlanningElementTokenSchema).max(32).optional(),
  normalizedEvidence: PlanningFinalCoverageEvidenceSchema,
  explanation: z.enum(["CANONICAL_REFERENCE_ABSENT", "STAGED_MAPPING_NOT_BOUND", "SEMANTIC_EVIDENCE_BELOW_THRESHOLD"]),
}).strict();
export type PlanningFinalCoverageIssue = z.infer<typeof PlanningFinalCoverageIssueSchema>;

export const PlanningFinalCoverageDiagnosticsSchema = z.object({
  availability: z.enum(["AVAILABLE", "UNAVAILABLE"]),
  issueCount: z.number().int().nonnegative(),
  retainedIssueCount: z.number().int().nonnegative(),
  issues: z.array(PlanningFinalCoverageIssueSchema).max(8),
  truncated: z.boolean(),
}).strict().superRefine((value, context) => {
  if (value.retainedIssueCount !== value.issues.length)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["retainedIssueCount"], message: "retainedIssueCount must equal the retained issue entries" });
  if (value.issueCount < value.retainedIssueCount)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["issueCount"], message: "issueCount cannot be smaller than retainedIssueCount" });
  if (value.truncated !== (value.issueCount > value.retainedIssueCount))
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["truncated"], message: "truncated must describe omitted issue entries" });
  if (value.availability === "AVAILABLE" && value.issueCount === 0)
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["availability"], message: "available coverage diagnostics must retain at least one issue" });
  if (value.availability === "UNAVAILABLE" && (value.issueCount !== 0 || value.issues.length !== 0 || value.truncated))
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["availability"], message: "unavailable coverage diagnostics cannot contain issue entries" });
});
export type PlanningFinalCoverageDiagnostics = z.infer<typeof PlanningFinalCoverageDiagnosticsSchema>;

export type PlanningStagedCoverageBinding = {
  canonicalRequirementId: z.infer<typeof SemanticRequirementIdSchema>;
  stagedRequirementToken: z.infer<typeof SafeRequirementTokenSchema>;
  planningElementIds: z.infer<typeof SafePlanningElementTokenSchema>[];
};

export const PlanningAdmissionIssueSchema = z.object({
  reasonCode: SafeReasonCodeSchema,
  validator: PlanningAdmissionValidatorSchema,
  category: PlanningAdmissionIssueCategorySchema,
  safeToken: SafeOpaqueTokenSchema.optional(),
}).strict();
export type PlanningAdmissionIssue = z.infer<typeof PlanningAdmissionIssueSchema>;

export const PlanningFinalAdmissionDiagnosticsSchema = z.object({
  boundary: PlanningAdmissionBoundarySchema,
  primary: PlanningAdmissionIssueSchema,
  issueCount: z.number().int().positive(),
  safeIssues: z.array(PlanningAdmissionIssueSchema).max(8),
  coverage: PlanningFinalCoverageDiagnosticsSchema.optional(),
}).strict().superRefine((value, context) => {
  const first = value.safeIssues[0];
  if (!first) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["safeIssues"], message: "at least one safe issue is required" });
    return;
  }
  if (JSON.stringify(first) !== JSON.stringify(value.primary)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["primary"], message: "primary must be the first safe issue" });
  }
  if (value.issueCount < value.safeIssues.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["issueCount"], message: "issueCount cannot be smaller than safeIssues" });
  }
});
export type PlanningFinalAdmissionDiagnostics = z.infer<typeof PlanningFinalAdmissionDiagnosticsSchema>;

const MAX_SAFE_ISSUES = 8;
const SAFE_TOKEN_PATTERN = /(?:^|[^A-Z0-9])((?:REQ|PE|PAGE|ROUTE)_\d{3,})(?:$|[^A-Z0-9])/;

function safeReasonCode(value: unknown) {
  return typeof value === "string" && SafeReasonCodeSchema.safeParse(value).success ? value : undefined;
}

function safeToken(value: unknown) {
  if (typeof value !== "string") return undefined;
  const match = value.match(SAFE_TOKEN_PATTERN)?.[1];
  return match && SafeOpaqueTokenSchema.safeParse(match).success ? match : undefined;
}

function categoryFor(reasonCode: string): PlanningAdmissionIssueCategory {
  if (reasonCode.includes("ASSEMBLY")) return "ASSEMBLY";
  if (reasonCode.includes("SCHEMA")) return "SCHEMA";
  if (reasonCode.includes("TRACEABILITY") || reasonCode.includes("REFERENCE")) return "TRACEABILITY";
  if (reasonCode.includes("COVERAGE") || reasonCode.includes("REQUIREMENT")) return "COVERAGE";
  if (reasonCode.includes("ROUTE") || reasonCode.includes("PAGE")) return "ROUTE";
  if (reasonCode.includes("CURRENT") || reasonCode.includes("STALE") || reasonCode.includes("DRIFT")) return "CURRENTNESS";
  if (reasonCode.includes("DEPENDENCY") || reasonCode.includes("GRAPH")) return "DEPENDENCY";
  if (reasonCode.includes("CAPABILITY") || reasonCode.includes("FORM")) return "CAPABILITY";
  if (reasonCode.includes("STRUCTURE") || reasonCode.includes("INCOMPLETE")) return "STRUCTURE";
  return "OTHER";
}

function issueFromBlocker(blocker: string, validator: PlanningAdmissionValidator): PlanningAdmissionIssue | undefined {
  const reasonCode = safeReasonCode(blocker.split(":", 1)[0]);
  if (!reasonCode) return undefined;
  const token = safeToken(blocker);
  return PlanningAdmissionIssueSchema.parse({
    reasonCode,
    validator,
    category: categoryFor(reasonCode),
    ...(token ? { safeToken: token } : {}),
  });
}

function issueKey(issue: PlanningAdmissionIssue) {
  return `${issue.reasonCode}|${issue.validator}|${issue.category}|${issue.safeToken ?? ""}`;
}

export function planningFinalAdmissionDiagnostics(input: {
  boundary: PlanningAdmissionBoundary;
  validator: PlanningAdmissionValidator;
  blockers: readonly string[];
  fallbackReasonCode?: string;
  coverage?: PlanningFinalCoverageDiagnostics;
}): PlanningFinalAdmissionDiagnostics {
  const issues = input.blockers
    .map((blocker) => issueFromBlocker(blocker, input.validator))
    .filter((issue): issue is PlanningAdmissionIssue => Boolean(issue));
  const fallbackReasonCode = safeReasonCode(input.fallbackReasonCode) ?? "PLANNING_FINAL_ADMISSION_FAILED";
  const unique = [...new Map(issues.map((issue) => [issueKey(issue), issue])).values()];
  if (!unique.length) unique.push(PlanningAdmissionIssueSchema.parse({ reasonCode: fallbackReasonCode, validator: input.validator, category: categoryFor(fallbackReasonCode) }));
  unique.sort((left, right) => issueKey(left).localeCompare(issueKey(right), "en"));
  const safeIssues = unique.slice(0, MAX_SAFE_ISSUES);
  return PlanningFinalAdmissionDiagnosticsSchema.parse({
    boundary: input.boundary,
    primary: safeIssues[0],
    issueCount: unique.length,
    safeIssues,
    ...(input.coverage ? { coverage: input.coverage } : {}),
  });
}

export function planningFinalCoverageDiagnostics(input: {
  issues: readonly PlanningFinalCoverageIssue[];
  availability?: "AVAILABLE" | "UNAVAILABLE";
}): PlanningFinalCoverageDiagnostics {
  const unique = [...new Map(input.issues.map((issue) => [`${issue.canonicalRequirementId}|${issue.reason}`, issue])).values()]
    .sort((left, right) => `${left.canonicalRequirementId}|${left.reason}`.localeCompare(`${right.canonicalRequirementId}|${right.reason}`, "en"));
  const retained = unique.slice(0, MAX_SAFE_ISSUES);
  return PlanningFinalCoverageDiagnosticsSchema.parse({
    availability: input.availability ?? "AVAILABLE",
    issueCount: unique.length,
    retainedIssueCount: retained.length,
    issues: retained,
    truncated: unique.length > retained.length,
  });
}

export function planningFinalAdmissionDiagnosticsFromError(input: {
  error: unknown;
  boundary: PlanningAdmissionBoundary;
  validator: PlanningAdmissionValidator;
}, depth = 0): PlanningFinalAdmissionDiagnostics {
  if (depth > 6) return planningFinalAdmissionDiagnostics({ boundary: input.boundary, validator: input.validator, blockers: [], fallbackReasonCode: "PLANNING_FINAL_ADMISSION_FAILED" });
  if (input.error && typeof input.error === "object") {
    const value = input.error as Record<string, unknown>;
    const existing = PlanningFinalAdmissionDiagnosticsSchema.safeParse(value.finalAdmissionDiagnostics);
    if (existing.success) return existing.data;
    if ("cause" in value) {
      const nested = planningFinalAdmissionDiagnosticsFromError({ error: value.cause, boundary: input.boundary, validator: input.validator }, depth + 1);
      if (nested.primary.reasonCode !== "PLANNING_FINAL_ADMISSION_FAILED" || nested.primary.validator !== input.validator) return nested;
    }
    const reasonCode = safeReasonCode(value.reasonCode) ?? safeReasonCode(value.code);
    const token = safeToken(value.safeToken) ?? safeToken(value.reference) ?? safeToken(value.fieldPath);
    if (reasonCode) {
      return planningFinalAdmissionDiagnostics({
        boundary: input.boundary,
        validator: input.validator,
        blockers: [`${reasonCode}${token ? `:${token}` : ""}`],
        fallbackReasonCode: reasonCode,
      });
    }
  }
  return planningFinalAdmissionDiagnostics({ boundary: input.boundary, validator: input.validator, blockers: [], fallbackReasonCode: "PLANNING_FINAL_ADMISSION_FAILED" });
}

export function existingPlanningFinalAdmissionDiagnostics(error: unknown, depth = 0): PlanningFinalAdmissionDiagnostics | undefined {
  if (depth > 6 || !error || typeof error !== "object") return undefined;
  const value = error as Record<string, unknown>;
  const existing = PlanningFinalAdmissionDiagnosticsSchema.safeParse(value.finalAdmissionDiagnostics);
  if (existing.success) return existing.data;
  return "cause" in value ? existingPlanningFinalAdmissionDiagnostics(value.cause, depth + 1) : undefined;
}

export class PlanningFinalAdmissionError extends Error {
  readonly code = "PLANNING_FINAL_ADMISSION_FAILED";
  readonly reasonCode: string;
  readonly safeToken?: string;

  constructor(
    readonly finalAdmissionDiagnostics: PlanningFinalAdmissionDiagnostics,
    readonly blockers: readonly string[] = [],
    message = "Planning candidate failed the deterministic final admission boundary.",
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PlanningFinalAdmissionError";
    this.reasonCode = finalAdmissionDiagnostics.primary.reasonCode;
    this.safeToken = finalAdmissionDiagnostics.primary.safeToken;
  }
}
