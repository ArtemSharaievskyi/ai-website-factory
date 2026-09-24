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
import { PersistenceError } from "@/persistence/database/errors";
import { FACTORY_OPERATOR_LANGUAGE, normalizeSiteLanguage, OperatorLanguageSchema, resolveLanguageAuthority, type LanguageResolution, type OperatorLanguage } from "@/domain/language/schema";
import type { ProjectOrigin } from "@/domain/project/provenance";
import {
  createInitialProjectRequest,
  type InitialProjectRequest,
} from "@/domain/project/initial-request";
import type { ProjectAssetService } from "@/runtime/assets/service";
import {
  clarificationAnswerOperationKey,
  ANSWER_CLARIFICATIONS_OPERATION,
  type ClarificationAnswerRequest,
} from "./clarification-idempotency";
import { normalizeCanonicalUserInputText } from "@/domain/project/canonical-input";
import { briefApprovalBlockers } from "@/domain/requirements/brief-validation";
import { canonicalBriefChecksumForDocument } from "@/persistence/database/brief-revision-v3-contracts";
import { mapRowToDocument } from "@/persistence/database/mapping";
import { migrateLegacyBriefToCanonicalBriefV3 } from "@/domain/requirements/v3/migrate";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { createBriefV3OperationIdentity, createRevisionCurrentnessToken, RevisionCurrentnessTokenSchema, type RevisionCurrentnessToken } from "@/runtime/brief-revision-v3/identity";
import type { BriefV3TransactionService } from "@/runtime/brief-revision-v3/service";
import { BriefV3TransactionError } from "@/runtime/brief-revision-v3/errors";
import type { BriefV3AssetBinding } from "@/runtime/brief-revision-v3/ports";
import { deterministicBriefCorrectionInstruction, type BriefConsistencyCorrectionInput } from "@/domain/requirements/v3/consistency";
import { currentWorkbenchOperationContext } from "@/runtime/workbench/operation-context";
import { currentRuntimeProvenance } from "@/runtime/workbench/observability";
import { evaluateBriefReadiness, type BriefReadinessApprovalBlocker } from "@/domain/requirements/v3/readiness";
import { BriefApprovalService } from "./brief-approval";

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
  createBriefRevisionV3?: (slug: string) => BriefV3TransactionService;
  createBriefApproval?: (slug: string) => BriefApprovalService;
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

const readinessBlockerReason = (blocker: BriefReadinessApprovalBlocker): string => {
  switch (blocker.code) {
    case "CANONICAL_CONTRADICTION": return `BRIEF_V3_CONTRADICTION:${blocker.invariant}`;
    case "UNRESOLVED_CANONICAL_DECISION": return `BRIEF_V3_UNRESOLVED:${blocker.target}`;
    case "UNRESOLVED_CANONICAL_REQUIREMENT": return `BRIEF_V3_UNRESOLVED:${blocker.target}`;
    case "UNANSWERED_CLARIFICATION": return `CLARIFICATION_REQUIRED:${blocker.id}`;
  }
};

