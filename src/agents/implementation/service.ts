import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import {
  DocumentRepository,
  ProjectRepository,
  ProjectVersionRepository,
  saveDocumentCASInTransaction,
  saveDocumentInTransaction,
} from "@/persistence/database/repositories";
import { mapRowToDocument } from "@/persistence/database/mapping";
import type { PersistenceDatabase } from "@/persistence/database/types";
import { PersistenceError } from "@/persistence/database/errors";
import {
  ImplementationRunsSchema,
  type ImplementationExecutionRun,
  type ImplementationRuns,
} from "@/domain/implementation/schema";
import {
  TaskGraphSchema,
  type AgentTask,
  type TaskGraph,
} from "@/domain/tasks/schema";
import {
  ImplementationAgentInputSchema,
  DEFAULT_EXECUTION_POLICY,
  type ExecutionPolicy,
  type ImplementationAgentInput,
} from "./contracts";
import { ImplementationError } from "./errors";
import { AtomicChangeApplier, validateProposal } from "./applier";
import {
  TaskContextAssembler,
  type ContextAssemblerDependencies,
} from "./policy";
import { DeterministicImplementationProvider } from "./provider";
import type { ImplementationProvider } from "./contracts";
import { validateSupportedTask, validateTaskResult } from "./validators";
import type { BackendPlans } from "./backend";
import { implementationAgentDefinition } from "@/agents/catalog";
import { PlanningPackageSchema, StoragePlanSchema } from "@/agents/planner/contracts";
import { planningSemanticChecksum } from "@/agents/planner/deterministic";
import type { DependencyAuthorityContext } from "@/dependencies/authority";
import { validatePhase7CContractPackage, validateTaskContractBinding } from "@/domain/contracts/phase7c";
import { validateDirectionDesignCapability } from "@/domain/design/capability";
import { evaluateRealFormProcessingGate, isRealFormProcessingTask } from "@/domain/requirements/v3/lifecycle-gates";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { validateTaskCapabilityBinding } from "@/orchestration/tooling/authority";
import { implementationOrchestrator } from "@/orchestration/orchestrator/implementation-routing";
import { exclusivePathsOverlap, preflightExclusivePathClaims } from "@/domain/tasks/shared-ownership";
import { runDesignSystemChecklist } from "./design-quality";

export interface ImplementationMemoryPort {
  writeSnapshot(
    projectId: string,
    version: number,
    documents: Record<string, unknown>,
  ): Promise<void>;
}
const now = () => new Date().toISOString();
const graphWithoutChecksum = (graph: TaskGraph) => {
  const value = { ...graph };
  delete value.graphChecksum;
  return value;
};
const graphChecksum = (graph: TaskGraph) =>
  checksumPersistedDocument(graphWithoutChecksum(graph));
type TaskGraphOwner = "implementation-agent" | "full-execution";
type CanonicalPersistenceState = { outcome: "NOT_COMMITTED" | "COMMITTED" | "AMBIGUOUS" };
const dependencyContextFor = (input: ImplementationAgentInput, taskType: string): DependencyAuthorityContext => {
  const planning = PlanningPackageSchema.safeParse(input.acceptedPlanningPackage);
  const plannedDependencies = planning.success
    ? planning.data.dependencies.dependencies.map((dependency) => ({ name: dependency.name, runtime: dependency.runtime, required: dependency.required }))
    : [];
  return { projectId: input.projectId, projectVersion: input.projectVersion, planningChecksum: input.acceptedPlanningChecksum, plannedDependencies, taskType };
};
const DESIGN_CHECKLIST_TASK_TYPES = new Set(["implement-design-system", "implement-shared-layout", "implement-navigation", "implement-page", "implement-shared-component", "implement-form", "implement-motion"]);
const readDesignCandidateFiles = async (root: string, relativePaths: readonly string[]) => (await Promise.all([...new Set([...relativePaths, "package.json"])].map(async (relativePath) => {
  try { return { path: relativePath.replaceAll("\\", "/"), content: await readFile(path.join(root, relativePath), "utf8") }; }
  catch { return undefined; }
}))).filter((file): file is { path: string; content: string } => Boolean(file));
const approvedBriefChecksumMatches = (input: ImplementationAgentInput) =>
  input.approvedBriefChecksum === checksumPersistedDocument(input.approvedBrief) ||
  input.approvedBriefChecksum === input.approvedBrief.approval.approvedRequirementsChecksum ||
  (input.canonicalBrief !== undefined && canonicalBriefChecksum(input.canonicalBrief) === input.approvedBriefChecksum);
