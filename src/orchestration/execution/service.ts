import { randomUUID } from "node:crypto";
import {
  AgentTaskSchema,
  TaskGraphSchema,
  type AgentTask,
  type TaskGraph,
} from "@/domain/tasks/schema";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { FullExecutionError } from "./errors";
import {
  DEFAULT_FULL_EXECUTION_POLICY,
  ExecutionCheckpointSchema,
  ExecutionPauseStateSchema,
  ExecutionSummarySchema,
  RepairCycleRecordSchema,
  TaskExecutionDispatchSchema,
  TaskExecutionOutcomeSchema,
  TaskGraphExecutionRunSchema,
  type ExecutionStatePort,
  type FullExecutionPolicy,
  type FullExecutionReconciliationInput,
  type FullExecutionSnapshot,
  type FullExecutionStartInput,
  type RepairPort,
  type TaskExecutionContext,
  type TaskExecutionOutcome,
  type TaskExecutorPort,
  type TaskGraphExecutionRun,
} from "./contracts";
import { QualityCheckSchema, type QualityCheck } from "@/domain/quality/schema";
import {
  graphChecksum,
  taskCategory,
  taskExecutionCapability,
  validateFullExecutionReadiness,
} from "./policy";
import { taskCapabilitiesFor } from "@/orchestration/tooling/authority";
import { resolveTools } from "@/orchestration/orchestrator/tools";

const now = () => new Date().toISOString();
const withoutGraphChecksum = (graph: TaskGraph) => {
  const copy = { ...graph };
  delete copy.graphChecksum;
  return copy;
};
const withGraphChecksum = (graph: TaskGraph) =>
  TaskGraphSchema.parse({
    ...graph,
    graphChecksum: checksumPersistedDocument(withoutGraphChecksum(graph)),
  });
const runtimeOperation: Readonly<
  Record<string, "lint" | "typecheck" | "tests" | "build">
> = {
  "runtime-lint": "lint",
  "runtime-typecheck": "typecheck",
  "runtime-tests": "tests",
  "runtime-build": "build",
};
const recordsEqual = (left: Record<string, string>, right: Record<string, string>) =>
  Object.keys(left).length === Object.keys(right).length &&
  Object.entries(left).every(([key, value]) => right[key] === value);
const executionIdentityFor = (input: FullExecutionStartInput) => input.executionIdentity ?? `full-execution:${input.projectId}:${input.projectVersion}`;
export function fullExecutionRequestChecksum(input: FullExecutionStartInput) {
  return checksumPersistedDocument({
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    executionIdentity: executionIdentityFor(input),
    idempotencyKey: input.idempotencyKey,
    graph: input.graph,
    expectedGraphChecksum: input.expectedGraphChecksum,
    workflowState: input.workflowState,
    projectImmutable: input.projectImmutable,
    workspaceValid: input.workspaceValid,
    sourceDocumentChecksums: input.sourceDocumentChecksums,
    currentDocumentChecksums: input.currentDocumentChecksums,
    toolPolicyVersion: input.toolPolicyVersion,
    activeRunIds: input.activeRunIds ?? [],
    requirementChangePending: input.requirementChangePending ?? false,
    pause: input.pause ?? false,
  });
}

const defaultRepairer: RepairPort = {
  async create(input) {
    const source = input.failedTask;
    if (!source.fileScopes.length)
      return {
        unresolvedCode: "REPAIR_SCOPE_UNRESOLVED",
        unresolvedSummary: `taskId=${source.id};taskType=${source.taskType};reason=original task has no writable scope`,
      };
    const repairTools = resolveTools("repair-targeted-failure");
    const repairTask = AgentTaskSchema.parse({
      ...source,
      id: randomUUID(),
      taskType: "repair-targeted-failure",
      role: "implementation",
      title: `Repair ${source.title}`,
      objective:
        input.failure.safeFailureSummary ??
        "Apply the targeted repair for the failed validation.",
      dependencies: source.dependencies,
      status: "ready",
      executionMode: "exclusive-write",
      parallelGroup: undefined,
      attempt: 0,
      maxAttempts: 1,
      repairOfTaskId: source.id,
      safeFailureCode: input.failure.safeFailureCode,
      acceptanceCriteria: [
        `Repair references ${source.id}`,
        input.failure.safeFailureSummary ??
          "The original failure is corrected.",
      ],
      fileScopes: [...source.fileScopes],
      allowedTools: repairTools.allowed,
      deniedTools: repairTools.denied,
      requiredCapabilities: taskCapabilitiesFor({ taskType: "repair-targeted-failure", allowedTools: repairTools.allowed }),
      createdAt: now(),
      startedAt: undefined,
      completedAt: undefined,
    });
    return {
      repairTask,
      rerunTaskIds: [source.id],
      affectedScopes: [...source.fileScopes],
    };
  },
};

