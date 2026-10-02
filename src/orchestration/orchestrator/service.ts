import { randomUUID } from "node:crypto";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { DocumentRepository, DecisionRepository, ProjectRepository, WorkflowPersistenceService, appendDecisionInTransaction, saveDocumentCASInTransaction, saveDocumentInTransaction, transitionWorkflowInTransaction } from "@/persistence/database/repositories";
import type { PersistenceDatabase } from "@/persistence/database/types";
import { AgentTaskSchema, TaskGraphSchema, type AgentTask, type TaskGraph } from "@/domain/tasks/schema";
import { DecisionRecordSchema, type DecisionRecord } from "@/domain/workflow/decision";
import { OrchestratorError } from "./errors";
import { OrchestratorInputSchema, DEFAULT_ORCHESTRATION_POLICY, type OrchestratorInput, type OrchestrationPolicy, type OrchestrationResult, type TaskEvent } from "./contracts";
import { buildImplementationTaskGraph } from "./graph";
import { taskGraphReady, validateImplementationTaskGraph } from "./validation";
import { ownershipForTask, UNIT_TEST_ARTIFACT_POLICY_VERSION } from "@/domain/tasks/ownership";
import { FUNCTIONAL_QA_DIAGNOSTIC_POLICY_VERSION } from "../../runtime/qa/contracts";
import { phase7CForLegacyTaskGraphCorrection, rebindPhase7CToSelectedDesign, rebindTaskContractsToPackage, validatePhase7CContractPackage, validateStartImplementationGate } from "@/domain/contracts/phase7c";
import { DesignDependencyAmendmentSchema, validateDirectionDesignCapability } from "@/domain/design/capability";
import { evaluatePlanningAcceptanceReadiness, planningSemanticChecksum } from "@/agents/planner/deterministic";
import { BriefV3DocumentSchema } from "@/persistence/database/brief-revision-v3-contracts";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { deriveTaskCapabilities, taskCapabilitiesFor, validateTaskCapabilityBinding } from "@/orchestration/tooling/authority";
import { implementationDomainForTaskType, specialistProfileIdForDomain } from "@/domain/implementation/profiles";
import { assertApprovedCrossDomainChange, type CrossDomainChangeProposal } from "@/domain/implementation/contracts";
import { isWithinSpecialistDomainScope, isWithinTaskScope } from "@/agents/implementation/scope";
import { mapRowToDocument, mapRowToProject } from "@/persistence/database/mapping";
import { PersistenceError } from "@/persistence/database/errors";
import { runPreImplementationSecurityThreatModel } from "@/agents/reviewers/security/threat-model";
import { runPreImplementationArchitectureCritic } from "@/agents/reviewers/lightweight/agents";

export interface OrchestratorMemoryPort { writeSnapshot(projectId: string, version: number, documents: Record<string, unknown>): Promise<void>; appendDecision(projectId: string, version: number, decision: unknown): Promise<void>; }
export interface OrchestratorWorkspacePort { verify(projectId: string, version: number): Promise<boolean>; reserve?(projectId: string, version: number): Promise<boolean>; }
export interface OrchestrationPlanningProvider { plan(input: unknown, signal?: AbortSignal): Promise<{ tasks: unknown[]; usage?: { inputTokens?: number; outputTokens?: number } }>; }