const runBase = (
  input: ImplementationAgentInput,
  status: ImplementationExecutionRun["status"],
  startedAt: string,
): ImplementationExecutionRun => ({
  executionId: randomUUID(),
  projectId: input.projectId,
  projectVersion: input.projectVersion,
  taskId: input.taskId,
  attempt: input.task.attempt,
  status,
  changedFiles: [],
  createdFiles: [],
  deletedFiles: [],
  beforeChecksums: {},
  afterChecksums: {},
  validationResults: [],
  warnings: [],
  startedAt,
  executionPolicyVersion: input.executionPolicyVersion,
});

export class ImplementationAgentService {
  private readonly documents: DocumentRepository;
  private readonly projects: ProjectRepository;
  private readonly versions: ProjectVersionRepository;
  private readonly context: TaskContextAssembler;
  private readonly applier: AtomicChangeApplier;
  private readonly provider: ImplementationProvider;
  private readonly policy: ExecutionPolicy;
  private readonly taskGraphOwner: TaskGraphOwner;
  private readonly active = new Set<string>();
  private readonly idempotency = new Map<
    string,
    { hash: string; result: ImplementationExecutionRun }
  >();
  constructor(
    private readonly database: PersistenceDatabase,
    dependencies: ContextAssemblerDependencies & {
      memory?: ImplementationMemoryPort;
      provider?: ImplementationProvider;
      policy?: ExecutionPolicy;
      taskGraphOwner?: TaskGraphOwner;
    },
  ) {
    this.documents = new DocumentRepository(database);
    this.projects = new ProjectRepository(database);
    this.versions = new ProjectVersionRepository(database);
    this.context = new TaskContextAssembler(
      dependencies.policy ?? DEFAULT_EXECUTION_POLICY,
      dependencies,
    );
    this.applier = new AtomicChangeApplier();
    this.provider =
      dependencies.provider ?? new DeterministicImplementationProvider();
    this.policy = dependencies.policy ?? DEFAULT_EXECUTION_POLICY;
    this.taskGraphOwner = dependencies.taskGraphOwner ?? "implementation-agent";
    this.memory = dependencies.memory;
  }
  getAgentDefinition() {
    return implementationAgentDefinition;
  }
  private readonly memory?: ImplementationMemoryPort;
  private parse(raw: ImplementationAgentInput) {
    try {
      const input = ImplementationAgentInputSchema.parse(raw);
      if (input.expectedProjectWorkflowState !== "IMPLEMENTING")
        throw new ImplementationError(
          "IMPLEMENTATION_WORKFLOW_STATE_INVALID",
          "Project is not in IMPLEMENTING state.",
        );
      if (
        input.task.projectId !== input.projectId ||
        input.task.projectVersion !== input.projectVersion ||
        input.task.id !== input.taskId
      )
        throw new ImplementationError(
          "IMPLEMENTATION_INPUT_INVALID",
          "Task does not belong to the requested project version.",
        );
      if (input.task.role !== "implementation")
        throw new ImplementationError(
          "IMPLEMENTATION_ROLE_INVALID",
          "Only implementation tasks can be executed by this agent.",
        );
      if (input.task.status !== "ready")
        throw new ImplementationError(
          "IMPLEMENTATION_TASK_NOT_READY",
          "Task is not READY.",
        );
      if (input.task.attempt >= input.task.maxAttempts)
        throw new ImplementationError(
          "IMPLEMENTATION_ATTEMPT_LIMIT_REACHED",
          "Task attempt limit has been reached.",
        );
      if (input.projectImmutable)
        throw new ImplementationError(
          "IMPLEMENTATION_VERSION_IMMUTABLE",
          "Released project versions are immutable.",
        );
      if (input.taskGraphChecksum !== graphChecksum(input.taskGraph))
        throw new ImplementationError(
          "IMPLEMENTATION_GRAPH_STALE",
          "TaskGraph checksum is stale.",
        );
      if (
        !input.taskGraph.tasks.some(
          (task) => task.id === input.taskId && task.status === "ready",
        )
      )
        throw new ImplementationError(
          "IMPLEMENTATION_TASK_NOT_READY",
          "Task is not READY in the current TaskGraph.",
        );
      if (
        input.task.dependencies.some(
          (dependency) =>
            input.taskGraph.tasks.find(
              (candidate) => candidate.id === dependency,
            )?.status !== "passed",
        )
      )
        throw new ImplementationError(
          "IMPLEMENTATION_DEPENDENCY_INCOMPLETE",
          "A task dependency has not passed.",
        );
      if (!approvedBriefChecksumMatches(input))
        throw new ImplementationError(
          "IMPLEMENTATION_DOCUMENT_STALE",
          "Approved Brief checksum is stale.",
        );
      if (
        input.selectedDesignChecksum !==
        checksumPersistedDocument(input.selectedDesign)
      )
        throw new ImplementationError(
          "IMPLEMENTATION_DESIGN_STALE",
          "Selected design checksum is stale.",
        );
      if (input.selectedDesign.selectedDirectionContract) {
        const approvedDependencies = new Set((input.phase7cContractPackage?.dependencyProposal.dependencies ?? []).filter((dependency) => dependency.packageName === "motion" && (dependency.approvalStatus === "APPROVED" || dependency.approvalStatus === "NOT_REQUIRED")).map((dependency) => `${dependency.packageName}@${dependency.versionSpec}`));
        const contractReadiness = validateDirectionDesignCapability(input.selectedDesign.selectedDirectionId, input.selectedDesign.selectedDirectionContract, { approvedDependencies });
        const binding = input.selectedDesign.designContract;
        if (!binding || binding.visualSystemChecksum !== input.selectedDesign.selectedDirectionContract.visualSystem.tokenChecksum || binding.typographyChecksum !== input.selectedDesign.selectedDirectionContract.typography.checksum || binding.motionChecksum !== input.selectedDesign.selectedDirectionContract.motion.checksum || binding.interactionChecksum !== checksumPersistedDocument(input.selectedDesign.selectedDirectionContract.interactions) || binding.currentness.status !== "CURRENT" || !contractReadiness.valid) throw new ImplementationError("IMPLEMENTATION_DESIGN_VIOLATION", "The selected professional design contract is missing, stale, or not approved for implementation.", contractReadiness.issues[0]);
      }
      if (
        input.architectureChecksum !==
        checksumPersistedDocument(input.technicalArchitecture)
      )
        throw new ImplementationError(
          "IMPLEMENTATION_DOCUMENT_STALE",
          "Architecture checksum is stale.",
        );
      const planning = PlanningPackageSchema.safeParse(input.acceptedPlanningPackage);
      if (
        planning.success &&
        input.acceptedPlanningChecksum !== checksumPersistedDocument(planning.data) &&
        input.acceptedPlanningChecksum !== planning.data.acceptance?.checksum
      )
        throw new ImplementationError(
          "IMPLEMENTATION_DOCUMENT_STALE",
          "Accepted Planning checksum is stale.",
        );
      const formProcessing = evaluateRealFormProcessingGate({
        brief: input.canonicalBrief ?? input.approvedBrief,
        decisions: input.existingDecisions,
        approvedBriefChecksum: input.approvedBriefChecksum,
      });
      if (isRealFormProcessingTask(input.task.taskType) && !formProcessing.allowed)
        throw new ImplementationError(
          "FORM_PLAN_VIOLATION",
          "Real form processing requires a current explicit user approval.",
        );
      const capabilityBinding = validateTaskCapabilityBinding(input.task);
      if (!capabilityBinding.valid)
        throw new ImplementationError(
          "IMPLEMENTATION_CAPABILITY_BINDING_INVALID",
          "The implementation task advertises capabilities that its approved tools do not provide.",
          undefined,
          { missingCapabilities: capabilityBinding.missingCapabilities },
        );
      const route = implementationOrchestrator.resolveTask({
        task: input.task,
        architecture: input.technicalArchitecture,
        phase7c: input.phase7cContractPackage,
        taskById: new Map(input.taskGraph.tasks.map((task) => [task.id, task])),
      });
      if (route.status !== "ACTIVE")
        throw new ImplementationError(
          route.status === "UNROUTABLE" ? "IMPLEMENTATION_TASK_TYPE_UNSUPPORTED" : "IMPLEMENTATION_TASK_NOT_REQUIRED",
          "The implementation task is not admitted to an active Factory specialist domain.",
          undefined,
          { routeStatus: route.status, domain: route.domain },
        );
      validateSupportedTask(input.task);
      return input;
    } catch (error) {
      if (error instanceof ImplementationError) throw error;
      throw new ImplementationError(
        "IMPLEMENTATION_INPUT_INVALID",
        "Implementation input did not match the strict contract.",
        error,
      );
    }
  }
  private async saveRun(
    input: ImplementationAgentInput,
    run: ImplementationExecutionRun,
    graph: TaskGraph,
    persistenceState: CanonicalPersistenceState,
    expectedGraph?: { rowVersion: number; checksum: string },
  ) {
    let runs: ImplementationRuns;
    try {
      runs = await this.database.transaction(async (tx) => {
        const existingRow = await tx.getDocument(input.projectId, input.projectVersion, "implementation-runs");
        const existing = existingRow ? mapRowToDocument(existingRow) : null;
        const nextRuns: ImplementationRuns = existing?.documentType === "implementation-runs"
          ? {
              ...existing,
              runs: [
                ...existing.runs.filter(
                  (candidate) => candidate.executionId !== run.executionId,
                ),
                run,
              ],
              updatedAt: now(),
            }
          : {
              schemaVersion: 1,
              documentType: "implementation-runs",
              projectId: input.projectId,
              projectVersion: input.projectVersion,
              createdAt: input.task.createdAt,
              updatedAt: now(),
              runs: [run],
          };
        await saveDocumentInTransaction(tx, ImplementationRunsSchema.parse(nextRuns));
        if (this.taskGraphOwner === "implementation-agent") {
          if (expectedGraph) await saveDocumentCASInTransaction(tx, graph, expectedGraph.rowVersion, expectedGraph.checksum);
          else await saveDocumentInTransaction(tx, graph);
        }
        return nextRuns;
      });
      persistenceState.outcome = "COMMITTED";
    } catch (error) {
      persistenceState.outcome = error instanceof PersistenceError && error.code === "PERSISTENCE_COMMIT_AMBIGUOUS" ? "AMBIGUOUS" : "NOT_COMMITTED";
      throw error;
    }
    if (this.memory) {
      try {
        await this.memory.writeSnapshot(input.projectId, input.projectVersion, {
          "implementation-runs.json": runs,
          ...(this.taskGraphOwner === "implementation-agent" ? { "task-graph.json": graph } : {}),
        });
      } catch (error) {
        throw new ImplementationError("IMPLEMENTATION_STATE_MISMATCH", "Implementation was committed but its derived Project Memory projection could not be synchronized.", error);
      }
    }
  }
  private updateGraph(
    graph: TaskGraph,
    taskId: string,
    status: AgentTask["status"],
    attempt: number,
    failure?: { code: string; summary: string },
  ) {
    const timestamp = now();
    const tasks = graph.tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            status,
            attempt,
            ...(status === "running" ? { startedAt: timestamp } : {}),
            ...(["passed", "failed", "cancelled"].includes(status)
              ? { completedAt: timestamp }
              : {}),
            ...(failure ? { safeFailureCode: failure.code } : {}),
          }
        : task,
    );
    if (status === "passed")
      for (const task of tasks)
        if (
          ["pending", "blocked"].includes(task.status) &&
          task.dependencies.length > 0 &&
          task.dependencies.every(
            (dependency) =>
              tasks.find((candidate) => candidate.id === dependency)?.status ===
              "passed",
          )
        )
          task.status = "ready";
    return TaskGraphSchema.parse({
      ...graph,
      tasks,
      updatedAt: timestamp,
      graphChecksum: checksumPersistedDocument({
        ...graphWithoutChecksum({ ...graph, tasks }),
        updatedAt: timestamp,
      }),
    });
  }
  async executeImplementationTask(
    raw: ImplementationAgentInput,
    signal?: AbortSignal,
  ): Promise<ImplementationExecutionRun> {
    const input = this.parse(raw);
    const dependencyContext = dependencyContextFor(input, input.task.taskType);
    const key = `${input.projectId}:${input.projectVersion}:${input.idempotencyKey}`;
    const skillSelection = await this.context.prepareSkillContext(input);
    const hash = checksumPersistedDocument({ input, skillContextChecksum: skillSelection?.identityChecksum ?? "none" });
    const prior = this.idempotency.get(key);
    if (prior) {
      if (prior.hash !== hash)
        throw new ImplementationError(
          "IMPLEMENTATION_IDEMPOTENCY_CONFLICT",
          "Execution idempotency key was reused with different input.",
        );
      return prior.result;
    }
    if (this.active.has(input.taskId))
      throw new ImplementationError(
        "IMPLEMENTATION_EXECUTION_CONFLICT",
        "Another execution owns this task.",
      );
    this.active.add(input.taskId);
    const startedAt = now();
    let run = runBase(input, "running", startedAt);
    let graph = input.taskGraph;
    let executionTask = input.task;
    let graphCommitContext: { rowVersion: number; checksum: string } | undefined;
    const canonicalPersistence: CanonicalPersistenceState = { outcome: "NOT_COMMITTED" };
    let applied: Awaited<ReturnType<AtomicChangeApplier["apply"]>> | undefined;
    let designChecklist: import("@/domain/design/quality-contract").DesignSystemChecklistResult | undefined;
    try {
      const project = await this.projects.getWithVersion(input.projectId);
      const version = await this.versions.get(
        input.projectId,
        input.projectVersion,
      );
      if (!project || project.project.currentVersion !== input.projectVersion || project.project.workflowState !== "IMPLEMENTING")
        throw new ImplementationError(
          "IMPLEMENTATION_WORKFLOW_STATE_INVALID",
          "Project version or workflow state is stale.",
        );
      if (!version || version.immutable)
        throw new ImplementationError(
          "IMPLEMENTATION_VERSION_IMMUTABLE",
          "Project version is unavailable or immutable.",
        );
      const persistedGraph = await this.documents.getWithMetadata(input.projectId, input.projectVersion, "task-graph");
      if (!persistedGraph || persistedGraph.document.documentType !== "task-graph" || persistedGraph.rowVersion !== input.expectedTaskRowVersion || persistedGraph.document.graphChecksum !== input.taskGraphChecksum)
        throw new ImplementationError("IMPLEMENTATION_GRAPH_STALE", "The current persisted TaskGraph is required and must match the implementation admission token.");
      graph = persistedGraph.document;
      const [brief, planning, selected] = await Promise.all([
        this.documents.get(input.projectId, input.projectVersion, "requirements"),
        this.documents.get(input.projectId, input.projectVersion, "planning-package"),
        this.documents.get(input.projectId, input.projectVersion, "selected-design"),
      ]);
      const parsedPlanning = planning?.documentType === "planning-package" ? PlanningPackageSchema.parse(planning) : null;
      if ([brief, planning, selected].some(Boolean) && (!brief || brief.documentType !== "requirements" || (!approvedBriefChecksumMatches({ ...input, approvedBrief: brief }) && !(input.canonicalBrief !== undefined && canonicalBriefChecksum(input.canonicalBrief) === input.approvedBriefChecksum)) || !parsedPlanning || (input.acceptedPlanningChecksum !== checksumPersistedDocument(parsedPlanning) && input.acceptedPlanningChecksum !== parsedPlanning.acceptance.checksum) || checksumPersistedDocument(input.assetManifest) !== checksumPersistedDocument(parsedPlanning.assets) || input.architectureChecksum !== checksumPersistedDocument(parsedPlanning.architecture) || !selected || selected.documentType !== "selected-design" || input.selectedDesignChecksum !== checksumPersistedDocument(selected)))
        throw new ImplementationError("IMPLEMENTATION_DOCUMENT_STALE", "Canonical implementation documents changed before execution.");
      if (input.phase7cContractPackage) {
        try {
          const contract = input.phase7cContractPackage.taskContracts.find((candidate) => candidate.taskId === (input.task.taskType === "repair-targeted-failure" ? input.task.repairOfTaskId : input.task.id) || (input.task.taskType === "repair-targeted-failure" && candidate.taskContractId === input.task.phase7c?.taskContractId));
          if (!contract) throw new Error("TaskContract is missing.");
          validatePhase7CContractPackage(input.phase7cContractPackage);
          if (input.phase7cContractPackage.projectId !== input.projectId || input.phase7cContractPackage.projectVersion !== input.projectVersion || input.phase7cContractPackage.currentness.status !== "CURRENT" || input.phase7cContractPackage.approvedBriefChecksum !== input.approvedBriefChecksum || !parsedPlanning || input.phase7cContractPackage.planningChecksum !== planningSemanticChecksum(parsedPlanning) || input.phase7cContractPackage.architectureChecksum !== checksumPersistedDocument(parsedPlanning.architecture)) throw new Error("Phase 7C package is stale.");
          validateTaskContractBinding({ ...input.task, phase7cTaskContractId: input.task.phase7c?.taskContractId }, contract);
          if (input.task.phase7c?.taskContractChecksum !== contract.checksum) throw new Error("Task binding checksum is stale.");
        } catch (error) {
          throw new ImplementationError("IMPLEMENTATION_GRAPH_STALE", "Implementation is blocked by a stale Phase 7C contract package.", error);
        }
      }
      const currentTask = persistedGraph.document.tasks.find((candidate) => candidate.id === input.taskId);
      if (!currentTask || currentTask.status !== input.expectedTaskState || currentTask.attempt !== input.task.attempt || checksumPersistedDocument(currentTask) !== checksumPersistedDocument(input.task)) throw new ImplementationError("IMPLEMENTATION_GRAPH_STALE", "The implementation task is no longer admissible from the current TaskGraph.");
      const capabilityBinding = validateTaskCapabilityBinding(currentTask);
      if (!capabilityBinding.valid) throw new ImplementationError("IMPLEMENTATION_CAPABILITY_BINDING_INVALID", "The implementation task advertises capabilities that its approved tools do not provide.", undefined, { missingCapabilities: capabilityBinding.missingCapabilities });
      executionTask = currentTask;
      const activeClaims = graph.tasks.filter((task) => task.role === "implementation" && task.status === "running");
      const requestedPaths = executionTask.fileScopes.filter((scope) => !/[*?[\]]/.test(scope));
      if (activeClaims.some((active) => active.id !== executionTask.id && active.fileScopes.some((activeScope) => requestedPaths.some((requestedPath) => exclusivePathsOverlap(activeScope, requestedPath)))))
        throw new ImplementationError("IMPLEMENTATION_SCOPE_VIOLATION", "Implementation path ownership or an active exclusive path claim was denied before provider execution.", undefined, { code: "TASK_PATH_COLLISION" });
      const exclusiveClaims = [{ taskId: executionTask.id, taskType: executionTask.taskType, implementationDomain: executionTask.implementationDomain, paths: requestedPaths }];
      const exclusivePreflight = preflightExclusivePathClaims(exclusiveClaims);
      if (!exclusivePreflight.valid) throw new ImplementationError("IMPLEMENTATION_SCOPE_VIOLATION", "Implementation path ownership or an active exclusive path claim was denied before provider execution.", undefined, { code: exclusivePreflight.code });
      const graphAdmission = { rowVersion: persistedGraph.rowVersion, checksum: persistedGraph.checksum };
      if (this.taskGraphOwner === "implementation-agent") {
        graph = this.updateGraph(
          graph,
          executionTask.id,
          "running",
          executionTask.attempt + 1,
        );
        await this.database.transaction(async (tx) => {
          const currentProject = await tx.getProject(input.projectId);
          const currentVersion = await tx.getVersion(input.projectId, input.projectVersion);
          const currentGraph = await tx.getDocument(input.projectId, input.projectVersion, "task-graph");
          if (!currentProject || currentProject.current_version !== input.projectVersion || currentProject.workflow_state !== "IMPLEMENTING")
            throw new ImplementationError("IMPLEMENTATION_WORKFLOW_STATE_INVALID", "Project version or workflow state changed before implementation admission was committed.");
          if (!currentVersion || currentVersion.immutable)
            throw new ImplementationError("IMPLEMENTATION_VERSION_IMMUTABLE", "Project version became unavailable or immutable before implementation admission was committed.");
          if (!currentGraph || currentGraph.rowVersion !== graphAdmission.rowVersion || currentGraph.checksum !== graphAdmission.checksum)
            throw new ImplementationError("IMPLEMENTATION_GRAPH_STALE", "The current persisted TaskGraph changed before implementation admission was committed.");
          await saveDocumentCASInTransaction(tx, graph, graphAdmission.rowVersion, graphAdmission.checksum);
        });
        graphCommitContext = { rowVersion: graphAdmission.rowVersion + 1, checksum: checksumPersistedDocument(graph) };
      }
      if (input.cancellation.requested || signal?.aborted)
        throw new ImplementationError(
          "IMPLEMENTATION_CANCELLED",
          "Execution was cancelled before proposal generation.",
        );
      const context = await this.context.assemble({
        ...input,
        task: {
          ...executionTask,
          status: "running",
          attempt: executionTask.attempt + 1,
          startedAt,
        },
      }, skillSelection);
      if (signal?.aborted)
        throw new ImplementationError(
          "IMPLEMENTATION_CANCELLED",
          "Execution was cancelled before proposal application.",
        );
      const proposal = await this.provider.proposeTaskChanges(context, signal);
      validateProposal(
        {
          ...executionTask,
          attempt: executionTask.attempt + 1,
          status: "running",
          startedAt,
        },
        proposal,
        input.stagingWorkspacePath,
        this.policy,
        dependencyContext,
        input.phase7cContractPackage,
        { taskGraphChecksum: input.taskGraphChecksum },
      );
      applied = await this.applier.apply(
        {
          ...executionTask,
          attempt: executionTask.attempt + 1,
          status: "running",
          startedAt,
        },
        proposal,
        input.stagingWorkspacePath,
        this.policy,
        () => Boolean(signal?.aborted),
        dependencyContext,
        input.phase7cContractPackage,
        { taskGraphChecksum: input.taskGraphChecksum },
      );
      const acceptedPlanning = input.acceptedPlanningPackage as BackendPlans["planning"];
      if (executionTask.taskType === "implement-storage") StoragePlanSchema.parse(acceptedPlanning?.storage);
      const backendPlans = {
        brief: input.approvedBrief,
        planning: acceptedPlanning,
      };
      const validations = validateTaskResult(
        executionTask,
        proposal,
        backendPlans,
        input.stagingWorkspacePath,
        dependencyContext,
      );
      if (DESIGN_CHECKLIST_TASK_TYPES.has(executionTask.taskType)) {
        const candidateFiles = await readDesignCandidateFiles(input.stagingWorkspacePath, applied.changedFiles);
        designChecklist = runDesignSystemChecklist({
          files: candidateFiles,
          designChecksum: input.selectedDesignChecksum,
          approvedDesignText: JSON.stringify(input.selectedDesign),
          taskType: executionTask.taskType,
        });
        if (designChecklist.verdict === "BLOCK") {
          run = {
            ...run,
            designChecklist,
            validationResults: [{ name: "design-system-checklist", status: "failed", summary: "DesignSystemChecklist blocked frontend handoff.", safeFailureCode: "IMPLEMENTATION_DESIGN_VIOLATION" }],
          };
          throw new ImplementationError("IMPLEMENTATION_DESIGN_VIOLATION", "DesignSystemChecklist blocked frontend handoff.", designChecklist.findings[0]);
        }
      }
      run = {
        ...run,
        status: "passed",
        proposalChecksum: checksumPersistedDocument(proposal),
        contextChecksum: context.contextChecksum,
        changedFiles: applied.changedFiles,
        createdFiles: applied.createdFiles,
        deletedFiles: applied.deletedFiles,
        beforeChecksums: applied.beforeChecksums,
        afterChecksums: applied.afterChecksums,
        ...(applied.astPatchEvidence?.length ? { astPatchEvidence: applied.astPatchEvidence } : {}),
        validationResults: [
          ...validations,
          ...(designChecklist ? [{ name: "design-system-checklist", status: "passed" as const, summary: `DesignSystemChecklist ${designChecklist.verdict}; findings=${designChecklist.findings.length}.` }] : []),
        ],
        ...(designChecklist ? { designChecklist } : {}),
        completedAt: now(),
        providerUsageMetadata: proposal.providerMetadata,
        attempt: executionTask.attempt + 1,
      };
      graph = this.updateGraph(
        graph,
        executionTask.id,
        "passed",
        executionTask.attempt + 1,
      );
      await this.saveRun(input, run, graph, canonicalPersistence, graphCommitContext);
      this.idempotency.set(key, { hash, result: run });
      return run;
    } catch (error) {
      if (canonicalPersistence.outcome === "COMMITTED") {
        this.idempotency.set(key, { hash, result: run });
        return run;
      }
      if (canonicalPersistence.outcome === "AMBIGUOUS") {
        try {
          const authoritative = await this.getImplementationExecution(input.projectId, input.projectVersion, run.executionId);
          if (authoritative) {
            this.idempotency.set(key, { hash, result: authoritative });
            return authoritative;
          }
        } catch (readbackError) {
          throw new ImplementationError("IMPLEMENTATION_STATE_MISMATCH", "Implementation persistence outcome is indeterminate and authoritative readback failed.", readbackError);
        }
        throw new ImplementationError("IMPLEMENTATION_STATE_MISMATCH", "Implementation persistence outcome is indeterminate; workspace changes were preserved for reconciliation.", error);
      }
      let implementationError =
        error instanceof ImplementationError
          ? error
          : new ImplementationError(
              "IMPLEMENTATION_WORKSPACE_TAMPERED",
              "Implementation task failed safely.",
              error,
            );
      if (applied && canonicalPersistence.outcome === "NOT_COMMITTED") {
        try { await applied.rollback(); }
        catch (rollbackError) {
          implementationError = rollbackError instanceof ImplementationError
            ? rollbackError
            : new ImplementationError("AST_PATCH_ROLLBACK_FAILED", "Workspace rollback could not be proven complete.", rollbackError);
        }
      }
      const schemaPaths = error && typeof error === "object" && "issues" in error && Array.isArray((error as { issues?: unknown }).issues)
        ? (error as { issues: Array<{ path?: unknown[]; code?: unknown; message?: unknown }> }).issues.slice(0, 4).map((issue) => `${Array.isArray(issue.path) ? issue.path.join(".") : "unknown"}:${typeof issue.code === "string" ? issue.code : "invalid"}:${typeof issue.message === "string" ? issue.message.slice(0, 120) : "invalid"}`).join(",")
        : "";
      const status =
        implementationError.code === "IMPLEMENTATION_CANCELLED"
          ? ("cancelled" as const)
          : ("failed" as const);
      run = {
        ...run,
        status,
        ...(designChecklist ? { designChecklist } : {}),
        safeFailureCode: implementationError.code,
        safeFailureSummary: `${implementationError.message}${schemaPaths ? ` [schemaPaths=${schemaPaths}]` : ""}`,
        completedAt: now(),
      };
      if (graphCommitContext) {
        graph = this.updateGraph(
          graph,
          executionTask.id,
          status,
          Math.min(executionTask.attempt + 1, executionTask.maxAttempts),
          {
            code: implementationError.code,
            summary: implementationError.message,
          },
        );
        await this.saveRun(input, run, graph, canonicalPersistence, graphCommitContext);
      }
      this.idempotency.set(key, { hash, result: run });
      throw implementationError;
    } finally {
      this.active.delete(input.taskId);
    }
  }
  async getImplementationExecution(
    projectId: string,
    version: number,
    executionId: string,
  ) {
    const document = await this.documents.get(
      projectId,
      version,
      "implementation-runs",
    );
    return document?.documentType === "implementation-runs"
      ? (document.runs.find((run) => run.executionId === executionId) ?? null)
      : null;
  }
  async getNewlyReadyTasks(projectId: string, version: number) {
    const graph = await this.documents.get(projectId, version, "task-graph");
    return graph?.documentType === "task-graph"
      ? graph.tasks.filter((task) => task.status === "ready")
      : [];
  }
  async reconcileImplementationState(projectId: string, version: number) {
    const graph = await this.documents.get(projectId, version, "task-graph");
    if (!graph || graph.documentType !== "task-graph")
      return [
        {
          code: "IMPLEMENTATION_RESULT_MISSING",
          description: "TaskGraph is missing.",
          automaticRepairAllowed: false,
          recommendedAction: "Reconcile the orchestration graph first.",
        },
      ];
    const runs = await this.documents.get(
      projectId,
      version,
      "implementation-runs",
    );
    const issues: Array<{
      code: string;
      description: string;
      automaticRepairAllowed: boolean;
      recommendedAction: string;
    }> = [];
    if (graph.tasks.some((task) => task.status === "running"))
      issues.push({
        code: "IMPLEMENTATION_INTERRUPTED",
        description: "A task remains RUNNING without a live execution owner.",
        automaticRepairAllowed: false,
        recommendedAction:
          "Inspect the last execution and explicitly retry or cancel it.",
      });
    if (
      !runs &&
      graph.tasks.some((task) =>
        ["passed", "failed", "cancelled"].includes(task.status),
      )
    )
      issues.push({
        code: "IMPLEMENTATION_RESULT_MISSING",
        description: "Task status exists without execution history.",
        automaticRepairAllowed: false,
        recommendedAction: "Restore execution history before continuing.",
      });
    return issues;
  }
}
