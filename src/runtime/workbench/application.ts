import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { randomUUID } from "node:crypto";
import { DecisionRepository, DocumentRepository, OperationRepository, ProjectRepository } from "@/persistence/database/repositories";
import type { PersistenceDatabase } from "@/persistence/database/types";
import type { WorkflowState } from "@/domain/workflow/engine";
import { evaluatePlanningAcceptanceReadiness, planningDocumentChecksum, planningSemanticChecksum } from "@/agents/planner/deterministic";
import type { PlannerArchitectService } from "@/agents/planner/service";
import type { ArchitectureReviewOrchestrationService } from "@/orchestration/architecture-review/service";
import type { ArchitectureReviewInput } from "@/agents/reviewers/architecture/contracts";
import { FACTORY_ARCHITECTURE_STACK } from "@/agents/reviewers/architecture/contracts";
import { readCanonicalReviewContext } from "@/agents/reviewers/architecture/currentness";
import type { DesignAgentService } from "@/agents/design/service";
import { DesignAgentInputSchema, type DesignAgentInput } from "@/agents/design/contracts";
import type { OrchestratorService } from "@/orchestration/orchestrator/service";
import type { ContractAuditOrchestrationService } from "@/orchestration/contract-audit/service";
import { DEFAULT_ORCHESTRATION_POLICY } from "@/orchestration/orchestrator/contracts";
import { Phase7CContractService } from "@/operations/phase7c";
import { directionSetChecksum } from "@/agents/design/deterministic";
import type { TrialEntryService } from "@/runtime/trial-entry/service";
import {
  actionsForWorkbenchState,
  projectStatusLabel,
  workbenchStatus,
  type ConversationEntry,
  type WorkbenchAction,
  type WorkbenchBrief,
  type WorkbenchDesign,
  type WorkbenchPlanning,
  type WorkbenchProject,
  type WorkbenchProjection,
  type WorkbenchRequest,
} from "./contracts";
import { FACTORY_OPERATOR_LANGUAGE } from "@/domain/language/schema";
import { isUserFacingProjectOrigin } from "@/domain/project/provenance";
import type { ProjectAssetService } from "@/runtime/assets/service";
import type { WorkbenchAsset } from "./contracts";
import type { CanonicalBriefV3, RequirementCategory } from "@/domain/requirements/v3/schema";
import { type RequirementSpecification } from "@/domain/requirements/schema";
import { BriefV3DocumentSchema, type BriefV3Document } from "@/persistence/database/brief-revision-v3-contracts";
import { executorCapabilitiesForTasks } from "@/orchestration/execution/capabilities";
import { canonicalBriefToPlannerBrief } from "@/agents/planner/brief-context";
import { admitPlanningRefresh, PlanningAdmissionError } from "@/agents/planner/refresh-admission";
import { CONTRACT_AUDIT_PROMPT_VERSION } from "@/agents/reviewers/contracts/contracts";
import { currentWorkbenchOperationContext, isWorkbenchOperationFailure, withWorkbenchOperationContext, type WorkbenchOperationContext } from "./operation-context";
import { currentRuntimeProvenance, type WorkbenchResponseMetadata } from "./observability";
import { providerFailureDiagnosticFromError } from "@/integrations/openai/failure-diagnostics";
import { workbenchPlanningLogicalOperationId, WorkbenchOperationConflict, WorkbenchOperationLedger } from "./operation-ledger";
import { ArchitectureReviewOperationLedger } from "./architecture-operation-ledger";
import { implementationReadiness } from "@/runtime/workflow/implementation-readiness";

const list = (values: string[] | undefined, limit = 12) => (values ?? []).slice(0, limit).map((value) => value.slice(0, 500));
const statements = (values: unknown, limit = 16): string[] => {
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => typeof value === "string" ? [value] : value && typeof value === "object" && typeof (value as { statement?: unknown }).statement === "string" ? [(value as { statement: string }).statement] : []).slice(0, limit).map((value) => value.slice(0, 500));
};

const v3Statements = (brief: CanonicalBriefV3, categories: readonly RequirementCategory[]) =>
  brief.requirements.filter((requirement) => categories.includes(requirement.category)).map((requirement) => requirement.statement);

type ContractAuditMutationPhase = "BEFORE_TASKGRAPH_PERSISTENCE" | "TASKGRAPH_PERSISTED" | "LIFECYCLE_TRANSITIONED" | "AUDIT_RESULT_RECEIVED";
const contractAuditFailureResult = (error: unknown, mutationPhase: ContractAuditMutationPhase) => {
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : error instanceof Error ? error.name : "UNKNOWN_FAILURE";
  const providerDiagnostic = providerFailureDiagnosticFromError(error);
  return {
    outcome: "FAILED",
    code,
    mutationPhase,
    ...(providerDiagnostic ? { providerDiagnostic } : {}),
    providerReceipt: providerDiagnostic?.requestAttempted ? (providerDiagnostic.responseReceived ? "RESPONSE_RECEIVED" : "REQUEST_ATTEMPTED_OUTCOME_UNKNOWN") : "NOT_ATTEMPTED",
    canonicalContractAuditPersisted: false,
    taskGraphPersisted: mutationPhase !== "BEFORE_TASKGRAPH_PERSISTENCE",
    lifecycleMutated: mutationPhase === "LIFECYCLE_TRANSITIONED" || mutationPhase === "AUDIT_RESULT_RECEIVED",
  };
};

/** Host approval is persisted on V3; this V1-shaped value is only an in-memory compatibility view. */
export const approvedBriefForDownstream = (brief: RequirementSpecification, document: BriefV3Document) => {
  if (!document.approval?.approved || document.approval.approvedCanonicalChecksum !== document.briefChecksum) throw new WorkbenchActionError("BRIEF_APPROVAL_REQUIRED", "The current CanonicalBriefV3 is not approved.");
  return canonicalBriefToPlannerBrief(document.brief, brief, document.approval);
};

const briefV3Projection = (brief: CanonicalBriefV3, checksum: string, readyForApproval: boolean, approved: boolean): WorkbenchBrief => ({
  checksum,
  readyForApproval,
  approved,
  briefSchemaVersion: 3,
  projectSummary: brief.summary,
  businessGoals: v3Statements(brief, ["BUSINESS_GOAL"]),
  targetAudiences: v3Statements(brief, ["AUDIENCE"]),
  pages: brief.pages.map((page) => `${page.slug}: ${page.purpose}`),
  features: v3Statements(brief, ["FEATURE"]),
  forms: v3Statements(brief, ["FORM"]),
  content: v3Statements(brief, ["CONTENT"]),
  imageStrategy: brief.scope.images.sourceStrategy,
  constraints: v3Statements(brief, ["TECHNICAL"]),
  brandVisual: v3Statements(brief, ["BRAND_VISUAL"]),
  assets: brief.assets.map((asset) => `${asset.role}: ${asset.usage} (${asset.reference})`),
  uxResponsive: v3Statements(brief, ["UX_RESPONSIVE"]),
  seo: [
    ...brief.seo.primaryKeywords.map((keyword) => `Keyword: ${keyword}`),
    ...(brief.seo.exactTitle ? [`Exact title: ${brief.seo.exactTitle}`] : []),
    ...(brief.seo.exactMetaDescription ? [`Exact meta description: ${brief.seo.exactMetaDescription}`] : []),
    ...brief.seo.locationTargeting.map((entry) => entry.statement),
  ],
  legalCompliance: [
    ...v3Statements(brief, ["LEGAL_CONSTRAINT"]),
    `Placeholder policy: ${brief.legal.placeholderPolicy}`,
  ],
  technicalDeferred: [
    ...v3Statements(brief, ["TECHNICAL"]),
    ...v3Statements(brief, ["DEFERRED_INTEGRATION"]),
  ],
  prohibited: v3Statements(brief, ["PROHIBITED"]),
  siteLanguage: brief.localization.defaultLocale,
});

export class WorkbenchActionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "WorkbenchActionError";
  }
}

export type WorkbenchWorkflowScope = {
  planner: PlannerArchitectService;
  architectureReviewer: ArchitectureReviewOrchestrationService;
  design: DesignAgentService;
  orchestrator: OrchestratorService;
  contractAuditor: ContractAuditOrchestrationService;
};

export class WorkbenchApplication {
  private readonly projects: ProjectRepository;
  private readonly documents: DocumentRepository;

  constructor(private readonly dependencies: { database: PersistenceDatabase; entry: TrialEntryService; assets?: ProjectAssetService; getWorkflowScope?: (slug: string) => WorkbenchWorkflowScope }) {
    this.projects = new ProjectRepository(dependencies.database);
    this.documents = new DocumentRepository(dependencies.database);
  }

  private planningLedger(projectId: string, operationId: string, parent: WorkbenchOperationContext | undefined) {
    return new WorkbenchOperationLedger(this.dependencies.database, projectId, operationId, parent?.correlationId, parent?.runtimeProvenance, parent?.responseSink, operationId === `workbench-planning:${projectId}` ? undefined : operationId);
  }

