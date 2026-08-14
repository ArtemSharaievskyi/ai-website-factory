import { randomUUID } from "node:crypto";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import {
  ClarificationRepository,
  DocumentRepository,
  OperationRepository,
  ProjectRepository,
} from "@/persistence/database/repositories";
import type { PersistenceDatabase } from "@/persistence/database/types";
import type { ClarificationAnswer } from "@/domain/requirements/schema";
import type { WorkflowState } from "@/domain/workflow/engine";
import type { FactoryProject } from "@/domain/project/schema";
import type { LeadAgentService } from "@/agents/lead/service";
import type { LeadAgentInput } from "@/agents/lead/contracts";
import { LeadError } from "@/agents/lead/errors";
import { FACTORY_OPERATOR_LANGUAGE, normalizeSiteLanguage, OperatorLanguageSchema, resolveLanguageAuthority, type LanguageResolution, type OperatorLanguage } from "@/domain/language/schema";
import type { ProjectOrigin } from "@/domain/project/provenance";
import {
  createInitialProjectRequest,
  type InitialProjectRequest,
} from "@/domain/project/initial-request";
import type { ProjectAssetService } from "@/runtime/assets/service";

export type TrialEntryAnswer = {
  questionId: string;
  status?: ClarificationAnswer["status"];
  answer?: string;
};

export type TrialEntryQuestion = {
  id: string;
  requirementKey?: string;
  category: string;
  question: string;
  blocking: boolean;
  required: boolean;
  answerStatus: ClarificationAnswer["status"];
};

export type TrialEntryStatus = {
  projectId: string;
  slug: string;
  projectVersion: number;
  workflowState: WorkflowState;
  rowVersion: number;
  pendingUserAction: string;
  blockingReasons: string[];
  nextAllowedActions: string[];
  operatorLanguage: OperatorLanguage;
  siteLanguage: string;
  clarification?: {
    questions: TrialEntryQuestion[];
    unresolvedQuestionIds: string[];
    blockingUnresolvedQuestionIds: string[];
  operatorLanguage?: OperatorLanguage;
    clarificationVersion?: number;
  };
  brief?: {
    checksum: string;
    readyForApproval: boolean;
    approved: boolean;
  };
};

export type TrialEntryProjectSummary = {
  projectId: string;
  slug: string;
  title?: string;
  workflowState: WorkflowState;
  updatedAt: string;
  origin: ProjectOrigin;
  siteLanguage: string;
};

export type TrialEntryResult = {
  request: Pick<InitialProjectRequest, "requestId" | "projectId" | "submittedAt" | "checksum"> & { byteSize: number };
  project: { projectId: string; slug: string; projectVersion: number; siteLanguage: string };
  workflowState: WorkflowState;
  lead: { firstSemanticOwner: "lead"; analysisCompleted: true; clarificationQuestions: TrialEntryQuestion[] };
  brief?: { checksum: string; readyForApproval: boolean; blockingReasons: string[] };
};

type RefreshClarificationsResult = Pick<TrialEntryResult, "project" | "workflowState" | "lead">;

type TrialEntryDependencies = {
  database: PersistenceDatabase;
  createLeadAgent: (slug: string) => LeadAgentService;
  assets?: ProjectAssetService;
};

const questionView = (question: {
  id: string;
  requirementKey?: string;
  category: string;
  question: string;
  blocking: boolean;
  required: boolean;
  answerStatus: ClarificationAnswer["status"];
}): TrialEntryQuestion => ({
  id: question.id,
  ...(question.requirementKey ? { requirementKey: question.requirementKey } : {}),
  category: question.category,
  question: question.question,
  blocking: question.blocking,
  required: question.required,
  answerStatus: question.answerStatus,
});