export class FullTaskGraphExecutor {
  private readonly active = new Map<
    string,
    {
      controller: AbortController;
      promise: Promise<TaskGraphExecutionRun>;
      input: FullExecutionStartInput;
    }
  >();
  private readonly completed = new Map<
    string,
    { hash: string; run: TaskGraphExecutionRun }
  >();
  private readonly paused = new Set<string>();
  private repairTargets = new Map<string, string>();
  private pauseRequest?: { runId: string; reason: string };
  private pauseRequested = false;
  constructor(
    private readonly state: ExecutionStatePort,
    private readonly executors: TaskExecutorPort,
    private readonly repairer: RepairPort = defaultRepairer,
    private readonly policy: FullExecutionPolicy = DEFAULT_FULL_EXECUTION_POLICY,
    private readonly clock: () => string = now,
  ) {}

  async execute(
    input: FullExecutionStartInput,
  ): Promise<TaskGraphExecutionRun> {
    const normalizedInput = { ...input, executionIdentity: executionIdentityFor(input) };
    const key = `${normalizedInput.projectId}:${normalizedInput.projectVersion}:${normalizedInput.idempotencyKey}`;
    const hash = fullExecutionRequestChecksum(normalizedInput);
    const prior = this.completed.get(key);
    if (prior) {
      if (prior.hash !== hash)
        throw new FullExecutionError(
          "FULL_EXECUTION_IDEMPOTENCY_CONFLICT",
          "Execution idempotency key was reused with different input.",
        );
      return prior.run;
    }
    const persisted = await this.state.load({ projectId: normalizedInput.projectId, projectVersion: normalizedInput.projectVersion });
    const persistedRun = persisted.executionRun;
    if (persistedRun && persistedRun.idempotencyKey === normalizedInput.idempotencyKey) {
      if (persisted.executionRequestChecksum !== hash)
        throw new FullExecutionError("FULL_EXECUTION_IDEMPOTENCY_CONFLICT", "Execution idempotency key was reused with different input.");
      if (["paused", "failed", "cancelled", "completed"].includes(persistedRun.status) && !persisted.activeRunIds.includes(persistedRun.runId)) return persistedRun;
    }
    if (persisted.activeRunIds.length)
      throw new FullExecutionError("FULL_EXECUTION_CONFLICT", "Another full execution is active for this project version.");
    const existing = [...this.active.values()].find(
      (session) =>
        session.input.projectId === normalizedInput.projectId &&
        session.input.projectVersion === normalizedInput.projectVersion,
    );
    if (existing)
      throw new FullExecutionError(
        "FULL_EXECUTION_CONFLICT",
        "Another full execution is active for this project version.",
      );
    const controller = new AbortController();
    if (normalizedInput.signal)
      normalizedInput.signal.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
    const promise = this.start(normalizedInput, controller, hash);
    this.active.set(key, { controller, promise, input: normalizedInput });
    try {
      const run = await promise;
      if (["paused", "failed", "cancelled", "completed"].includes(run.status)) this.completed.set(key, { hash, run });
      return run;
    } finally {
      this.active.delete(key);
      try {
        await this.state.release?.(input.projectId, input.projectVersion);
      } catch {
        // Lease cleanup is best-effort; the durable run state remains authoritative.
      }
    }
  }

  async pause(runId: string, reason = "Explicit pause requested.") {
    const session = [...this.active.values()].find(
      (candidate) =>
        candidate.input.projectId && candidate.input.projectVersion,
    );
    if (!session)
      throw new FullExecutionError(
        "FULL_EXECUTION_RESUME_BLOCKED",
        "No active execution session was found.",
      );
    this.paused.add(runId);
    this.pauseRequested = true;
    this.pauseRequest = { runId, reason };
    return { runId, reason };
  }
  async cancel(runId: string) {
    if (!runId)
      throw new FullExecutionError(
        "FULL_EXECUTION_CANCELLED",
        "An execution run ID is required.",
      );
    const session = [...this.active.values()].find(
      (candidate) =>
        candidate.input.projectId && candidate.input.projectVersion,
    );
    if (!session)
      throw new FullExecutionError(
        "FULL_EXECUTION_CANCELLED",
        "No active execution session was found.",
      );
    session.controller.abort();
    return true;
  }
  async resume(runId: string, input: FullExecutionStartInput) {
    const snapshot = await this.state.load({
      projectId: input.projectId,
      projectVersion: input.projectVersion,
    });
    if (snapshot.activeRunIds.includes(runId))
      throw new FullExecutionError(
        "FULL_EXECUTION_RESUME_BLOCKED",
        "The prior execution is still active.",
      );
    if (
      input.expectedGraphChecksum !== graphChecksum(snapshot.graph) ||
      !snapshot.workspaceValid ||
      snapshot.projectImmutable
    )
      throw new FullExecutionError(
        "FULL_EXECUTION_RESUME_BLOCKED",
        "Execution resume inputs are stale or immutable.",
      );
    this.paused.delete(runId);
    return this.execute({ ...input, activeRunIds: [] });
  }