  async handle(request: WorkbenchRequest): Promise<WorkbenchProjection> {
    if (request.action === "generate-planning") {
      const parent = currentWorkbenchOperationContext();
      let operation = this.planningLedger(request.projectId, `workbench-planning:${request.projectId}`, parent);
      try {
        const current = await this.projects.getWithVersion(request.projectId);
        if (!current) throw new WorkbenchActionError("PROJECT_NOT_FOUND", "We could not find that project.");
        if (current.project.workflowState === "AWAITING_PLANNING_GENERATION") {
          const briefDocument = await this.documents.get(request.projectId, current.project.currentVersion, "brief-v3");
          const parsedBrief = briefDocument?.documentType === "brief-v3" ? BriefV3DocumentSchema.safeParse(briefDocument) : null;
          if (!parsedBrief?.success || !parsedBrief.data.approval?.approved || parsedBrief.data.approval.approvedCanonicalChecksum !== parsedBrief.data.briefChecksum)
            throw new WorkbenchActionError("BRIEF_APPROVAL_REQUIRED", "Planning requires the current approved Project Brief.");
          const operationId = workbenchPlanningLogicalOperationId(current.project.projectId, current.project.currentVersion, parsedBrief.data.briefChecksum);
          operation = this.planningLedger(request.projectId, operationId, parent);
          await operation.bindCurrentness({ projectVersion: current.project.currentVersion, rowVersion: current.rowVersion, briefChecksum: parsedBrief.data.briefChecksum });
          return this.handlePlanningGeneration(request.projectId, operation);
        }
      } catch (error) {
        // handlePlanningGeneration already converted staged failures into the
        // durable Workbench envelope. Re-wrapping it would discard diagnostics.
        if (isWorkbenchOperationFailure(error)) throw error;
        throw await operation.fail(error);
      }
    }
    if (request.action === "approve-planning") {
      const parent = currentWorkbenchOperationContext();
      let operation = this.planningLedger(request.projectId, `workbench-planning:${request.projectId}`, parent);
      try {
        const current = await this.projects.getWithVersion(request.projectId);
        const briefDocument = current ? await this.documents.get(request.projectId, current.project.currentVersion, "brief-v3") : null;
        const parsedBrief = briefDocument?.documentType === "brief-v3" ? BriefV3DocumentSchema.safeParse(briefDocument) : null;
        if (current && parsedBrief?.success && parsedBrief.data.approval?.approved && parsedBrief.data.approval.approvedCanonicalChecksum === parsedBrief.data.briefChecksum) {
          const operationId = workbenchPlanningLogicalOperationId(current.project.projectId, current.project.currentVersion, parsedBrief.data.briefChecksum);
          operation = this.planningLedger(request.projectId, operationId, parent);
        }
        if (await operation.hasActiveOperation())
          throw new WorkbenchOperationConflict("WORKBENCH_OPERATION_IN_PROGRESS", "A current Planning operation is already active.");
      } catch (error) {
        if (error instanceof WorkbenchOperationConflict) throw error;
        throw await operation.fail(error);
      }
    }
    switch (request.action) {
      case "create": {
        const result = await this.dependencies.entry.createProject({ requestText: request.requestText, ...(request.languageHint ? { languageHint: request.languageHint } : {}), ...(request.operatorLanguage ? { operatorLanguage: request.operatorLanguage } : {}) });
        return this.project(result.project.projectId);
      }
      case "respond":
        await this.dependencies.entry.respond(request.projectId, request.answers);
        return this.project(request.projectId);
      case "refresh-clarifications":
        await this.dependencies.entry.refreshClarifications(request.projectId, request.requestId);
        return this.project(request.projectId);
      case "status":
        return this.project(request.projectId);
      case "list":
        return this.empty(await this.projectList());
      case "approve-brief":
        await this.dependencies.entry.approveBrief(request);
        return this.project(request.projectId);
      case "request-brief-changes":
        await this.dependencies.entry.requestBriefChanges(request);
        return this.project(request.projectId);
      case "generate-planning":
        throw new WorkbenchActionError("PLANNING_WORKFLOW_INVALID", "Planning generation is only available from its canonical lifecycle frontier.");
      case "approve-planning":
        await this.approvePlanning(request.projectId);
        return this.project(request.projectId);
      case "generate-architecture-review":
        return this.generateArchitectureReview(request.projectId);
      case "generate-design":
        return this.generateDesign(request.projectId);
      case "reconcile-design-outcome-unknown":
        await this.reconcileDesignOutcomeUnknown(request);
        return this.project(request.projectId);
      case "reconcile-design-pre-provider-failure":
        await this.reconcileDesignPreProviderFailure(request);
        return this.project(request.projectId);
      case "request-planning-changes":
        await this.requestPlanningChanges(request.projectId, request.reason);
        return this.project(request.projectId);
      case "database-decision":
        await this.databaseDecision(request.projectId, request.mode, request.reason);
        return this.project(request.projectId);
      case "dependency-approval":
        await this.dependencyApproval(request.projectId);
        return this.project(request.projectId);
      case "run-contract-audit":
        await this.runContractAuditPrerequisite(request.projectId);
        return this.project(request.projectId);
      case "recover-contract-audit":
        await this.recoverContractAudit(request.projectId);
        return this.project(request.projectId);
      case "design-selection":
        await this.selectDesign(request.projectId, request.selectedDirectionId);
        return this.project(request.projectId);
      case "start-implementation":
        await this.startImplementation(request.projectId);
        return this.project(request.projectId);
      default:
        throw new WorkbenchActionError("WORKBENCH_ACTION_NOT_AVAILABLE", "That workflow action is not available from the current canonical state.");
    }
  }

  private async handlePlanningGeneration(projectId: string, ledger = this.planningLedger(projectId, `workbench-planning:${projectId}`, currentWorkbenchOperationContext())) {
    const parent = currentWorkbenchOperationContext();
    const correlationId = parent?.correlationId ?? randomUUID();
    let reserved = false;
    try {
      const reservation = await ledger.reserve();
      reserved = reservation.status === "NEW";
      await ledger.setStage("OPERATION_INITIALIZATION");
      const context: WorkbenchOperationContext = {
        correlationId,
        operationId: ledger.logicalOperationId,
        operationKind: "PLANNING_GENERATION",
        projectId,
        phase: "PLANNING" as const,
        stage: "OPERATION_INITIALIZATION" as const,
        providerInvocationLedger: ledger,
        bindCurrentness: (input) => ledger.bindCurrentness(input),
        setStage: async (stage) => { context.stage = stage; await ledger.setStage(stage); },
        markMutationCommitted: () => ledger.markCanonicalPlanningPersisted(),
        runtimeProvenance: parent?.runtimeProvenance,
        responseSink: parent?.responseSink,
      };
      return await withWorkbenchOperationContext(context, async () => {
        await this.generatePlanning(projectId);
        await ledger.complete();
        return this.project(projectId);
      });
    } catch (error) {
      if (!reserved && error instanceof WorkbenchOperationConflict) throw error;
      throw await ledger.fail(error);
    }
  }

  private async projectList(): Promise<WorkbenchProject[]> {
    const projects = await this.dependencies.entry.listProjects();
    return projects.filter((project) => isUserFacingProjectOrigin(project.origin)).map((project) => ({
      projectId: project.projectId,
      name: project.title ?? "Untitled project",
      slug: project.slug,
      origin: project.origin,
      workflowState: project.workflowState,
      statusLabel: projectStatusLabel(project.workflowState),
      updatedAt: project.updatedAt,
    }));
  }

  private empty(projects: WorkbenchProject[]): WorkbenchProjection {
    return {
      mode: "NEW_PROJECT",
      operatorLanguage: FACTORY_OPERATOR_LANGUAGE,
      siteLanguage: "en",
      status: workbenchStatus("DRAFT", [], false),
      questions: [],
      assets: [],
      dependencies: [],
      designs: [],
      conversation: [],
      projects,
    };
  }