const now = () => new Date().toISOString();
const event = (taskId: string, from: AgentTask["status"], to: AgentTask["status"], actor: string, reason: string, attempt: number): TaskEvent => ({ taskId, from, to, actor, reason, attempt, createdAt: now() });
const withoutChecksum = (graph: TaskGraph) => { const rest = { ...graph }; delete rest.graphChecksum; return rest; };
const withChecksum = (graph: TaskGraph) => TaskGraphSchema.parse({ ...graph, graphChecksum: checksumPersistedDocument(withoutChecksum(graph)) });
const repairScopeCovers = (allowed: string, requested: string) => { const pattern = allowed.replaceAll("\\", "/").replace(/^\.\//, ""); const value = requested.replaceAll("\\", "/").replace(/^\.\//, ""); if (pattern === value) return true; if (pattern.endsWith("/**")) { const base = pattern.slice(0, -3).replace(/\/$/, ""); return value === base || value.startsWith(`${base}/`); } if (pattern.endsWith("/*")) { const base = pattern.slice(0, -2).replace(/\/$/, ""); const relative = value.startsWith(`${base}/`) ? value.slice(base.length + 1) : ""; return Boolean(relative) && !relative.includes("/"); } if (pattern.endsWith("*")) { const prefix = pattern.slice(0, -1); const relative = value.startsWith(prefix) ? value.slice(prefix.length) : ""; return Boolean(relative) && !relative.includes("/"); } return false; };
const repairOwner = (graph: TaskGraph, failed: AgentTask, scopes: string[]) => { if (!failed.taskType.startsWith("validate-")) return failed; const candidates = graph.tasks.filter((task) => task.role === "implementation" && !task.taskType.startsWith("validate-") && task.taskType !== "repair-targeted-failure" && scopes.every((scope) => task.fileScopes.some((allowed) => repairScopeCovers(allowed, scope)))); return candidates.sort((left, right) => Math.max(...right.fileScopes.map((scope) => scope.replaceAll("*", "").length), 0) - Math.max(...left.fileScopes.map((scope) => scope.replaceAll("*", "").length), 0))[0]; };
const repairTemplate = (graph: TaskGraph, task: AgentTask) => { if (task.taskType !== "repair-targeted-failure" || !task.repairOfTaskId) return task; const referenced = graph.tasks.find((candidate) => candidate.id === task.repairOfTaskId); return referenced ? repairOwner(graph, referenced, task.fileScopes) ?? referenced : task; };
const repairRoot = (graph: TaskGraph, task: AgentTask) => { let current = task; const visited = new Set<string>(); while (current.taskType === "repair-targeted-failure" && current.repairOfTaskId && !visited.has(current.id)) { visited.add(current.id); const next = graph.tasks.find((candidate) => candidate.id === current.repairOfTaskId); if (!next) break; current = next; } return current; };
const hasExplicitValidAstPatchBinding = (task: AgentTask) => task.allowedTools.includes("controlled-edit") && task.requiredCapabilities?.includes("edit.ast-patch") === true && validateTaskCapabilityBinding(task).valid;
const expectedSpecialistBinding = (graph: TaskGraph, task: AgentTask) => {
  const template = task.taskType === "repair-targeted-failure" ? repairTemplate(graph, task) : task;
  const root = repairRoot(graph, template);
  const domain = implementationDomainForTaskType(root.taskType) ?? template.implementationDomain ?? root.implementationDomain;
  return domain ? { implementationDomain: domain, specialistProfileId: specialistProfileIdForDomain(domain) } : undefined;
};

export class OrchestratorService {
  async getImplementationResumeCheckpoint(projectId: string, projectVersion: number) {
    return this.database.transaction(async (tx) => {
      const projectRow = await tx.getProject(projectId);
      const version = await tx.getVersion(projectId, projectVersion);
      const readDocument = async (documentType: string) => {
        const row = await tx.getDocument(projectId, projectVersion, documentType);
        return row ? mapRowToDocument(row) : null;
      };
      return {
        current: projectRow ? { project: mapRowToProject(projectRow), rowVersion: projectRow.row_version } : null,
        version,
        documents: {
          requirements: await readDocument("requirements"),
          briefV3: await readDocument("brief-v3"),
          planning: await readDocument("planning-package"),
          selected: await readDocument("selected-design"),
          graph: await readDocument("task-graph"),
        },
      };
    });
  }

  async reconcileRuntimeAfterArtifactRepair(input: { projectId: string; projectVersion: number; expectedGraphChecksum: string; actor: string; policyVersion: string }) { const graph = await this.documents.get(input.projectId, input.projectVersion, "task-graph"); if (!graph || graph.documentType !== "task-graph") throw new OrchestratorError("ORCHESTRATOR_GRAPH_NOT_READY", "Task graph was not found."); if (graph.graphChecksum !== input.expectedGraphChecksum) throw new OrchestratorError("TASK_STATE_CONFLICT", "Task graph changed before runtime repair reconciliation."); const next = withChecksum(TaskGraphSchema.parse({ ...graph, tasks: graph.tasks.map((task) => task.taskType === "validate-build" ? { ...task, status: "ready" as const, attempt: 0, completedAt: undefined, safeFailureCode: undefined, validationDiagnosticCount: undefined, validationDiagnosticPolicyVersion: input.policyVersion, validationSourceChecksum: undefined } : ["validate-functional-flow", "prepare-release"].includes(task.taskType) ? { ...task, status: "pending" as const, attempt: 0, completedAt: undefined, safeFailureCode: undefined, validationDiagnosticCount: undefined, validationDiagnosticPolicyVersion: undefined, validationSourceChecksum: undefined } : task), checkpoint: "validation-started" as const, updatedAt: now() })); await this.documents.save(next); return { taskGraph: next, reconciled: true as const, actor: input.actor }; }
  async markRuntimeValidationReady(input: { projectId: string; projectVersion: number; taskId: string; expectedGraphChecksum: string; policyVersion: string; actor: string }) { const graph = await this.documents.get(input.projectId, input.projectVersion, "task-graph"); if (!graph || graph.documentType !== "task-graph") throw new OrchestratorError("ORCHESTRATOR_GRAPH_NOT_READY", "Task graph was not found."); if (graph.graphChecksum !== input.expectedGraphChecksum) throw new OrchestratorError("TASK_STATE_CONFLICT", "Task graph changed before runtime validation readiness update."); const task = graph.tasks.find((candidate) => candidate.id === input.taskId); if (!task || !["validate-lint", "validate-typecheck", "validate-unit-tests", "validate-build"].includes(task.taskType)) throw new OrchestratorError("TASK_STATE_CONFLICT", "Only a supported runtime validation task may be marked ready."); const next = withChecksum(TaskGraphSchema.parse({ ...graph, tasks: graph.tasks.map((candidate) => candidate.id === task.id ? { ...candidate, status: "ready" as const, validationDiagnosticPolicyVersion: input.policyVersion, completedAt: undefined, safeFailureCode: undefined } : candidate), updatedAt: now() })); await this.documents.save(next); return { taskGraph: next, actor: input.actor }; }
  async reconcileFunctionalQaDependencies(input: { projectId: string; projectVersion: number; expectedGraphChecksum: string; actor: string }) { return this.database.transaction(async (tx) => { const graphRow = await tx.getDocument(input.projectId, input.projectVersion, "task-graph"); if (!graphRow) throw new OrchestratorError("ORCHESTRATOR_GRAPH_NOT_READY", "Task graph was not found."); const graph = mapRowToDocument(graphRow); if (graph.documentType !== "task-graph") throw new OrchestratorError("ORCHESTRATOR_GRAPH_NOT_READY", "Task graph was not found."); if (graph.graphChecksum !== input.expectedGraphChecksum) throw new OrchestratorError("TASK_STATE_CONFLICT", "Task graph changed before QA dependency reconciliation."); const runtimeDependencies = graph.tasks.filter((task) => ["validate-lint", "validate-typecheck", "validate-unit-tests", "validate-build"].includes(task.taskType)).map((task) => task.id); const qa = graph.tasks.find((task) => task.taskType === "validate-functional-flow"); if (!qa) return { taskGraph: graph, reconciled: false as const }; const dependencies = [...new Set([...qa.dependencies, ...runtimeDependencies])]; const dependenciesReady = runtimeDependencies.every((dependency) => graph.tasks.find((task) => task.id === dependency)?.status === "passed"); const needsReset = qa.status === "failed" || qa.status === "ready" || (qa.status === "passed" && !dependenciesReady); const needsReady = qa.status === "pending" && dependenciesReady; if (!needsReset && !needsReady && runtimeDependencies.every((dependency) => qa.dependencies.includes(dependency))) return { taskGraph: graph, reconciled: false as const }; const next = withChecksum(TaskGraphSchema.parse({ ...graph, tasks: graph.tasks.map((task) => task.id === qa.id ? { ...task, dependencies, ...((needsReset || needsReady) ? { status: dependenciesReady ? "ready" as const : "pending" as const, ...(needsReset ? { attempt: 0, completedAt: undefined, safeFailureCode: undefined, validationReplayIdentity: undefined, validationReplayPolicyVersion: undefined } : {}) } : {}) } : task), updatedAt: now() })); const saved = TaskGraphSchema.parse(await saveDocumentCASInTransaction(tx, next, graphRow.rowVersion, graphRow.checksum)); return { taskGraph: saved, reconciled: true as const, actor: input.actor }; }); }
  private readonly documents: DocumentRepository; private readonly decisions: DecisionRepository; private readonly projects: ProjectRepository; private readonly workflow: WorkflowPersistenceService;
  private readonly memory?: OrchestratorMemoryPort; private readonly workspace?: OrchestratorWorkspacePort; private readonly policy: OrchestrationPolicy;
  constructor(private readonly database: PersistenceDatabase, dependencies: { memory?: OrchestratorMemoryPort; workspace?: OrchestratorWorkspacePort; policy?: OrchestrationPolicy } = {}) { this.documents = new DocumentRepository(database); this.decisions = new DecisionRepository(database); this.projects = new ProjectRepository(database); this.workflow = new WorkflowPersistenceService(database); this.memory = dependencies.memory; this.workspace = dependencies.workspace; this.policy = dependencies.policy ?? DEFAULT_ORCHESTRATION_POLICY; }

  private input(raw: OrchestratorInput) {
    try { const input = OrchestratorInputSchema.parse(raw); if (input.projectId !== input.approvedBrief.projectId || input.projectId !== input.acceptedPlanningPackage.projectId || input.projectId !== input.selectedDesign.projectId || input.projectVersion !== input.approvedBrief.projectVersion || input.projectVersion !== input.acceptedPlanningPackage.projectVersion || input.projectVersion !== input.selectedDesign.projectVersion) throw new OrchestratorError("ORCHESTRATOR_VERSION_MISMATCH", "Approved documents do not belong to the requested project version."); if (!input.allowedRoles.includes("implementation") || !input.allowedRoles.includes("qa-release")) throw new OrchestratorError("ORCHESTRATOR_INPUT_INVALID", "Required approved roles are unavailable."); if (!input.approvedBrief.approval.approved || input.approvedBrief.briefStatus !== "approved") throw new OrchestratorError("ORCHESTRATOR_BRIEF_STALE", "The approved Brief is unavailable."); if (input.approvedBriefChecksum !== checksumPersistedDocument(input.approvedBrief) && input.approvedBriefChecksum !== input.approvedBrief.approval.approvedRequirementsChecksum) throw new OrchestratorError("ORCHESTRATOR_BRIEF_STALE", "The approved Brief checksum is stale."); if (!input.acceptedPlanningPackage.accepted || !input.acceptedPlanningPackage.architecture.acceptance.accepted) throw new OrchestratorError("ORCHESTRATOR_PLANNING_STALE", "The planning package is not accepted."); if (input.acceptedPlanningChecksum !== checksumPersistedDocument(input.acceptedPlanningPackage) && input.acceptedPlanningChecksum !== input.acceptedPlanningPackage.acceptance.checksum) throw new OrchestratorError("ORCHESTRATOR_PLANNING_STALE", "The planning package checksum is stale."); if (input.selectedDesign.selectedDirectionChecksum !== input.selectedDesignChecksum && input.selectedDesignChecksum !== checksumPersistedDocument(input.selectedDesign)) throw new OrchestratorError("ORCHESTRATOR_DESIGN_STALE", "The selected design checksum is stale."); if (input.phase7cContractPackage) { if (input.phase7cContractPackage.projectId !== input.projectId || input.phase7cContractPackage.projectVersion !== input.projectVersion) throw new OrchestratorError("ORCHESTRATOR_VERSION_MISMATCH", "The Phase 7C contract package belongs to another project version."); try { validatePhase7CContractPackage(input.phase7cContractPackage); } catch (error) { throw new OrchestratorError("ORCHESTRATOR_PLANNING_STALE", "The Phase 7C contract package is invalid or stale.", error); } } if (input.currentWorkflowState !== "READY_FOR_IMPLEMENTATION" && input.currentWorkflowState !== "CONTRACT_AUDIT") throw new OrchestratorError("ORCHESTRATOR_WORKFLOW_STATE_INVALID", "Orchestration is only available after explicit design selection or Contract Audit correction."); if (input.projectImmutable) throw new OrchestratorError("ORCHESTRATOR_PROJECT_IMMUTABLE", "Released project versions are immutable."); if (!evaluatePlanningAcceptanceReadiness({ planningPackage: input.acceptedPlanningPackage, context: input.canonicalBrief ? { legalPlaceholderPolicy: input.canonicalBrief.legal.placeholderPolicy, canonicalBrief: input.canonicalBrief } : undefined }).readyForAcceptance || input.approvedBrief.unresolvedItems.some((item) => item.blocking)) throw new OrchestratorError("ORCHESTRATOR_INPUT_INVALID", "Blocking approved project data remains unresolved."); if (input.requiredExternalDecisionPending) throw new OrchestratorError("ORCHESTRATOR_INPUT_INVALID", "A required external decision remains pending."); if (input.existingDecisions.some((decision) => typeof decision === "object" && decision !== null && "requirementChange" in decision && (decision as { requirementChange?: unknown }).requirementChange === true && (decision as { userApprovalStatus?: unknown }).userApprovalStatus !== "approved")) throw new OrchestratorError("ORCHESTRATOR_REQUIREMENT_CHANGE_PENDING", "An unapproved requirement change is pending."); return input; } catch (error) { if (error instanceof OrchestratorError) throw error; throw new OrchestratorError("ORCHESTRATOR_INPUT_INVALID", "Orchestrator input did not match the strict contract.", error); }
  }

  private async assertCurrentCanonicalInputs(input: OrchestratorInput, expectedWorkflowState: "READY_FOR_IMPLEMENTATION" | "CONTRACT_AUDIT" = "READY_FOR_IMPLEMENTATION") {
    const current = await this.projects.getWithVersion(input.projectId);
    // Pure graph-contract tests intentionally use no persisted project. Production
    // admission always has the canonical project and downstream documents.
    if (!current) return;
    if (current.project.currentVersion !== input.projectVersion || current.project.workflowState !== expectedWorkflowState || current.rowVersion !== input.expectedRowVersion) throw new OrchestratorError("ORCHESTRATOR_WORKFLOW_STATE_INVALID", "The canonical project state is stale before TaskGraph creation.");
    const [brief, briefV3, planning, selected, review, architecture, phase7c] = await Promise.all([
      this.documents.get(input.projectId, input.projectVersion, "requirements"),
      this.documents.get(input.projectId, input.projectVersion, "brief-v3"),
      this.documents.get(input.projectId, input.projectVersion, "planning-package"),
      this.documents.get(input.projectId, input.projectVersion, "selected-design"),
      this.documents.get(input.projectId, input.projectVersion, "architecture-review"),
      this.documents.get(input.projectId, input.projectVersion, "architecture"),
      input.phase7cContractPackage ? this.documents.get(input.projectId, input.projectVersion, "phase-7c-contract-package") : Promise.resolve(null),
    ]);
    // Keep legacy pure-service fixtures usable, but once any canonical artifact
    // exists, missing or mismatched downstream inputs fail closed.
    if (![brief, briefV3, planning, selected, review, phase7c].some(Boolean)) return;
    if (briefV3?.documentType === "brief-v3") {
      const currentBrief = BriefV3DocumentSchema.parse(briefV3);
      if (!currentBrief.approval?.approved || currentBrief.approval.approvedCanonicalChecksum !== currentBrief.briefChecksum || (input.canonicalBrief && canonicalBriefChecksum(input.canonicalBrief) !== currentBrief.briefChecksum) || input.approvedBriefChecksum !== currentBrief.briefChecksum) throw new OrchestratorError("ORCHESTRATOR_BRIEF_STALE", "The persisted approved CanonicalBriefV3 is stale.");
    } else if (!brief || brief.documentType !== "requirements" || (checksumPersistedDocument(brief) !== input.approvedBriefChecksum && brief.approval.approvedRequirementsChecksum !== input.approvedBriefChecksum)) throw new OrchestratorError("ORCHESTRATOR_BRIEF_STALE", "The persisted approved Brief is stale.");
    if (!planning || planning.documentType !== "planning-package" || (checksumPersistedDocument(planning) !== input.acceptedPlanningChecksum && planning.acceptance.checksum !== input.acceptedPlanningChecksum)) throw new OrchestratorError("ORCHESTRATOR_PLANNING_STALE", "The persisted accepted Planning package is stale.");
    if (!selected || selected.documentType !== "selected-design" || checksumPersistedDocument(selected) !== input.selectedDesignChecksum) throw new OrchestratorError("ORCHESTRATOR_DESIGN_STALE", "The persisted selected Design is stale.");
    if (!review || review.documentType !== "architecture-review" || review.result.verdict !== "APPROVED" || review.approvedBriefChecksum !== input.approvedBriefChecksum || review.acceptedPlanningChecksum !== input.acceptedPlanningChecksum) throw new OrchestratorError("ORCHESTRATOR_INPUT_INVALID", "A current approved Architecture Review is required.");
    if (!architecture || architecture.documentType !== "architecture" || !architecture.acceptance.accepted || checksumPersistedDocument(architecture) !== checksumPersistedDocument(input.technicalArchitecture)) throw new OrchestratorError("ORCHESTRATOR_PLANNING_STALE", "The persisted Architecture is stale.");
    if (input.phase7cContractPackage && (!phase7c || phase7c.documentType !== "phase-7c-contract-package" || phase7c.currentness.status !== "CURRENT" || phase7c.approvedBriefChecksum !== input.approvedBriefChecksum || phase7c.planningChecksum !== planningSemanticChecksum(planning) || phase7c.architectureChecksum !== checksumPersistedDocument(architecture))) throw new OrchestratorError("ORCHESTRATOR_PLANNING_STALE", "The persisted Phase 7C package is stale.");
  }
  async createImplementationTaskGraph(raw: OrchestratorInput): Promise<OrchestrationResult> { const input = this.input(raw); await this.assertCurrentCanonicalInputs(input); const graph = buildImplementationTaskGraph(input, this.policy); const validation = validateImplementationTaskGraph(graph, input, this.policy); const readiness = taskGraphReady(graph, { ...input, workspaceReserved: input.workspaceReserved }); const graphValidation = { valid: validation.valid, errors: validation.errors, warnings: validation.warnings }; const result = TaskGraphSchema.parse({ ...graph, graphChecksum: graph.graphChecksum, validation: graphValidation, readyForExecution: readiness.readyForExecution, blockingReasons: readiness.blockingReasons, warnings: readiness.warnings, checkpoint: "graph-validated" }); const phase7c = input.phase7cContractPackage ? rebindTaskContractsToPackage(rebindPhase7CToSelectedDesign(input.phase7cContractPackage, input.selectedDesignChecksum), graph.tasks) : undefined; await this.database.transaction(async (tx) => { if (phase7c) await saveDocumentInTransaction(tx, phase7c, `${input.idempotencyKey}:phase-7c-task-contracts`); await saveDocumentInTransaction(tx, result, input.idempotencyKey); }); return { taskGraph: result, ...validation, readyForExecution: readiness.readyForExecution, blockingReasons: readiness.blockingReasons, warnings: readiness.warnings, graphChecksum: result.graphChecksum ?? validation.graphChecksum }; }
  async regenerateImplementationTaskGraph(raw: OrchestratorInput, expectedPersistedGraphChecksum: string, idempotencyKey: string, expectedPersistedPhase7CRowVersion: number): Promise<OrchestrationResult> {
    const expectedPhase7CChecksum = raw.phase7cContractPackage ? checksumPersistedDocument(raw.phase7cContractPackage) : undefined;
    const input = this.input(raw.phase7cContractPackage ? { ...raw, phase7cContractPackage: phase7CForLegacyTaskGraphCorrection(raw.phase7cContractPackage) } : raw);
    await this.assertCurrentCanonicalInputs(input, "CONTRACT_AUDIT");
    const currentGraph = await this.documents.get(input.projectId, input.projectVersion, "task-graph");
    if (!currentGraph || currentGraph.documentType !== "task-graph") throw new OrchestratorError("ORCHESTRATOR_GRAPH_NOT_READY", "A prior implementation task graph is required before regeneration.");
    if (checksumPersistedDocument(currentGraph) !== expectedPersistedGraphChecksum) throw new OrchestratorError("ORCHESTRATOR_GRAPH_CHECKSUM_MISMATCH", "The persisted TaskGraph changed before regeneration.");
    const priorAudit = await this.documents.get(input.projectId, input.projectVersion, "contract-audit");
    if (!priorAudit || priorAudit.documentType !== "contract-audit" || !["CHANGES_REQUIRED", "BLOCKED"].includes(priorAudit.result.verdict)) throw new OrchestratorError("ORCHESTRATOR_INPUT_INVALID", "TaskGraph regeneration requires a current Contract Audit correction result.");
    const decisions = await this.decisions.list(input.projectId, input.projectVersion);
    const regenerationCount = decisions.filter((decision) => decision.category === "task-graph-regeneration").length;
    if (regenerationCount >= 2) throw new OrchestratorError("ORCHESTRATOR_TASKGRAPH_REGENERATION_EXHAUSTED", "The bounded TaskGraph correction budget is exhausted for this project version.");
    const graph = buildImplementationTaskGraph(input, this.policy);
    const validation = validateImplementationTaskGraph(graph, input, this.policy);
    const readiness = taskGraphReady(graph, { ...input, workspaceReserved: input.workspaceReserved });
    const graphValidation = { valid: validation.valid, errors: validation.errors, warnings: validation.warnings };
    const result = TaskGraphSchema.parse({ ...graph, graphChecksum: graph.graphChecksum, validation: graphValidation, readyForExecution: readiness.readyForExecution, blockingReasons: readiness.blockingReasons, warnings: readiness.warnings, checkpoint: "graph-validated" });
    if (!validation.valid || !readiness.readyForExecution) throw new OrchestratorError("ORCHESTRATOR_GRAPH_INVALID", "The regenerated implementation graph is not ready for execution.", { validationErrors: validation.errors.slice(0, 16), blockingReasons: readiness.blockingReasons.slice(0, 16) });
    if (checksumPersistedDocument(currentGraph) === checksumPersistedDocument(result)) throw new OrchestratorError("ORCHESTRATOR_GRAPH_INVALID", "TaskGraph regeneration produced no correction for the current audit.");
    const phase7c = input.phase7cContractPackage ? rebindTaskContractsToPackage(rebindPhase7CToSelectedDesign(input.phase7cContractPackage, input.selectedDesignChecksum), graph.tasks) : undefined;
    const decision = DecisionRecordSchema.parse({ id: randomUUID(), timestamp: now(), actorType: "system", actorIdentifier: "orchestrator", category: "task-graph-regeneration", decision: "Regenerated the implementation TaskGraph after bounded Contract Audit correction.", rationale: "The Orchestrator authorized one bounded TaskGraph-only regeneration; upstream canonical artifacts remain unchanged.", affectedDocuments: ["task-graph.json", "contract-audit.json"], requirementChange: false, userApprovalRequired: false, userApprovalStatus: "not-required" });
    await this.database.transaction(async (tx) => {
      const current = await tx.getProject(input.projectId);
      const graphRow = await tx.getDocument(input.projectId, input.projectVersion, "task-graph");
      if (!current || current.current_version !== input.projectVersion || current.workflow_state !== "CONTRACT_AUDIT" || current.row_version !== input.expectedRowVersion || !graphRow || graphRow.checksum !== expectedPersistedGraphChecksum) throw new Error("TASKGRAPH_REGENERATION_STALE");
      if (phase7c) {
        const phase7cRow = await tx.getDocument(input.projectId, input.projectVersion, "phase-7c-contract-package");
        if (!phase7cRow || phase7cRow.rowVersion !== expectedPersistedPhase7CRowVersion || phase7cRow.checksum !== expectedPhase7CChecksum) throw new OrchestratorError("ORCHESTRATOR_PLANNING_STALE", "The Phase 7C package changed before TaskGraph correction.");
        await saveDocumentCASInTransaction(tx, phase7c, expectedPersistedPhase7CRowVersion, expectedPhase7CChecksum!);
      }
      await saveDocumentInTransaction(tx, result, idempotencyKey);
      await appendDecisionInTransaction(tx, input.projectId, input.projectVersion, decision);
    });
    return { taskGraph: result, ...validation, readyForExecution: readiness.readyForExecution, blockingReasons: readiness.blockingReasons, warnings: readiness.warnings, graphChecksum: result.graphChecksum ?? validation.graphChecksum };
  }
  async reconcileImplementationTaskGraphPolicy(raw: OrchestratorInput, expectedPersistedGraphChecksum: string, idempotencyKey: string): Promise<OrchestrationResult> {
    const input = this.input(raw);
    await this.assertCurrentCanonicalInputs(input, "CONTRACT_AUDIT");
    const currentGraph = await this.documents.get(input.projectId, input.projectVersion, "task-graph");
    if (!currentGraph || currentGraph.documentType !== "task-graph") throw new OrchestratorError("ORCHESTRATOR_GRAPH_NOT_READY", "A prior implementation task graph is required before policy reconciliation.");
    if (checksumPersistedDocument(currentGraph) !== expectedPersistedGraphChecksum) throw new OrchestratorError("ORCHESTRATOR_GRAPH_CHECKSUM_MISMATCH", "The persisted TaskGraph changed before policy reconciliation.");
    const priorAudit = await this.documents.get(input.projectId, input.projectVersion, "contract-audit");
    if (!priorAudit || priorAudit.documentType !== "contract-audit" || !["CHANGES_REQUIRED", "BLOCKED"].includes(priorAudit.result.verdict)) throw new OrchestratorError("ORCHESTRATOR_INPUT_INVALID", "TaskGraph policy reconciliation requires a current Contract Audit correction result.");
    const graph = buildImplementationTaskGraph(input, this.policy);
    const validation = validateImplementationTaskGraph(graph, input, this.policy);
    const readiness = taskGraphReady(graph, { ...input, workspaceReserved: input.workspaceReserved });
    const result = TaskGraphSchema.parse({ ...graph, graphChecksum: graph.graphChecksum, validation: { valid: validation.valid, errors: validation.errors, warnings: validation.warnings }, readyForExecution: readiness.readyForExecution, blockingReasons: readiness.blockingReasons, warnings: readiness.warnings, checkpoint: "graph-validated" });
    if (!validation.valid || !readiness.readyForExecution) throw new OrchestratorError("ORCHESTRATOR_GRAPH_INVALID", "The reconciled implementation graph is not ready for execution.");
    if (checksumPersistedDocument(currentGraph) === checksumPersistedDocument(result)) return { taskGraph: result, ...validation, readyForExecution: readiness.readyForExecution, blockingReasons: readiness.blockingReasons, warnings: readiness.warnings, graphChecksum: result.graphChecksum ?? validation.graphChecksum };
    const decisions = await this.decisions.list(input.projectId, input.projectVersion);
    if (decisions.some((decision) => decision.category === "task-graph-scope-reconciliation")) throw new OrchestratorError("ORCHESTRATOR_TASKGRAPH_REGENERATION_EXHAUSTED", "The bounded TaskGraph scope-reconciliation budget is exhausted for this project version.");
    const decision = DecisionRecordSchema.parse({ id: randomUUID(), timestamp: now(), actorType: "system", actorIdentifier: "orchestrator", category: "task-graph-scope-reconciliation", decision: "Reconciled implementation TaskGraph write scopes after Contract Audit findings.", rationale: "The Orchestrator applied one bounded source-policy repair; approved upstream artifacts remain unchanged.", affectedDocuments: ["task-graph.json", "contract-audit.json"], requirementChange: false, userApprovalRequired: false, userApprovalStatus: "not-required" });
    await this.database.transaction(async (tx) => {
      const current = await tx.getProject(input.projectId);
      const graphRow = await tx.getDocument(input.projectId, input.projectVersion, "task-graph");
      if (!current || current.current_version !== input.projectVersion || current.workflow_state !== "CONTRACT_AUDIT" || current.row_version !== input.expectedRowVersion || !graphRow || graphRow.checksum !== expectedPersistedGraphChecksum) throw new Error("TASKGRAPH_POLICY_RECONCILIATION_STALE");
      await saveDocumentInTransaction(tx, result, idempotencyKey);
      await appendDecisionInTransaction(tx, input.projectId, input.projectVersion, decision);
    });
    return { taskGraph: result, ...validation, readyForExecution: readiness.readyForExecution, blockingReasons: readiness.blockingReasons, warnings: readiness.warnings, graphChecksum: result.graphChecksum ?? validation.graphChecksum };
  }
  async reconcileImplementationTaskGraphDependencies(raw: OrchestratorInput, expectedPersistedGraphChecksum: string, idempotencyKey: string): Promise<OrchestrationResult> {
    const input = this.input(raw);
    await this.assertCurrentCanonicalInputs(input, "CONTRACT_AUDIT");
    const currentGraph = await this.documents.get(input.projectId, input.projectVersion, "task-graph");
    if (!currentGraph || currentGraph.documentType !== "task-graph") throw new OrchestratorError("ORCHESTRATOR_GRAPH_NOT_READY", "A prior implementation task graph is required before dependency reconciliation.");
    if (checksumPersistedDocument(currentGraph) !== expectedPersistedGraphChecksum) throw new OrchestratorError("ORCHESTRATOR_GRAPH_CHECKSUM_MISMATCH", "The persisted TaskGraph changed before dependency reconciliation.");
    const priorAudit = await this.documents.get(input.projectId, input.projectVersion, "contract-audit");
    if (!priorAudit || priorAudit.documentType !== "contract-audit" || !["CHANGES_REQUIRED", "BLOCKED"].includes(priorAudit.result.verdict)) throw new OrchestratorError("ORCHESTRATOR_INPUT_INVALID", "TaskGraph dependency reconciliation requires a current Contract Audit correction result.");
    const graph = buildImplementationTaskGraph(input, this.policy);
    const validation = validateImplementationTaskGraph(graph, input, this.policy);
    const readiness = taskGraphReady(graph, { ...input, workspaceReserved: input.workspaceReserved });
    const result = TaskGraphSchema.parse({ ...graph, graphChecksum: graph.graphChecksum, validation: { valid: validation.valid, errors: validation.errors, warnings: validation.warnings }, readyForExecution: readiness.readyForExecution, blockingReasons: readiness.blockingReasons, warnings: readiness.warnings, checkpoint: "graph-validated" });
    if (!validation.valid || !readiness.readyForExecution) throw new OrchestratorError("ORCHESTRATOR_GRAPH_INVALID", "The dependency-reconciled implementation graph is not ready for execution.");
    if (checksumPersistedDocument(currentGraph) === checksumPersistedDocument(result)) return { taskGraph: result, ...validation, readyForExecution: readiness.readyForExecution, blockingReasons: readiness.blockingReasons, warnings: readiness.warnings, graphChecksum: result.graphChecksum ?? validation.graphChecksum };
    const decisions = await this.decisions.list(input.projectId, input.projectVersion);
    if (decisions.some((decision) => decision.category === "task-graph-dependency-reconciliation")) throw new OrchestratorError("ORCHESTRATOR_TASKGRAPH_REGENERATION_EXHAUSTED", "The bounded TaskGraph dependency-reconciliation budget is exhausted for this project version.");
    const decision = DecisionRecordSchema.parse({ id: randomUUID(), timestamp: now(), actorType: "system", actorIdentifier: "orchestrator", category: "task-graph-dependency-reconciliation", decision: "Reconciled implementation TaskGraph validation dependencies after Contract Audit findings.", rationale: "The Orchestrator applied one bounded dependency-policy repair; approved upstream artifacts remain unchanged.", affectedDocuments: ["task-graph.json", "contract-audit.json"], requirementChange: false, userApprovalRequired: false, userApprovalStatus: "not-required" });
    await this.database.transaction(async (tx) => {
      const current = await tx.getProject(input.projectId);
      const graphRow = await tx.getDocument(input.projectId, input.projectVersion, "task-graph");
      if (!current || current.current_version !== input.projectVersion || current.workflow_state !== "CONTRACT_AUDIT" || current.row_version !== input.expectedRowVersion || !graphRow || graphRow.checksum !== expectedPersistedGraphChecksum) throw new Error("TASKGRAPH_DEPENDENCY_RECONCILIATION_STALE");
      await saveDocumentInTransaction(tx, result, idempotencyKey);
      await appendDecisionInTransaction(tx, input.projectId, input.projectVersion, decision);
    });
    return { taskGraph: result, ...validation, readyForExecution: readiness.readyForExecution, blockingReasons: readiness.blockingReasons, warnings: readiness.warnings, graphChecksum: result.graphChecksum ?? validation.graphChecksum };
  }
  async validateImplementationTaskGraph(graph: TaskGraph, input?: OrchestratorInput) { const validation = validateImplementationTaskGraph(graph, input ? this.input(input) : undefined, this.policy); return { ...validation, readyForExecution: input ? taskGraphReady(graph, this.input(input)).readyForExecution : validation.valid }; }
  async getOrchestrationStatus(projectId: string, version: number) { const document = await this.documents.get(projectId, version, "task-graph"); return document?.documentType === "task-graph" ? { taskGraph: document, validation: document.validation, checkpoint: document.checkpoint, readyForExecution: document.readyForExecution, blockingReasons: document.blockingReasons ?? [], warnings: document.warnings ?? [] } : null; }
  async getExecutionReadyTasks(projectId: string, version: number) { const graph = await this.documents.get(projectId, version, "task-graph"); if (!graph || graph.documentType !== "task-graph") return []; return graph.tasks.filter((task) => task.status === "ready"); }

  async startImplementation(raw: OrchestratorInput) { const input = this.input(raw); const current = await this.projects.getWithVersion(input.projectId); if (!current || current.project.workflowState !== "READY_FOR_IMPLEMENTATION") throw new OrchestratorError("IMPLEMENTATION_ALREADY_STARTED", "Implementation has already started or the project state is stale."); const graph = await this.documents.get(input.projectId, input.projectVersion, "task-graph"); if (!graph || graph.documentType !== "task-graph") throw new OrchestratorError("ORCHESTRATOR_GRAPH_NOT_READY", "An implementation task graph must be created first."); const audit = await this.documents.get(input.projectId, input.projectVersion, "contract-audit"); if (!audit || audit.documentType !== "contract-audit" || audit.result.verdict !== "APPROVED" || !input.approvedContractAuditChecksum || input.approvedContractAuditChecksum !== checksumPersistedDocument(audit) || audit.briefChecksum !== input.approvedBriefChecksum || audit.planningChecksum !== input.acceptedPlanningChecksum || audit.designChecksum !== input.selectedDesignChecksum || audit.taskGraphChecksum !== (graph.graphChecksum ?? checksumPersistedDocument(graph))) throw new OrchestratorError("IMPLEMENTATION_START_BLOCKED", "A current approved Contract Audit is required before implementation."); const persistedPhase7c = input.phase7cContractPackage ? await this.documents.get(input.projectId, input.projectVersion, "phase-7c-contract-package") : null; const phase7cContractPackage = persistedPhase7c?.documentType === "phase-7c-contract-package" ? persistedPhase7c : input.phase7cContractPackage; if (!phase7cContractPackage) throw new OrchestratorError("IMPLEMENTATION_START_BLOCKED", "A current Phase 7C contract package is required before implementation."); try { validateStartImplementationGate({ contractPackage: phase7cContractPackage, taskContracts: phase7cContractPackage.taskContracts, databaseTask: graph.tasks.some((task) => task.taskType.includes("database") || task.taskType === "implement-rls-policy") }); } catch (error) { throw new OrchestratorError("IMPLEMENTATION_START_BLOCKED", "The Phase 7C start gate rejected implementation.", error); }
    let securityThreatModel: ReturnType<typeof runPreImplementationSecurityThreatModel>;
    try {
      securityThreatModel = runPreImplementationSecurityThreatModel(input);
    } catch (error) {
      throw new OrchestratorError("IMPLEMENTATION_START_BLOCKED", "The pre-implementation security threat model blocked the start gate.", error);
    }
    let architectureCritic: ReturnType<typeof runPreImplementationArchitectureCritic>;
    try {
      architectureCritic = runPreImplementationArchitectureCritic({ architecture: input.technicalArchitecture });
    } catch (error) {
      throw new OrchestratorError("IMPLEMENTATION_START_BLOCKED", "The pre-implementation architecture critic blocked the start gate.", error);
    }
    const selectedContract = input.selectedDesign.selectedDirectionContract;
    if (selectedContract) {
      const approvedDependencies = new Set(phase7cContractPackage.dependencyProposal.dependencies.filter((dependency) => dependency.approvalStatus === "APPROVED" || dependency.approvalStatus === "NOT_REQUIRED").map((dependency) => `${dependency.packageName}@${dependency.versionSpec}`));
      const readiness = validateDirectionDesignCapability(input.selectedDesign.selectedDirectionId, selectedContract, { requireLiveEvidence: true, approvedDependencies });
      const binding = input.selectedDesign.designContract;
      if (!binding || binding.visualSystemChecksum !== selectedContract.visualSystem.tokenChecksum || binding.typographyChecksum !== selectedContract.typography.checksum || binding.motionChecksum !== selectedContract.motion.checksum || binding.interactionChecksum !== checksumPersistedDocument(selectedContract.interactions) || binding.currentness.status !== "CURRENT" || !readiness.valid) throw new OrchestratorError("IMPLEMENTATION_START_BLOCKED", "The selected professional design contract is stale, incomplete, or lacks current tool evidence.", readiness.issues[0]);
      if (selectedContract.motion.suitability === "MOTION") {
        const amendmentDocument = await this.documents.get(input.projectId, input.projectVersion, "design-dependency-amendment");
        const amendment = amendmentDocument?.documentType === "design-dependency-amendment" ? DesignDependencyAmendmentSchema.parse(amendmentDocument) : undefined;
        const motionApproved = phase7cContractPackage.dependencyProposal.dependencies.some((dependency) => dependency.packageName === "motion" && dependency.versionSpec === "12.43.0" && (dependency.approvalStatus === "APPROVED" || dependency.approvalStatus === "NOT_REQUIRED"));
        if (!amendment || amendment.status !== "USER_APPROVED" || amendment.directionId !== input.selectedDesign.selectedDirectionId || !motionApproved) throw new OrchestratorError("IMPLEMENTATION_START_BLOCKED", "A user-approved DESIGN_DEPENDENCY_AMENDMENT and approved Motion dependency are required before implementation.");
      }
    }
    const readiness = taskGraphReady(graph, { ...input, workspaceReserved: true }); if (!readiness.readyForExecution) throw new OrchestratorError("IMPLEMENTATION_START_BLOCKED", "The implementation task graph is not ready for execution."); if (this.workspace) { const verified = this.workspace.reserve ? await this.workspace.reserve(input.projectId, input.projectVersion) : await this.workspace.verify(input.projectId, input.projectVersion); if (!verified) throw new OrchestratorError("IMPLEMENTATION_START_BLOCKED", "The project workspace could not be reserved or verified."); }
     const readyIds = new Set(graph.tasks.filter((task) => task.dependencies.length === 0).map((task) => task.id)); const next = withChecksum(TaskGraphSchema.parse({ ...graph, securityThreatModel, architectureCritic, tasks: graph.tasks.map((task) => readyIds.has(task.id) ? { ...task, status: "ready" as const } : task), checkpoint: "implementation-started" as const, readyForExecution: true, blockingReasons: [], updatedAt: now() })); const decision = DecisionRecordSchema.parse({ id: randomUUID(), timestamp: now(), actorType: "system", actorIdentifier: "orchestrator", category: "implementation-start", decision: "Started implementation workflow with a persisted task graph.", rationale: "The user explicitly requested implementation start after graph readiness; task execution remains a future operation.", affectedDocuments: ["task-graph.json", "project.json", "manifest.json"], requirementChange: false, userApprovalRequired: false, userApprovalStatus: "not-required" }); let started: { project: import("@/domain/project/schema").FactoryProject; rowVersion: number }; try { started = await this.database.transaction(async (tx) => { const currentRow = await tx.getProject(input.projectId); const graphRow = await tx.getDocument(input.projectId, input.projectVersion, "task-graph"); if (!currentRow || currentRow.row_version !== input.expectedRowVersion || currentRow.workflow_state !== "READY_FOR_IMPLEMENTATION" || !graphRow || graphRow.checksum !== checksumPersistedDocument(graph)) throw new Error("IMPLEMENTATION_START_STALE"); await saveDocumentInTransaction(tx, next, `${input.idempotencyKey}:implementation-start`); await appendDecisionInTransaction(tx, input.projectId, input.projectVersion, decision); return transitionWorkflowInTransaction(tx, { projectId: input.projectId, projectVersion: input.projectVersion, expectedState: "READY_FOR_IMPLEMENTATION", expectedRowVersion: input.expectedRowVersion, targetState: "IMPLEMENTING", actor: "orchestrator", reason: "Explicit implementation start accepted; no task execution performed.", context: { requirements: input.approvedBrief, requirementsChecksum: input.approvedBriefChecksum, architecture: input.technicalArchitecture, decisions: input.existingDecisions as never[], ...(phase7cContractPackage ? { phase7cContractPackage } : {}) }, idempotencyKey: input.idempotencyKey }); }); } catch (error) { throw new OrchestratorError("IMPLEMENTATION_START_BLOCKED", "The implementation start transition was rejected.", error); } if (this.memory) { try { await this.memory.appendDecision(input.projectId, input.projectVersion, decision); await this.memory.writeSnapshot(input.projectId, input.projectVersion, { "task-graph.json": next, "project.json": started.project }); } catch (error) { throw new OrchestratorError("IMPLEMENTATION_START_BLOCKED", "Implementation started but its projection could not be synchronized.", error); } } return { project: started.project, rowVersion: started.rowVersion, taskGraph: next, initialReadyTasks: next.tasks.filter((task) => task.status === "ready") };
  }

  async transitionTaskState(input: { projectId: string; projectVersion: number; taskId: string; targetStatus: AgentTask["status"]; expectedGraphChecksum: string; actor: string; reason: string }) { const document = await this.documents.get(input.projectId, input.projectVersion, "task-graph"); if (!document || document.documentType !== "task-graph") throw new OrchestratorError("ORCHESTRATOR_GRAPH_NOT_READY", "Task graph was not found."); if (document.graphChecksum !== input.expectedGraphChecksum) throw new OrchestratorError("TASK_STATE_CONFLICT", "Task graph changed before the task transition."); const task = document.tasks.find((candidate) => candidate.id === input.taskId); if (!task) throw new OrchestratorError("TASK_STATE_CONFLICT", "Task was not found in the current graph."); const allowed: Record<AgentTask["status"], AgentTask["status"][]> = { pending: ["blocked", "ready", "cancelled"], blocked: ["ready", "cancelled"], ready: ["running", "cancelled"], running: ["passed", "failed", "cancelled"], passed: [], failed: ["ready"], cancelled: [] }; if (!allowed[task.status].includes(input.targetStatus)) throw new OrchestratorError("TASK_TRANSITION_INVALID", "The task state transition is not permitted."); if (input.targetStatus === "ready" && task.status === "failed" && task.attempt >= task.maxAttempts) throw new OrchestratorError("TASK_ATTEMPT_LIMIT_REACHED", "The task has exhausted its allowed attempts."); if (input.targetStatus === "running" && task.attempt >= task.maxAttempts) throw new OrchestratorError("TASK_ATTEMPT_LIMIT_REACHED", "The task has exhausted its allowed attempts."); const timestamp = now(); const nextTask = { ...task, status: input.targetStatus, ...(input.targetStatus === "running" ? { startedAt: timestamp, attempt: task.attempt + 1 } : {}), ...(["passed", "failed", "cancelled"].includes(input.targetStatus) ? { completedAt: timestamp } : {}) }; const nextTasks = document.tasks.map((candidate) => candidate.id === task.id ? nextTask : candidate); const next = withChecksum(TaskGraphSchema.parse({ ...document, tasks: nextTasks, updatedAt: timestamp })); await this.documents.save(next); return { taskGraph: next, event: event(task.id, task.status, input.targetStatus, input.actor, input.reason, nextTask.attempt) }; }

  async retryFailedTask(input: Omit<Parameters<OrchestratorService["transitionTaskState"]>[0], "targetStatus">) { const graph = await this.documents.get(input.projectId, input.projectVersion, "task-graph"); const task = graph?.documentType === "task-graph" ? graph.tasks.find((candidate) => candidate.id === input.taskId) : undefined; if (!task || task.status !== "failed") throw new OrchestratorError("TASK_TRANSITION_INVALID", "Only a failed task can be retried."); return this.transitionTaskState({ ...input, targetStatus: "ready" }); }
  async replayFailedValidationTask(input: { projectId: string; projectVersion: number; taskId: string; expectedGraphChecksum: string; actor: string; reason: "VALIDATION_EVIDENCE_REFRESH"; sourceChecksum: string; diagnosticPolicyVersion: string }) { const graph = await this.documents.get(input.projectId, input.projectVersion, "task-graph"); if (!graph || graph.documentType !== "task-graph") throw new OrchestratorError("ORCHESTRATOR_GRAPH_NOT_READY", "Task graph was not found."); if (graph.graphChecksum !== input.expectedGraphChecksum) throw new OrchestratorError("TASK_STATE_CONFLICT", "Task graph changed before validation replay."); const task = graph.tasks.find((candidate) => candidate.id === input.taskId); const supported = ["validate-lint", "validate-typecheck", "validate-unit-tests", "validate-build"].includes(task?.taskType ?? ""); if (!task || !supported || task.status !== "failed") throw new OrchestratorError("TASK_TRANSITION_INVALID", "Only a failed supported validation task can be replayed."); const identity = `${task.id}:${input.sourceChecksum}:${input.diagnosticPolicyVersion}:${input.reason}`; if (task.validationReplayIdentity === identity) return { taskGraph: graph, replayed: false as const, event: event(task.id, "failed", task.status, input.actor, "Validation replay already reconciled.", task.attempt) }; if ((task.validationReplayCount ?? 0) >= 1 && task.validationDiagnosticPolicyVersion === input.diagnosticPolicyVersion) throw new OrchestratorError("TASK_ATTEMPT_LIMIT_REACHED", "Validation evidence replay is bounded to one attempt per task and policy version."); if (task.validationSourceChecksum && task.validationSourceChecksum !== input.sourceChecksum) throw new OrchestratorError("TASK_STATE_CONFLICT", "Workspace source checksum changed since the validation evidence was recorded."); if (graph.tasks.some((candidate) => candidate.repairOfTaskId === task.id && ["pending", "ready", "running"].includes(candidate.status))) throw new OrchestratorError("TASK_REPAIR_INVALID", "Validation replay is blocked while an active repair owns the failed task."); if (task.dependencies.some((dependency) => graph.tasks.find((candidate) => candidate.id === dependency)?.status !== "passed")) throw new OrchestratorError("TASK_DEPENDENCY_FAILED", "Validation replay requires all implementation dependencies to remain passed."); const timestamp = now(); const nextTask = { ...task, status: "ready" as const, completedAt: undefined, validationReplayCount: 1, validationReplayIdentity: identity, validationDiagnosticPolicyVersion: input.diagnosticPolicyVersion, validationSourceChecksum: input.sourceChecksum }; const next = withChecksum(TaskGraphSchema.parse({ ...graph, tasks: graph.tasks.map((candidate) => candidate.id === task.id ? nextTask : candidate), checkpoint: "validation-started" as const, updatedAt: timestamp })); await this.documents.save(next); return { taskGraph: next, replayed: true as const, event: event(task.id, "failed", "ready", input.actor, input.reason, task.attempt) }; }
  async createTargetedRepairTask(input: {
    projectId: string;
    projectVersion: number;
    failedTaskId: string;
    failureCode: string;
    failureSummary: string;
    expectedCorrection: string;
    revalidationTaskIds: string[];
    expectedGraphChecksum: string;
    actor: string;
    fileScopes?: string[];
    repairIdentity?: string;
    lateValidationEvidence?: boolean;
  }) {
    try {
      return await this.database.transaction(async (tx) => {
    const project = await tx.getProject(input.projectId);
    const version = await tx.getVersion(input.projectId, input.projectVersion);
    if (!project || !version)
      throw new OrchestratorError(
        "ORCHESTRATOR_GRAPH_NOT_READY",
        "The project version or task graph was not found.",
      );
    if (
      project.current_version !== input.projectVersion ||
      project.workflow_state !== "IMPLEMENTING"
    )
      throw new OrchestratorError(
        "TASK_STATE_CONFLICT",
        "Targeted repair requires the current IMPLEMENTING project version.",
      );
    if (version.immutable)
      throw new OrchestratorError(
        "ORCHESTRATOR_PROJECT_IMMUTABLE",
        "Released project versions are immutable.",
      );
    const graphRow = await tx.getDocument(
      input.projectId,
      input.projectVersion,
      "task-graph",
    );
    if (!graphRow)
      throw new OrchestratorError(
        "ORCHESTRATOR_GRAPH_NOT_READY",
        "Task graph was not found.",
      );
    const graph = mapRowToDocument(graphRow);
    if (graph.documentType !== "task-graph")
      throw new OrchestratorError(
        "ORCHESTRATOR_GRAPH_NOT_READY",
        "Task graph was not found.",
      );
    if (graph.graphChecksum !== input.expectedGraphChecksum)
      throw new OrchestratorError(
        "TASK_STATE_CONFLICT",
        "Task graph changed before repair creation.",
      );
    const failed = graph.tasks.find(
      (task) => task.id === input.failedTaskId,
    );
    if (
      !failed ||
      !["failed", "pending"].includes(failed.status) ||
      (failed.status === "pending" && !input.lateValidationEvidence)
    )
      throw new OrchestratorError(
        "TASK_REPAIR_INVALID",
        "A repair task must target a failed validation task or a pending task with late validation evidence.",
      );
    const scopes = input.fileScopes ?? failed.fileScopes;
    if (
      !scopes.length ||
      scopes.some(
        (scope) =>
          !scope ||
          scope.includes("*") ||
          scope.includes("..") ||
          scope.startsWith("/") ||
          /^[A-Za-z]:[\\/]/.test(scope) ||
          ["node_modules", ".next", ".git", ".factory"].some(
            (name) => scope === name || scope.startsWith(`${name}/`),
          ),
      )
    )
      throw new OrchestratorError(
        "TASK_REPAIR_INVALID",
        "Repair scope cannot be empty or unsafe.",
      );
    const owner = repairOwner(graph, failed, scopes);
    if (!owner)
      throw new OrchestratorError(
        "TASK_REPAIR_INVALID",
        "The targeted repair scope has no canonical implementation owner.",
      );
    const repairIdentity =
      input.repairIdentity ??
      `${failed.id}:${input.failureCode}:${scopes.join(",")}:targeted-repair-v1`;
    const operation = "orchestrator.targeted-repair-task";
    const operationKey = `${input.projectId}:${input.projectVersion}:${repairIdentity}`;
    const operationPayload = {
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      failedTaskId: failed.id,
      failureCode: input.failureCode,
      failureSummary: input.failureSummary,
      expectedCorrection: input.expectedCorrection,
      revalidationTaskIds: input.revalidationTaskIds,
      fileScopes: scopes,
      repairIdentity,
      lateValidationEvidence: Boolean(input.lateValidationEvidence),
    };
    const operationPayloadHash = checksumPersistedDocument(operationPayload);
    const activeExisting = graph.tasks.find(
      (task) =>
        task.repairOfTaskId === failed.id &&
        ["pending", "ready", "running"].includes(task.status),
    );
    if (activeExisting && activeExisting.repairIdentity !== repairIdentity)
      throw new OrchestratorError(
        "TASK_REPAIR_INVALID",
        "A different targeted repair is already active for the failed task.",
      );
    const reservation = await tx.reserveOperation({
      operation,
      key: operationKey,
      payloadHash: operationPayloadHash,
    });
    if (reservation.status === "IN_PROGRESS")
      throw new OrchestratorError(
        "TASK_STATE_CONFLICT",
        "Targeted repair creation is already in progress.",
      );
    if (reservation.status === "SUCCEEDED") {
      const stored =
        reservation.result && typeof reservation.result === "object"
          ? (reservation.result as { repairTaskId?: unknown })
          : {};
      const replay = graph.tasks.find(
        (task) =>
          task.id === stored.repairTaskId &&
          task.taskType === "repair-targeted-failure" &&
          task.repairIdentity === repairIdentity,
      );
      if (!replay)
        throw new OrchestratorError(
          "TASK_STATE_CONFLICT",
          "The targeted repair operation completed without its repair task.",
        );
      return replay;
    }
    if (activeExisting) {
      await tx.completeOperation({
        operation,
        key: operationKey,
        payloadHash: operationPayloadHash,
        result: {
          repairTaskId: activeExisting.id,
          graphChecksum: graph.graphChecksum,
        },
      });
      return activeExisting;
    }
    const dependencies = failed.dependencies.filter((dependency) => {
      const task = graph.tasks.find((candidate) => candidate.id === dependency);
      return (
        task &&
        !task.taskType.startsWith("validate-") &&
        task.taskType !== "prepare-release"
      );
    });
    const dependenciesPassed = dependencies.every(
      (dependency) =>
        graph.tasks.find((task) => task.id === dependency)?.status === "passed",
    );
    const repairAllowedTools = owner.allowedTools.filter((tool) => tool !== "shadcn-registry-read");
    const repair: AgentTask = {
      ...owner,
      id: randomUUID(),
      taskType: "repair-targeted-failure",
      title: `Repair ${failed.title}`,
      objective: input.expectedCorrection,
      status: dependenciesPassed ? "ready" : "pending",
      completedAt: undefined,
      dependencies,
      executionMode: "exclusive-write",
      parallelGroup: undefined,
      attempt: 0,
      maxAttempts: 1,
      repairOfTaskId: failed.id,
      repairIdentity,
      safeFailureCode: input.failureCode,
      blockingFailure: true,
      expectedOutputs: ["targeted correction"],
      acceptanceCriteria: [input.failureSummary, input.expectedCorrection],
      fileScopes: scopes,
      allowedTools: repairAllowedTools,
      requiredCapabilities: taskCapabilitiesFor({ taskType: "repair-targeted-failure", allowedTools: repairAllowedTools }),
    };
    const resetExhaustedTask = (candidate: AgentTask) =>
      candidate.attempt >= candidate.maxAttempts
        ? { ...candidate, attempt: 0, safeFailureCode: input.failureCode }
        : candidate;
    const supersededRepairIds = new Set(
      graph.tasks
        .filter(
          (candidate) =>
            candidate.taskType === "repair-targeted-failure" &&
            candidate.status === "failed" &&
            candidate.repairOfTaskId === failed.id,
        )
        .map((candidate) => candidate.id),
    );
    const nextTasks = graph.tasks.map((candidate) => {
      if (supersededRepairIds.has(candidate.id))
        return { ...candidate, status: "cancelled" as const, completedAt: now() };
      if (candidate.id !== failed.id) return candidate;
      const rerunnable = resetExhaustedTask(candidate);
      return candidate.status === "pending"
        ? {
            ...rerunnable,
            status: "failed" as const,
            completedAt: now(),
            validationDiagnosticCount:
              candidate.validationDiagnosticCount ?? 1,
          }
        : rerunnable;
    });
    const next = withChecksum(
      TaskGraphSchema.parse({
        ...graph,
        tasks: nextTasks.concat(repair),
        checkpoint: "repair-required" as const,
        updatedAt: now(),
      }),
    );
    await saveDocumentCASInTransaction(
      tx,
      next,
      graphRow.rowVersion,
      graphRow.checksum,
    );
    await tx.completeOperation({
      operation,
      key: operationKey,
      payloadHash: operationPayloadHash,
      result: { repairTaskId: repair.id, graphChecksum: next.graphChecksum },
    });
    return repair;
    });
    } catch (error) {
      if (error instanceof PersistenceError && error.code === "IDEMPOTENCY_CONFLICT")
        throw new OrchestratorError(
          "TASK_STATE_CONFLICT",
          "The targeted repair identity is already bound to a different correction.",
          error,
        );
      throw error;
    }
  }
  /**
   * Routes an explicitly host-approved, implementation-compatible proposal to
   * the owning upstream domain.  It never gives the proposing specialist a
   * cross-domain write path.
   */
  async routeCrossDomainChangeProposal(input: { proposal: CrossDomainChangeProposal; expectedGraphChecksum: string; workspaceChecksum: string; actor: string }) {
    const proposal = assertApprovedCrossDomainChange(input.proposal);
    if (proposal.canonicalImpact !== "IMPLEMENTATION_CONTRACT_REPAIR" || proposal.requestedContractDelta.some((delta) => !delta.compatibleWithArchitecture)) throw new OrchestratorError("TASK_REPAIR_INVALID", "The requested change requires lifecycle escalation rather than an implementation repair.");
    if (proposal.currentness.workspaceChecksum !== input.workspaceChecksum || proposal.requestedFileScopes.some((scope) => scope.includes("*") || scope.includes("..") || scope.startsWith("/"))) throw new OrchestratorError("TASK_REPAIR_INVALID", "The cross-domain proposal has stale workspace binding or non-explicit paths.");
    const operation = "orchestrator.cross-domain-change";
    const operationKey = `${proposal.projectId}:${proposal.projectVersion}:${proposal.proposalId}`;
    const payloadHash = checksumPersistedDocument({ proposalChecksum: proposal.checksum, expectedGraphChecksum: input.expectedGraphChecksum });
    return this.database.transaction(async (tx) => {
      const project = await tx.getProject(proposal.projectId);
      const version = await tx.getVersion(proposal.projectId, proposal.projectVersion);
      const graphRow = await tx.getDocument(proposal.projectId, proposal.projectVersion, "task-graph");
      if (!project || !version || !graphRow || project.current_version !== proposal.projectVersion || project.workflow_state !== "IMPLEMENTING" || version.immutable) throw new OrchestratorError("TASK_STATE_CONFLICT", "Cross-domain repair requires the current mutable IMPLEMENTING project version.");
      const graph = mapRowToDocument(graphRow);
      if (graph.documentType !== "task-graph") throw new OrchestratorError("ORCHESTRATOR_GRAPH_NOT_READY", "The persisted implementation graph is invalid.");
      const reservation = await tx.reserveOperation({ operation, key: operationKey, payloadHash });
      if (reservation.status === "IN_PROGRESS") throw new OrchestratorError("TASK_STATE_CONFLICT", "Cross-domain repair routing is already in progress.");
      if (reservation.status === "SUCCEEDED") {
        const repairId = typeof (reservation.result as { repairTaskId?: unknown } | null)?.repairTaskId === "string" ? (reservation.result as { repairTaskId: string }).repairTaskId : undefined;
        const repair = graph.tasks.find((task) => task.id === repairId);
        if (!repair) throw new OrchestratorError("TASK_STATE_CONFLICT", "The completed cross-domain route has no repair task.");
        return { repairTask: repair, taskGraph: graph, routed: false as const };
      }
      if (graph.graphChecksum !== input.expectedGraphChecksum || proposal.currentness.taskGraphChecksum !== graph.graphChecksum || proposal.currentness.architectureChecksum !== (graph.sourceDocumentChecksums?.architecture ?? "0".repeat(64))) throw new OrchestratorError("TASK_STATE_CONFLICT", "The cross-domain proposal is stale against the current TaskGraph or Architecture.");
      const source = graph.tasks.find((task) => task.id === proposal.sourceTaskId);
      const target = graph.tasks.find((task) => task.role === "implementation" && task.implementationDomain === proposal.targetDomain && task.taskType !== "repair-targeted-failure");
      if (!source || source.implementationDomain !== proposal.sourceDomain || !target || !["passed", "failed", "blocked"].includes(source.status)) throw new OrchestratorError("TASK_REPAIR_INVALID", "The proposal source or the target-domain task is not eligible for repair routing.");
      const sourceContractType = proposal.sourceDomain === "DATABASE" ? "database-implementation-contract" : proposal.sourceDomain === "BACKEND" ? "backend-implementation-contract" : undefined;
      if (sourceContractType) {
        const sourceContractRow = await tx.getDocument(proposal.projectId, proposal.projectVersion, sourceContractType);
        const sourceContract = sourceContractRow ? mapRowToDocument(sourceContractRow) : undefined;
        if (!sourceContract || !["database-implementation-contract", "backend-implementation-contract"].includes(sourceContract.documentType) || sourceContract.documentType !== sourceContractType || sourceContract.sourceTaskId !== source.id || sourceContract.currentness.upstreamArtifactChecksum !== proposal.currentness.sourceArtifactChecksum) throw new OrchestratorError("TASK_STATE_CONFLICT", "The proposal source implementation artifact is stale.");
      } else if (proposal.currentness.sourceArtifactChecksum !== checksumPersistedDocument({ taskId: source.id, taskType: source.taskType, attempt: source.attempt })) {
        throw new OrchestratorError("TASK_STATE_CONFLICT", "The frontend proposal source task binding is stale.");
      }
      if (!proposal.requestedFileScopes.every((scope) => isWithinSpecialistDomainScope(proposal.targetDomain, scope) && target.fileScopes.some((allowed) => isWithinTaskScope(allowed, scope)))) throw new OrchestratorError("TASK_REPAIR_INVALID", "The proposed paths are outside the target specialist's explicit ownership.");
      const repairIdentity = `cross-domain:${proposal.checksum}`;
      const existing = graph.tasks.find((task) => task.repairIdentity === repairIdentity);
      if (existing) return { repairTask: existing, taskGraph: graph, routed: false as const };
      const dependencies = target.dependencies;
      const repair: AgentTask = AgentTaskSchema.parse({ ...target, id: randomUUID(), taskType: "repair-targeted-failure", title: `Repair ${target.title}`, objective: proposal.rationale, status: dependencies.every((dependency) => graph.tasks.find((task) => task.id === dependency)?.status === "passed") ? "ready" : "pending", dependencies, executionMode: "exclusive-write", parallelGroup: undefined, attempt: 0, maxAttempts: 1, repairOfTaskId: target.id, repairIdentity, safeFailureCode: "CROSS_DOMAIN_CONTRACT_REPAIR", blockingFailure: true, expectedOutputs: ["recertified implementation contract"], acceptanceCriteria: proposal.requestedContractDelta.map((delta) => delta.change), fileScopes: proposal.requestedFileScopes, requiredCapabilities: taskCapabilitiesFor({ taskType: "repair-targeted-failure", allowedTools: target.allowedTools }) });
      const next = withChecksum(TaskGraphSchema.parse({ ...graph, tasks: graph.tasks.map((task) => task.id === source.id ? { ...task, status: "blocked" as const, completedAt: undefined, safeFailureCode: "DOMAIN_HANDOFF_STALE", dependencies: [...new Set([...task.dependencies, repair.id])] } : task).concat(repair), checkpoint: "repair-required" as const, updatedAt: now() }));
      const priorProposal = await tx.getDocument(proposal.projectId, proposal.projectVersion, "cross-domain-change-proposal");
      await saveDocumentCASInTransaction(tx, { schemaVersion: 1, documentType: "cross-domain-change-proposal", projectId: proposal.projectId, projectVersion: proposal.projectVersion, createdAt: proposal.createdAt, updatedAt: now(), proposal }, priorProposal?.rowVersion ?? null, priorProposal?.checksum ?? null);
      await saveDocumentCASInTransaction(tx, next, graphRow.rowVersion, graphRow.checksum);
      await tx.completeOperation({ operation, key: operationKey, payloadHash, result: { repairTaskId: repair.id, graphChecksum: next.graphChecksum } });
      return { repairTask: repair, taskGraph: next, routed: true as const };
    });
  }
  async repairTaskCapabilityBindings(input: { projectId: string; projectVersion: number; expectedGraphChecksum: string; actor: string; idempotencyKey?: string }) {
    const operation = "orchestrator.task-capability-binding-repair";
    const idempotencyKey = input.idempotencyKey ?? `${input.projectId}:${input.projectVersion}:${input.expectedGraphChecksum}`;
    const payload = { projectId: input.projectId, projectVersion: input.projectVersion, actor: input.actor, operationVersion: "task-capability-binding-repair-v2" };
    const payloadHash = checksumPersistedDocument(payload);
    let projectionProject: ReturnType<typeof mapRowToProject> | undefined;
    let projectionDecision: DecisionRecord | undefined;
    try {
      const result = await this.database.transaction(async (tx) => {
        const project = await tx.getProject(input.projectId);
        const version = await tx.getVersion(input.projectId, input.projectVersion);
        const graphRow = await tx.getDocument(input.projectId, input.projectVersion, "task-graph");
        if (!project || !version || !graphRow) throw new PersistenceError("PERSISTENCE_NOT_FOUND", "The project version or task graph was not found.");
        if (project.current_version !== input.projectVersion || project.workflow_state !== "IMPLEMENTING") throw new PersistenceError("PERSISTENCE_CONFLICT", "Capability binding repair requires the current IMPLEMENTING project version.");
        if (version.immutable) throw new PersistenceError("PERSISTENCE_IMMUTABLE", "Released project versions are immutable.");
        projectionProject = mapRowToProject(project);
        const graph = mapRowToDocument(graphRow);
        if (graph.documentType !== "task-graph") throw new PersistenceError("PERSISTENCE_VALIDATION_FAILED", "The persisted implementation graph is invalid.");
        const graphWithoutChecksum = { ...graph };
        delete graphWithoutChecksum.graphChecksum;
        if (graph.graphChecksum !== checksumPersistedDocument(graphWithoutChecksum)) throw new PersistenceError("PERSISTENCE_CONFLICT", "The persisted task graph checksum is invalid.");
        const reservation = await tx.reserveOperation({ operation, key: idempotencyKey, payloadHash });
        if (reservation.status === "IN_PROGRESS") throw new PersistenceError("PERSISTENCE_CONFLICT", "Capability binding repair is already in progress.");
        if (reservation.status === "SUCCEEDED") {
          const stored = reservation.result && typeof reservation.result === "object" ? reservation.result as { repaired?: unknown; repairedTaskIds?: unknown; graphChecksum?: unknown; decisionId?: unknown } : {};
          if (stored.graphChecksum !== graph.graphChecksum && input.expectedGraphChecksum !== graph.graphChecksum) throw new PersistenceError("PERSISTENCE_CONFLICT", "The persisted task graph changed after capability binding repair completed.");
          const repairedTaskIds = Array.isArray(stored.repairedTaskIds) && stored.repairedTaskIds.every((taskId): taskId is string => typeof taskId === "string") ? stored.repairedTaskIds : [];
          if (stored.repaired === true) {
            const decisions = await tx.listDecisions(input.projectId, input.projectVersion);
            const decisionId = typeof stored.decisionId === "string" ? stored.decisionId : undefined;
            projectionDecision = decisions.find((decision) => decision.id === decisionId)
              ?? [...decisions].reverse().find((decision) => decision.category === "task-capability-binding-repair");
            if (!projectionDecision)
              throw new PersistenceError("PERSISTENCE_CONFLICT", "The capability binding repair decision is missing from canonical persistence.");
          }
          return { taskGraph: graph, repairedTaskIds, repaired: stored.repaired === true };
        }
        if (graph.graphChecksum !== input.expectedGraphChecksum) throw new PersistenceError("PERSISTENCE_CONFLICT", "Task graph changed before capability binding repair.");
        const retiredRepairTaskIds = graph.tasks.filter((task) => task.taskType === "repair-targeted-failure" && task.status === "failed" && repairRoot(graph, task).status === "passed").map((task) => task.id);
        const repairedTaskIds = [...new Set([
          ...graph.tasks.filter((task) => {
            const expectedBinding = expectedSpecialistBinding(graph, task);
            const specialistBindingInvalid = task.role === "implementation" && expectedBinding !== undefined && (task.implementationDomain !== expectedBinding.implementationDomain || task.specialistProfileId !== expectedBinding.specialistProfileId);
            return !validateTaskCapabilityBinding(task).valid || (task.allowedTools.includes("controlled-edit") && !hasExplicitValidAstPatchBinding(task)) || specialistBindingInvalid || (task.taskType === "repair-targeted-failure" && (task.allowedTools.includes("shadcn-registry-read") || task.role !== "implementation" || task.executionMode === "parallel-safe" || task.parallelGroup !== undefined));
          }).map((task) => task.id),
          ...retiredRepairTaskIds,
        ])];
        if (!repairedTaskIds.length) {
          await tx.completeOperation({ operation, key: idempotencyKey, payloadHash, result: { repaired: false, repairedTaskIds: [], graphChecksum: graph.graphChecksum } });
          return { taskGraph: graph, repairedTaskIds, repaired: false as const };
        }
        const candidate = withChecksum(TaskGraphSchema.parse({
          ...graph,
          tasks: graph.tasks.map((task) => {
            if (retiredRepairTaskIds.includes(task.id)) return { ...task, status: "cancelled" as const, completedAt: task.completedAt ?? now() };
            if (!repairedTaskIds.includes(task.id)) return task;
            const template = repairTemplate(graph, task);
            const preserveAstBinding = hasExplicitValidAstPatchBinding(template);
            const allowedTools = template.allowedTools.filter((tool) => (tool !== "controlled-edit" || preserveAstBinding) && !(task.taskType === "repair-targeted-failure" && tool === "shadcn-registry-read"));
            const specialistBinding = expectedSpecialistBinding(graph, task);
            const binding = specialistBinding ? { implementationDomain: specialistBinding.implementationDomain, specialistProfileId: specialistBinding.specialistProfileId } : {};
            return task.taskType === "repair-targeted-failure"
              ? { ...task, ...binding, role: "implementation" as const, allowedSkills: template.allowedSkills.slice(), allowedTools, requiredCapabilities: deriveTaskCapabilities({ taskType: task.taskType, allowedTools }), executionMode: "exclusive-write" as const, parallelGroup: undefined, expectedArtifactTypes: template.expectedArtifactTypes, ...(template.phase7c ? { phase7c: template.phase7c } : {}) }
              : { ...task, ...binding, allowedTools, requiredCapabilities: deriveTaskCapabilities({ taskType: task.taskType, allowedTools }) };
          }),
          updatedAt: now(),
        }));
        const validation = validateImplementationTaskGraph(candidate);
        const blockingReasons = [...new Set([...(graph.blockingReasons ?? []).filter((reason) => reason !== "TASK_CAPABILITY_BINDING_INVALID"), ...validation.errors])];
        const next = withChecksum(TaskGraphSchema.parse({
          ...candidate,
          validation: { valid: validation.valid, errors: validation.errors, warnings: validation.warnings },
          readyForExecution: validation.valid && blockingReasons.length === 0,
          blockingReasons,
          warnings: [...new Set([...(graph.warnings ?? []), ...validation.warnings])],
        }));
        const decision = DecisionRecordSchema.parse({ id: randomUUID(), timestamp: now(), actorType: "system", actorIdentifier: input.actor, category: "task-capability-binding-repair", decision: "Repaired persisted TaskGraph capability bindings from the canonical task/tool registry.", rationale: "The existing graph was structurally retained; invalid required capabilities were replaced with host-derived bindings, repair tasks were rebound to their canonical implementation owners, legacy broad controlled-edit grants were removed, inherited registry access was removed from repair tasks, repairs were made exclusive-write so they cannot conflict with their owner, and failed repairs superseded by passed work were retired as cancelled history.", affectedDocuments: ["task-graph.json"], requirementChange: false, userApprovalRequired: false, userApprovalStatus: "not-required" });
        projectionDecision = decision;
        await saveDocumentCASInTransaction(tx, next, graphRow.rowVersion, graphRow.checksum);
        await appendDecisionInTransaction(tx, input.projectId, input.projectVersion, decision);
        const operationResult = { repaired: true, repairedTaskIds, graphChecksum: next.graphChecksum, decisionId: decision.id };
        await tx.completeOperation({ operation, key: idempotencyKey, payloadHash, result: operationResult });
        return { taskGraph: next, repairedTaskIds, repaired: true as const };
      });
      if (this.memory && projectionProject) {
        try {
          if (projectionDecision) await this.memory.appendDecision(input.projectId, input.projectVersion, projectionDecision);
          await this.memory.writeSnapshot(input.projectId, input.projectVersion, { "task-graph.json": result.taskGraph, "project.json": projectionProject });
        } catch (error) {
          throw new OrchestratorError("TASK_STATE_CONFLICT", "Capability binding repair committed but its derived projection could not be synchronized.", error);
        }
      }
      return { ...result, actor: input.actor };
    } catch (error) {
      if (error instanceof PersistenceError && error.code === "PERSISTENCE_NOT_FOUND") throw new OrchestratorError("ORCHESTRATOR_GRAPH_NOT_READY", "The project version or task graph was not found.", error);
      if (error instanceof PersistenceError && error.code === "PERSISTENCE_IMMUTABLE") throw new OrchestratorError("ORCHESTRATOR_PROJECT_IMMUTABLE", "Released project versions are immutable.", error);
      throw new OrchestratorError("TASK_STATE_CONFLICT", "Task graph changed before capability binding repair was persisted.", error);
    }
  }
  async cancelTask(input: Omit<Parameters<OrchestratorService["transitionTaskState"]>[0], "targetStatus"> & { reason: string }) { return this.transitionTaskState({ ...input, targetStatus: "cancelled" }); }
  async reconcileTaskGraph(projectId: string, version: number) { const document = await this.documents.get(projectId, version, "task-graph"); if (!document || document.documentType !== "task-graph") return [{ code: "ORCHESTRATION_GRAPH_MISSING", description: "Task graph is missing from persistence.", automaticRepairAllowed: false, recommendedAction: "Recreate the graph from current approved inputs." }]; const issues: Array<{ code: string; description: string; automaticRepairAllowed: boolean; recommendedAction: string }> = []; if (document.graphChecksum !== checksumPersistedDocument(withoutChecksum(document))) issues.push({ code: "ORCHESTRATION_CHECKSUM_MISMATCH", description: "Persisted task graph checksum does not match its content.", automaticRepairAllowed: false, recommendedAction: "Inspect the persisted graph before any repair." }); const running = document.tasks.filter((task) => task.status === "running"); if (running.length) issues.push({ code: "ORCHESTRATION_INTERRUPTED_TASK", description: "A task was running when orchestration was interrupted.", automaticRepairAllowed: false, recommendedAction: "Inspect the task attempt and explicitly retry or cancel it." }); for (const task of document.tasks) { if (task.taskType === "repair-targeted-failure" && task.fileScopes.length === 0) issues.push({ code: "ORCHESTRATION_REPAIR_SCOPE_INVALID", description: "A persisted repair task has no writable scope.", automaticRepairAllowed: false, recommendedAction: "Supersede the invalid repair record after explicit investigation." }); for (const dependency of task.dependencies) if (!document.tasks.some((candidate) => candidate.id === dependency)) issues.push({ code: "ORCHESTRATION_TASK_ORPHANED", description: "A task dependency is missing from the graph.", automaticRepairAllowed: false, recommendedAction: "Rebuild or manually reconcile the graph." }); } return issues; }
  async reconcileValidationReplay(input: Parameters<OrchestratorService["replayFailedValidationTask"]>[0]) { const graph = await this.documents.get(input.projectId, input.projectVersion, "task-graph"); if (!graph || graph.documentType !== "task-graph") throw new OrchestratorError("ORCHESTRATOR_GRAPH_NOT_READY", "Task graph was not found."); const task = graph.tasks.find((candidate) => candidate.id === input.taskId); const identity = task ? `${task.id}:${input.sourceChecksum}:${input.diagnosticPolicyVersion}:${input.reason}` : ""; if (task?.validationReplayIdentity === identity) return { taskGraph: graph, replayed: false as const, event: event(task.id, task.status, task.status, input.actor, "Validation replay already reconciled.", task.attempt) }; if (task && graph.tasks.some((candidate) => candidate.repairOfTaskId === task.id && ["pending", "ready", "running"].includes(candidate.status))) return { taskGraph: graph, replayed: false as const, event: event(task.id, task.status, task.status, input.actor, "Validation replay deferred to the active canonical repair.", task.attempt) }; return this.replayFailedValidationTask(input); }
  async reconcileStaleTestArtifactTask(input: { projectId: string; projectVersion: number; expectedGraphChecksum: string; actor: string; artifactCount?: number }) { const graph = await this.documents.get(input.projectId, input.projectVersion, "task-graph"); if (!graph || graph.documentType !== "task-graph") throw new OrchestratorError("ORCHESTRATOR_GRAPH_NOT_READY", "Task graph was not found."); if (graph.graphChecksum !== input.expectedGraphChecksum) throw new OrchestratorError("TASK_STATE_CONFLICT", "Task graph changed before test-artifact reconciliation."); const task = graph.tasks.find((candidate) => candidate.taskType === "write-unit-tests"); if (!task || (task.status !== "passed" && !(task.status === "failed" && (task.attempt < task.maxAttempts || task.safeFailureCode === "IMPLEMENTATION_CONTEXT_TOO_LARGE" || JSON.stringify(task.fileScopes) !== JSON.stringify(ownershipForTask("write-unit-tests")!.scopes)))) || (task.status === "passed" && task.taskAcceptancePolicyVersion === UNIT_TEST_ARTIFACT_POLICY_VERSION && input.artifactCount !== 0)) return { taskGraph: graph, reconciled: false as const, staleTaskId: undefined }; const dependents = new Set<string>(); let changed = true; while (changed) { changed = false; for (const candidate of graph.tasks) if (!dependents.has(candidate.id) && candidate.dependencies.some((dependency) => dependency === task.id || dependents.has(dependency))) { dependents.add(candidate.id); changed = true; } } const timestamp = now(); const nextTasks = graph.tasks.map((candidate) => { if (candidate.id === task.id) return { ...candidate, status: "ready" as const, fileScopes: ownershipForTask("write-unit-tests")!.scopes.slice(), attempt: JSON.stringify(task.fileScopes) !== JSON.stringify(ownershipForTask("write-unit-tests")!.scopes) || (task.status === "failed" && task.attempt >= task.maxAttempts) ? 0 : task.attempt, completedAt: undefined, safeFailureCode: undefined, taskAcceptancePolicyVersion: UNIT_TEST_ARTIFACT_POLICY_VERSION }; if (dependents.has(candidate.id) && (candidate.taskType.startsWith("validate-") || candidate.taskType === "prepare-release")) return { ...candidate, status: "pending" as const, attempt: 0, completedAt: undefined, safeFailureCode: undefined, validationDiagnosticCount: undefined, validationDiagnosticPolicyVersion: undefined, validationSourceChecksum: undefined, validationReplayCount: undefined, validationReplayIdentity: undefined }; return candidate; }); const next = withChecksum(TaskGraphSchema.parse({ ...graph, tasks: nextTasks, checkpoint: "implementation-started" as const, updatedAt: timestamp })); await this.documents.save(next); return { taskGraph: next, reconciled: true as const, staleTaskId: task.id, actor: input.actor }; }
  async reconcileStaleFoundationTask(input: { projectId: string; projectVersion: number; expectedGraphChecksum: string; actor: string; configPresent: boolean }) { const graph = await this.documents.get(input.projectId, input.projectVersion, "task-graph"); if (!graph || graph.documentType !== "task-graph") throw new OrchestratorError("ORCHESTRATOR_GRAPH_NOT_READY", "Task graph was not found."); if (graph.graphChecksum !== input.expectedGraphChecksum) throw new OrchestratorError("TASK_STATE_CONFLICT", "Task graph changed before foundation reconciliation."); const task = graph.tasks.find((candidate) => candidate.taskType === "implement-project-foundation"); if (!task || (task.status !== "passed" && task.safeFailureCode !== "IMPLEMENTATION_CONTEXT_TOO_LARGE") || input.configPresent) return { taskGraph: graph, reconciled: false as const }; const dependents = new Set<string>(); let changed = true; while (changed) { changed = false; for (const candidate of graph.tasks) if (!dependents.has(candidate.id) && candidate.dependencies.some((dependency) => dependency === task.id || dependents.has(dependency))) { dependents.add(candidate.id); changed = true; } } const timestamp = now(); const nextTasks = graph.tasks.map((candidate) => candidate.id === task.id ? { ...candidate, status: "ready" as const, attempt: 0, completedAt: undefined, safeFailureCode: undefined } : dependents.has(candidate.id) && (candidate.taskType.startsWith("validate-") || candidate.taskType === "prepare-release") ? { ...candidate, status: "pending" as const, attempt: 0, completedAt: undefined, safeFailureCode: undefined, validationDiagnosticCount: undefined, validationDiagnosticPolicyVersion: undefined, validationSourceChecksum: undefined, validationReplayCount: undefined, validationReplayIdentity: undefined } : candidate); const next = withChecksum(TaskGraphSchema.parse({ ...graph, tasks: nextTasks, checkpoint: "implementation-started" as const, updatedAt: timestamp })); await this.documents.save(next); return { taskGraph: next, reconciled: true as const, staleTaskId: task.id, actor: input.actor }; }
  async reconcileRuntimeGatePolicy(input: { projectId: string; projectVersion: number; expectedGraphChecksum: string; actor: string; policyVersion: string; refreshPassed?: boolean }) {
    const graph = await this.documents.get(input.projectId, input.projectVersion, "task-graph");
    if (!graph || graph.documentType !== "task-graph") throw new OrchestratorError("ORCHESTRATOR_GRAPH_NOT_READY", "Task graph was not found.");
    if (graph.graphChecksum !== input.expectedGraphChecksum) throw new OrchestratorError("TASK_STATE_CONFLICT", "Task graph changed before runtime policy reconciliation.");
    const refreshPassed = input.refreshPassed ?? input.actor === "real-e2e-resume";
    const runtimeTypes = new Set(["validate-lint", "validate-typecheck", "validate-unit-tests", "validate-build", "prepare-release"]);
    const stale = refreshPassed || graph.tasks.some((task) => {
      if (runtimeTypes.has(task.taskType)) return task.validationDiagnosticPolicyVersion !== input.policyVersion;
      return task.taskType === "validate-functional-flow" && (task.validationDiagnosticPolicyVersion !== FUNCTIONAL_QA_DIAGNOSTIC_POLICY_VERSION || task.validationDiagnosticCount === undefined || task.validationDiagnosticCount === 0);
    });
    if (!stale) return { taskGraph: graph, reconciled: false as const };
    const nextTasks = graph.tasks.map((task) => {
      const expectedPolicy = task.taskType === "validate-functional-flow" ? FUNCTIONAL_QA_DIAGNOSTIC_POLICY_VERSION : input.policyVersion;
      if (task.taskType === "validate-functional-flow") {
        if (!refreshPassed && task.validationDiagnosticPolicyVersion === expectedPolicy && task.validationDiagnosticCount !== undefined && task.validationDiagnosticCount > 0) return task;
        return { ...task, status: "pending" as const, attempt: 0, completedAt: undefined, safeFailureCode: undefined, validationDiagnosticCount: undefined, validationDiagnostics: undefined, validationDiagnosticPolicyVersion: undefined, validationSourceChecksum: undefined, validationPlanChecksum: undefined, validationReplayCount: undefined, validationReplayIdentity: undefined, validationReplayPolicyVersion: undefined };
      }
      if (!runtimeTypes.has(task.taskType) || (!refreshPassed && task.validationDiagnosticPolicyVersion === expectedPolicy)) return task;
      return { ...task, status: task.taskType === "validate-lint" ? "ready" as const : "pending" as const, attempt: 0, completedAt: undefined, safeFailureCode: undefined, validationDiagnosticCount: undefined, validationDiagnostics: undefined, validationDiagnosticPolicyVersion: undefined, validationSourceChecksum: undefined, validationReplayCount: undefined, validationReplayIdentity: undefined, validationReplayPolicyVersion: undefined };
    });
    const next = withChecksum(TaskGraphSchema.parse({ ...graph, tasks: nextTasks, checkpoint: "validation-started" as const, updatedAt: now() }));
    await this.documents.save(next);
    return { taskGraph: next, reconciled: true as const, actor: input.actor };
  }
  async reconcileQaPolicyRefresh(input: { projectId: string; projectVersion: number; expectedGraphChecksum: string; actor: string; sourceChecksum: string; policyVersion: string; scenarioChecksum: string }) { const graph = await this.documents.get(input.projectId, input.projectVersion, "task-graph"); if (!graph || graph.documentType !== "task-graph") throw new OrchestratorError("ORCHESTRATOR_GRAPH_NOT_READY", "Task graph was not found."); if (graph.graphChecksum !== input.expectedGraphChecksum) throw new OrchestratorError("TASK_STATE_CONFLICT", "Task graph changed before QA policy refresh."); const task = graph.tasks.find((candidate) => candidate.taskType === "validate-functional-flow"); if (!task || !["failed", "ready"].includes(task.status)) return { taskGraph: graph, replayed: false as const, reason: "NO_FAILED_QA" as const }; if (graph.tasks.some((candidate) => candidate.repairOfTaskId === task.id && ["pending", "ready", "running"].includes(candidate.status))) return { taskGraph: graph, replayed: false as const, reason: "QA_REPAIR_ACTIVE" as const }; if (task.validationReplayPolicyVersion === input.policyVersion || task.validationReplayIdentity?.includes(`:${input.policyVersion}:`)) { if (task.status === "ready") return { taskGraph: graph, replayed: false as const, reason: "POLICY_REFRESH_ALREADY_PENDING" as const }; throw new OrchestratorError("QA_POLICY_REPLAY_ALREADY_USED", "The current QA policy refresh has already been scheduled."); } if (task.validationSourceChecksum && task.validationSourceChecksum !== input.sourceChecksum) throw new OrchestratorError("QA_SOURCE_STALE", "The failed QA task source checksum is stale."); if (task.validationPlanChecksum && task.validationPlanChecksum !== input.scenarioChecksum) throw new OrchestratorError("QA_PLAN_STALE", "The failed QA scenario plan checksum is stale."); if (task.dependencies.some((dependency) => graph.tasks.find((candidate) => candidate.id === dependency)?.status !== "passed")) throw new OrchestratorError("QA_DEPENDENCY_FAILED", "QA policy refresh requires all dependencies to remain passed."); const identity = `${task.id}:${input.sourceChecksum}:${input.scenarioChecksum}:${input.policyVersion}:POLICY_REFRESH`; const nextTask = { ...task, status: "ready" as const, completedAt: undefined, safeFailureCode: undefined, validationReplayCount: 1, validationReplayIdentity: identity, validationReplayPolicyVersion: input.policyVersion, validationReplayBaseAttempt: task.attempt, validationReplayKind: "policy-refresh" as const, validationSourceChecksum: input.sourceChecksum, validationPlanChecksum: input.scenarioChecksum }; const next = withChecksum(TaskGraphSchema.parse({ ...graph, tasks: graph.tasks.map((candidate) => candidate.id === task.id ? nextTask : candidate), checkpoint: "validation-started" as const, updatedAt: now() })); await this.documents.save(next); return { taskGraph: next, replayed: true as const, reason: "POLICY_REFRESH_SCHEDULED" as const }; }
  async replayFailedQaEvidence(input: { projectId: string; projectVersion: number; taskId: string; expectedGraphChecksum: string; actor: string; sourceChecksum: string; policyVersion: string; scenarioChecksum: string }) { const graph = await this.documents.get(input.projectId, input.projectVersion, "task-graph"); if (!graph || graph.documentType !== "task-graph") throw new OrchestratorError("ORCHESTRATOR_GRAPH_NOT_READY", "Task graph was not found."); if (graph.graphChecksum !== input.expectedGraphChecksum) throw new OrchestratorError("TASK_STATE_CONFLICT", "Task graph changed before QA replay."); const task = graph.tasks.find((candidate) => candidate.id === input.taskId); if (!task || task.taskType !== "validate-functional-flow" || task.status !== "failed") throw new OrchestratorError("TASK_TRANSITION_INVALID", "Only a failed functional QA task can be replayed."); const identity = `${task.id}:${input.sourceChecksum}:${input.policyVersion}:${input.scenarioChecksum}:VALIDATION_EVIDENCE_REFRESH`; if (task.validationReplayIdentity === identity) return { taskGraph: graph, replayed: false as const }; if ((task.validationReplayCount ?? 0) >= 1) throw new OrchestratorError("TASK_ATTEMPT_LIMIT_REACHED", "Functional QA evidence replay is bounded to one attempt."); if (graph.tasks.some((candidate) => candidate.repairOfTaskId === task.id && ["pending", "ready", "running"].includes(candidate.status))) throw new OrchestratorError("TASK_REPAIR_INVALID", "QA replay is blocked while an active repair owns the failed task."); if (task.dependencies.some((dependency) => graph.tasks.find((candidate) => candidate.id === dependency)?.status !== "passed")) throw new OrchestratorError("TASK_DEPENDENCY_FAILED", "QA replay requires all implementation and runtime dependencies to remain passed."); const nextTask = { ...task, status: "ready" as const, completedAt: undefined, validationReplayCount: 1, validationReplayIdentity: identity, validationDiagnosticPolicyVersion: input.policyVersion, validationSourceChecksum: input.sourceChecksum }; const next = withChecksum(TaskGraphSchema.parse({ ...graph, tasks: graph.tasks.map((candidate) => candidate.id === task.id ? nextTask : candidate), checkpoint: "validation-started" as const, updatedAt: now() })); await this.documents.save(next); return { taskGraph: next, replayed: true as const }; }
  async reconcileStaleQaEvidence(input: { projectId: string; projectVersion: number; expectedGraphChecksum: string; actor: string; sourceChecksum: string; policyVersion: string; scenarioChecksum: string }) { const graph = await this.documents.get(input.projectId, input.projectVersion, "task-graph"); if (!graph || graph.documentType !== "task-graph") throw new OrchestratorError("ORCHESTRATOR_GRAPH_NOT_READY", "Task graph was not found."); if (graph.graphChecksum !== input.expectedGraphChecksum) throw new OrchestratorError("TASK_STATE_CONFLICT", "Task graph changed before QA evidence reconciliation."); const task = graph.tasks.find((candidate) => candidate.taskType === "validate-functional-flow"); if (!task || task.status !== "failed" || (task.validationDiagnosticPolicyVersion === input.policyVersion && (task.validationDiagnosticCount ?? 0) > 0)) return { taskGraph: graph, replayed: false as const }; return this.replayFailedQaEvidence({ projectId: input.projectId, projectVersion: input.projectVersion, expectedGraphChecksum: input.expectedGraphChecksum, actor: input.actor, sourceChecksum: input.sourceChecksum, policyVersion: input.policyVersion, scenarioChecksum: input.scenarioChecksum, taskId: task.id }); }
}
