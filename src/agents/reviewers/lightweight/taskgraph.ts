import { z } from "zod";
import { createHash } from "node:crypto";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { TaskGraphSchema, type TaskGraph } from "@/domain/tasks/schema";
import { findAgentById } from "@/agents/catalog";
import { ReviewActivationPlanSchema, ReviewAgentIdSchema, ReviewSnapshotSchema, type ReviewActivationPlan, type ReviewAgentId, type ReviewSnapshot } from "@/domain/review/lightweight";

export const ReviewTaskTypeSchema = z.enum([
  "review-browser-qa",
  "review-security",
  "review-accessibility",
  "review-performance",
  "review-visual-regression",
  "review-code",
  "review-architecture",
  "review-contracts",
  "review-test-quality",
  "review-release-readiness",
  "review-seo",
  "review-content-quality",
  "review-dependencies",
  "review-documentation",
]);
export type ReviewTaskType = z.infer<typeof ReviewTaskTypeSchema>;

export const ReviewTaskSchema = z.object({
  taskId: z.string().min(1).max(160),
  agent: ReviewAgentIdSchema,
  taskType: ReviewTaskTypeSchema,
  dependencies: z.array(z.string().min(1).max(160)),
  executionMode: z.enum(["parallel-safe", "sequential"]),
  snapshotId: z.string().min(1).max(160),
  implementationChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  canonicalWriteAuthority: z.literal(false),
}).strict();
export type ReviewTask = z.infer<typeof ReviewTaskSchema>;

export const ReviewTaskGraphSchema = z.object({
  graphId: z.string().min(1).max(160),
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  snapshotId: z.string().min(1).max(160),
  implementationChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  maxConcurrency: z.number().int().positive().max(4),
  tasks: z.array(ReviewTaskSchema).min(1),
}).strict().superRefine((graph, context) => {
  const ids = new Set(graph.tasks.map((task) => task.taskId));
  if (ids.size !== graph.tasks.length) context.addIssue({ code: "custom", path: ["tasks"], message: "Review task IDs must be unique." });
  for (const task of graph.tasks) {
    if (task.snapshotId !== graph.snapshotId || task.implementationChecksum !== graph.implementationChecksum) context.addIssue({ code: "custom", path: ["tasks"], message: "Every review task must bind to the immutable review snapshot." });
    if (task.dependencies.some((dependency) => !ids.has(dependency))) context.addIssue({ code: "custom", path: ["tasks"], message: "Review task dependency does not exist." });
  }
}).transform((graph) => graph);
export type ReviewTaskGraph = z.infer<typeof ReviewTaskGraphSchema>;

const taskTypeFor: Record<ReviewAgentId, ReviewTaskType | undefined> = {
  "architecture-reviewer": "review-architecture",
  "contract-auditor": "review-contracts",
  "code-integration-reviewer": "review-code",
  "security-reviewer": "review-security",
  "test-quality-reviewer": "review-test-quality",
  "browser-qa": "review-browser-qa",
  "accessibility-review": "review-accessibility",
  "performance-review": "review-performance",
  "visual-regression": "review-visual-regression",
  "release-readiness": "review-release-readiness",
  "seo-review": "review-seo",
  "content-quality": "review-content-quality",
  "dependency-guardian": "review-dependencies",
  "documentation": "review-documentation",
};

const deterministicReviewTools: Partial<Record<ReviewAgentId, readonly string[]>> = {
  "browser-qa": ["playwright-functional-qa"],
  "accessibility-review": ["playwright-functional-qa"],
  "performance-review": ["generated-runtime-validation"],
  "visual-regression": ["playwright-functional-qa"],
  "seo-review": ["generated-runtime-validation"],
  "dependency-guardian": ["generated-runtime-validation"],
};

export function buildReviewTaskGraph(input: { snapshot: ReviewSnapshot; activation: ReviewActivationPlan; maxConcurrency?: number }): ReviewTaskGraph {
  const snapshot = ReviewSnapshotSchema.parse(input.snapshot);
  const activation = ReviewActivationPlanSchema.parse(input.activation);
  const maxConcurrency = Math.min(Math.max(input.maxConcurrency ?? 4, 1), 4);
  const reviewers = activation.required.filter((agent) => agent !== "release-readiness");
  const tasks: ReviewTask[] = reviewers.map((agent) => ReviewTaskSchema.parse({ taskId: `review-task:${agent}`, agent, taskType: taskTypeFor[agent], dependencies: [], executionMode: "parallel-safe", snapshotId: snapshot.snapshotId, implementationChecksum: snapshot.implementationChecksum, canonicalWriteAuthority: false }));
  const reviewerTaskIds = tasks.map((task) => task.taskId);
  if (activation.required.includes("release-readiness")) tasks.push(ReviewTaskSchema.parse({ taskId: "review-task:release-readiness", agent: "release-readiness", taskType: "review-release-readiness", dependencies: reviewerTaskIds, executionMode: "sequential", snapshotId: snapshot.snapshotId, implementationChecksum: snapshot.implementationChecksum, canonicalWriteAuthority: false }));
  return ReviewTaskGraphSchema.parse({ graphId: `review-graph:${checksumPersistedDocument({ snapshotId: snapshot.snapshotId, implementationChecksum: snapshot.implementationChecksum, required: activation.required }).slice(0, 24)}`, projectId: snapshot.projectId, projectVersion: snapshot.projectVersion, snapshotId: snapshot.snapshotId, implementationChecksum: snapshot.implementationChecksum, maxConcurrency, tasks });
}