  private async project(projectId: string): Promise<WorkbenchProjection> {
    const current = await this.projects.getWithVersion(projectId);
    if (!current) throw new WorkbenchActionError("PROJECT_NOT_FOUND", "We could not find that project.");
    const status = await this.dependencies.entry.status(projectId);
    const version = current.project.currentVersion;
    const clarification = await this.documents.get(projectId, version, "clarification-log");
    const requirements = await this.documents.get(projectId, version, "requirements");
    const briefV3Document = await this.documents.get(projectId, version, "brief-v3");
    const briefV3 = briefV3Document?.documentType === "brief-v3" ? briefV3Document : undefined;
    let planning = await this.documents.get(projectId, version, "planning-package");
    if (planning?.documentType === "planning-package" && briefV3) {
      try {
        const admission = admitPlanningRefresh({
          candidate: planning,
          current: planning,
          canonicalBrief: briefV3.brief,
          projectId,
          projectVersion: version,
          approvedBriefChecksum: briefV3.briefChecksum,
          timestamp: planning.updatedAt,
        });
        if (
          !briefV3.approval?.approved ||
          briefV3.approval.approvedCanonicalChecksum !== briefV3.briefChecksum ||
          admission.blockers.length > 0
        )
          planning = null;
      } catch (error) {
        if (error instanceof PlanningAdmissionError) planning = null;
        else throw error;
      }
    }
    const phase7cDocument = await this.documents.get(projectId, version, "phase-7c-contract-package");
    const phase7c = planning?.documentType === "planning-package" ? phase7cDocument : null;
    const directions = await this.documents.get(projectId, version, "design-directions");
    const designAttempt = await this.documents.get(projectId, version, "design-generation-attempt");
    const designOperation = designAttempt?.documentType === "design-generation-attempt"
      ? await this.dependencies.database.transaction((tx) => tx.getOperation({ operation: "workbench.design", key: designAttempt.operationKey }))
      : null;
    const hasIndeterminateDesignAttempt = designAttempt?.documentType === "design-generation-attempt" && designAttempt.state === "PROVIDER_STARTED" && designOperation?.status === "IN_PROGRESS";
    const designFreshAttemptBlocked = designAttempt?.documentType === "design-generation-attempt" && designAttempt.state === "OUTCOME_UNKNOWN";
    const selected = await this.documents.get(projectId, version, "selected-design");
    const contractPackage = phase7c;
    const contractAudit = await this.documents.get(projectId, version, "contract-audit");
    const taskGraph = await this.documents.get(projectId, version, "task-graph");
    const hasBlockingQuestions = status.clarification?.blockingUnresolvedQuestionIds.length ? true : false;
    const clarificationSession = clarification?.documentType === "clarification-log" ? clarification : undefined;
    const canRefreshClarifications = current.project.workflowState === "CLARIFYING" && Boolean(clarificationSession) && hasBlockingQuestions && clarificationSession?.answers.every((answer) => answer.status === "unresolved") === true && (clarificationSession?.clarificationVersion ?? 1) < 2;
    const briefReady = status.brief?.readyForApproval ?? false;
    let canGenerateArchitectureReview = false;
    if (current.project.workflowState === "ARCHITECTURE_REVIEW" && requirements?.documentType === "requirements" && briefV3 && planning?.documentType === "planning-package") {
      try {
        const input = this.architectureReviewInput(current.project.id, version, current.rowVersion, requirements, briefV3, planning);
        const canonical = await this.dependencies.database.transaction((tx) => readCanonicalReviewContext(tx, input));
        canGenerateArchitectureReview = canonical.reviewRow === null;
      } catch {
        canGenerateArchitectureReview = false;
      }
    }
    const implementationGate = implementationReadiness({
      workflowState: current.project.workflowState,
      ...(contractPackage?.documentType === "phase-7c-contract-package" ? { phase7c: contractPackage } : {}),
      ...(selected?.documentType === "selected-design" ? { selectedDesign: selected } : {}),
      ...(contractAudit?.documentType === "contract-audit" ? { contractAudit } : {}),
      ...(taskGraph?.documentType === "task-graph" ? { taskGraph } : {}),
    });
    const phase7cDatabaseDecisionPending = contractPackage?.documentType === "phase-7c-contract-package" && contractPackage.databaseDecision.approval.status === "PENDING";
    const phase7cDependencyApprovalPending = contractPackage?.documentType === "phase-7c-contract-package" && contractPackage.dependencyProposal.dependencies.some((dependency) => dependency.approvalRequired && dependency.approvalStatus === "PENDING");
    const phase7cContractAuditPending = contractPackage?.documentType === "phase-7c-contract-package" && contractPackage.status === "PENDING_USER_APPROVAL" && contractPackage.databaseDecision.approval.status === "APPROVED" && !phase7cDependencyApprovalPending && !contractAudit;
    let phase7cContractAuditRecoveryPending = false;
    if (current.project.workflowState === "CONTRACT_AUDIT" && contractPackage?.documentType === "phase-7c-contract-package" && !contractAudit && taskGraph?.documentType === "task-graph" && taskGraph.validation?.valid && taskGraph.readyForExecution) {
      const auditFrontierPayload = { projectId, projectVersion: version, approvedBriefChecksum: briefV3?.briefChecksum, planningChecksum: contractPackage.planningChecksum, architectureChecksum: contractPackage.architectureChecksum, designChecksum: contractPackage.designChecksum, databaseDecisionChecksum: contractPackage.databaseDecision.checksum, dependencyProposalChecksum: contractPackage.dependencyProposal.checksum };
      const auditOperationKey = `workbench-contract-audit-prerequisite:${projectId}:${version}:${checksumPersistedDocument(auditFrontierPayload)}`;
      const priorOperation = await this.dependencies.database.transaction((tx) => tx.getOperation({ operation: "workbench.contract-audit-prerequisite", key: auditOperationKey }));
      phase7cContractAuditRecoveryPending = priorOperation?.status === "FAILED";
    }
    const allowedActions = actionsForWorkbenchState({
      workflowState: current.project.workflowState,
      hasBlockingQuestions,
      hasBrief: Boolean(briefV3 || requirements?.documentType === "requirements"),
      briefReady,
      hasPlanning: planning?.documentType === "planning-package",
      hasDesigns: directions?.documentType === "design-directions",
      canRefreshClarifications,
      canGenerateArchitectureReview,
      hasIndeterminateDesignAttempt,
      designFreshAttemptBlocked,
      implementationReady: implementationGate.ready,
      phase7cDatabaseDecisionPending,
      phase7cDependencyApprovalPending,
      phase7cContractAuditPending,
      phase7cContractAuditRecoveryPending,
    });
    const brief = briefV3
      ? briefV3Projection(briefV3.brief, briefV3.briefChecksum, briefReady, briefV3.approval?.approved === true && briefV3.approval.approvedCanonicalChecksum === briefV3.briefChecksum)
      : requirements?.documentType === "requirements"
        ? this.brief(requirements, status.brief?.checksum ?? checksumPersistedDocument(requirements), briefReady)
        : undefined;
    const planningProjection = planning?.documentType === "planning-package" ? this.planning(planning, briefV3?.brief.legal.placeholderPolicy, briefV3?.brief) : undefined;
    const database = phase7c?.documentType === "phase-7c-contract-package" ? {
      packageChecksum: checksumPersistedDocument(phase7c),
      recommendation: phase7c.databaseDecision.plannerRecommendation,
      mode: phase7c.databaseDecision.mode,
      rationale: phase7c.databaseDecision.recommendationRationale,
      status: phase7c.databaseDecision.approval.status,
      connectionStatus: phase7c.databaseDecision.connectionStatus,
    } : undefined;
    const dependencies = phase7c?.documentType === "phase-7c-contract-package" ? phase7c.dependencyProposal.dependencies.slice(0, 20).map((dependency) => ({ packageName: dependency.packageName, versionSpec: dependency.versionSpec, purpose: dependency.rationale, approvalRequired: dependency.approvalRequired, approvalStatus: dependency.approvalStatus })) : [];
    const designItems = directions?.documentType === "design-directions" ? directions.directions.map((direction): WorkbenchDesign => ({
      id: direction.id,
      label: direction.shortName ?? direction.label,
      concept: direction.concept,
      typography: direction.typographyStrategy,
      layout: direction.layoutStrategy,
      photography: direction.imageArtDirection,
      componentCharacter: direction.componentCharacter,
      motion: direction.motionPolicy,
      tradeoffs: list(direction.risks, 6),
      selected: selected?.documentType === "selected-design" && selected.selectedDirectionId === direction.id,
      checksum: checksumPersistedDocument(direction),
    })) : [];
    const questions = status.clarification?.questions.map((question) => {
      const answer = clarification?.documentType === "clarification-log" ? clarification.answers.find((candidate) => candidate.questionId === question.id)?.answer : undefined;
      return { ...question, ...(answer ? { answer } : {}) };
    }) ?? [];
    const siteLanguage = current.project.siteLanguage;
    const assets = this.dependencies.assets ? (await this.dependencies.assets.list(current.project.id)).map((asset): WorkbenchAsset => ({ assetId: asset.assetId, category: asset.category, source: asset.source, safeDisplayName: asset.safeDisplayName, mediaType: asset.mediaType, byteSize: asset.byteSize, sha256: asset.sha256, status: asset.status, version: asset.version, currentness: asset.currentness, ...(asset.rejectionReason ? { rejectionReason: asset.rejectionReason } : {}) })) : [];
    const conversation = this.conversation(current.project.originalPrompt, current.project.workflowState, questions, brief, planningProjection, designItems);
    return {
      mode: "PROJECT_WORKBENCH",
      operatorLanguage: clarificationSession?.operatorLanguage ?? FACTORY_OPERATOR_LANGUAGE,
      siteLanguage,
      ...(clarificationSession?.languageResolution ? { languageResolution: clarificationSession.languageResolution } : {}),
      project: {
        projectId: current.project.id,
        name: briefV3?.brief.title ?? (requirements?.documentType === "requirements" && requirements.projectTitle ? requirements.projectTitle : current.project.title ?? "Untitled project"),
        slug: current.project.slug,
        promptPreview: current.project.originalPrompt.slice(0, 1200),
        workflowState: current.project.workflowState,
        rowVersion: current.rowVersion,
        projectVersion: version,
      },
      status: workbenchStatus(current.project.workflowState, allowedActions, hasBlockingQuestions),
      questions,
      assets,
      ...(brief ? { brief } : {}),
      ...(planningProjection ? { planning: planningProjection } : {}),
      ...(database ? { database } : {}),
      dependencies,
      designs: designItems,
      ...(selected?.documentType === "selected-design" ? { selectedDesignId: selected.selectedDirectionId } : {}),
      ...(directions?.documentType === "design-directions" ? { designSetChecksum: directionSetChecksum(directions) } : {}),
      conversation,
      projects: await this.projectList(),
    };
  }

  private scope(projectId: string) {
    if (!this.dependencies.getWorkflowScope) throw new WorkbenchActionError("WORKBENCH_ADVANCED_RUNTIME_UNAVAILABLE", "The advanced workflow runtime is not configured. The project was not changed.");
    return this.projects.get(projectId).then((project) => {
      if (!project) throw new WorkbenchActionError("PROJECT_NOT_FOUND", "We could not find that project.");
      return this.dependencies.getWorkflowScope!(project.slug);
    });
  }

  private async generatePlanning(projectId: string) {
    const scope = await this.scope(projectId);
    const current = await this.projects.getWithVersion(projectId);
    const version = current?.project.currentVersion ?? 1;
    const persistedBrief = await this.documents.get(projectId, version, "requirements");
    const briefV3Document = await this.documents.get(projectId, version, "brief-v3");
    if (!current || !persistedBrief || persistedBrief.documentType !== "requirements" || !briefV3Document || briefV3Document.documentType !== "brief-v3") throw new WorkbenchActionError("PLANNING_UPSTREAM_MISSING", "Planning requires a current approved Project Brief.");
    const briefV3 = BriefV3DocumentSchema.parse(briefV3Document);
    const brief = approvedBriefForDownstream(persistedBrief, briefV3);
    const decisions = await new DecisionRepository(this.dependencies.database).list(projectId, version);
    const approvedBriefChecksum = briefV3.briefChecksum;
    if (current.project.workflowState !== "AWAITING_PLANNING_GENERATION") throw new WorkbenchActionError("PLANNING_WORKFLOW_INVALID", "Planning generation is only available from the canonical Planning generation lifecycle state.");
    await currentWorkbenchOperationContext()?.bindCurrentness?.({ projectVersion: version, rowVersion: current.rowVersion, briefChecksum: approvedBriefChecksum });
    await scope.planner.planApprovedProject({ projectId, projectVersion: version, approvedBrief: brief, canonicalBrief: briefV3.brief, approvedBriefChecksum, originalPromptReference: "original-prompt.md", clarificationEvidenceReferences: ["clarification-log.json"], currentWorkflowState: "AWAITING_PLANNING_GENERATION", existingDecisions: decisions, suppliedFiles: [], allowedSkills: [], idempotencyKey: currentWorkbenchOperationContext()?.operationId ?? `workbench-planning:${projectId}`, expectedRowVersion: current.rowVersion }, { correlationId: currentWorkbenchOperationContext()?.correlationId, ...(currentWorkbenchOperationContext()?.providerInvocationLedger ? { providerInvocationLedger: currentWorkbenchOperationContext()?.providerInvocationLedger } : {}), ...(currentWorkbenchOperationContext()?.setStage ? { setStage: currentWorkbenchOperationContext()?.setStage } : {}), ...(currentWorkbenchOperationContext()?.markMutationCommitted ? { markMutationCommitted: currentWorkbenchOperationContext()?.markMutationCommitted } : {}) });
  }

  private async approvePlanning(projectId: string) {
    const current = await this.projects.getWithVersion(projectId);
    if (!current) throw new WorkbenchActionError("PROJECT_NOT_FOUND", "We could not find that project.");
    if (current.project.workflowState !== "AWAITING_PLANNING_APPROVAL") throw new WorkbenchActionError("PLANNING_WORKFLOW_INVALID", "Planning approval is only available from the canonical Planning approval lifecycle state.");
    const version = current.project.currentVersion;
    const planning = await this.documents.get(projectId, version, "planning-package");
    if (!planning || planning.documentType !== "planning-package") throw new WorkbenchActionError("PLANNING_NOT_READY", "No current Planning candidate is available for approval.");
    const scope = await this.scope(projectId);
    await scope.planner.acceptPlanningPackage({ projectId, projectVersion: version, planningChecksum: planningDocumentChecksum(planning), acceptedAt: new Date().toISOString(), acceptedBy: "workbench-user", expectedRowVersion: current.rowVersion, idempotencyKey: `workbench-planning-accept:${projectId}` });
  }

  private async requestPlanningChanges(projectId: string, reason: string) {
    const scope = await this.scope(projectId);
    const current = await this.projects.getWithVersion(projectId);
    const planning = await this.documents.get(projectId, current?.project.currentVersion ?? 1, "planning-package");
    if (!current || !planning || planning.documentType !== "planning-package") throw new WorkbenchActionError("PLANNING_NOT_READY", "No current planning package is available for revision.");
    await scope.planner.requestPlanningClarification({ projectId, projectVersion: current.project.currentVersion, blockers: [reason], requestedBy: "workbench-user", idempotencyKey: `workbench-planning-changes:${projectId}:${checksumPersistedDocument(reason)}` });
  }

