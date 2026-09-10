import { z } from "zod";

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
const SafeReasonCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]+$/).max(120);

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