const uuidFor = (value: string) => {
  const bytes = createHash("sha256").update(value, "utf8").digest("hex").slice(0, 32).split("");
  bytes[12] = "4";
  bytes[16] = ((Number.parseInt(bytes[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${bytes.slice(0, 8).join("")}-${bytes.slice(8, 12).join("")}-${bytes.slice(12, 16).join("")}-${bytes.slice(16, 20).join("")}-${bytes.slice(20).join("")}`;
};

/**
 * Materialize the review graph into the Factory's existing typed TaskGraph
 * document without granting any reviewer a write scope or canonical authority.
 */
export function buildReviewTaskGraphDocument(input: { snapshot: ReviewSnapshot; activation: ReviewActivationPlan; maxConcurrency?: number }): TaskGraph {
  const reviewGraph = buildReviewTaskGraph(input);
  const createdAt = input.snapshot.createdAt;
  const idByReviewTaskId = new Map(reviewGraph.tasks.map((task) => [task.taskId, uuidFor(`${reviewGraph.snapshotId}:${task.taskId}`)]));
  const tasks = reviewGraph.tasks.map((reviewTask) => {
    const definition = findAgentById(reviewTask.agent);
    const requirementReferences = input.snapshot.taskRefs.length ? input.snapshot.taskRefs : [`review-snapshot:${reviewGraph.snapshotId}`];
    const planningReferences = input.snapshot.architectureOperationRefs.length ? input.snapshot.architectureOperationRefs : input.snapshot.designInteractionRefs.length ? input.snapshot.designInteractionRefs : [`review-binding:${reviewGraph.snapshotId}`];
    return {
      id: idByReviewTaskId.get(reviewTask.taskId)!,
      projectId: reviewGraph.projectId,
      projectVersion: reviewGraph.projectVersion,
      role: "qa-release" as const,
      taskType: reviewTask.taskType,
      title: `${definition?.displayName ?? reviewTask.agent} review`,
      objective: `Run the deterministic ${reviewTask.agent} review against immutable snapshot ${reviewGraph.snapshotId}.`,
      requirementReferences,
      planningReferences,
      selectedDesignReferences: input.snapshot.designInteractionRefs,
      inputs: [reviewGraph.snapshotId, reviewGraph.implementationChecksum],
      expectedOutputs: ["agent-review.result"],
      acceptanceCriteria: ["Return a typed reviewer result bound to the implementation checksum.", "Do not mutate source or canonical state."],
      allowedSkills: [],
      allowedTools: [...(deterministicReviewTools[reviewTask.agent] ?? [])],
      deniedTools: ["controlled-edit", "filesystem-write", "git-write", "shell-restricted"],
      fileScopes: [],
      requiredArtifacts: ["agent-review.result"],
      dependencies: reviewTask.dependencies.map((dependency) => idByReviewTaskId.get(dependency)!),
      status: "pending" as const,
      priority: "high" as const,
      executionMode: reviewTask.executionMode === "parallel-safe" ? "validation-only" as const : "sequential" as const,
      parallelGroup: reviewTask.executionMode === "parallel-safe" ? `review:${reviewGraph.snapshotId}` : undefined,
      attempt: 0,
      maxAttempts: 1,
      createdAt,
      blockingFailure: true,
      estimatedContextBytes: Math.min(definition?.contextPolicy.maxBytes ?? 120_000, 120_000),
      expectedArtifactTypes: ["agent-review"],
    };
  });
  const base = {
    schemaVersion: 1 as const,
    documentType: "task-graph" as const,
    projectId: reviewGraph.projectId,
    projectVersion: reviewGraph.projectVersion,
    createdAt,
    updatedAt: createdAt,
    tasks,
    orchestrationPolicyVersion: "lightweight-review-v1",
    toolPolicyVersion: "lightweight-review-v1",
    sourceDocumentChecksums: { implementation: reviewGraph.implementationChecksum, ...(input.snapshot.architectureChecksum ? { architecture: input.snapshot.architectureChecksum } : {}), ...(input.snapshot.designChecksum ? { design: input.snapshot.designChecksum } : {}) },
    checkpoint: "release-ready" as const,
    readyForExecution: false,
    blockingReasons: ["LIGHTWEIGHT_REVIEW_HOST_RUNNER_REQUIRED"],
    warnings: [],
    validation: { valid: true, errors: [], warnings: [] },
  };
  return TaskGraphSchema.parse({ ...base, graphChecksum: checksumPersistedDocument(base) });
}