  private architectureReviewInput(projectId: string, projectVersion: number, expectedRowVersion: number, persistedBrief: Extract<Awaited<ReturnType<DocumentRepository["get"]>>, { documentType: "requirements" }>, briefV3: BriefV3Document, planning: Extract<Awaited<ReturnType<DocumentRepository["get"]>>, { documentType: "planning-package" }>): ArchitectureReviewInput {
    const approvedBrief = approvedBriefForDownstream(persistedBrief, briefV3);
    return {
      projectId,
      projectVersion,
      approvedBrief,
      canonicalBrief: briefV3.brief,
      approvedBriefChecksum: briefV3.briefChecksum,
      acceptedPlanningPackage: planning,
      acceptedPlanningChecksum: checksumPersistedDocument(planning),
      factoryArchitecturePolicy: {
        policyVersion: "factory-architecture-v1",
        stack: [...FACTORY_ARCHITECTURE_STACK],
        prohibitedTechnologies: ["redis", "nestjs"],
        serverActionPreference: "preferred",
        routeHandlerPreference: "second",
        packageManager: "npm",
      },
      relevantProjectConstraints: approvedBrief.technicalConstraints.slice(0, 40),
      idempotencyKey: `workbench-architecture-review:${projectId}`,
      expectedRowVersion,
    };
  }

  private async generateArchitectureReview(projectId: string) {
    const current = await this.projects.getWithVersion(projectId);
    if (!current) throw new WorkbenchActionError("PROJECT_NOT_FOUND", "We could not find that project.");
    if (current.project.workflowState !== "ARCHITECTURE_REVIEW") throw new WorkbenchActionError("ARCHITECTURE_REVIEW_WORKFLOW_INVALID", "Architecture Review is only available from the canonical Architecture Review lifecycle stage.");
    const version = current.project.currentVersion;
    const persistedBrief = await this.documents.get(projectId, version, "requirements");
    const briefV3Document = await this.documents.get(projectId, version, "brief-v3");
    const planning = await this.documents.get(projectId, version, "planning-package");
    const architectureReview = await this.documents.get(projectId, version, "architecture-review");
    if (architectureReview) throw new WorkbenchActionError("ARCHITECTURE_REVIEW_ALREADY_EXISTS", "The current Architecture Review artifact already exists.");
    if (!persistedBrief || persistedBrief.documentType !== "requirements" || !briefV3Document || briefV3Document.documentType !== "brief-v3" || !planning || planning.documentType !== "planning-package") throw new WorkbenchActionError("ARCHITECTURE_REVIEW_BLOCKED", "A current approved Brief and accepted Planning package are required before Architecture Review.");
    const briefV3 = BriefV3DocumentSchema.parse(briefV3Document);
    const input = this.architectureReviewInput(projectId, version, current.rowVersion, persistedBrief, briefV3, planning);
    const canonical = await this.dependencies.database.transaction((tx) => readCanonicalReviewContext(tx, input));
    if (canonical.reviewRow) throw new WorkbenchActionError("ARCHITECTURE_REVIEW_ALREADY_EXISTS", "The current Architecture Review artifact already exists.");
    const scope = await this.scope(projectId);
    const parent = currentWorkbenchOperationContext();
    const correlationId = parent?.correlationId ?? randomUUID();
    const ledger = new ArchitectureReviewOperationLedger(this.dependencies.database, input, correlationId, parent?.runtimeProvenance, parent?.responseSink);
    let reserved = false;
    try {
      const reservation = await ledger.reserve();
      reserved = reservation.status === "NEW";
      await ledger.setStage("OPERATION_INITIALIZATION");
      const context: WorkbenchOperationContext = {
        correlationId,
        operationId: input.idempotencyKey,
        operationKind: "ARCHITECTURE_REVIEW",
        projectId,
        phase: "ARCHITECTURE_REVIEW",
        stage: "OPERATION_INITIALIZATION",
        providerInvocationLedger: ledger,
        setStage: async (stage) => { context.stage = stage; await ledger.setStage(stage); },
        runtimeProvenance: parent?.runtimeProvenance,
        responseSink: parent?.responseSink,
      };
      return await withWorkbenchOperationContext(context, async () => {
        await scope.architectureReviewer.reviewAndRoute(input, undefined, { correlationId: context.correlationId, providerInvocationLedger: ledger, setStage: context.setStage, markCanonicalPersisted: (lifecycleMutated) => ledger.markCanonicalArchitecturePersisted(lifecycleMutated) });
        await ledger.complete();
        return this.project(projectId);
      });
    } catch (error) {
      if (!reserved && error instanceof WorkbenchOperationConflict) throw error;
      throw await ledger.fail(error);
    }
  }

  private async designGenerationInput(projectId: string, current: Awaited<ReturnType<ProjectRepository["getWithVersion"]>>): Promise<{ input: DesignAgentInput; operationKey: string; payloadHash: string; architectureChecksum: string }> {
    if (!current) throw new WorkbenchActionError("PROJECT_NOT_FOUND", "We could not find that project.");
    if (current.project.workflowState !== "AWAITING_DESIGN_SELECTION") throw new WorkbenchActionError("DESIGN_WORKFLOW_INVALID", "Design directions can only be generated from the canonical Design frontier.");
    const version = current.project.currentVersion;
    const persistedBrief = await this.documents.get(projectId, version, "requirements");
    const briefV3Document = await this.documents.get(projectId, version, "brief-v3");
    const planning = await this.documents.get(projectId, version, "planning-package");
    const architectureReview = await this.documents.get(projectId, version, "architecture-review");
    if (!persistedBrief || persistedBrief.documentType !== "requirements" || !briefV3Document || briefV3Document.documentType !== "brief-v3" || !planning || planning.documentType !== "planning-package" || !architectureReview || architectureReview.documentType !== "architecture-review")
      throw new WorkbenchActionError("DESIGN_UPSTREAM_MISSING", "A current approved Brief, accepted Planning package, and Architecture Review are required before Design.");
    const briefV3 = BriefV3DocumentSchema.parse(briefV3Document);
    const brief = approvedBriefForDownstream(persistedBrief, briefV3);
    const acceptedPlanningChecksum = checksumPersistedDocument(planning);
    const architectureChecksum = checksumPersistedDocument(architectureReview);
    if (!planning.accepted) throw new WorkbenchActionError("DESIGN_PLANNING_NOT_ACCEPTED", "Design requires the accepted current Planning package.");
    if (architectureReview.result.verdict !== "APPROVED" || architectureReview.approvedBriefChecksum !== briefV3.briefChecksum || architectureReview.acceptedPlanningChecksum !== acceptedPlanningChecksum)
      throw new WorkbenchActionError("DESIGN_ARCHITECTURE_REVIEW_STALE", "The Architecture Review is not approved and current for the Brief and Planning package.");
    const decisions = await new DecisionRepository(this.dependencies.database).list(projectId, version);
    const visualStatements = brief.brandVisualRequirements
      ? Object.values(brief.brandVisualRequirements).flatMap((items) => items.flatMap((item) => typeof item === "object" && item && "statement" in item ? String(item.statement) : []))
      : [];
    const prohibitedStatements = brief.prohibitedRequirements?.map((item) => item.statement) ?? [];
    const frontierChecksum = checksumPersistedDocument({ projectId, projectVersion: version, approvedBriefChecksum: briefV3.briefChecksum, acceptedPlanningChecksum, architectureChecksum });
    const operationKey = `workbench-design:${projectId}:${version}:${frontierChecksum}`;
    const input = DesignAgentInputSchema.parse({
      projectId,
      projectVersion: version,
      approvedBrief: brief,
      canonicalBrief: briefV3.brief,
      approvedBriefChecksum: briefV3.briefChecksum,
      acceptedPlanningPackage: planning,
      acceptedPlanningChecksum,
      contentPlan: planning.content,
      assetManifest: planning.assets,
      suppliedBrandMetadata: brief.brandVisualRequirements ?? {},
      suppliedLogoMetadata: {
        ...brief.suppliedLogoLocation,
        ...(brief.assetRequirements ? { requiredAssets: brief.assetRequirements.requiredAssets.map((asset) => ({ reference: asset.reference, role: asset.role, replacementForbidden: asset.replacementForbidden })) } : {}),
      },
      imageSourceDecision: brief.imageSourceDecision,
      designPreferences: visualStatements,
      explicitDesignExclusions: [...brief.explicitExclusions, ...prohibitedStatements],
      currentWorkflowState: current.project.workflowState,
      existingDecisions: decisions,
      allowedSkills: [],
      idempotencyKey: operationKey,
      expectedRowVersion: current.rowVersion,
    });
    const payloadHash = checksumPersistedDocument({ action: "generate-design", projectId, projectVersion: version, approvedBriefChecksum: briefV3.briefChecksum, acceptedPlanningChecksum, architectureChecksum, expectedRowVersion: current.rowVersion, providerContract: "design-directions" });
    return { input, operationKey, payloadHash, architectureChecksum };
  }

  private async publishDesignResponse(input: { responseOrigin: WorkbenchResponseMetadata["responseOrigin"]; operationKey: string; payloadHash: string; projectId: string; attemptStatus?: WorkbenchResponseMetadata["attemptStatus"]; attemptCreated: boolean }) {
    const context = currentWorkbenchOperationContext();
    if (!context?.responseSink) return;
    const current = await this.projects.getWithVersion(input.projectId);
    const attempt = await this.documents.get(input.projectId, current?.project.currentVersion ?? 0, "design-generation-attempt");
    const attemptId = attempt?.documentType === "design-generation-attempt" ? attempt.attemptId : undefined;
    context.responseSink.metadata = {
      schemaVersion: 1,
      responseOrigin: input.responseOrigin,
      attemptCreated: input.attemptCreated && Boolean(attemptId),
      operationId: input.operationKey,
      ...(attemptId ? { attemptId } : {}),
      correlationId: context.correlationId,
      semanticIntentHash: input.payloadHash,
      ...(input.attemptStatus ? { attemptStatus: input.attemptStatus } : {}),
      runtimeProvenance: context.runtimeProvenance ?? currentRuntimeProvenance(),
    };
  }

