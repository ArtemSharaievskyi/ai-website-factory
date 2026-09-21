import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { readGitHead, workingTreeEntries } from "./git";
import { loadSession, sessionExists } from "./protected-state";
import { formatBaselineDiagnostics, reconcileWorktreeBaseline, type BaselinePathDiagnostic } from "./worktree-baseline";

export const TaskModeSchema = z.enum(["SOURCE_REPAIR", "REAL_LIFECYCLE", "READ_ONLY_AUDIT"]);
export const TaskStopConditionSchema = z.enum([
  "USER_APPROVAL",
  "SOURCE_DEFECT",
  "PROVIDER_FAILURE",
  "PROVIDER_SEMANTIC_FAILURE",
  "CURRENTNESS_FAILURE",
  "PROVIDER_BUDGET",
  "CONTRACT_UNREPRESENTABLE",
  "BLOCKED",
  "CHANGES_REQUIRED",
]);

export const AgentPolicyModeSchema = z.enum(["SINGLE", "BOUNDED_PARALLEL", "READ_ONLY_SWARM"]);
export const AgentPolicySchema = z.object({
  mode: AgentPolicyModeSchema,
  maxSubagents: z.number().int().min(0).max(4),
  parallelCanonicalWrites: z.literal(false),
  singleIntegrationAuthority: z.literal(true),
  canonicalMutationAuthorities: z.array(z.string().trim().min(1).max(120)).max(1).optional(),
}).strict();

export const ProviderBudgetSchema = z.object({
  lead: z.number().int().min(0).max(100).optional(),
  planner: z.number().int().min(0).max(100).optional(),
  architectureReview: z.number().int().min(0).max(100).optional(),
  design: z.number().int().min(0).max(100).optional(),
  contractAudit: z.number().int().min(0).max(100).optional(),
  codeIntegrationReview: z.number().int().min(0).max(100).optional(),
  securityReview: z.number().int().min(0).max(100).optional(),
  testQualityReview: z.number().int().min(0).max(100).optional(),
  implementation: z.number().int().min(0).max(100).optional(),
}).strict();

export const TaskEnvelopeSchema = z.object({
  mode: TaskModeSchema,
  expectedHead: z.string().regex(/^[0-9a-f]{40}$/i, "expectedHead must be a full Git commit SHA."),
  protectedProjectId: z.string().uuid().optional(),
  operation: z.string().min(1).regex(/^[A-Z][A-Z0-9_]*$/, "operation must be an uppercase identifier."),
  providerBudget: ProviderBudgetSchema,
  allowedSourceMutation: z.boolean(),
  allowedCanonicalMutation: z.boolean(),
  targetState: z.string().min(1),
  stopAt: z.array(TaskStopConditionSchema).min(1).refine((items) => new Set(items).size === items.length, "stopAt must not contain duplicates."),
  agentPolicy: AgentPolicySchema,
}).strict();

export type TaskEnvelope = z.infer<typeof TaskEnvelopeSchema>;
export type TaskMode = z.infer<typeof TaskModeSchema>;

export class TaskEnvelopeError extends Error {
  constructor(readonly code: string, message = code) {
    super(`${code}${message === code ? "" : `:${message}`}`);
    this.name = "TaskEnvelopeError";
  }
}

const hasProviderBudget = (budget: TaskEnvelope["providerBudget"]) => Object.values(budget).some((value) => (value ?? 0) > 0);
const assertZeroProviderBudget = (envelope: TaskEnvelope, code: string) => {
  if (hasProviderBudget(envelope.providerBudget)) throw new TaskEnvelopeError(code);
};

export function validateTaskEnvelope(input: unknown): TaskEnvelope {
  const result = TaskEnvelopeSchema.safeParse(input);
  if (!result.success) {
    const detail = result.error.issues.map((issue) => `${issue.path.join(".") || "envelope"}:${issue.message}`).join(",");
    throw new TaskEnvelopeError("TASK_ENVELOPE_SCHEMA_INVALID", detail);
  }
  const envelope = result.data;
  if (envelope.mode === "SOURCE_REPAIR" && (!envelope.allowedSourceMutation || envelope.allowedCanonicalMutation)) {
    throw new TaskEnvelopeError("TASK_ENVELOPE_SOURCE_REPAIR_MUTATION_INVALID");
  }
  if (envelope.mode === "REAL_LIFECYCLE" && (envelope.allowedSourceMutation || !envelope.allowedCanonicalMutation)) {
    throw new TaskEnvelopeError("TASK_ENVELOPE_REAL_LIFECYCLE_MUTATION_INVALID");
  }
  if (envelope.mode === "REAL_LIFECYCLE" && !envelope.protectedProjectId) {
    throw new TaskEnvelopeError("TASK_ENVELOPE_PROTECTED_PROJECT_REQUIRED");
  }
  if (envelope.mode === "READ_ONLY_AUDIT" && (envelope.allowedSourceMutation || envelope.allowedCanonicalMutation)) {
    throw new TaskEnvelopeError("TASK_ENVELOPE_READ_ONLY_MUTATION_INVALID");
  }
  if (envelope.agentPolicy.mode === "SINGLE" && envelope.agentPolicy.maxSubagents !== 0) {
    throw new TaskEnvelopeError("TASK_ENVELOPE_SINGLE_AGENT_BOUND_INVALID");
  }
  if (envelope.agentPolicy.mode === "BOUNDED_PARALLEL" && envelope.agentPolicy.maxSubagents < 1) {
    throw new TaskEnvelopeError("TASK_ENVELOPE_BOUNDED_PARALLEL_BOUND_INVALID");
  }
  if (envelope.agentPolicy.mode === "READ_ONLY_SWARM" && envelope.agentPolicy.maxSubagents < 1) {
    throw new TaskEnvelopeError("TASK_ENVELOPE_READ_ONLY_SWARM_BOUND_INVALID");
  }
  if (envelope.agentPolicy.mode === "READ_ONLY_SWARM" && (envelope.allowedSourceMutation || envelope.allowedCanonicalMutation)) {
    throw new TaskEnvelopeError("TASK_ENVELOPE_READ_ONLY_SWARM_MUTATION_INVALID");
  }
  if (envelope.mode === "SOURCE_REPAIR") assertZeroProviderBudget(envelope, "TASK_ENVELOPE_SOURCE_REPAIR_PROVIDER_BUDGET_FORBIDDEN");
  if (envelope.mode === "READ_ONLY_AUDIT") assertZeroProviderBudget(envelope, "TASK_ENVELOPE_READ_ONLY_PROVIDER_BUDGET_FORBIDDEN");
  return envelope;
}