const actionForState = (state: WorkflowState) => {
  switch (state) {
    case "DRAFT":
      return { pendingUserAction: "SUBMIT_TO_LEAD", nextAllowedActions: ["SUBMIT_TO_LEAD"] };
    case "CLARIFYING":
      return { pendingUserAction: "ANSWER_LEAD_CLARIFICATIONS", nextAllowedActions: ["ANSWER_LEAD_CLARIFICATIONS"] };
    case "AWAITING_BRIEF_APPROVAL":
      return { pendingUserAction: "APPROVE_BRIEF_OR_REQUEST_CHANGES", nextAllowedActions: ["APPROVE_BRIEF", "REQUEST_BRIEF_CHANGES"] };
    case "AWAITING_DESIGN_SELECTION":
      return { pendingUserAction: "APPROVE_PLANNING_AND_SELECT_DESIGN", nextAllowedActions: ["APPROVE_PLANNING", "REQUEST_PLANNING_CHANGES", "DATABASE_DECISION", "DEPENDENCY_APPROVAL", "DESIGN_SELECTION"] };
    case "READY_FOR_IMPLEMENTATION":
      return { pendingUserAction: "START_IMPLEMENTATION", nextAllowedActions: ["START_IMPLEMENTATION"] };
    default:
      return { pendingUserAction: "WAIT_FOR_CURRENT_WORKFLOW_OWNER", nextAllowedActions: [] };
  }
};

export class TrialEntryService {
  private readonly projects: ProjectRepository;
  private readonly clarifications: ClarificationRepository;
  private readonly documents: DocumentRepository;
  private readonly operations: OperationRepository;

  constructor(private readonly dependencies: TrialEntryDependencies) {
    this.projects = new ProjectRepository(dependencies.database);
    this.clarifications = new ClarificationRepository(dependencies.database);
    this.documents = new DocumentRepository(dependencies.database);
    this.operations = new OperationRepository(dependencies.database);
  }

  private async inputForProject(project: FactoryProject, idempotencyKey: string, operatorLanguage: OperatorLanguage = FACTORY_OPERATOR_LANGUAGE, languageResolution?: LanguageResolution): Promise<LeadAgentInput> {
    const resolvedLanguage = languageResolution ?? resolveLanguageAuthority({ prompt: project.originalPrompt, explicitOperatorLanguage: operatorLanguage, explicitSiteLanguage: project.siteLanguage, legacy: true });
    return {
      projectId: project.id,
      projectVersion: project.currentVersion,
      originalPrompt: project.originalPrompt,
      suppliedFiles: [],
      // Asset metadata is derived from the authoritative project-scoped service here;
      // the browser never supplies or selects Lead's available-assets context.
      availableAssets: this.dependencies.assets ? await this.dependencies.assets.listCurrentReadyReferences(project.id) : [],
      knownUserAnswers: {},
      currentWorkflowState: project.workflowState,
      idempotencyKey,
      // The current product default is operatorLanguage: FACTORY_OPERATOR_LANGUAGE;
      // an existing canonical clarification session may supply another locale.
      operatorLanguage,
      siteLanguage: project.siteLanguage,
      languageResolution: resolvedLanguage,
      projectSlug: project.slug,
      ...(project.title ? { projectTitle: project.title } : {}),
      origin: project.origin,
    };
  }