  private async generateDesign(projectId: string) {
    const current = await this.projects.getWithVersion(projectId);
    const { input, operationKey, payloadHash, architectureChecksum } = await this.designGenerationInput(projectId, current);
    const operation = "workbench.design";
    const existingDirections = await this.documents.get(projectId, input.projectVersion, "design-directions");
    const existingAttempt = await this.documents.get(projectId, input.projectVersion, "design-generation-attempt");
    if (existingAttempt?.documentType === "design-generation-attempt" && existingAttempt.state === "OUTCOME_UNKNOWN") throw new WorkbenchActionError("DESIGN_OUTCOME_UNKNOWN_REQUIRES_AUTHORIZATION", "The prior Design provider outcome is unknown. Explicit fresh-attempt authority is required before another provider call.");
    const existingDirectionsCurrent = existingDirections?.documentType === "design-directions" && existingDirections.approvedBriefChecksum === input.approvedBriefChecksum && existingDirections.acceptedPlanningChecksum === input.acceptedPlanningChecksum && existingDirections.directions.every((direction) => direction.canonicalContent?.architectureChecksum === architectureChecksum);
    if (existingDirections?.documentType === "design-directions" && !existingDirectionsCurrent)
      throw new WorkbenchActionError("DESIGN_DIRECTION_SET_STALE", "The current Design direction set is not bound to the approved Architecture Review.");
    const reservation = await this.dependencies.database.transaction((tx) => tx.reserveOperation({ operation, key: operationKey, payloadHash }));
    if (reservation.status === "IN_PROGRESS") {
      if (existingDirectionsCurrent) {
        await this.dependencies.database.transaction((tx) => tx.completeOperation({ operation, key: operationKey, payloadHash, result: { status: "SUCCEEDED", replayed: true, directionSetId: existingDirections.setId, directionSetChecksum: directionSetChecksum(existingDirections) } }));
        await this.publishDesignResponse({ responseOrigin: "REPLAY", operationKey, payloadHash, projectId, attemptStatus: "SUCCEEDED", attemptCreated: true });
        return this.project(projectId);
      }
      throw new WorkbenchOperationConflict("WORKBENCH_OPERATION_IN_PROGRESS", "A current Design generation operation is already active.");
    }
    if (reservation.status === "SUCCEEDED") {
      if (!existingDirectionsCurrent) throw new WorkbenchActionError("DESIGN_DIRECTION_SET_STALE", "The completed Design operation has no current direction set bound to the approved Architecture Review.");
      await this.publishDesignResponse({ responseOrigin: "IDEMPOTENT_SUCCESS", operationKey, payloadHash, projectId, attemptStatus: "SUCCEEDED", attemptCreated: true });
      return this.project(projectId);
    }
    try {
      const scope = await this.scope(projectId);
      if (!scope.design) throw new WorkbenchActionError("DESIGN_RUNTIME_UNAVAILABLE", "The canonical Design runtime is not configured. The project was not changed.");
      const terminalAttempt = existingAttempt?.documentType === "design-generation-attempt" && ["SETUP_FAILED", "PROVIDER_FAILED", "WIRE_FAILED", "DOMAIN_FAILED", "ADMISSION_FAILED", "PERSISTENCE_FAILED"].includes(existingAttempt.state);
      const freshAttemptAuthorization = reservation.status === "NEW" && terminalAttempt
        ? { schemaVersion: 1 as const, kind: "EXPLICIT_USER_AUTHORIZATION" as const, authorizationId: randomUUID(), authorizedBy: "workbench:top-level-dispatch", authorizedAt: new Date().toISOString() }
        : undefined;
      const result = await scope.design.generateDesignDirections(input, freshAttemptAuthorization ? { replaceExisting: true, freshAttemptAuthorization } : undefined);
      await this.dependencies.database.transaction((tx) => tx.completeOperation({ operation, key: operationKey, payloadHash, result: { status: "SUCCEEDED", directionSetId: result.directionSet.setId, directionSetChecksum: result.readiness.directionSetChecksum } }));
      await this.publishDesignResponse({ responseOrigin: existingDirectionsCurrent ? "REPLAY" : "NEW_EXECUTION", operationKey, payloadHash, projectId, attemptStatus: "SUCCEEDED", attemptCreated: true });
      return this.project(projectId);
    } catch (error) {
      await this.dependencies.database.transaction((tx) => tx.failOperation({ operation, key: operationKey, payloadHash, result: { status: "FAILED", code: error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "DESIGN_GENERATION_FAILED" } })).catch(() => undefined);
      await this.publishDesignResponse({ responseOrigin: "NEW_EXECUTION", operationKey, payloadHash, projectId, attemptStatus: "FAILED", attemptCreated: true });
      throw error;
    }
  }

  private async reconcileDesignOutcomeUnknown(request: Extract<WorkbenchRequest, { action: "reconcile-design-outcome-unknown" }>) {
    const current = await this.projects.getWithVersion(request.projectId);
    if (!current || current.project.currentVersion !== request.projectVersion || current.rowVersion !== request.expectedRowVersion) throw new WorkbenchActionError("DESIGN_RECONCILIATION_STALE", "The Design reconciliation request is stale.");
    const { operationKey, payloadHash } = await this.designGenerationInput(request.projectId, current);
    if (operationKey !== request.operationKey) throw new WorkbenchActionError("DESIGN_RECONCILIATION_STALE", "The Design reconciliation request is bound to a different operation frontier.");
    const scope = await this.scope(request.projectId);
    if (!scope.design) throw new WorkbenchActionError("DESIGN_RUNTIME_UNAVAILABLE", "The canonical Design runtime is not configured. The project was not changed.");
    await scope.design.reconcileIndeterminateDesignAttempt({
      projectId: request.projectId,
      projectVersion: request.projectVersion,
      attemptId: request.attemptId,
      operationKey,
      operationPayloadHash: payloadHash,
      expectedRowVersion: request.expectedRowVersion,
      expectedAttemptChecksum: request.expectedAttemptChecksum,
    });
  }

  private async reconcileDesignPreProviderFailure(request: Extract<WorkbenchRequest, { action: "reconcile-design-pre-provider-failure" }>) {
    const current = await this.projects.getWithVersion(request.projectId);
    if (!current || current.project.currentVersion !== request.projectVersion || current.rowVersion !== request.expectedRowVersion) throw new WorkbenchActionError("DESIGN_RECONCILIATION_STALE", "The Design pre-provider reconciliation request is stale.");
    const { operationKey, payloadHash } = await this.designGenerationInput(request.projectId, current);
    if (operationKey !== request.operationKey) throw new WorkbenchActionError("DESIGN_RECONCILIATION_STALE", "The Design pre-provider reconciliation request is bound to a different operation frontier.");
    const scope = await this.scope(request.projectId);
    if (!scope.design) throw new WorkbenchActionError("DESIGN_RUNTIME_UNAVAILABLE", "The canonical Design runtime is not configured. The project was not changed.");
    await scope.design.reconcilePreProviderFailure({
      projectId: request.projectId,
      projectVersion: request.projectVersion,
      attemptId: request.attemptId,
      operationKey,
      operationPayloadHash: payloadHash,
      expectedRowVersion: request.expectedRowVersion,
      expectedAttemptChecksum: request.expectedAttemptChecksum,
    });
  }

  private async databaseDecision(projectId: string, mode: "NONE" | "SUPABASE_NEW" | "SUPABASE_EXISTING", reason?: string) {
    const current = await this.projects.getWithVersion(projectId);
    if (!current) throw new WorkbenchActionError("PROJECT_NOT_FOUND", "We could not find that project.");
    const packageService = new Phase7CContractService(this.dependencies.database);
    const pkg = await packageService.get(projectId, current.project.currentVersion);
    await packageService.approveDatabase({ projectId, projectVersion: current.project.currentVersion, expectedPackageChecksum: checksumPersistedDocument(pkg), mode, actorId: "workbench-user", approvedAt: new Date().toISOString(), ...(reason ? { reason } : {}), idempotencyKey: `workbench-database:${projectId}:${mode}` });
  }

  private async dependencyApproval(projectId: string) {
    const current = await this.projects.getWithVersion(projectId);
    if (!current) throw new WorkbenchActionError("PROJECT_NOT_FOUND", "We could not find that project.");
    const packageService = new Phase7CContractService(this.dependencies.database);
    const pkg = await packageService.get(projectId, current.project.currentVersion);
    await packageService.approveDependencies({ projectId, projectVersion: current.project.currentVersion, expectedPackageChecksum: checksumPersistedDocument(pkg), actorId: "workbench-user", approvedAt: new Date().toISOString(), idempotencyKey: `workbench-dependencies:${projectId}` });
  }

  private async selectDesign(projectId: string, selectedDirectionId: string) {
    const current = await this.projects.getWithVersion(projectId);
    if (!current) throw new WorkbenchActionError("PROJECT_NOT_FOUND", "We could not find that project.");
    const set = await this.documents.get(projectId, current.project.currentVersion, "design-directions");
    if (!set || set.documentType !== "design-directions" || set.directions.length !== 3) throw new WorkbenchActionError("DESIGN_SET_NOT_READY", "Exactly three current Design Directions are required.");
    const selected = set.directions.find((direction) => direction.id === selectedDirectionId);
    if (!selected) throw new WorkbenchActionError("DESIGN_DIRECTION_NOT_FOUND", "That Design Direction is not part of the current set.");
    const scope = await this.scope(projectId);
    await scope.design.selectDesignDirection({ projectId, projectVersion: current.project.currentVersion, designDirectionSetId: set.setId, selectedDirectionId, directionSetChecksum: directionSetChecksum(set), selectedDirectionChecksum: checksumPersistedDocument(selected), expectedRowVersion: current.rowVersion, selectedBy: "workbench-user", selectedAt: new Date().toISOString(), selectionNotes: "Selected explicitly in the Factory Workbench.", idempotencyKey: `workbench-design-selection:${projectId}:${selectedDirectionId}` });
  }