export function parsePorcelainPaths(stdout: string) {
  const entries: string[] = [];
  const records = stdout.includes("\0") ? stdout.split("\0") : stdout.split(/\r?\n/).map((line) => line.trimEnd());
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const value = record.slice(3);
    if (!value) continue;
    const renamed = value.lastIndexOf(" -> ");
    entries.push((renamed >= 0 ? value.slice(renamed + 4) : value).replaceAll("\\", "/"));
    if (renamed >= 0 || record[0] === "R" || record[0] === "C" || record[1] === "R" || record[1] === "C") {
      const original = records[index + 1];
      if (original) entries.push(original.replaceAll("\\", "/"));
      index += 1;
    }
  }
  return [...new Set(entries)].sort();
}

export async function workingTreePaths(root: string) {
  try { return (await workingTreeEntries(root)).map((entry) => entry.path); }
  catch { throw new TaskEnvelopeError("TASK_ENVELOPE_SOURCE_STATUS_UNAVAILABLE"); }
}

export type TaskPreflightReport = {
  envelope: TaskEnvelope;
  currentHead: string;
  workingTreePaths: string[];
  ignoredBaselinePaths: string[];
  pathDiagnostics: BaselinePathDiagnostic[];
  protectedSessionRequired: boolean;
  protectedSessionFound: boolean;
};

export async function preflightTaskEnvelope(root: string, input: unknown, options: { envelopePath?: string } = {}): Promise<TaskPreflightReport> {
  const envelope = validateTaskEnvelope(input);
  const currentHead = await readGitHead(root);
  if (envelope.expectedHead.toLowerCase() !== currentHead.toLowerCase()) throw new TaskEnvelopeError("TASK_ENVELOPE_EXPECTED_HEAD_MISMATCH");
  let session: Awaited<ReturnType<typeof loadSession>> | undefined;
  if (await sessionExists(root)) {
    try { session = await loadSession(root); }
    catch { throw new TaskEnvelopeError("TASK_ENVELOPE_PROTECTED_SESSION_INVALID"); }
  } else if (envelope.mode === "REAL_LIFECYCLE") throw new TaskEnvelopeError("TASK_ENVELOPE_PROTECTED_SESSION_REQUIRED");
  const entries = await workingTreeEntries(root).catch(() => { throw new TaskEnvelopeError("TASK_ENVELOPE_SOURCE_STATUS_UNAVAILABLE"); });
  const envelopePath = options.envelopePath ? path.relative(root, options.envelopePath).replaceAll("\\", "/") : undefined;
  const reconciliation = await reconcileWorktreeBaseline({ root, entries, baselineArtifacts: session?.baselineArtifacts ?? [], ...(envelopePath ? { envelopePath } : {}) });
  if (!reconciliation.passed) throw new TaskEnvelopeError("TASK_ENVELOPE_SOURCE_NOT_CLEAN", formatBaselineDiagnostics(reconciliation.rejected));
  const paths = entries.map((entry) => entry.path);
  const ignoredBaselinePaths = reconciliation.accepted.map((diagnostic) => diagnostic.path);
  const pathDiagnostics = [...reconciliation.accepted, ...reconciliation.rejected];
  if (envelope.mode !== "REAL_LIFECYCLE") return { envelope, currentHead, workingTreePaths: paths, ignoredBaselinePaths, pathDiagnostics, protectedSessionRequired: false, protectedSessionFound: Boolean(session) };
  const protectedProjectId = envelope.protectedProjectId!;
  if (!session?.protectedProjects.some((project) => project.projectId.toLowerCase() === protectedProjectId.toLowerCase())) {
    throw new TaskEnvelopeError("TASK_ENVELOPE_PROTECTED_PROJECT_NOT_IN_SESSION");
  }
  return { envelope, currentHead, workingTreePaths: paths, ignoredBaselinePaths, pathDiagnostics, protectedSessionRequired: true, protectedSessionFound: true };
}

export async function readTaskEnvelope(filename: string) {
  let value: unknown;
  try { value = JSON.parse(await readFile(filename, "utf8")) as unknown; } catch { throw new TaskEnvelopeError("TASK_ENVELOPE_FILE_INVALID"); }
  return value;
}
