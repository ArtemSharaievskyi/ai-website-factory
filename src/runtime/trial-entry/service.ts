import { checksumPersistedDocument } from "@/persistence/database/serialization";
import {
  ClarificationRepository,
  DocumentRepository,
  ProjectRepository,
} from "@/persistence/database/repositories";
import type { PersistenceDatabase } from "@/persistence/database/types";
import type { ClarificationAnswer } from "@/domain/requirements/schema";
import type { WorkflowState } from "@/domain/workflow/engine";
import type { FactoryProject } from "@/domain/project/schema";
import type { LeadAgentService } from "@/agents/lead/service";
import type { LeadAgentInput } from "@/agents/lead/contracts";
import {
  createInitialProjectRequest,
  type InitialProjectRequest,
} from "@/domain/project/initial-request";

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
  clarification?: {
    questions: TrialEntryQuestion[];
    unresolvedQuestionIds: string[];
    blockingUnresolvedQuestionIds: string[];
  };
  brief?: {
    checksum: string;
    readyForApproval: boolean;
    approved: boolean;
  };
};

export type TrialEntryResult = {
  request: Pick<InitialProjectRequest, "requestId" | "projectId" | "submittedAt" | "checksum"> & { byteSize: number };
  project: { projectId: string; slug: string; projectVersion: number };
  workflowState: WorkflowState;
  lead: { firstSemanticOwner: "lead"; analysisCompleted: true; clarificationQuestions: TrialEntryQuestion[] };
  brief?: { checksum: string; readyForApproval: boolean; blockingReasons: string[] };
};

type TrialEntryDependencies = {
  database: PersistenceDatabase;
  createLeadAgent: (slug: string) => LeadAgentService;
};

const inputForProject = (
  project: FactoryProject,
  idempotencyKey: string,
): LeadAgentInput => ({
  projectId: project.id,
  projectVersion: project.currentVersion,
  originalPrompt: project.originalPrompt,
  suppliedFiles: [],
  knownUserAnswers: {},
  currentWorkflowState: project.workflowState,
  idempotencyKey,
  projectSlug: project.slug,
  ...(project.title ? { projectTitle: project.title } : {}),
});

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

  constructor(private readonly dependencies: TrialEntryDependencies) {
    this.projects = new ProjectRepository(dependencies.database);
    this.clarifications = new ClarificationRepository(dependencies.database);
    this.documents = new DocumentRepository(dependencies.database);
  }

  async createProject(input: { requestText: string; languageHint?: string }) {
    const request = createInitialProjectRequest(input);
    const slug = `project-${request.projectId.slice(0, 8)}`;
    const lead = this.dependencies.createLeadAgent(slug);
    const leadInput = {
      projectId: request.projectId,
      projectVersion: 1,
      originalPrompt: request.requestText,
      suppliedFiles: [],
      knownUserAnswers: {},
      currentWorkflowState: "DRAFT" as const,
      idempotencyKey: `initial-request:${request.requestId}`,
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
    const lead = this.dependencies.createLeadAgent(current.project.slug);
    const leadInput = inputForProject(current.project, `clarification-resume:${projectId}`);
    await lead.analyzeProjectPrompt(leadInput);
    await lead.planClarifications(leadInput);
    const session = await this.clarifications.getSession(
      projectId,
      current.project.currentVersion,
    );
    if (!session) throw new Error("TRIAL_ENTRY_CLARIFICATION_NOT_FOUND");
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
}