  async createProject(input: { requestText: string; languageHint?: string; operatorLanguage?: OperatorLanguage }) {
    const request = createInitialProjectRequest(input);
    const slug = `project-${request.projectId.slice(0, 8)}`;
    const lead = this.dependencies.createLeadAgent(slug);
    const languageResolution = resolveLanguageAuthority({
      prompt: request.requestText,
      ...(input.operatorLanguage ? { explicitOperatorLanguage: input.operatorLanguage } : {}),
      ...(normalizeSiteLanguage(input.languageHint) !== "UNRESOLVED" ? { explicitSiteLanguage: input.languageHint } : {}),
    });
    const leadInput = {
      projectId: request.projectId,
      projectVersion: 1,
      originalPrompt: request.requestText,
      suppliedFiles: [],
      availableAssets: [],
      knownUserAnswers: {},
      currentWorkflowState: "DRAFT" as const,
      idempotencyKey: `initial-request:${request.requestId}`,
      operatorLanguage: OperatorLanguageSchema.parse(languageResolution.operatorLanguage),
      siteLanguage: languageResolution.siteLanguage,
      languageResolution,
      projectSlug: slug,
    } satisfies LeadAgentInput;

    const project = await lead.startProjectIntake(leadInput);
    await lead.analyzeProjectPrompt(leadInput);
    await lead.planClarifications(leadInput);
    let current = await this.projects.getWithVersion(project.id);
    if (!current) throw new Error("TRIAL_ENTRY_PROJECT_NOT_FOUND_AFTER_INTAKE");
    const clarification = await lead.getClarificationStatus(
      project.id,
      project.currentVersion,
    );
    let brief: TrialEntryResult["brief"];
    if (!clarification.unresolved.length) {
      const draft = await lead.buildBriefDraft(project.id, project.currentVersion);
      brief = {
        checksum: draft.briefChecksum,
        readyForApproval: draft.readyForApproval,
        blockingReasons: draft.blockingReasons,
      };
      current = (await this.projects.getWithVersion(project.id)) ?? current;
    }
    return {
      request: {
        requestId: request.requestId,
        projectId: request.projectId,
        submittedAt: request.submittedAt,
        checksum: request.checksum,
        byteSize: Buffer.byteLength(request.requestText, "utf8"),
      },
      project: {
        projectId: current.project.id,
        slug: current.project.slug,
        projectVersion: current.project.currentVersion,
        siteLanguage: current.project.siteLanguage,
      },
      workflowState: current.project.workflowState,
      lead: {
        firstSemanticOwner: "lead",
        analysisCompleted: true,
        clarificationQuestions: clarification.session.questions.map(questionView),
      },
      ...(brief ? { brief } : {}),
    } satisfies TrialEntryResult;
  }

  async respond(projectId: string, answers: TrialEntryAnswer[]) {
    const current = await this.projects.getWithVersion(projectId);
    if (!current) throw new Error("TRIAL_ENTRY_PROJECT_NOT_FOUND");
    if (current.project.workflowState !== "CLARIFYING")
      throw new Error("TRIAL_ENTRY_NOT_AWAITING_CLARIFICATION");
    const session = await this.clarifications.getSession(projectId, current.project.currentVersion);
    if (!session) throw new Error("TRIAL_ENTRY_CLARIFICATION_NOT_FOUND");
    const lead = this.dependencies.createLeadAgent(current.project.slug);
    const leadInput = await this.inputForProject(current.project, `clarification-resume:${projectId}`, session.operatorLanguage ?? FACTORY_OPERATOR_LANGUAGE, session.languageResolution);
    await lead.analyzeProjectPrompt(leadInput);
    await lead.planClarifications(leadInput);
    const knownQuestions = new Set(session.questions.map((question) => question.id));
    if (!answers.length) throw new Error("TRIAL_ENTRY_ANSWERS_EMPTY");
    for (const answer of answers) {
      if (!knownQuestions.has(answer.questionId))
        throw new Error("TRIAL_ENTRY_QUESTION_NOT_FOUND");
      const status = answer.status ?? "answered";
      await lead.recordClarificationAnswer({
        projectId,
        projectVersion: current.project.currentVersion,
        questionId: answer.questionId,
        status,
        ...(answer.answer === undefined ? {} : { answer: answer.answer }),
        answeredBy: "user",
        idempotencyKey: `clarification-answer:${projectId}:${answer.questionId}:${checksumPersistedDocument({ status, answer: answer.answer ?? "" })}`,
      });
    }
    const clarification = await lead.getClarificationStatus(
      projectId,
      current.project.currentVersion,
    );
    let brief: TrialEntryResult["brief"];
    if (!clarification.unresolved.length) {
      const draft = await lead.buildBriefDraft(projectId, current.project.currentVersion);
      brief = {
        checksum: draft.briefChecksum,
        readyForApproval: draft.readyForApproval,
        blockingReasons: draft.blockingReasons,
      };
    }
    const updated = (await this.projects.getWithVersion(projectId)) ?? current;
    return {
      project: {
        projectId: updated.project.id,
        slug: updated.project.slug,
        projectVersion: updated.project.currentVersion,
        siteLanguage: updated.project.siteLanguage,
      },
      workflowState: updated.project.workflowState,
      lead: {
        firstSemanticOwner: "lead",
        analysisCompleted: true,
        clarificationQuestions: clarification.session.questions.map(questionView),
      },
      ...(brief ? { brief } : {}),
    };
  }