  private async start(
    input: FullExecutionStartInput,
    controller: AbortController,
    requestChecksum: string,
  ): Promise<TaskGraphExecutionRun> {
    validateFullExecutionReadiness(input, this.policy);
    const runId = randomUUID();
    let graph = withGraphChecksum(input.graph);
    const start = this.clock();
    let run = TaskGraphExecutionRunSchema.parse({
      runId,
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      taskGraphChecksum: graphChecksum(graph),
      sourceDocumentChecksums: input.sourceDocumentChecksums,
      executionPolicyVersion: this.policy.version,
      startedAt: start,
      status: "running",
      currentCheckpoint: this.checkpoint("execution-started", graph),
      executedTaskIds: [],
      passedTaskIds: [],
      failedTaskIds: [],
      cancelledTaskIds: [],
      blockedTaskIds: [],
      repairCycles: [],
      qualityGateSummary: [],
      finalWorkflowState: "IMPLEMENTING",
      pauseState: ExecutionPauseStateSchema.parse({ paused: false }),
      idempotencyKey: input.idempotencyKey,
      executionIdentity: executionIdentityFor(input),
    });
    await this.persist(run, graph, input.workflowState, "run-started", input, graph, requestChecksum);
    const repairFor = new Map<string, string>(
      graph.tasks
        .filter((task) => task.repairOfTaskId)
        .map((task) => [task.id, task.repairOfTaskId!]),
    );
    this.repairTargets = repairFor;
    for (
      let iteration = 0;
      iteration < this.policy.maxSchedulerIterations;
      iteration++
    ) {
      const snapshot = await this.state.load({
        projectId: input.projectId,
        projectVersion: input.projectVersion,
      });
      this.ensureFresh(input, snapshot, graph);
      if (
        this.pauseRequested ||
        this.paused.has(runId) ||
        this.pauseRequest?.runId === runId ||
        input.pause
      ) {
        run = {
          ...run,
          status: "paused",
          currentCheckpoint: this.checkpoint("execution-paused", graph),
          pauseState: {
            paused: true,
            requestedAt: this.clock(),
            reason: this.pauseRequest?.reason ?? "Explicit pause requested.",
          },
        };
        await this.persist(run, graph, input.workflowState, "run-paused", input, graph, requestChecksum);
        this.pauseRequested = false;
        return run;
      }
      if (controller.signal.aborted) {
        const persistedGraph = graph;
        graph = this.cancelPending(graph);
        run = {
          ...run,
          status: "cancelled",
          cancelledTaskIds: graph.tasks
            .filter((task) => task.status === "cancelled")
            .map((task) => task.id),
          currentCheckpoint: this.checkpoint("execution-cancelled", graph),
          completedAt: this.clock(),
          finalWorkflowState: input.workflowState,
          safeFailureCode: "FULL_EXECUTION_CANCELLED",
        };
        await this.persist(run, graph, input.workflowState, "run-cancelled", input, persistedGraph, requestChecksum);
        return run;
      }
      const ready = this.selectReady(graph).filter(
        (task) => !this.policy.releaseBoundaryTaskTypes.includes(task.taskType),
      );
      if (ready.length === 0) {
        const persistedGraph = graph;
        graph = this.blockDependents(graph);
        const boundary = graph.tasks.filter(
          (task) =>
            !this.policy.releaseBoundaryTaskTypes.includes(task.taskType) &&
            task.status !== "cancelled",
        );
        const complete = boundary.every((task) => task.status === "passed");
        const failed = graph.tasks.some((task) => task.status === "failed");
        const blocked = graph.tasks.some((task) => task.status === "blocked");
        if (complete && !failed && !blocked) {
          run = {
            ...run,
            status: "completed",
            currentCheckpoint: this.checkpoint("execution-complete", graph),
            completedAt: this.clock(),
            finalWorkflowState: "VALIDATING",
            qualityGateSummary: snapshot.qualityChecks,
            passedTaskIds: graph.tasks
              .filter((task) => task.status === "passed")
              .map((task) => task.id),
          };
          await this.finishSummary(run, graph, input, snapshot, persistedGraph);
          return run;
        }
        if (failed || blocked) {
          const failureCode = run.safeFailureCode ?? "FULL_EXECUTION_NOT_READY";
          run = {
            ...run,
            status: "failed",
            currentCheckpoint: this.checkpoint(
              "execution-failed",
              graph,
              failureCode,
            ),
            completedAt: this.clock(),
            finalWorkflowState: input.workflowState,
            failedTaskIds: graph.tasks
              .filter((task) => task.status === "failed")
              .map((task) => task.id),
            blockedTaskIds: graph.tasks
              .filter((task) => task.status === "blocked")
              .map((task) => task.id),
            safeFailureCode: failureCode,
          };
          await this.persist(run, graph, input.workflowState, "run-failed", input, persistedGraph, requestChecksum);
          return run;
        }
        throw new FullExecutionError(
          "FULL_EXECUTION_NOT_READY",
          "Scheduler reached a graph state with no executable READY task.",
        );
      }
      if (
        ready.some((task) => taskCategory(task.taskType) !== "implementation")
      )
        run = {
          ...run,
          status: "validating",
          currentCheckpoint: this.checkpoint("validation-started", graph),
        };
      else
        run = {
          ...run,
          currentCheckpoint: this.checkpoint(
            "implementation-wave-started",
            graph,
          ),
        };
      const selected = this.selectNonConflicting(ready);
      const outcomes = await Promise.all(
        selected.map(async (task) => {
          const dispatch = TaskExecutionDispatchSchema.parse({
            dispatchId: randomUUID(),
            runId,
            taskId: task.id,
            taskType: task.taskType,
            category: taskCategory(task.taskType),
            attempt: task.attempt,
            startedAt: this.clock(),
            executionPolicyVersion: this.policy.version,
          });
          await this.state.appendEvent({
            runId,
            type: "task-dispatched",
            taskId: task.id,
            timestamp: dispatch.startedAt,
          });
          return {
            task,
            outcome: await this.dispatch({
              runId,
              projectId: input.projectId,
              projectVersion: input.projectVersion,
              task,
              graph,
              signal: controller.signal,
            }),
          };
        }),
      );
      for (const item of outcomes) {
        const persistedGraph = graph;
        run = await this.applyOutcome(
          run,
          graph,
          item.task,
          item.outcome,
          repairFor,
        );
        graph = withGraphChecksum(
          this.graphAfterOutcome(graph, item.task, item.outcome),
        );
        await this.persist(
          run,
          graph,
          run.status === "validating" ? "VALIDATING" : input.workflowState,
          item.outcome.status === "passed" ? "task-completed" : "task-failed",
          input,
          persistedGraph,
          requestChecksum,
        );
        if (
          item.outcome.status === "failed" &&
          item.outcome.classification === "repairable"
        ) {
          const cycleCount = run.repairCycles.filter(
            (cycle) => cycle.originalTaskId === item.task.id,
          ).length;
          if (
            cycleCount >= this.policy.maxRepairCyclesPerTask ||
            run.repairCycles.length >= this.policy.maxTotalRepairCycles
          ) {
            run = {
              ...run,
              status: "failed",
              safeFailureCode: "FULL_EXECUTION_REPAIR_LIMIT_EXCEEDED",
            };
            await this.persist(
              run,
              graph,
              input.workflowState,
              "repair-limit-exceeded",
              input,
              graph,
              requestChecksum,
            );
            return run;
          }
          const repair = await this.repairer.create({
            runId,
            failedTask: item.task,
            failure: item.outcome,
            cycleNumber: cycleCount + 1,
            graph,
          });
          if ("unresolvedCode" in repair) {
            run = {
              ...run,
              status: "failed",
              safeFailureCode: repair.unresolvedCode,
              safeFailureSummary: repair.unresolvedSummary,
              currentCheckpoint: this.checkpoint(
                "execution-failed",
                graph,
                repair.unresolvedCode,
              ),
            };
            await this.persist(
              run,
              graph,
              input.workflowState,
              "repair-scope-unresolved",
              input,
              graph,
              requestChecksum,
            );
            return run;
          }
          const cycle = RepairCycleRecordSchema.parse({
            cycleId: randomUUID(),
            cycleNumber: cycleCount + 1,
            originalTaskId: item.task.id,
            failedValidationTaskId:
              taskCategory(item.task.taskType) === "runtime-validation" ||
              taskCategory(item.task.taskType) === "functional-qa"
                ? item.task.id
                : undefined,
            repairTaskId: repair.repairTask.id,
            failureCode:
              item.outcome.safeFailureCode ?? "FULL_EXECUTION_TASK_UNSUPPORTED",
            diagnosticSummary:
              item.outcome.safeFailureSummary ?? "Targeted repair requested.",
            affectedScopes: repair.affectedScopes,
            requirementReferences: item.task.requirementReferences ?? [],
            planningReferences: item.task.planningReferences ?? [],
            status: "created",
            rerunTaskIds: repair.rerunTaskIds,
            createdAt: this.clock(),
          });
          run = {
            ...run,
            repairCycles: [...run.repairCycles, cycle],
            currentCheckpoint: this.checkpoint("repair-created", graph),
          };
          repairFor.set(repair.repairTask.id, item.task.id);
          const persistedGraph = graph;
          graph = withGraphChecksum({
            ...graph,
            tasks: [...graph.tasks, repair.repairTask],
            updatedAt: this.clock(),
          });
          await this.persist(run, graph, input.workflowState, "repair-created", input, persistedGraph, requestChecksum);
        }
      }
    }
    throw new FullExecutionError(
      "FULL_EXECUTION_NOT_READY",
      "The bounded scheduler iteration limit was reached.",
    );
  }