const actionForState = (state: WorkflowState, hasDesigns = false) => {
  switch (state) {
    case "DRAFT":
      return { pendingUserAction: "SUBMIT_TO_LEAD", nextAllowedActions: ["SUBMIT_TO_LEAD"] };
    case "CLARIFYING":
      return { pendingUserAction: "ANSWER_LEAD_CLARIFICATIONS", nextAllowedActions: ["ANSWER_LEAD_CLARIFICATIONS"] };
    case "AWAITING_BRIEF_APPROVAL":
      return { pendingUserAction: "APPROVE_BRIEF_OR_REQUEST_CHANGES", nextAllowedActions: ["APPROVE_BRIEF", "REQUEST_BRIEF_CHANGES"] };
    case "AWAITING_PLANNING_GENERATION":
      return { pendingUserAction: "GENERATE_PLANNING", nextAllowedActions: ["GENERATE_PLANNING", "REQUEST_BRIEF_CHANGES"] };
    case "AWAITING_PLANNING_APPROVAL":
      return { pendingUserAction: "APPROVE_PLANNING", nextAllowedActions: ["APPROVE_PLANNING", "REQUEST_BRIEF_CHANGES", "REQUEST_PLANNING_CHANGES", "DATABASE_DECISION", "DEPENDENCY_APPROVAL"] };
    case "AWAITING_DESIGN_SELECTION":
      return hasDesigns
        ? { pendingUserAction: "DESIGN_SELECTION", nextAllowedActions: ["REQUEST_PLANNING_CHANGES", "DATABASE_DECISION", "DEPENDENCY_APPROVAL", "DESIGN_SELECTION"] }
        : { pendingUserAction: "GENERATE_DESIGN", nextAllowedActions: ["GENERATE_DESIGN", "REQUEST_PLANNING_CHANGES", "DATABASE_DECISION", "DEPENDENCY_APPROVAL"] };
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
    if (!answers.length) throw new Error("TRIAL_ENTRY_ANSWERS_EMPTY");
    const operationIdentity = clarificationAnswerOperationKey({
      projectId,
      projectVersion: (await this.projects.getWithVersion(projectId))?.project.currentVersion ?? 1,
      answers,
    });
    const operationPayload = {
      ...operationIdentity.payload,
      roundFingerprint: operationIdentity.fingerprint,
    };
    let reservation;
    try {
      reservation = await this.operations.reserve(
        ANSWER_CLARIFICATIONS_OPERATION,
        operationIdentity.key,
        operationPayload,
      );
    } catch (error) {
      if (error instanceof PersistenceError && error.code === "IDEMPOTENCY_CONFLICT") {
        const latest = await this.currentClarificationSession(projectId);
        this.assertCurrentAnswerRound(latest.projectVersion, latest.session, answers);
      }
      throw error;
    }
    if (reservation.status === "IN_PROGRESS")
      throw new LeadError("IDEMPOTENCY_CONFLICT", "The clarification answer round is already in progress.");
    if (reservation.status === "SUCCEEDED") return reservation.result as TrialEntryResult;

    try {
      const current = await this.projects.getWithVersion(projectId);
      if (!current) throw new Error("TRIAL_ENTRY_PROJECT_NOT_FOUND");
      if (current.project.workflowState !== "CLARIFYING")
        throw new Error("TRIAL_ENTRY_NOT_AWAITING_CLARIFICATION");
      const session = await this.clarifications.getSession(projectId, current.project.currentVersion);
      if (!session) throw new Error("TRIAL_ENTRY_CLARIFICATION_NOT_FOUND");
      this.assertCurrentAnswerRound(current.project.currentVersion, session, answers);
      const lead = this.dependencies.createLeadAgent(current.project.slug);
      const leadInput = await this.inputForProject(
        current.project,
        `clarification-resume:v2:${operationIdentity.key}`,
        session.operatorLanguage ?? FACTORY_OPERATOR_LANGUAGE,
        session.languageResolution,
      );
      const clarificationSession = await lead.continueClarificationRound({
        ...leadInput,
        answers: answers.map((answer) => ({
          questionId: answer.questionId,
          status: answer.status ?? "answered",
          ...(answer.answer === undefined ? {} : { answer: answer.answer }),
        })),
      });
      const clarification = {
        session: clarificationSession,
        unresolved: clarificationSession.questions.filter((question) => question.answerStatus === "unresolved"),
      };
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
      const result = {
        project: {
          projectId: updated.project.id,
          slug: updated.project.slug,
          projectVersion: updated.project.currentVersion,
          siteLanguage: updated.project.siteLanguage,
        },
        workflowState: updated.project.workflowState,
        lead: {
          firstSemanticOwner: "lead" as const,
          analysisCompleted: true as const,
          clarificationQuestions: clarification.session.questions.map(questionView),
        },
        ...(brief ? { brief } : {}),
      } satisfies Omit<TrialEntryResult, "request">;
      await this.operations.complete(
        ANSWER_CLARIFICATIONS_OPERATION,
        operationIdentity.key,
        operationPayload,
        result,
      );
      return result;
    } catch (error) {
      await this.operations.fail(
        ANSWER_CLARIFICATIONS_OPERATION,
        operationIdentity.key,
        operationPayload,
      ).catch(() => undefined);
      throw error;
    }
  }

  private async currentClarificationSession(projectId: string) {
    const current = await this.projects.getWithVersion(projectId);
    if (!current) throw new Error("TRIAL_ENTRY_PROJECT_NOT_FOUND");
    const session = await this.clarifications.getSession(projectId, current.project.currentVersion);
    if (!session) throw new Error("TRIAL_ENTRY_CLARIFICATION_NOT_FOUND");
    return { projectVersion: current.project.currentVersion, session };
  }

  private assertCurrentAnswerRound(projectVersion: number, session: Awaited<ReturnType<ClarificationRepository["getSession"]>>, answers: readonly ClarificationAnswerRequest[]) {
    if (!session || session.projectVersion !== projectVersion) throw new Error("TRIAL_ENTRY_CLARIFICATION_NOT_FOUND");
    const questions = new Map(session.questions.map((question) => [question.id, question]));
    for (const answer of answers) {
      const question = questions.get(answer.questionId);
      if (!question) throw new Error("TRIAL_ENTRY_QUESTION_NOT_FOUND");
      if (question.answerStatus !== "unresolved") throw new LeadError("CLARIFICATION_ALREADY_RESOLVED", "The clarification question is no longer current.");
      if (question.blocking && (answer.status ?? "answered") === "deferred") throw new LeadError("BLOCKING_CLARIFICATIONS_REMAIN", "Blocking clarification questions cannot be intentionally deferred.");
    }
  }

  async status(projectId: string): Promise<TrialEntryStatus> {
    const current = await this.projects.getWithVersion(projectId);
    if (!current) throw new Error("TRIAL_ENTRY_PROJECT_NOT_FOUND");
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
    const briefV3 = await this.documents.get(
      projectId,
      current.project.currentVersion,
      "brief-v3",
    );
    const directions = await this.documents.get(
      projectId,
      current.project.currentVersion,
      "design-directions",
    );
    const actions = actionForState(current.project.workflowState, directions?.documentType === "design-directions");
    const legacyBriefV3 = !briefV3 && requirements?.documentType === "requirements"
      ? (() => {
          try { return migrateLegacyBriefToCanonicalBriefV3(requirements); } catch { return undefined; }
        })()
      : undefined;
    const readinessBrief = briefV3?.documentType === "brief-v3" ? briefV3.brief : legacyBriefV3;
    const briefV3Readiness = briefV3?.documentType === "brief-v3"
      ? evaluateBriefReadiness({ brief: briefV3.brief, clarificationSession: session ? { questions: session.questions } : undefined })
      : legacyBriefV3
        ? evaluateBriefReadiness({ brief: legacyBriefV3, clarificationSession: session ? { questions: session.questions } : undefined })
        : undefined;
    const blockingReasons = [
      ...(briefV3Readiness ? briefV3Readiness.approvalBlockers.map((blocker) => readinessBlockerReason(blocker)) : clarification?.blockingUnresolvedQuestionIds.map((id) => `CLARIFICATION_REQUIRED:${id}`) ?? []),
      ...(readinessBrief
        ? []
        : requirements?.documentType === "requirements"
          ? [...requirements.unresolvedItems.filter((item) => item.blocking).map((item) => `REQUIREMENT_UNRESOLVED:${item.id}`), ...briefApprovalBlockers(requirements)]
          : []),
    ];
    const approvalLifecycle = current.project.workflowState === "CLARIFYING" || current.project.workflowState === "AWAITING_BRIEF_APPROVAL";
    const statusActions = readinessBrief && approvalLifecycle && briefV3Readiness?.readyForApproval === true && blockingReasons.length === 0
      ? ["APPROVE_BRIEF", "REQUEST_BRIEF_CHANGES"]
      : readinessBrief && approvalLifecycle
        ? []
        : actions.nextAllowedActions;
    return {
      projectId: current.project.id,
      slug: current.project.slug,
      projectVersion: current.project.currentVersion,
      workflowState: current.project.workflowState,
      rowVersion: current.rowVersion,
      pendingUserAction: actions.pendingUserAction,
      blockingReasons,
      nextAllowedActions: statusActions,
      operatorLanguage: session?.operatorLanguage ?? FACTORY_OPERATOR_LANGUAGE,
      siteLanguage: current.project.siteLanguage,
      ...(clarification ? { clarification } : {}),
      ...(briefV3?.documentType === "brief-v3"
        ? {
            brief: {
              checksum: briefV3.briefChecksum,
              readyForApproval: briefV3Readiness?.readyForApproval ?? false,
              approved: briefV3.approval?.approved === true && briefV3.approval.approvedCanonicalChecksum === briefV3.briefChecksum,
            },
          }
        : requirements?.documentType === "requirements"
        ? {
            brief: {
              checksum: legacyBriefV3 ? canonicalBriefChecksum(legacyBriefV3) : checksumPersistedDocument(requirements),
              readyForApproval: briefV3Readiness?.readyForApproval ?? false,
              approved: false,
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

  /** Routes current V3 approval to the host-owned readiness/currentness authority. */
  async resumeBriefV3(input: { projectId: string; expectedRowVersion: number }) {
    const current = await this.projects.getWithVersion(input.projectId);
    if (!current) throw new Error("TRIAL_ENTRY_PROJECT_NOT_FOUND");
    const approval = this.dependencies.createBriefApproval?.(current.project.slug) ?? new BriefApprovalService({ database: this.dependencies.database });
    return approval.admitCurrentBrief({
      projectId: input.projectId,
      projectVersion: current.project.currentVersion,
      expectedRowVersion: input.expectedRowVersion,
    });
  }

  async approveBrief(input: { projectId: string; briefChecksum: string; expectedRowVersion: number; approvalNote?: string; approvedBy?: string }) {
    const current = await this.projects.getWithVersion(input.projectId);
    if (!current) throw new Error("TRIAL_ENTRY_PROJECT_NOT_FOUND");
    const approval = this.dependencies.createBriefApproval?.(current.project.slug) ?? new BriefApprovalService({ database: this.dependencies.database });
    const result = await approval.approve({
      projectId: input.projectId,
      projectVersion: current.project.currentVersion,
      briefChecksum: input.briefChecksum,
      approvedBy: input.approvedBy ?? "workbench-user",
      ...(input.approvalNote ? { approvalNote: input.approvalNote } : {}),
      expectedRowVersion: input.expectedRowVersion,
      idempotencyKey: `workbench-approve-brief:${input.projectId}:${input.briefChecksum}`,
    });
    return { projectId: input.projectId, workflowState: result.projectState, rowVersion: result.rowVersion, briefChecksum: result.briefChecksum };
  }

  private revisionTargetState(state: WorkflowState): WorkflowState {
    if (state === "AWAITING_BRIEF_APPROVAL") return "CLARIFYING";
    if (state === "AWAITING_PLANNING_GENERATION" || state === "AWAITING_PLANNING_APPROVAL") return "AWAITING_BRIEF_APPROVAL";
    if (state === "AWAITING_DESIGN_SELECTION") return "AWAITING_BRIEF_APPROVAL";
    throw new LeadError("BRIEF_REVISION_REQUIRED", "Brief revision is only available before implementation.");
  }

  /**
   * Adapts the public Workbench currentness DTO to the V3 token without
   * creating a second mutation or idempotency authority. A committed replay
   * may arrive with the pre-commit row version, so recover its exact token
   * from the durable V3 attempt before reading the now-current document.
   */
  private async briefRevisionCurrentness(input: { projectId: string; projectVersion: number; briefChecksum: string; expectedRowVersion: number; reason: string; requirementKeys: readonly string[]; assetBindings?: readonly BriefV3AssetBinding[]; targetWorkflowState?: WorkflowState }): Promise<RevisionCurrentnessToken> {
    const snapshot = await this.dependencies.database.transaction(async (tx) => ({
      project: await tx.getProject(input.projectId),
      version: await tx.getVersion(input.projectId, input.projectVersion),
      v3: await tx.getDocument(input.projectId, input.projectVersion, "brief-v3"),
      legacy: await tx.getDocument(input.projectId, input.projectVersion, "requirements"),
      attempts: await tx.listBriefRevisionAttempts(input.projectId, input.projectVersion),
    }));
    if (!snapshot.project || !snapshot.version || snapshot.project.current_version !== input.projectVersion) throw new Error("TRIAL_ENTRY_PROJECT_NOT_FOUND");
    const targetFor = (workflowState: WorkflowState) => this.revisionTargetState(workflowState);
    for (const attempt of snapshot.attempts) {
      const currentness = RevisionCurrentnessTokenSchema.safeParse(attempt.currentnessToken);
      if (!currentness.success || currentness.data.projectRowVersion !== input.expectedRowVersion) continue;
      if (input.briefChecksum !== currentness.data.briefChecksum && input.briefChecksum !== currentness.data.documentChecksum) continue;
      const identity = createBriefV3OperationIdentity({ projectId: input.projectId, projectVersion: input.projectVersion, revisionInstruction: input.reason, targetHints: input.requirementKeys, targetWorkflowState: input.targetWorkflowState ?? targetFor(currentness.data.workflowState), currentness: currentness.data, assetBindings: input.assetBindings });
      if (attempt.operationKey === identity.operationKey && attempt.payloadHash === identity.payloadHash) return currentness.data;
    }
    const v3Document = snapshot.v3 ? mapRowToDocument(snapshot.v3) : null;
    const legacyDocument = snapshot.legacy ? mapRowToDocument(snapshot.legacy) : null;
    const selected = v3Document && (input.briefChecksum === canonicalBriefChecksumForDocument(v3Document) || input.briefChecksum === snapshot.v3?.checksum)
      ? { document: v3Document, row: snapshot.v3 }
      : legacyDocument && (input.briefChecksum === snapshot.legacy?.checksum || input.briefChecksum === canonicalBriefChecksumForDocument(legacyDocument))
        ? { document: legacyDocument, row: snapshot.legacy }
        : null;
    if (!selected || !selected.row) throw new LeadError("BRIEF_CHECKSUM_MISMATCH", "The Project Brief changed before this revision was processed.");
    return createRevisionCurrentnessToken({
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      projectRowVersion: input.expectedRowVersion,
      projectVersionRowVersion: Number(snapshot.version.rowVersion),
      workflowState: snapshot.project.workflow_state,
      documentType: selected.row.documentType,
      briefChecksum: canonicalBriefChecksumForDocument(selected.document),
      documentChecksum: selected.row.checksum,
      documentRowVersion: Number(selected.row.rowVersion),
    });
  }

  async requestBriefChanges(input: { projectId: string; projectVersion: number; briefChecksum: string; expectedRowVersion: number; reason: string; requirementKeys?: string[]; assetBindings?: readonly BriefV3AssetBinding[]; correction?: BriefConsistencyCorrectionInput; requestedBy?: string }) {
    const project = await this.projects.getWithVersion(input.projectId);
    if (!project) throw new Error("TRIAL_ENTRY_PROJECT_NOT_FOUND");
    const reason = normalizeCanonicalUserInputText(input.reason, "BRIEF_REVISION_TOO_LARGE");
    const requirementKeys = input.requirementKeys ?? ["project-brief"];
    const correction = input.correction;
    if (correction && project.project.workflowState !== "AWAITING_BRIEF_APPROVAL") throw new LeadError("BRIEF_REVISION_REQUIRED", "Deterministic Brief consistency correction is only available at the Brief approval frontier.");
    const correctionBindings = correction && "assetBinding" in correction ? [correction.assetBinding] : [];
    const assetBindings = input.assetBindings ?? correctionBindings;
    if (correction && "assetBinding" in correction && (assetBindings.length !== 1 || assetBindings[0]?.assetId !== correction.assetBinding.assetId || assetBindings[0]?.sha256 !== correction.assetBinding.sha256)) throw new LeadError("BRIEF_REVISION_REQUIRED", "The deterministic Brief correction asset binding is inconsistent.");
    if (correction && !("assetBinding" in correction) && assetBindings.length) throw new LeadError("BRIEF_REVISION_REQUIRED", "A public email correction cannot carry unrelated asset bindings.");
    const revisionInstruction = correction ? deterministicBriefCorrectionInstruction(correction) : reason;
    const targetWorkflowState = correction ? "AWAITING_BRIEF_APPROVAL" as const : undefined;
    const expectedCurrentness = await this.briefRevisionCurrentness({ ...input, reason: revisionInstruction, requirementKeys, assetBindings, targetWorkflowState });
    const supportingContext = assetBindings.length
      ? await (this.dependencies.assets ? this.dependencies.assets.validateBriefRevisionBindings(input.projectId, input.projectVersion, assetBindings) : Promise.reject(new Error("ASSET_BINDING_SERVICE_UNAVAILABLE")))
      : undefined;
    const revisionService = this.dependencies.createBriefRevisionV3?.(project.project.slug);
    if (!revisionService) throw new Error("TRIAL_ENTRY_BRIEF_REVISION_V3_UNAVAILABLE");
    const operationIdentity = createBriefV3OperationIdentity({ projectId: input.projectId, projectVersion: input.projectVersion, revisionInstruction, targetHints: requirementKeys, targetWorkflowState: targetWorkflowState ?? this.revisionTargetState(expectedCurrentness.workflowState), currentness: expectedCurrentness, assetBindings });
    const context = currentWorkbenchOperationContext();
    try {
      const result = await revisionService.execute({
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      revisionInstruction,
      expectedCurrentness,
      targetHints: requirementKeys,
      targetWorkflowState: targetWorkflowState ?? this.revisionTargetState(expectedCurrentness.workflowState),
      actor: input.requestedBy ?? "workbench-user",
      supportingContext,
      assetBindings,
      ...(correction ? { deterministicCorrection: correction } : {}),
      });
      if (context?.responseSink) context.responseSink.metadata = { schemaVersion: 1, responseOrigin: result.outcome === "COMMITTED_REPLAY" ? "REPLAY" : "NEW_EXECUTION", attemptCreated: true, operationId: operationIdentity.operationKey, attemptId: result.attemptId, correlationId: context.correlationId, semanticIntentHash: operationIdentity.payloadHash, attemptStatus: "SUCCEEDED", runtimeProvenance: context.runtimeProvenance ?? currentRuntimeProvenance() };
      return { projectId: result.projectId, workflowState: result.workflowState, requirementsChecksum: result.currentBriefChecksum } satisfies { projectId: string; workflowState: WorkflowState; requirementsChecksum: string };
    } catch (error) {
      if (context?.responseSink && error instanceof BriefV3TransactionError && typeof error.details.attemptId === "string") context.responseSink.metadata = { schemaVersion: 1, responseOrigin: "NEW_EXECUTION", attemptCreated: true, operationId: operationIdentity.operationKey, attemptId: error.details.attemptId, correlationId: context.correlationId, semanticIntentHash: operationIdentity.payloadHash, attemptStatus: "FAILED", runtimeProvenance: context.runtimeProvenance ?? currentRuntimeProvenance() };
      throw error;
    }
  }
}