  async status(projectId: string): Promise<TrialEntryStatus> {
    const current = await this.projects.getWithVersion(projectId);
    if (!current) throw new Error("TRIAL_ENTRY_PROJECT_NOT_FOUND");
    const actions = actionForState(current.project.workflowState);
    const session = await this.clarifications.getSession(
      projectId,
      current.project.currentVersion,
    );
    const clarification = session
      ? {
          questions: session.questions.map(questionView),
          unresolvedQuestionIds: session.questions
            .filter((question) => question.answerStatus === "unresolved")
            .map((question) => question.id),
          blockingUnresolvedQuestionIds: session.questions
            .filter((question) => question.blocking && question.answerStatus === "unresolved")
            .map((question) => question.id),
          ...(session.operatorLanguage ? { operatorLanguage: session.operatorLanguage } : {}),
          ...(session.clarificationVersion ? { clarificationVersion: session.clarificationVersion } : {}),
        }
      : undefined;
    const requirements = await this.documents.get(
      projectId,
      current.project.currentVersion,
      "requirements",
    );
    const blockingReasons = [
      ...(clarification?.blockingUnresolvedQuestionIds.map((id) => `CLARIFICATION_REQUIRED:${id}`) ?? []),
      ...(requirements?.documentType === "requirements"
        ? requirements.unresolvedItems.filter((item) => item.blocking).map((item) => `REQUIREMENT_UNRESOLVED:${item.id}`)
        : []),
    ];
    return {
      projectId: current.project.id,
      slug: current.project.slug,
      projectVersion: current.project.currentVersion,
      workflowState: current.project.workflowState,
      rowVersion: current.rowVersion,
      pendingUserAction: actions.pendingUserAction,
      blockingReasons,
      nextAllowedActions: actions.nextAllowedActions,
      operatorLanguage: session?.operatorLanguage ?? FACTORY_OPERATOR_LANGUAGE,
      siteLanguage: current.project.siteLanguage,
      ...(clarification ? { clarification } : {}),
      ...(requirements?.documentType === "requirements"
        ? {
            brief: {
              checksum: requirements.approval.approvedRequirementsChecksum ?? checksumPersistedDocument(requirements),
              readyForApproval: requirements.briefStatus === "draft" && !requirements.unresolvedItems.some((item) => item.blocking),
              approved: requirements.approval.approved,
            },
          }
        : {}),
    };
  }

  async listProjects(): Promise<TrialEntryProjectSummary[]> {
    const projects = await this.projects.list();
    return projects.map((project) => ({
      projectId: project.id,
      slug: project.slug,
      ...(project.title ? { title: project.title } : {}),
      workflowState: project.workflowState,
      updatedAt: project.updatedAt,
      origin: project.origin,
      siteLanguage: project.siteLanguage,
    }));
  }