  private async dispatch(
    context: TaskExecutionContext,
  ): Promise<TaskExecutionOutcome> {
    const category = taskCategory(context.task.taskType);
    const capability = taskExecutionCapability(context.task.taskType);
    try {
      if (capability === "implementation" && this.executors.implementation)
        return TaskExecutionOutcomeSchema.parse(
          await this.executors.implementation(context),
        );
      if (
        capability?.startsWith("runtime-") &&
        this.executors.runtimeValidation
      )
        return TaskExecutionOutcomeSchema.parse(
          await this.executors.runtimeValidation(
            context,
            runtimeOperation[capability],
          ),
        );
      if (capability === "database-validation" && this.executors.databaseValidation)
        return TaskExecutionOutcomeSchema.parse(
          await this.executors.databaseValidation(context),
        );
      if (capability === "functional-qa" && this.executors.functionalQa)
        return TaskExecutionOutcomeSchema.parse(
          await this.executors.functionalQa(context),
        );
      if (capability === "static-security" && this.executors.staticValidation)
        return TaskExecutionOutcomeSchema.parse(
          await this.executors.staticValidation(context),
        );
      return TaskExecutionOutcomeSchema.parse({
        taskId: context.task.id,
        status: "failed",
        classification: "blocking-nonrepairable",
        repairable: false,
        safeFailureCode: "FULL_EXECUTION_TASK_UNSUPPORTED",
        safeFailureSummary: `No approved executor exists for task capability ${capability ?? category}.`,
      });
    } catch (error) {
      const safeFailureCode =
        typeof error === "object" &&
        error &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : "FULL_EXECUTION_EXECUTOR_FAILURE";
      return TaskExecutionOutcomeSchema.parse({
        taskId: context.task.id,
        status: context.signal.aborted ? "cancelled" : "failed",
        classification: context.signal.aborted
          ? "cancelled"
          : "infrastructure-failure",
        repairable: false,
        safeFailureCode,
        safeFailureSummary:
          error instanceof Error
            ? error.message.slice(0, 1000)
            : "Task execution failed safely.",
      });
    }
  }
  private selectReady(graph: TaskGraph) {
    return graph.tasks.filter(
      (task) =>
        task.status === "ready" &&
        task.dependencies.every(
          (dependency) =>
            graph.tasks.find((candidate) => candidate.id === dependency)
              ?.status === "passed",
        ),
    );
  }
  private selectNonConflicting(tasks: AgentTask[]) {
    const selected: AgentTask[] = [];
    for (const task of tasks.sort((a, b) => a.id.localeCompare(b.id))) {
      if (selected.length >= this.policy.maxConcurrency) break;
      if (
        selected.some(
          (other) =>
            this.overlap(task.fileScopes, other.fileScopes) ||
            task.executionMode !== "parallel-safe" ||
            other.executionMode !== "parallel-safe",
        )
      )
        continue;
      selected.push(task);
    }
    return selected.length ? selected : tasks.slice(0, 1);
  }
  private overlap(left: string[], right: string[]) {
    return left.some((a) =>
      right.some(
        (b) =>
          a === b ||
          a === "**" ||
          b === "**" ||
          (a.endsWith("/**") && b.startsWith(a.slice(0, -3))) ||
          (b.endsWith("/**") && a.startsWith(b.slice(0, -3))),
      ),
    );
  }
  private graphAfterOutcome(
    graph: TaskGraph,
    task: AgentTask,
    outcome: TaskExecutionOutcome,
  ) {
    const status: AgentTask["status"] =
      outcome.status === "passed"
        ? "passed"
        : outcome.status === "cancelled"
          ? "cancelled"
          : "failed";
    let tasks = graph.tasks.map((candidate) =>
      candidate.id === task.id
        ? {
            ...candidate,
            status,
            attempt: candidate.attempt + 1,
            ...(outcome.sourceChecksum
              ? { validationSourceChecksum: outcome.sourceChecksum }
              : {}),
            ...(outcome.validationPlanChecksum
              ? { validationPlanChecksum: outcome.validationPlanChecksum }
              : {}),
            ...(outcome.diagnosticPolicyVersion
              ? {
                  validationDiagnosticPolicyVersion:
                    outcome.diagnosticPolicyVersion,
                }
              : {}),
            ...(outcome.diagnostics
              ? {
                  validationDiagnosticCount: outcome.diagnostics.length,
                  validationDiagnostics: outcome.diagnostics,
                }
              : {}),
            ...(outcome.status === "failed" || outcome.status === "cancelled"
              ? {
                  safeFailureCode: outcome.safeFailureCode,
                  completedAt: this.clock(),
                }
              : { completedAt: this.clock() }),
          }
        : candidate,
    );
    if (
      outcome.status === "failed" &&
      outcome.classification === "retryable-task" &&
      task.attempt + 1 < task.maxAttempts
    )
      tasks = tasks.map((candidate) =>
        candidate.id === task.id
          ? { ...candidate, status: "ready" as const, completedAt: undefined }
          : candidate,
      );
    const repairTarget = this.repairTargets.get(task.id);
    if (outcome.status === "passed" && repairTarget) {
      tasks = tasks.map((candidate) =>
        candidate.id === repairTarget
          ? {
              ...candidate,
              status: "ready" as const,
              completedAt: undefined,
              safeFailureCode: undefined,
            }
          : candidate,
      );
      const validationTypes = new Set([
        "validate-lint",
        "validate-typecheck",
        "validate-unit-tests",
        "validate-build",
        "validate-functional-flow",
        "prepare-release",
      ]);
      tasks = tasks.map((candidate) =>
        validationTypes.has(candidate.taskType)
          ? {
              ...candidate,
              status:
                candidate.taskType === "validate-lint"
                  ? ("pending" as const)
                  : ("pending" as const),
              attempt: 0,
              completedAt: undefined,
              safeFailureCode: undefined,
              validationDiagnosticCount: undefined,
              validationDiagnostics: undefined,
              validationDiagnosticPolicyVersion: undefined,
              validationSourceChecksum: undefined,
              validationPlanChecksum: undefined,
              validationReplayCount: undefined,
              validationReplayIdentity: undefined,
              validationReplayPolicyVersion: undefined,
            }
          : candidate,
      );
    }
    if (outcome.status === "passed")
      tasks = tasks.map((candidate) =>
        ["pending", "blocked"].includes(candidate.status) &&
        candidate.dependencies.length > 0 &&
        candidate.dependencies.every(
          (dependency) =>
            tasks.find((item) => item.id === dependency)?.status === "passed",
        )
          ? { ...candidate, status: "ready" as const }
          : candidate,
      );
    return { ...graph, tasks, updatedAt: this.clock() };
  }
  private blockDependents(graph: TaskGraph) {
    const tasks = graph.tasks.map((task) =>
      task.status === "pending" &&
      task.dependencies.some((dependency) =>
        ["failed", "cancelled", "blocked"].includes(
          graph.tasks.find((candidate) => candidate.id === dependency)
            ?.status ?? "",
        ),
      )
        ? {
            ...task,
            status: "blocked" as const,
            safeFailureCode: "FULL_EXECUTION_NOT_READY",
          }
        : task,
    );
    return withGraphChecksum({ ...graph, tasks, updatedAt: this.clock() });
  }
  private cancelPending(graph: TaskGraph) {
    return withGraphChecksum({
      ...graph,
      tasks: graph.tasks.map((task) =>
        ["pending", "ready", "blocked"].includes(task.status)
          ? {
              ...task,
              status: "cancelled" as const,
              completedAt: this.clock(),
              safeFailureCode: "FULL_EXECUTION_CANCELLED",
            }
          : task,
      ),
      updatedAt: this.clock(),
    });
  }
  private checkpoint(
    name:
      | "execution-started"
      | "implementation-wave-started"
      | "implementation-wave-complete"
      | "validation-started"
      | "repair-created"
      | "repair-running"
      | "repair-complete"
      | "validation-rerun"
      | "quality-gates-passed"
      | "execution-complete"
      | "execution-failed"
      | "execution-paused"
      | "execution-cancelled",
    graph: TaskGraph,
    safeFailureCode?: string,
  ) {
    return ExecutionCheckpointSchema.parse({
      name,
      timestamp: this.clock(),
      completedTaskIds: graph.tasks
        .filter((task) => task.status === "passed")
        .map((task) => task.id),
      readyTaskIds: graph.tasks
        .filter((task) => task.status === "ready")
        .map((task) => task.id),
      ...(safeFailureCode ? { safeFailureCode } : {}),
    });
  }
  private async applyOutcome(
    run: TaskGraphExecutionRun,
    graph: TaskGraph,
    task: AgentTask,
    outcome: TaskExecutionOutcome,
    repairFor: Map<string, string>,
  ) {
    const executed = [...new Set([...run.executedTaskIds, task.id])];
    const boundOutcomeChecks = (outcome.qualityChecks ?? []).map((check) =>
      QualityCheckSchema.parse({
        ...check,
        evidence: {
          projectId: run.projectId,
          projectVersion: run.projectVersion,
          taskGraphChecksum: run.taskGraphChecksum,
          sourceDocumentChecksums: run.sourceDocumentChecksums,
          ...(outcome.runtimeValidationRunId
            ? { runtimeValidationRunId: outcome.runtimeValidationRunId }
            : {}),
          ...(outcome.qaRunId ? { qaRunId: outcome.qaRunId } : {}),
          ...(outcome.sourceChecksum
            ? { sourceChecksum: outcome.sourceChecksum }
            : {}),
          ...(outcome.validationPlanChecksum
            ? { validationPlanChecksum: outcome.validationPlanChecksum }
            : {}),
        },
      }),
    );
    const quality = [...run.qualityGateSummary, ...boundOutcomeChecks].reduce(
      (all, check) => [
        ...all.filter((existing) => existing.name !== check.name),
        check,
      ],
      [] as typeof run.qualityGateSummary,
    );
    const base = {
      ...run,
      executedTaskIds: executed,
      passedTaskIds:
        outcome.status === "passed"
          ? [...new Set([...run.passedTaskIds, task.id])]
          : run.passedTaskIds,
      failedTaskIds:
        outcome.status === "failed"
          ? [...new Set([...run.failedTaskIds, task.id])]
          : run.failedTaskIds,
      cancelledTaskIds:
        outcome.status === "cancelled"
          ? [...new Set([...run.cancelledTaskIds, task.id])]
          : run.cancelledTaskIds,
      qualityGateSummary: quality,
      safeFailureCode: outcome.safeFailureCode ?? run.safeFailureCode,
    };
    if (repairFor.has(task.id) && outcome.status === "passed") {
      const cycles = base.repairCycles.map((cycle) =>
        cycle.repairTaskId === task.id
          ? { ...cycle, status: "passed" as const, completedAt: this.clock() }
          : cycle,
      );
      return {
        ...base,
        repairCycles: cycles,
        currentCheckpoint: this.checkpoint("repair-complete", graph),
      };
    }
    return base;
  }
  private ensureFresh(
    input: FullExecutionStartInput,
    snapshot: FullExecutionSnapshot,
    graph: TaskGraph,
  ) {
    if (snapshot.projectImmutable || !snapshot.workspaceValid)
      throw new FullExecutionError(
        "FULL_EXECUTION_STALE_STATE",
        "The project became immutable or the workspace is invalid.",
      );
    if (graphChecksum(snapshot.graph) !== graphChecksum(graph))
      throw new FullExecutionError(
        "FULL_EXECUTION_GRAPH_STALE",
        "The authoritative TaskGraph changed during execution.",
      );
    if (
      Object.keys(input.sourceDocumentChecksums).some(
        (name) =>
          input.sourceDocumentChecksums[name] !==
          snapshot.currentDocumentChecksums[name],
      )
    )
      throw new FullExecutionError(
        "FULL_EXECUTION_DOCUMENT_STALE",
        "An approved document changed during execution.",
      );
  }
  private async persist(
    run: TaskGraphExecutionRun,
    graph: TaskGraph,
    workflowState: string,
    eventType: string,
    input: FullExecutionStartInput,
    expectedGraph: TaskGraph,
    requestChecksum: string,
  ) {
    const snapshot = await this.state.load({ projectId: input.projectId, projectVersion: input.projectVersion });
    if (graphChecksum(snapshot.graph) !== graphChecksum(expectedGraph))
      throw new FullExecutionError("FULL_EXECUTION_GRAPH_STALE", "The authoritative TaskGraph changed before execution persistence.");
    if (Object.keys(input.sourceDocumentChecksums).some((name) => input.sourceDocumentChecksums[name] !== snapshot.currentDocumentChecksums[name]))
      throw new FullExecutionError("FULL_EXECUTION_DOCUMENT_STALE", "An approved document changed before execution persistence.");
    await this.state.save({
      run: TaskGraphExecutionRunSchema.parse(run),
      graph: withGraphChecksum(graph),
      workflowState,
      requestChecksum,
      expectedGraphRowVersion: snapshot.graphRowVersion,
      expectedGraphDocumentChecksum: snapshot.graphDocumentChecksum,
      expectedRunDocumentRowVersion: snapshot.runDocumentRowVersion,
      expectedRunDocumentChecksum: snapshot.runDocumentChecksum,
    });
    await this.state.appendEvent({
      runId: run.runId,
      type: eventType,
      timestamp: this.clock(),
      ...(run.safeFailureCode ? { safeCode: run.safeFailureCode } : {}),
    });
  }
  private async finishSummary(
    run: TaskGraphExecutionRun,
    graph: TaskGraph,
    input: FullExecutionStartInput,
    snapshot: FullExecutionSnapshot,
    expectedGraph: TaskGraph,
  ) {
    const quality = snapshot.qualityChecks.length
      ? snapshot.qualityChecks
      : run.qualityGateSummary;
    const currentEvidence = (check: QualityCheck) => {
      const evidence = check.evidence;
      const executionReference =
        check.name === "e2e"
          ? evidence?.qaRunId
          : ["lint", "typecheck", "unit-tests", "build"].includes(check.name)
            ? evidence?.runtimeValidationRunId
            : undefined;
      return (
        evidence?.projectId === input.projectId &&
        evidence.projectVersion === input.projectVersion &&
        evidence.taskGraphChecksum === run.taskGraphChecksum &&
        recordsEqual(evidence.sourceDocumentChecksums, run.sourceDocumentChecksums) &&
        Boolean(executionReference) &&
        check.command !== undefined &&
        check.resultSummary !== undefined &&
        (check.exitCode === undefined || check.exitCode === 0)
      );
    };
    const mandatoryPassed = this.policy.mandatoryQualityCheckNames.every((name) =>
      quality.some(
        (check) =>
          check.name === name &&
          check.status === "passed" &&
          currentEvidence(check),
      ),
    );
    const evidenceBlockers = this.policy.mandatoryQualityCheckNames.flatMap((name) => {
      const check = quality.find((candidate) => candidate.name === name);
      if (!check) return [`QUALITY_GATE_MISSING_${name.toUpperCase()}`];
      if (check.status !== "passed" || !currentEvidence(check))
        return [`QUALITY_GATE_EVIDENCE_INCOMPLETE_${name.toUpperCase()}`];
      return [];
    });
    const blockers = graph.tasks
      .filter(
        (task) =>
          !this.policy.releaseBoundaryTaskTypes.includes(task.taskType) &&
          task.status !== "passed" &&
          task.status !== "cancelled",
      )
      .map(
        (task) => task.safeFailureCode ?? `TASK_${task.status.toUpperCase()}`,
      );
    blockers.push(...evidenceBlockers);
    const summary = ExecutionSummarySchema.parse({
      schemaVersion: 1,
      documentType: "full-execution",
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      createdAt: run.startedAt,
      updatedAt: this.clock(),
      runId: run.runId,
      taskGraphChecksum: run.taskGraphChecksum,
      totalTasks: graph.tasks.length,
      passed: graph.tasks.filter((task) => task.status === "passed").length,
      failed: graph.tasks.filter((task) => task.status === "failed").length,
      cancelled: graph.tasks.filter((task) => task.status === "cancelled")
        .length,
      blocked: graph.tasks.filter((task) => task.status === "blocked").length,
      repairsAttempted: run.repairCycles.length,
      repairsPassed: run.repairCycles.filter(
        (cycle) => cycle.status === "passed",
      ).length,
      qualityGates: quality,
      runtimeValidationReference: snapshot.runtimeValidationRunId,
      qaReference: snapshot.qaRunId,
      finalWorkflowState: "VALIDATING",
      releaseEligible:
        mandatoryPassed &&
        snapshot.testQualityReviewApproved !== false &&
        blockers.length === 0 &&
        run.repairCycles.every((cycle) => cycle.status === "passed"),
      blockers,
      warnings: [],
      sourceChecksums: input.sourceDocumentChecksums,
      policyVersion: this.policy.version,
      completedAt: this.clock(),
    });
    await this.state.saveSummary(summary);
    await this.persist(
      {
        ...run,
        currentCheckpoint: this.checkpoint("quality-gates-passed", graph),
      },
      graph,
      "VALIDATING",
      "run-completed",
      input,
      expectedGraph,
      fullExecutionRequestChecksum(input),
    );
  }
}