  private async startImplementation(projectId: string) {
    const current = await this.projects.getWithVersion(projectId);
    if (!current) throw new WorkbenchActionError("PROJECT_NOT_FOUND", "We could not find that project.");
    if (!this.dependencies.getWorkflowScope) throw new WorkbenchActionError("IMPLEMENTATION_START_BLOCKED", "The canonical Orchestrator runtime is not available.");
    const scope = await this.scope(projectId);
    const version = current.project.currentVersion;
    const persistedBrief = await this.documents.get(projectId, version, "requirements");
    const briefV3Document = await this.documents.get(projectId, version, "brief-v3");
    const planning = await this.documents.get(projectId, version, "planning-package");
    const selected = await this.documents.get(projectId, version, "selected-design");
    const phase7c = await this.documents.get(projectId, version, "phase-7c-contract-package");
    if (!persistedBrief || persistedBrief.documentType !== "requirements" || !briefV3Document || briefV3Document.documentType !== "brief-v3" || !planning || planning.documentType !== "planning-package" || !selected || selected.documentType !== "selected-design" || !phase7c || phase7c.documentType !== "phase-7c-contract-package") throw new WorkbenchActionError("IMPLEMENTATION_START_BLOCKED", "The current Brief, Planning, Design, and Phase 7C package are required before implementation.");
    const briefV3 = BriefV3DocumentSchema.parse(briefV3Document);
    const brief = approvedBriefForDownstream(persistedBrief, briefV3);
    const decisions = await new DecisionRepository(this.dependencies.database).list(projectId, version);
    const input = { projectId, projectVersion: version, approvedBrief: brief, canonicalBrief: briefV3.brief, approvedBriefChecksum: briefV3.briefChecksum, acceptedPlanningPackage: planning, acceptedPlanningChecksum: planningDocumentChecksum(planning), selectedDesign: selected, selectedDesignChecksum: checksumPersistedDocument(selected), technicalArchitecture: planning.architecture, contentPlan: planning.content, assetManifest: planning.assets, currentWorkflowState: "READY_FOR_IMPLEMENTATION" as const, existingDecisions: decisions, allowedRoles: ["lead", "planner-architect", "design", "implementation", "qa-release"] as ("lead" | "planner-architect" | "design" | "implementation" | "qa-release")[], approvedSkillRegistrySnapshot: { schemaVersion: 1 as const, checksum: "0".repeat(64), skills: [] }, toolPolicyVersion: "tools-v1", orchestrationPolicyVersion: DEFAULT_ORCHESTRATION_POLICY.version, idempotencyKey: `workbench-orchestrator:${projectId}:${checksumPersistedDocument(phase7c)}`, expectedRowVersion: current.rowVersion, workspaceReserved: true, projectImmutable: false, phase7cContractPackage: phase7c };
    const priorGraph = await this.documents.get(projectId, version, "task-graph");
    const priorAudit = await this.documents.get(projectId, version, "contract-audit");
    const priorTaskGraph = priorGraph?.documentType === "task-graph" ? priorGraph : undefined;
    const priorContractAudit = priorAudit?.documentType === "contract-audit" ? priorAudit : undefined;
    const auditRecovery = current.project.workflowState === "CONTRACT_AUDIT";
    const reconciling = auditRecovery && (priorContractAudit?.result.verdict === "CHANGES_REQUIRED" || priorContractAudit?.result.verdict === "BLOCKED");
    const staleApprovedAudit = auditRecovery && priorTaskGraph && priorContractAudit?.result.verdict === "APPROVED" && priorContractAudit.taskGraphChecksum !== checksumPersistedDocument(priorTaskGraph);
    if (auditRecovery && (!priorTaskGraph || !priorContractAudit || (!reconciling && !staleApprovedAudit))) throw new WorkbenchActionError("IMPLEMENTATION_START_BLOCKED", "The current Contract Audit cycle cannot be recovered safely.");
    const dependencyReconciliation = reconciling && priorContractAudit!.result.findings.some((finding) => finding.category === "DEPENDENCY_CONTRACT_MISMATCH");
    const scopeReconciliation = reconciling && priorContractAudit!.result.findings.some((finding) => finding.category === "ARTIFACT_MULTIPLE_OWNERS" || finding.category === "SCOPE_CONTRACT_MISMATCH");
    const persistedGraphChecksum = priorTaskGraph ? checksumPersistedDocument(priorTaskGraph) : undefined;
    const graph = dependencyReconciliation
      ? await scope.orchestrator.reconcileImplementationTaskGraphDependencies(input, persistedGraphChecksum!, `workbench-orchestrator-dependency-reconciliation:${projectId}:${persistedGraphChecksum}`)
      : scopeReconciliation
        ? await scope.orchestrator.reconcileImplementationTaskGraphPolicy(input, persistedGraphChecksum!, `workbench-orchestrator-policy-reconciliation:${projectId}:${persistedGraphChecksum}`)
          : auditRecovery
            ? { taskGraph: priorTaskGraph!, valid: priorTaskGraph!.validation?.valid ?? false, errors: priorTaskGraph!.validation?.errors ?? [], warnings: priorTaskGraph!.warnings ?? [], readyForExecution: priorTaskGraph!.readyForExecution, blockingReasons: priorTaskGraph!.blockingReasons ?? [], graphChecksum: priorTaskGraph!.graphChecksum! }
            : await scope.orchestrator.createImplementationTaskGraph(input);
    if (!graph.valid || !graph.readyForExecution) throw new WorkbenchActionError("IMPLEMENTATION_START_BLOCKED", "The canonical implementation graph is not ready.");
    const architectureReview = await this.documents.get(projectId, version, "architecture-review");
    if (!architectureReview || architectureReview.documentType !== "architecture-review" || architectureReview.result.verdict !== "APPROVED") throw new WorkbenchActionError("IMPLEMENTATION_START_BLOCKED", "The current approved Architecture Review is required before Contract Audit.");
    const auditEntry = await scope.contractAuditor.enterAudit({ projectId, projectVersion: version, expectedRowVersion: (await this.projects.getWithVersion(projectId))?.rowVersion ?? current.rowVersion, idempotencyKey: `workbench-contract-audit-enter:${projectId}` });
    const executorCatalog = [{ executorId: "factory-runtime", kind: "runtime" as const, current: true, capabilities: executorCapabilitiesForTasks(graph.taskGraph.tasks) }];
    const currentAssetReferences = this.dependencies.assets ? await this.dependencies.assets.listCurrentReadyReferences(projectId) : [];
    const auditIdempotencyKey = dependencyReconciliation
      ? `workbench-contract-audit-dependency-reconciliation:${projectId}:${graph.taskGraph.graphChecksum}:${CONTRACT_AUDIT_PROMPT_VERSION}`
      : scopeReconciliation
        ? `workbench-contract-audit-reconciliation:${projectId}:${graph.taskGraph.graphChecksum}:${CONTRACT_AUDIT_PROMPT_VERSION}`
        : auditRecovery
          ? `workbench-contract-audit-recheck:${projectId}:${graph.taskGraph.graphChecksum}:${CONTRACT_AUDIT_PROMPT_VERSION}`
          : `workbench-contract-audit:${projectId}:${graph.taskGraph.graphChecksum}:${CONTRACT_AUDIT_PROMPT_VERSION}`;
    const audit = await scope.contractAuditor.auditAndRoute({ projectId, projectVersion: version, approvedBrief: brief, canonicalBrief: briefV3.brief, briefChecksum: briefV3.briefChecksum, acceptedPlanningPackage: planning, planningChecksum: planningDocumentChecksum(planning), approvedArchitectureReview: architectureReview, architectureReviewChecksum: checksumPersistedDocument(architectureReview), selectedDesign: selected, designChecksum: checksumPersistedDocument(selected), taskGraph: graph.taskGraph, taskGraphChecksum: graph.taskGraph.graphChecksum!, executorCatalog, currentAssetReferences, idempotencyKey: auditIdempotencyKey, expectedRowVersion: auditEntry.rowVersion });
    if (audit.result.verdict !== "APPROVED") throw new WorkbenchActionError("IMPLEMENTATION_START_BLOCKED", "Contract Audit rejected the current implementation chain.");
    const approvedAudit = await this.documents.get(projectId, version, "contract-audit");
    if (!approvedAudit || approvedAudit.documentType !== "contract-audit") throw new WorkbenchActionError("IMPLEMENTATION_START_BLOCKED", "The approved Contract Audit was not persisted.");
    await scope.orchestrator.startImplementation({ ...input, idempotencyKey: auditRecovery ? `workbench-orchestrator-start-recovery:${projectId}` : input.idempotencyKey, approvedContractAuditChecksum: checksumPersistedDocument(approvedAudit), expectedRowVersion: (await this.projects.getWithVersion(projectId))?.rowVersion ?? current.rowVersion });
  }

