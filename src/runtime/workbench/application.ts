import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { DecisionRepository, DocumentRepository, ProjectRepository } from "@/persistence/database/repositories";
import type { PersistenceDatabase } from "@/persistence/database/types";
import type { WorkflowState } from "@/domain/workflow/engine";
import { evaluatePlanningAcceptanceReadiness, planningDocumentChecksum } from "@/agents/planner/deterministic";
import { FACTORY_ARCHITECTURE_STACK } from "@/agents/reviewers/architecture/contracts";
import type { PlannerArchitectService } from "@/agents/planner/service";
import type { ArchitectureReviewOrchestrationService } from "@/orchestration/architecture-review/service";
import type { DesignAgentService } from "@/agents/design/service";
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
import { taskExecutionCapability } from "@/orchestration/execution/capabilities";
import { canonicalBriefToPlannerBrief } from "@/agents/planner/brief-context";
import { admitPlanningRefresh, PlanningAdmissionError } from "@/agents/planner/refresh-admission";

const list = (values: string[] | undefined, limit = 12) => (values ?? []).slice(0, limit).map((value) => value.slice(0, 500));
const statements = (values: unknown, limit = 16): string[] => {
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => typeof value === "string" ? [value] : value && typeof value === "object" && typeof (value as { statement?: unknown }).statement === "string" ? [(value as { statement: string }).statement] : []).slice(0, limit).map((value) => value.slice(0, 500));
};