export function reconcileFullExecution(
  input: FullExecutionReconciliationInput,
) {
  const issues: Array<{
    code: string;
    description: string;
    automaticRepairAllowed: boolean;
  }> = [];
  if (input.run.status === "running" && !input.schedulerActive)
    issues.push({
      code: "FULL_EXECUTION_SCHEDULER_MISSING",
      description: "Execution is RUNNING without an active scheduler.",
      automaticRepairAllowed: false,
    });
  if (
    input.run.executedTaskIds.some(
      (id) =>
        input.run.status === "running" && !input.activeTaskIds.includes(id),
    )
  )
    issues.push({
      code: "FULL_EXECUTION_ORPHAN_TASK",
      description: "A dispatched task has no active executor.",
      automaticRepairAllowed: false,
    });
  if (!input.qualityCheckPresent && input.run.status === "completed")
    issues.push({
      code: "FULL_EXECUTION_QUALITY_STALE",
      description: "Completed execution has no persisted quality gate.",
      automaticRepairAllowed: false,
    });
  if (
    input.snapshot.activeRunIds.filter((id) => id === input.run.runId).length >
    1
  )
    issues.push({
      code: "FULL_EXECUTION_CONFLICT",
      description: "Duplicate active execution records exist.",
      automaticRepairAllowed: false,
    });
  if (graphChecksum(input.snapshot.graph) !== input.run.taskGraphChecksum)
    issues.push({
      code: "FULL_EXECUTION_GRAPH_STALE",
      description:
        "Execution graph checksum does not match the authoritative graph.",
      automaticRepairAllowed: false,
    });
  return issues;
}