  private async runContractAuditPrerequisite(projectId: string) {
    const current = await this.projects.getWithVersion(projectId);
    if (!current) throw new WorkbenchActionError("PROJECT_NOT_FOUND", "We could not find that project.");
    if (current.project.workflowState !== "READY_FOR_IMPLEMENTATION") throw new WorkbenchActionError("CONTRACT_AUDIT_PREREQUISITE_BLOCKED", "Contract Audit prerequisites require the current READY_FOR_IMPLEMENTATION frontier.");
    if (!this.dependencies.getWorkflowScope) throw new WorkbenchActionError("CONTRACT_AUDIT_PREREQUISITE_BLOCKED", "The canonical downstream workflow runtime is not available.");
    const scope = await this.scope(projectId);
    const version = current.project.currentVersion;
    const persistedBrief = await this.documents.get(projectId, version, "requirements");
    const briefV3Document = await this.documents.get(projectId, version, "brief-v3");
    const planning = await this.documents.get(projectId, version, "planning-package");
    const selected = await this.documents.get(projectId, version, "selected-design");
    const phase7c = await this.documents.get(projectId, version, "phase-7c-contract-package");
    if (!persistedBrief || persistedBrief.documentType !== "requirements" || !briefV3Document || briefV3Document.documentType !== "brief-v3" || !planning || planning.documentType !== "planning-package" || !selected || selected.documentType !== "selected-design" || !phase7c || phase7c.documentType !== "phase-7c-contract-package") throw new WorkbenchActionError("CONTRACT_AUDIT_PREREQUISITE_BLOCKED", "The current Brief, Planning, selected Design, and Phase 7C package are required before Contract Audit.");
    if (phase7c.status !== "PENDING_USER_APPROVAL" || phase7c.databaseDecision.approval.status !== "APPROVED" || phase7c.dependencyProposal.dependencies.some((dependency) => dependency.approvalRequired && dependency.approvalStatus === "PENDING")) throw new WorkbenchActionError("CONTRACT_AUDIT_PREREQUISITE_BLOCKED", "Phase 7C database and dependency prerequisites are not complete.");
    const briefV3 = BriefV3DocumentSchema.parse(briefV3Document);
    const brief = approvedBriefForDownstream(persistedBrief, briefV3);
    const decisions = await new DecisionRepository(this.dependencies.database).list(projectId, version);
    const auditFrontierPayload = { projectId, projectVersion: version, approvedBriefChecksum: briefV3.briefChecksum, planningChecksum: phase7c.planningChecksum, architectureChecksum: phase7c.architectureChecksum, designChecksum: phase7c.designChecksum, databaseDecisionChecksum: phase7c.databaseDecision.checksum, dependencyProposalChecksum: phase7c.dependencyProposal.checksum };
    const auditOperationKey = `workbench-contract-audit-prerequisite:${projectId}:${version}:${checksumPersistedDocument(auditFrontierPayload)}`;
    const auditOperations = new OperationRepository(this.dependencies.database);
    const reservation = await auditOperations.reserve("workbench.contract-audit-prerequisite", auditOperationKey, auditFrontierPayload);
    if (reservation.status === "IN_PROGRESS") throw new WorkbenchOperationConflict("WORKBENCH_OPERATION_IN_PROGRESS", "A current Contract Audit prerequisite is already active.");
    if (reservation.status === "SUCCEEDED") throw new WorkbenchOperationConflict("WORKBENCH_OPERATION_REPLAY", "The current Contract Audit prerequisite was already completed.");
    let prerequisiteReserved = true;
    let mutationPhase: ContractAuditMutationPhase = "BEFORE_TASKGRAPH_PERSISTENCE";
    try {
    const input = { projectId, projectVersion: version, approvedBrief: brief, canonicalBrief: briefV3.brief, approvedBriefChecksum: briefV3.briefChecksum, acceptedPlanningPackage: planning, acceptedPlanningChecksum: planningDocumentChecksum(planning), selectedDesign: selected, selectedDesignChecksum: checksumPersistedDocument(selected), technicalArchitecture: planning.architecture, contentPlan: planning.content, assetManifest: planning.assets, currentWorkflowState: "READY_FOR_IMPLEMENTATION" as const, existingDecisions: decisions, allowedRoles: ["lead", "planner-architect", "design", "implementation", "qa-release"] as ("lead" | "planner-architect" | "design" | "implementation" | "qa-release")[], approvedSkillRegistrySnapshot: { schemaVersion: 1 as const, checksum: "0".repeat(64), skills: [] }, toolPolicyVersion: "tools-v1", orchestrationPolicyVersion: DEFAULT_ORCHESTRATION_POLICY.version, idempotencyKey: `workbench-orchestrator:${projectId}:${checksumPersistedDocument(phase7c)}`, expectedRowVersion: current.rowVersion, workspaceReserved: true, projectImmutable: false, phase7cContractPackage: phase7c };
    const priorAudit = await this.documents.get(projectId, version, "contract-audit");
    if (priorAudit) throw new WorkbenchActionError("CONTRACT_AUDIT_PREREQUISITE_BLOCKED", "A Contract Audit already exists for the current Phase 7C frontier.");
    const priorGraph = await this.documents.get(projectId, version, "task-graph");
    const graph = priorGraph?.documentType === "task-graph"
      ? { taskGraph: priorGraph, valid: priorGraph.validation?.valid ?? false, errors: priorGraph.validation?.errors ?? [], warnings: priorGraph.warnings ?? [], readyForExecution: priorGraph.readyForExecution, blockingReasons: priorGraph.blockingReasons ?? [], graphChecksum: priorGraph.graphChecksum! }
      : await scope.orchestrator.createImplementationTaskGraph(input);
    mutationPhase = priorGraph?.documentType === "task-graph" ? "TASKGRAPH_PERSISTED" : "TASKGRAPH_PERSISTED";
    if (!graph.valid || !graph.readyForExecution) throw new WorkbenchActionError("CONTRACT_AUDIT_PREREQUISITE_BLOCKED", "The current TaskGraph is not ready for Contract Audit.");
    const architectureReview = await this.documents.get(projectId, version, "architecture-review");
    if (!architectureReview || architectureReview.documentType !== "architecture-review" || architectureReview.result.verdict !== "APPROVED") throw new WorkbenchActionError("CONTRACT_AUDIT_PREREQUISITE_BLOCKED", "The current approved Architecture Review is required before Contract Audit.");
    const auditEntry = await scope.contractAuditor.enterAudit({ projectId, projectVersion: version, expectedRowVersion: (await this.projects.getWithVersion(projectId))?.rowVersion ?? current.rowVersion, idempotencyKey: `workbench-contract-audit-enter:${projectId}` });
    mutationPhase = "LIFECYCLE_TRANSITIONED";
    const executorCatalog = [{ executorId: "factory-runtime", kind: "runtime" as const, current: true, capabilities: executorCapabilitiesForTasks(graph.taskGraph.tasks) }];
    const currentAssetReferences = this.dependencies.assets ? await this.dependencies.assets.listCurrentReadyReferences(projectId) : [];
    const auditIdempotencyKey = `workbench-contract-audit:${projectId}:${graph.taskGraph.graphChecksum}:${CONTRACT_AUDIT_PROMPT_VERSION}`;
    const audit = await scope.contractAuditor.auditAndRoute({ projectId, projectVersion: version, approvedBrief: brief, canonicalBrief: briefV3.brief, briefChecksum: briefV3.briefChecksum, acceptedPlanningPackage: planning, planningChecksum: planningDocumentChecksum(planning), approvedArchitectureReview: architectureReview, architectureReviewChecksum: checksumPersistedDocument(architectureReview), selectedDesign: selected, designChecksum: checksumPersistedDocument(selected), taskGraph: graph.taskGraph, taskGraphChecksum: graph.taskGraph.graphChecksum!, executorCatalog, currentAssetReferences, idempotencyKey: auditIdempotencyKey, expectedRowVersion: auditEntry.rowVersion });
    mutationPhase = "AUDIT_RESULT_RECEIVED";
    if (audit.result.verdict !== "APPROVED") throw new WorkbenchActionError("CONTRACT_AUDIT_PREREQUISITE_REJECTED", "Contract Audit did not approve the current implementation contract chain.");
    await auditOperations.complete("workbench.contract-audit-prerequisite", auditOperationKey, auditFrontierPayload, { taskGraphChecksum: graph.taskGraph.graphChecksum, auditResultChecksum: checksumPersistedDocument(audit.result), projectState: audit.projectState });
    prerequisiteReserved = false;
    } catch (error) {
      if (prerequisiteReserved) {
        await auditOperations.fail("workbench.contract-audit-prerequisite", auditOperationKey, auditFrontierPayload, contractAuditFailureResult(error, mutationPhase)).catch(() => undefined);
      }
      throw error;
    }
  }

  private async recoverContractAudit(projectId: string) {
    const current = await this.projects.getWithVersion(projectId);
    if (!current) throw new WorkbenchActionError("PROJECT_NOT_FOUND", "We could not find that project.");
    if (current.project.workflowState !== "CONTRACT_AUDIT") throw new WorkbenchActionError("CONTRACT_AUDIT_RECOVERY_BLOCKED", "Contract Audit recovery requires the current CONTRACT_AUDIT frontier.");
    if (!this.dependencies.getWorkflowScope) throw new WorkbenchActionError("CONTRACT_AUDIT_RECOVERY_BLOCKED", "The canonical downstream workflow runtime is not available.");
    const scope = await this.scope(projectId);
    const version = current.project.currentVersion;
    const [persistedBrief, briefV3Document, planning, selected, phase7c, architectureReview, taskGraph, priorAudit, priorHistory] = await Promise.all([
      this.documents.get(projectId, version, "requirements"),
      this.documents.get(projectId, version, "brief-v3"),
      this.documents.get(projectId, version, "planning-package"),
      this.documents.get(projectId, version, "selected-design"),
      this.documents.get(projectId, version, "phase-7c-contract-package"),
      this.documents.get(projectId, version, "architecture-review"),
      this.documents.get(projectId, version, "task-graph"),
      this.documents.get(projectId, version, "contract-audit"),
      this.documents.get(projectId, version, "contract-audit-history"),
    ]);
    if (!persistedBrief || persistedBrief.documentType !== "requirements" || !briefV3Document || briefV3Document.documentType !== "brief-v3" || !planning || planning.documentType !== "planning-package" || !selected || selected.documentType !== "selected-design" || !phase7c || phase7c.documentType !== "phase-7c-contract-package" || !architectureReview || architectureReview.documentType !== "architecture-review" || !taskGraph || taskGraph.documentType !== "task-graph")
      throw new WorkbenchActionError("CONTRACT_AUDIT_RECOVERY_BLOCKED", "The current approved upstream artifacts and TaskGraph are required before Contract Audit recovery.");
    if (priorAudit || priorHistory || !taskGraph.validation?.valid || !taskGraph.readyForExecution || phase7c.status !== "PENDING_USER_APPROVAL" || phase7c.databaseDecision.approval.status !== "APPROVED" || phase7c.dependencyProposal.dependencies.some((dependency) => dependency.approvalRequired && dependency.approvalStatus === "PENDING"))
      throw new WorkbenchActionError("CONTRACT_AUDIT_RECOVERY_BLOCKED", "The current Contract Audit recovery frontier is not eligible.");
    if (architectureReview.result.verdict !== "APPROVED") throw new WorkbenchActionError("CONTRACT_AUDIT_RECOVERY_BLOCKED", "The current approved Architecture Review is required before Contract Audit recovery.");
    const briefV3 = BriefV3DocumentSchema.parse(briefV3Document);
    const brief = approvedBriefForDownstream(persistedBrief, briefV3);
    const taskGraphWithoutChecksum = { ...taskGraph };
    delete taskGraphWithoutChecksum.graphChecksum;
    const phase7cDesignBindingIsCurrent = phase7c.designChecksum === "0".repeat(64) || phase7c.designChecksum === selected.selectedDirectionChecksum;
    if (taskGraph.graphChecksum !== checksumPersistedDocument(taskGraphWithoutChecksum) || phase7c.approvedBriefChecksum !== briefV3.briefChecksum || phase7c.planningChecksum !== planningSemanticChecksum(planning) || !phase7cDesignBindingIsCurrent || architectureReview.approvedBriefChecksum !== briefV3.briefChecksum || architectureReview.acceptedPlanningChecksum !== planningDocumentChecksum(planning))
      throw new WorkbenchActionError("CONTRACT_AUDIT_RECOVERY_BLOCKED", "The current TaskGraph or upstream artifact bindings are stale.");
    const auditFrontierPayload = { projectId, projectVersion: version, approvedBriefChecksum: briefV3.briefChecksum, planningChecksum: phase7c.planningChecksum, architectureChecksum: phase7c.architectureChecksum, designChecksum: phase7c.designChecksum, databaseDecisionChecksum: phase7c.databaseDecision.checksum, dependencyProposalChecksum: phase7c.dependencyProposal.checksum };
    const priorOperationKey = `workbench-contract-audit-prerequisite:${projectId}:${version}:${checksumPersistedDocument(auditFrontierPayload)}`;
    const auditOperations = new OperationRepository(this.dependencies.database);
    const priorOperation = await this.dependencies.database.transaction((tx) => tx.getOperation({ operation: "workbench.contract-audit-prerequisite", key: priorOperationKey }));
    if (!priorOperation || priorOperation.status !== "FAILED") throw new WorkbenchActionError("CONTRACT_AUDIT_RECOVERY_BLOCKED", "Recovery requires one preserved failed Contract Audit prerequisite; no new provider work was started.");
    const recoveryPayload = { ...auditFrontierPayload, priorOperationKey, priorOperationPayloadHash: priorOperation.payloadHash, taskGraphChecksum: taskGraph.graphChecksum, recoveryGeneration: 1 as const };
    const recoveryKey = `workbench-contract-audit-recovery:${projectId}:${version}:${checksumPersistedDocument(recoveryPayload)}`;
    const existingRecovery = await this.dependencies.database.transaction((tx) => tx.getOperation({ operation: "workbench.contract-audit-recovery", key: recoveryKey }));
    if (existingRecovery?.status === "IN_PROGRESS") throw new WorkbenchOperationConflict("WORKBENCH_OPERATION_IN_PROGRESS", "A current Contract Audit recovery is already active.");
    if (existingRecovery) throw new WorkbenchOperationConflict("WORKBENCH_OPERATION_REPLAY", "This Contract Audit recovery identity has already reached a terminal state.");
    const reservation = await auditOperations.reserve("workbench.contract-audit-recovery", recoveryKey, recoveryPayload);
    if (reservation.status === "IN_PROGRESS") throw new WorkbenchOperationConflict("WORKBENCH_OPERATION_IN_PROGRESS", "A current Contract Audit recovery is already active.");
    if (reservation.status === "SUCCEEDED") throw new WorkbenchOperationConflict("WORKBENCH_OPERATION_REPLAY", "This Contract Audit recovery identity was already completed.");
    let mutationPhase: ContractAuditMutationPhase = "TASKGRAPH_PERSISTED";
    let recoveryTerminalized = false;
    try {
      const executorCatalog = [{ executorId: "factory-runtime", kind: "runtime" as const, current: true, capabilities: executorCapabilitiesForTasks(taskGraph.tasks) }];
      const currentAssetReferences = this.dependencies.assets ? await this.dependencies.assets.listCurrentReadyReferences(projectId) : [];
      const auditIdempotencyKey = `workbench-contract-audit-recovery:${projectId}:${taskGraph.graphChecksum}:${CONTRACT_AUDIT_PROMPT_VERSION}:1`;
      const audit = await scope.contractAuditor.auditAndRoute({ projectId, projectVersion: version, approvedBrief: brief, canonicalBrief: briefV3.brief, briefChecksum: briefV3.briefChecksum, acceptedPlanningPackage: planning, planningChecksum: planningDocumentChecksum(planning), approvedArchitectureReview: architectureReview, architectureReviewChecksum: checksumPersistedDocument(architectureReview), selectedDesign: selected, designChecksum: checksumPersistedDocument(selected), taskGraph, taskGraphChecksum: taskGraph.graphChecksum!, executorCatalog, currentAssetReferences, idempotencyKey: auditIdempotencyKey, expectedRowVersion: current.rowVersion });
      mutationPhase = "AUDIT_RESULT_RECEIVED";
      await auditOperations.complete("workbench.contract-audit-recovery", recoveryKey, recoveryPayload, { outcome: audit.result.verdict === "APPROVED" ? "APPROVED" : "AUDIT_REJECTED", auditResultChecksum: checksumPersistedDocument(audit.result), taskGraphChecksum: taskGraph.graphChecksum, projectState: audit.projectState, canonicalContractAuditPersisted: true });
      recoveryTerminalized = true;
      if (audit.result.verdict !== "APPROVED") throw new WorkbenchActionError("CONTRACT_AUDIT_PREREQUISITE_REJECTED", "Contract Audit completed with findings that require review.");
    } catch (error) {
      if (!recoveryTerminalized) await auditOperations.fail("workbench.contract-audit-recovery", recoveryKey, recoveryPayload, contractAuditFailureResult(error, mutationPhase)).catch(() => undefined);
      throw error;
    }
  }