  async refreshClarifications(projectId: string, requestId: string = randomUUID()): Promise<RefreshClarificationsResult> {
    const current = await this.projects.getWithVersion(projectId);
    if (!current) throw new Error("TRIAL_ENTRY_PROJECT_NOT_FOUND");
    if (current.project.workflowState !== "CLARIFYING") throw new Error("TRIAL_ENTRY_NOT_AWAITING_CLARIFICATION");
    const session = await this.clarifications.getSession(projectId, current.project.currentVersion);
    if (!session) throw new Error("TRIAL_ENTRY_CLARIFICATION_NOT_FOUND");
    if (session.answers.some((answer) => answer.status !== "unresolved")) throw new Error("TRIAL_ENTRY_CLARIFICATION_REFRESH_NOT_ALLOWED");
    const operation = "trial-entry:refresh-clarifications";
    const operationKey = `${projectId}:${requestId}`;
    const payload = { action: "refresh-clarifications", projectId, projectVersion: current.project.currentVersion };
    const reservation = await this.operations.reserve(operation, operationKey, payload);
    if (reservation.status === "IN_PROGRESS") throw new LeadError("IDEMPOTENCY_CONFLICT", "The clarification refresh is already in progress.");
    if (reservation.status === "SUCCEEDED") return reservation.result as RefreshClarificationsResult;

    let result: RefreshClarificationsResult;
    try {
      const lead = this.dependencies.createLeadAgent(current.project.slug);
      const refreshed = await lead.refreshClarifications(await this.inputForProject(current.project, `clarification-refresh:${operationKey}`, session.operatorLanguage ?? FACTORY_OPERATOR_LANGUAGE, session.languageResolution));
      result = {
        project: { projectId: current.project.id, slug: current.project.slug, projectVersion: current.project.currentVersion, siteLanguage: current.project.siteLanguage },
        workflowState: current.project.workflowState,
        lead: { firstSemanticOwner: "lead" as const, analysisCompleted: true as const, clarificationQuestions: refreshed.questions.map(questionView) },
      };
    } catch (error) {
      await this.operations.fail(operation, operationKey, payload).catch(() => undefined);
      throw error;
    }
    await this.operations.complete(operation, operationKey, payload, result);
    return result;
  }

  /** Rehydrates Lead's typed draft from durable requirements before approval. */
  async approveBrief(input: { projectId: string; briefChecksum: string; expectedRowVersion: number; approvalNote?: string; approvedBy?: string }) {
    const current = await this.projects.getWithVersion(input.projectId);
    if (!current) throw new Error("TRIAL_ENTRY_PROJECT_NOT_FOUND");
    if (current.project.workflowState !== "AWAITING_BRIEF_APPROVAL") throw new Error("TRIAL_ENTRY_NOT_AWAITING_BRIEF_APPROVAL");
    const lead = this.dependencies.createLeadAgent(current.project.slug);
    const session = await this.clarifications.getSession(input.projectId, current.project.currentVersion);
    const leadInput = await this.inputForProject(current.project, `brief-approval:${input.projectId}:${input.briefChecksum}`, session?.operatorLanguage ?? FACTORY_OPERATOR_LANGUAGE, session?.languageResolution);
    await lead.analyzeProjectPrompt(leadInput);
    await lead.planClarifications(leadInput);
    const clarification = await lead.getClarificationStatus(input.projectId, current.project.currentVersion);
    if (clarification.unresolved.length) throw new Error("TRIAL_ENTRY_CLARIFICATIONS_REMAIN");
    const draft = await lead.buildBriefDraft(input.projectId, current.project.currentVersion);
    const result = await lead.approveBrief({
      projectId: input.projectId,
      projectVersion: current.project.currentVersion,
      briefChecksum: input.briefChecksum,
      approvedAt: new Date().toISOString(),
      approvedBy: input.approvedBy ?? "workbench-user",
      ...(input.approvalNote ? { approvalNote: input.approvalNote } : {}),
      expectedRowVersion: input.expectedRowVersion,
      idempotencyKey: `workbench-approve-brief:${input.projectId}:${input.briefChecksum}`,
    });
    return { projectId: input.projectId, workflowState: result.projectState, rowVersion: result.rowVersion, briefChecksum: draft.briefChecksum };
  }

  async requestBriefChanges(input: { projectId: string; reason: string; requirementKeys?: string[]; requestedBy?: string }) {
    const current = await this.projects.getWithVersion(input.projectId);
    if (!current) throw new Error("TRIAL_ENTRY_PROJECT_NOT_FOUND");
    const lead = this.dependencies.createLeadAgent(current.project.slug);
    const result = await lead.requestBriefRevision({
      projectId: input.projectId,
      projectVersion: current.project.currentVersion,
      requirementKeys: input.requirementKeys ?? ["project-brief"],
      reason: input.reason,
      requestedBy: input.requestedBy ?? "workbench-user",
      idempotencyKey: `workbench-request-brief-changes:${input.projectId}:${checksumPersistedDocument(input.reason)}`,
    });
    return { projectId: input.projectId, workflowState: "CLARIFYING" as const, requirementsChecksum: checksumPersistedDocument(result) };
  }
}