const v3Statements = (brief: CanonicalBriefV3, categories: readonly RequirementCategory[]) =>
  brief.requirements.filter((requirement) => categories.includes(requirement.category)).map((requirement) => requirement.statement);

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

  async handle(request: WorkbenchRequest): Promise<WorkbenchProjection> {
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
      case "approve-planning":
        await this.approvePlanning(request.projectId);
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
    const selected = await this.documents.get(projectId, version, "selected-design");
    const contractPackage = phase7c;
    const contractAudit = await this.documents.get(projectId, version, "contract-audit");
    const taskGraph = await this.documents.get(projectId, version, "task-graph");
    const hasBlockingQuestions = status.clarification?.blockingUnresolvedQuestionIds.length ? true : false;
    const clarificationSession = clarification?.documentType === "clarification-log" ? clarification : undefined;
    const canRefreshClarifications = current.project.workflowState === "CLARIFYING" && Boolean(clarificationSession) && hasBlockingQuestions && clarificationSession?.answers.every((answer) => answer.status === "unresolved") === true && (clarificationSession?.clarificationVersion ?? 1) < 2;
    const briefReady = status.brief?.readyForApproval ?? false;
    const allowedActions = actionsForWorkbenchState({
      workflowState: current.project.workflowState,
      hasBlockingQuestions,
      hasBrief: Boolean(briefV3 || requirements?.documentType === "requirements"),
      briefReady,
      hasPlanning: planning?.documentType === "planning-package",
      hasDesigns: directions?.documentType === "design-directions",
      canRefreshClarifications,
      implementationReady: current.project.workflowState === "READY_FOR_IMPLEMENTATION" &&
        contractPackage?.documentType === "phase-7c-contract-package" && contractPackage.status === "APPROVED" &&
        selected?.documentType === "selected-design" &&
        contractAudit?.documentType === "contract-audit" && contractAudit.result.verdict === "APPROVED" &&
        taskGraph?.documentType === "task-graph" && taskGraph.readyForExecution === true,
    });
    const brief = briefV3
      ? briefV3Projection(briefV3.brief, briefV3.briefChecksum, briefReady, briefV3.approval?.approved === true && briefV3.approval.approvedCanonicalChecksum === briefV3.briefChecksum)
      : requirements?.documentType === "requirements"
        ? this.brief(requirements, status.brief?.checksum ?? checksumPersistedDocument(requirements), briefReady)
        : undefined;
    const planningProjection = planning?.documentType === "planning-package" ? this.planning(planning, briefV3?.brief.legal.placeholderPolicy) : undefined;
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

  private async approvePlanning(projectId: string) {
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
    const planning = await scope.planner.planApprovedProject({ projectId, projectVersion: version, approvedBrief: brief, canonicalBrief: briefV3.brief, approvedBriefChecksum, originalPromptReference: "original-prompt.md", clarificationEvidenceReferences: ["clarification-log.json"], currentWorkflowState: "AWAITING_DESIGN_SELECTION", existingDecisions: decisions, suppliedFiles: [], allowedSkills: [], idempotencyKey: `workbench-planning:${projectId}`, expectedRowVersion: current.rowVersion });
    const accepted = await scope.planner.acceptPlanningPackage({ projectId, projectVersion: version, planningChecksum: planningDocumentChecksum(planning), acceptedAt: new Date().toISOString(), acceptedBy: "workbench-user", expectedRowVersion: (await this.projects.getWithVersion(projectId))?.rowVersion ?? current.rowVersion, idempotencyKey: `workbench-planning-accept:${projectId}` });
    const reviewed = await scope.architectureReviewer.reviewAndRoute({ projectId, projectVersion: version, approvedBrief: brief, canonicalBrief: briefV3.brief, approvedBriefChecksum, acceptedPlanningPackage: accepted.package, acceptedPlanningChecksum: accepted.planningChecksum, factoryArchitecturePolicy: { policyVersion: "factory-architecture-v1", stack: [...FACTORY_ARCHITECTURE_STACK], prohibitedTechnologies: ["redis", "nestjs", "bullmq", "pnpm", "yarn"], serverActionPreference: "preferred", routeHandlerPreference: "second", packageManager: "npm" }, relevantProjectConstraints: brief.technicalConstraints, idempotencyKey: `workbench-architecture-review:${projectId}`, expectedRowVersion: (await this.projects.getWithVersion(projectId))?.rowVersion ?? accepted.rowVersion });
    if (reviewed.projectState !== "AWAITING_DESIGN_SELECTION") throw new WorkbenchActionError("ARCHITECTURE_REVIEW_BLOCKED", "Architecture review requested changes before Design can begin.");
    const afterReview = await this.projects.getWithVersion(projectId);
    await scope.design.generateDesignDirections({ projectId, projectVersion: version, approvedBrief: brief, canonicalBrief: briefV3.brief, approvedBriefChecksum, acceptedPlanningPackage: accepted.package, acceptedPlanningChecksum: accepted.planningChecksum, contentPlan: accepted.package.content, assetManifest: accepted.package.assets, suppliedBrandMetadata: {}, suppliedLogoMetadata: brief.suppliedLogoLocation, imageSourceDecision: brief.imageSourceDecision, designPreferences: [], explicitDesignExclusions: [], currentWorkflowState: "AWAITING_DESIGN_SELECTION", existingDecisions: decisions, allowedSkills: [], idempotencyKey: `workbench-design:${projectId}`, expectedRowVersion: afterReview?.rowVersion ?? reviewed.rowVersion });
  }

  private async requestPlanningChanges(projectId: string, reason: string) {
    const scope = await this.scope(projectId);
    const current = await this.projects.getWithVersion(projectId);
    const planning = await this.documents.get(projectId, current?.project.currentVersion ?? 1, "planning-package");
    if (!current || !planning || planning.documentType !== "planning-package") throw new WorkbenchActionError("PLANNING_NOT_READY", "No current planning package is available for revision.");
    await scope.planner.requestPlanningClarification({ projectId, projectVersion: current.project.currentVersion, blockers: [reason], requestedBy: "workbench-user", idempotencyKey: `workbench-planning-changes:${projectId}:${checksumPersistedDocument(reason)}` });
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
    const input = { projectId, projectVersion: version, approvedBrief: brief, canonicalBrief: briefV3.brief, approvedBriefChecksum: briefV3.briefChecksum, acceptedPlanningPackage: planning, acceptedPlanningChecksum: planningDocumentChecksum(planning), selectedDesign: selected, selectedDesignChecksum: checksumPersistedDocument(selected), technicalArchitecture: planning.architecture, contentPlan: planning.content, assetManifest: planning.assets, currentWorkflowState: "READY_FOR_IMPLEMENTATION" as const, existingDecisions: decisions, allowedRoles: ["lead", "planner-architect", "design", "implementation", "qa-release"] as ("lead" | "planner-architect" | "design" | "implementation" | "qa-release")[], approvedSkillRegistrySnapshot: { schemaVersion: 1 as const, checksum: "0".repeat(64), skills: [] }, toolPolicyVersion: "tools-v1", orchestrationPolicyVersion: DEFAULT_ORCHESTRATION_POLICY.version, idempotencyKey: `workbench-orchestrator:${projectId}`, expectedRowVersion: current.rowVersion, workspaceReserved: true, projectImmutable: false, phase7cContractPackage: phase7c };
    const graph = await scope.orchestrator.createImplementationTaskGraph(input);
    if (!graph.valid || !graph.readyForExecution) throw new WorkbenchActionError("IMPLEMENTATION_START_BLOCKED", "The canonical implementation graph is not ready.");
    const architectureReview = await this.documents.get(projectId, version, "architecture-review");
    if (!architectureReview || architectureReview.documentType !== "architecture-review" || architectureReview.result.verdict !== "APPROVED") throw new WorkbenchActionError("IMPLEMENTATION_START_BLOCKED", "The current approved Architecture Review is required before Contract Audit.");
    const auditEntry = await scope.contractAuditor.enterAudit({ projectId, projectVersion: version, expectedRowVersion: (await this.projects.getWithVersion(projectId))?.rowVersion ?? current.rowVersion, idempotencyKey: `workbench-contract-audit-enter:${projectId}` });
    const executorCatalog = [{ executorId: "factory-runtime", kind: "runtime" as const, current: true, capabilities: [...new Set(graph.taskGraph.tasks.map((task) => taskExecutionCapability(task.taskType)).filter(Boolean) as string[])] }];
    const audit = await scope.contractAuditor.auditAndRoute({ projectId, projectVersion: version, approvedBrief: brief, briefChecksum: briefV3.briefChecksum, acceptedPlanningPackage: planning, planningChecksum: planningDocumentChecksum(planning), approvedArchitectureReview: architectureReview, architectureReviewChecksum: checksumPersistedDocument(architectureReview), selectedDesign: selected, designChecksum: checksumPersistedDocument(selected), taskGraph: graph.taskGraph, taskGraphChecksum: graph.taskGraph.graphChecksum!, executorCatalog, idempotencyKey: `workbench-contract-audit:${projectId}`, expectedRowVersion: auditEntry.rowVersion });
    if (audit.result.verdict !== "APPROVED") throw new WorkbenchActionError("IMPLEMENTATION_START_BLOCKED", "Contract Audit rejected the current implementation chain.");
    const approvedAudit = await this.documents.get(projectId, version, "contract-audit");
    if (!approvedAudit || approvedAudit.documentType !== "contract-audit") throw new WorkbenchActionError("IMPLEMENTATION_START_BLOCKED", "The approved Contract Audit was not persisted.");
    await scope.orchestrator.startImplementation({ ...input, approvedContractAuditChecksum: checksumPersistedDocument(approvedAudit), expectedRowVersion: (await this.projects.getWithVersion(projectId))?.rowVersion ?? current.rowVersion });
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

  private planning(value: Extract<Awaited<ReturnType<DocumentRepository["get"]>>, { documentType: "planning-package" }>, legalPlaceholderPolicy?: "USE_EXPLICIT_PLACEHOLDERS" | "NO_PLACEHOLDERS" | "UNRESOLVED"): WorkbenchPlanning {
    const readiness = evaluatePlanningAcceptanceReadiness({ planningPackage: value, context: legalPlaceholderPolicy ? { legalPlaceholderPolicy } : undefined });
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
  "ANSWER_LEAD_CLARIFICATIONS", "REFRESH_LEAD_CLARIFICATIONS", "APPROVE_BRIEF", "REQUEST_BRIEF_CHANGES", "APPROVE_PLANNING", "REQUEST_PLANNING_CHANGES", "DATABASE_DECISION", "DEPENDENCY_APPROVAL", "DESIGN_SELECTION", "START_IMPLEMENTATION",
].includes(value);