  private brief(requirements: Extract<Awaited<ReturnType<DocumentRepository["get"]>>, { documentType: "requirements" }>, checksum: string, readyForApproval: boolean): WorkbenchBrief {
    return {
      checksum,
      readyForApproval,
      approved: requirements.approval.approved,
      ...(requirements.operatorLanguage ? { operatorLanguage: requirements.operatorLanguage } : {}),
      siteLanguage: requirements.localization.defaultLocale,
      ...(requirements.projectSummary ? { projectSummary: requirements.projectSummary } : {}),
      businessGoals: list(requirements.businessGoals),
      targetAudiences: list(requirements.targetAudiences),
      pages: requirements.pages.slice(0, 16).map((page) => `${page.slug}: ${page.purpose}`),
      features: list(requirements.features),
      forms: list(requirements.forms),
      ...(requirements.content ? { content: statements(requirements.content) } : {}),
      ...(requirements.imageSourceDecision ? { imageStrategy: requirements.imageSourceDecision } : {}),
      constraints: list(requirements.technicalConstraints),
      ...(requirements.briefSchemaVersion ? { briefSchemaVersion: requirements.briefSchemaVersion } : {}),
      ...(requirements.brandVisualRequirements ? { brandVisual: statements(Object.values(requirements.brandVisualRequirements).flat()) } : {}),
      ...(requirements.assetRequirements ? { assets: [...requirements.assetRequirements.requiredAssets.map((asset) => `${asset.role}: ${asset.usage} (${asset.reference})`), ...statements(requirements.assetRequirements.additionalImagery.sourcingPolicy)] } : {}),
      ...(requirements.uxResponsiveRequirements ? { uxResponsive: [...statements(requirements.uxResponsiveRequirements.responsiveBehavior), ...statements(requirements.uxResponsiveRequirements.interactionRequirements), ...(requirements.uxResponsiveRequirements.mobileFirst ? ["Mobile-first"] : []), ...(requirements.uxResponsiveRequirements.stickyMobileCta ? ["Sticky mobile CTA"] : []), ...(requirements.uxResponsiveRequirements.smoothScroll ? ["Smooth scroll"] : [])] } : {}),
      ...(requirements.seoMetadata ? { seo: [...requirements.seoMetadata.primaryKeywords.map((keyword) => `Keyword: ${keyword}`), ...(requirements.seoMetadata.exactTitle ? [`Exact title: ${requirements.seoMetadata.exactTitle}`] : []), ...(requirements.seoMetadata.exactMetaDescription ? [`Exact meta description: ${requirements.seoMetadata.exactMetaDescription}`] : []), ...statements(requirements.seoMetadata.locationTargeting)] } : {}),
      ...(requirements.legalComplianceConstraints ? { legalCompliance: [...statements(requirements.legalComplianceConstraints.constraints), `Placeholder policy: ${requirements.legalComplianceConstraints.placeholderPolicy}`] } : {}),
      ...(requirements.deferredIntegrations ? { technicalDeferred: [...list(requirements.technicalConstraints), ...statements(requirements.technical), ...requirements.deferredIntegrations.map((integration) => `${integration.integration}: ${integration.status} — ${integration.rationale}`)] } : {}),
      ...(requirements.prohibitedRequirements ? { prohibited: statements(requirements.prohibitedRequirements) } : {}),
    };
  }

  private planning(value: Extract<Awaited<ReturnType<DocumentRepository["get"]>>, { documentType: "planning-package" }>, legalPlaceholderPolicy?: "USE_EXPLICIT_PLACEHOLDERS" | "NO_PLACEHOLDERS" | "UNRESOLVED", canonicalBrief?: CanonicalBriefV3): WorkbenchPlanning {
    const readiness = evaluatePlanningAcceptanceReadiness({ planningPackage: value, context: legalPlaceholderPolicy ? { legalPlaceholderPolicy, ...(canonicalBrief ? { canonicalBrief } : {}) } : undefined });
    return {
      checksum: checksumPersistedDocument(value),
      accepted: value.accepted,
      readyForAcceptance: readiness.readyForAcceptance,
      architecture: `${value.architecture.applicationProfile} · ${value.architecture.packageManager}`,
      routes: value.architecture.routes.slice(0, 16).map((route) => `${route.path}: ${route.responsibility}`),
      majorFeatures: list(value.productScope.inScopeCapabilities),
      ...(value.databaseRecommendation ? { databaseRecommendation: value.databaseRecommendation.recommendation } : {}),
      dependencies: value.dependencies.dependencies.slice(0, 20).map((dependency) => ({ name: dependency.name, purpose: dependency.purpose, runtime: dependency.runtime, required: dependency.required })),
      blockers: list(value.blockers),
      blockingItems: readiness.blockingItems.map((item) => item.reason),
      deferredItems: readiness.deferredItems.map((item) => item.reason),
    };
  }

  private conversation(prompt: string, state: WorkflowState, questions: WorkbenchProjection["questions"], brief: WorkbenchBrief | undefined, planning: WorkbenchPlanning | undefined, designs: WorkbenchDesign[]): ConversationEntry[] {
    const entries: ConversationEntry[] = [{ entryId: "request", actor: "USER", kind: "MESSAGE", title: "Project request", text: prompt.slice(0, 1200) }];
    if (questions.length) entries.push({ entryId: "clarification", actor: "FACTORY", kind: "CLARIFICATION", title: "Lead clarification", text: `${questions.filter((question) => question.answerStatus === "unresolved").length} question(s) remain before the Brief can be prepared.`, status: state === "CLARIFYING" ? "current" : "complete" });
    if (brief) entries.push({ entryId: "brief", actor: "FACTORY", kind: "BRIEF", title: "Project Brief", text: brief.projectSummary ?? "Lead prepared a bounded Project Brief projection.", status: brief.approved ? "complete" : "current" });
    if (planning) entries.push({ entryId: "planning", actor: "FACTORY", kind: "PLANNING", title: "Planning package", text: planning.architecture, status: planning.accepted ? "complete" : "current" });
    if (designs.length === 3) entries.push({ entryId: "designs", actor: "FACTORY", kind: "DESIGN_DIRECTIONS", title: "Three Design Directions", text: "Choose one direction explicitly when the canonical design gate is ready.", status: designs.some((design) => design.selected) ? "complete" : "current" });
    return entries;
  }
}

export const isWorkbenchAction = (value: string): value is WorkbenchAction => [
  "ANSWER_LEAD_CLARIFICATIONS", "REFRESH_LEAD_CLARIFICATIONS", "APPROVE_BRIEF", "REQUEST_BRIEF_CHANGES", "GENERATE_PLANNING", "APPROVE_PLANNING", "REQUEST_PLANNING_CHANGES", "GENERATE_ARCHITECTURE_REVIEW", "GENERATE_DESIGN", "RECONCILE_DESIGN_OUTCOME_UNKNOWN", "RECONCILE_DESIGN_PRE_PROVIDER_FAILURE", "DATABASE_DECISION", "DEPENDENCY_APPROVAL", "RUN_CONTRACT_AUDIT", "RECOVER_CONTRACT_AUDIT", "DESIGN_SELECTION", "START_IMPLEMENTATION",
].includes(value);
