import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { FactoryProjectSchema } from "@/domain/project/schema";
import {
  ClarificationSessionSchema,
  type ClarificationAnswer,
  type ClarificationQuestion,
  type ClarificationSession,
  RequirementSpecificationSchema,
} from "@/domain/requirements/schema";
import { DecisionRecordSchema } from "@/domain/workflow/decision";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import {
  ProjectRepository,
  ProjectVersionRepository,
  ClarificationRepository,
  DocumentRepository,
  DecisionRepository,
  WorkflowPersistenceService,
} from "@/persistence/database/repositories";
import type {
  PersistenceDatabase,
  ProjectVersionRow,
} from "@/persistence/database/types";
import { LeadError } from "./errors";
import {
  analyzePromptDeterministically,
  assembleRequirements,
  planClarificationsDeterministically,
} from "./deterministic";
import {
  BriefApprovalRequestSchema,
  BriefDraftSchema,
  ClarificationPlanSchema,
  LeadAgentAnalysisSchema,
  LeadAgentInputSchema,
  type BriefApprovalRequest,
  type BriefDraft,
  type LeadAgentAnalysis,
  type LeadAgentInput,
  type ClarificationPlan,
} from "./contracts";
import {
  DeterministicLeadProvider,
  EmptySkillSelectionPort,
  type LeadAnalysisProvider,
  type LeadMemoryPort,
  type SkillSelectionPort,
} from "./ports";
import {
  CLARIFICATION_POLICY_VERSION,
  classifyRequirementCandidate,
  isWorkflowRequirement,
} from "./clarification-policy";
import { leadAgentDefinition } from "@/agents/catalog";
import type { AgentSkillSelection } from "@/skills/runtime/resolver";
import { FACTORY_OPERATOR_LANGUAGE, inferSiteLanguageFromPrompt, normalizeSiteLanguage } from "@/domain/language/schema";

const now = () => new Date().toISOString();
const normalizePrompt = (prompt: string) => prompt.replace(/\r\n?/g, "\n");
const key = (projectId: string, version: number) => `${projectId}:${version}`;
const versionedQuestionId = (questionId: string, clarificationVersion: number) => {
  const bytes = Buffer.from(createHash("sha256").update(`${questionId}:clarification-version:${clarificationVersion}`).digest("hex").slice(0, 32), "hex");
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const germanOperatorMarkers = /\b(?:bitte|welche|welcher|welches|bestätigen|vollständigen|geschäft|datenschutz|impressum|gegebenenfalls|dürfen|kontaktformular|sollen|benötigt|verfügbar)\b/gi;
const isGermanOperatorQuestion = (question: string) => {
  const markers = question.match(germanOperatorMarkers) ?? [];
  return /^(?:bitte|welche|welcher|welches|bestätigen|vollständigen)\b/i.test(question) || markers.length >= 2;
};
const validateClarificationPlanLanguage = (plan: ClarificationPlan, operatorLanguage: "en") => {
  if (plan.operatorLanguage !== operatorLanguage || plan.questions.some((question) => isGermanOperatorQuestion(question.question))) throw new LeadError("LEAD_CLARIFICATION_LANGUAGE_INVALID", "Lead clarification output did not match the Factory operator language.");
  return plan;
};
export type LeadServiceDependencies = {
  database: PersistenceDatabase;
  memory: LeadMemoryPort;
  provider?: LeadAnalysisProvider;
  skills?: SkillSelectionPort;
  resolveSkills?: (input: LeadAgentInput) => Promise<AgentSkillSelection>;
};

export class LeadAgentService {
  private readonly projects;
  private readonly versions;
  private readonly clarifications;
  private readonly documents;
  private readonly decisions;
  private readonly workflow;
  private readonly provider: LeadAnalysisProvider;
  private readonly skills: SkillSelectionPort;
  private readonly resolveSkills?: LeadServiceDependencies["resolveSkills"];
  private readonly skillSelections = new Map<string, AgentSkillSelection>();
  private readonly analyses = new Map<string, LeadAgentAnalysis>();
  private readonly drafts = new Map<string, BriefDraft>();
  private readonly intakeKeys = new Map<
    string,
    { checksum: string; result: ReturnType<typeof FactoryProjectSchema.parse> }
  >();
  private readonly answerKeys = new Map<string, string>();
  constructor(private readonly dependencies: LeadServiceDependencies) {
    this.projects = new ProjectRepository(dependencies.database);
    this.versions = new ProjectVersionRepository(dependencies.database);
    this.clarifications = new ClarificationRepository(dependencies.database);
    this.documents = new DocumentRepository(dependencies.database);
    this.decisions = new DecisionRepository(dependencies.database);
    this.workflow = new WorkflowPersistenceService(dependencies.database);
    this.provider =
      dependencies.provider ??
      new DeterministicLeadProvider(
        analyzePromptDeterministically,
        ({ analysis }) => planClarificationsDeterministically({ analysis }),
        ({ analysis, session }) => assembleRequirements({ analysis, session }),
      );
    this.skills = dependencies.skills ?? new EmptySkillSelectionPort();
    this.resolveSkills = dependencies.resolveSkills;
  }
  getAgentDefinition() {
    return leadAgentDefinition;
  }
  async startProjectIntake(input: LeadAgentInput) {
    const parsed = LeadAgentInputSchema.parse(input);
    const prompt = normalizePrompt(parsed.originalPrompt);
    const checksum = checksumPersistedDocument(prompt);
    const previous = this.intakeKeys.get(parsed.idempotencyKey);
    if (previous) {
      if (previous.checksum !== checksum)
        throw new LeadError(
          "IDEMPOTENCY_CONFLICT",
          "The intake idempotency key was reused with a different prompt.",
        );
      return previous.result;
    }
    const existing = await this.projects.getWithVersion(parsed.projectId);
    if (existing) {
      if (normalizePrompt(existing.project.originalPrompt) !== prompt)
        throw new LeadError(
          "IDEMPOTENCY_CONFLICT",
          "The existing project prompt differs from the intake prompt.",
        );
      this.intakeKeys.set(parsed.idempotencyKey, {
        checksum,
        result: existing.project,
      });
      await this.dependencies.memory.writeSnapshot(
        parsed.projectId,
        parsed.projectVersion,
        { "original-prompt.md": prompt },
      );
      return existing.project;
    }
    const createdAt = now();
    const project = FactoryProjectSchema.parse({
      schemaVersion: 1,
      documentType: "factory-project",
      projectId: parsed.projectId,
      projectVersion: parsed.projectVersion,
      createdAt,
      updatedAt: createdAt,
      id: parsed.projectId,
      slug: parsed.projectSlug ?? `project-${parsed.projectId.slice(0, 8)}`,
      origin: parsed.origin,
      siteLanguage: parsed.siteLanguage !== "UNRESOLVED" ? parsed.siteLanguage : inferSiteLanguageFromPrompt(prompt),
      ...(parsed.projectTitle ? { title: parsed.projectTitle } : {}),
      originalPrompt: prompt,
      currentVersion: parsed.projectVersion,
      workflowState: "DRAFT",
    });
    const saved = await this.projects.create(project, parsed.idempotencyKey);
    const version: ProjectVersionRow = {
      id: randomUUID(),
      projectId: parsed.projectId,
      versionNumber: parsed.projectVersion,
      state: "DRAFT",
      memoryRootPath: null,
      requirementsChecksum: null,
      selectedDesignChecksum: null,
      architectureChecksum: null,
      releasedAt: null,
      immutable: false,
      createdAt,
      updatedAt: createdAt,
      rowVersion: 1,
    };
    await this.versions.create(
      version,
      `lead-version-${parsed.idempotencyKey}`,
    );
    await this.dependencies.memory.writeSnapshot(
      parsed.projectId,
      parsed.projectVersion,
      { "original-prompt.md": prompt },
    );
    this.intakeKeys.set(parsed.idempotencyKey, { checksum, result: saved });
    return saved;
  }
  async analyzeProjectPrompt(input: LeadAgentInput) {
    const parsed = LeadAgentInputSchema.parse(input);
    let existing = this.analyses.get(
      key(parsed.projectId, parsed.projectVersion),
    );
    const checksum = checksumPersistedDocument(
      normalizePrompt(parsed.originalPrompt).trim(),
    );
    if (existing && existing.originalPromptChecksum !== checksum) {
      const current = await this.projects.getWithVersion(parsed.projectId);
      if (!current || normalizePrompt(current.project.originalPrompt).trim() !== normalizePrompt(parsed.originalPrompt).trim())
        throw new LeadError("IDEMPOTENCY_CONFLICT", "Prompt analysis belongs to a different prompt.");
      // A provider result is not trusted as the identity authority. Discard a
      // stale/corrupt cached result and obtain a fresh analysis for the same
      // canonical project instead of poisoning the next explicit operation.
      this.analyses.delete(key(parsed.projectId, parsed.projectVersion));
      existing = undefined;
    }
    try {
      const skillSelection = this.resolveSkills
        ? await this.resolveSkills(parsed)
        : undefined;
      const previousSelection = this.skillSelections.get(
        key(parsed.projectId, parsed.projectVersion),
      );
      if (
        existing &&
        parsed.availableAssets.length === 0 &&
        (!skillSelection ||
          !previousSelection ||
          previousSelection.identityChecksum ===
            skillSelection.identityChecksum)
      )
        return existing;
      const selected = await this.skills.select({
        role: "lead",
        taskType: "clarify-requirements",
      });
      const analysis = LeadAgentAnalysisSchema.parse(
        await this.provider.analyzePrompt(
          { ...parsed, originalPrompt: normalizePrompt(parsed.originalPrompt) },
          skillSelection?.contexts,
          skillSelection?.identityChecksum,
        ),
      );
      const result = LeadAgentAnalysisSchema.parse({
        ...analysis,
        provider: {
          ...analysis.provider,
          used:
            analysis.provider.used &&
            (skillSelection
              ? skillSelection.contexts.length > 0
              : selected.length > 0),
          },
      });
      if (result.projectId !== parsed.projectId || result.projectVersion !== parsed.projectVersion || result.originalPromptChecksum !== checksum || result.operatorLanguage !== parsed.operatorLanguage)
        throw new LeadError("LEAD_ANALYSIS_INVALID", "Lead analysis was not bound to the current project input.");
      this.analyses.set(key(parsed.projectId, parsed.projectVersion), result);
      if (skillSelection)
        this.skillSelections.set(
          key(parsed.projectId, parsed.projectVersion),
          skillSelection,
        );
      return result;
    } catch (error) {
      if (error instanceof LeadError) throw error;
      if (error instanceof z.ZodError)
        throw new LeadError(
          "LEAD_ANALYSIS_INVALID",
          "Lead analysis did not match the strict contract.",
          undefined,
          error,
        );
      throw new LeadError(
        "LEAD_PROVIDER_FAILED",
        "Lead analysis failed.",
        undefined,
        error,
      );
    }
  }
  async planClarifications(input: LeadAgentInput): Promise<ClarificationPlan> {
    const parsed = LeadAgentInputSchema.parse(input);
    const analysis =
      this.analyses.get(key(parsed.projectId, parsed.projectVersion)) ??
      (await this.analyzeProjectPrompt(parsed));
    const skillSelection = this.skillSelections.get(
      key(parsed.projectId, parsed.projectVersion),
    );
    const existing = await this.clarifications.getSession(
      parsed.projectId,
      parsed.projectVersion,
    );
    const plan = validateClarificationPlanLanguage(ClarificationPlanSchema.parse(
      await this.provider.proposeClarifications(
        { analysis, session: existing ?? undefined, operatorLanguage: parsed.operatorLanguage, siteLanguage: parsed.siteLanguage, availableAssets: parsed.availableAssets },
        skillSelection?.contexts,
        skillSelection?.identityChecksum,
      ),
    ), parsed.operatorLanguage);
    const satisfiedAssetKeys = new Set<string>();
    if (parsed.availableAssets.some((asset) => asset.status === "READY" && asset.currentness === "CURRENT" && asset.category === "LOGO")) satisfiedAssetKeys.add("logo");
    if (parsed.availableAssets.some((asset) => asset.status === "READY" && asset.currentness === "CURRENT" && (asset.category === "IMAGE" || asset.category === "REFERENCE"))) satisfiedAssetKeys.add("image-source");
    const assetSuperseded = (existing?.questions ?? []).filter((question) => question.answerStatus === "unresolved" && satisfiedAssetKeys.has(question.requirementKey ?? "")).map((question) => ({ question, supersededAt: now(), reason: "Satisfied by a READY project asset; no text answer was submitted." }));
    const questions: ClarificationQuestion[] = (existing?.questions ?? []).filter((question) => !assetSuperseded.some((entry) => entry.question.id === question.id));
    const known = new Set(
      questions.map((question) => question.requirementKey ?? question.id),
    );
    for (const planned of plan.questions)
      if (
        !known.has(planned.requirementKey) &&
        !questions.some(
          (question) => question.fingerprint === planned.fingerprint,
        )
      )
        questions.push({
          id: planned.id,
          category: planned.category,
          question: planned.question,
          reason: planned.reason,
          required: planned.required,
          blocking: planned.blocking,
          askedAt: plan.generatedAt,
          answerStatus: "unresolved",
          requirementKey: planned.requirementKey,
          fingerprint: planned.fingerprint,
          evidence: ["deterministic-planner"],
        });
    const session = ClarificationSessionSchema.parse({
      schemaVersion: 1,
      documentType: "clarification-log",
      projectId: parsed.projectId,
      projectVersion: parsed.projectVersion,
      createdAt: existing?.createdAt ?? plan.generatedAt,
      updatedAt: now(),
      questions,
      answers: existing?.answers ?? [],
      ...(existing
        ? {
            ...(existing.operatorLanguage ? { operatorLanguage: existing.operatorLanguage } : {}),
            ...(existing.clarificationVersion ? { clarificationVersion: existing.clarificationVersion } : {}),
          }
        : { operatorLanguage: parsed.operatorLanguage ?? FACTORY_OPERATOR_LANGUAGE, clarificationVersion: 1 }),
      ...((existing?.supersededQuestions || assetSuperseded.length) ? { supersededQuestions: [...(existing?.supersededQuestions ?? []), ...assetSuperseded] } : {}),
    });
    await this.clarifications.saveSession(
      session,
      `clarification-plan-${parsed.idempotencyKey}`,
    );
    await this.dependencies.memory.writeSnapshot(
      parsed.projectId,
      parsed.projectVersion,
      {
        "original-prompt.md": normalizePrompt(parsed.originalPrompt),
        "clarification-log.json": session,
      },
    );
    const current = await this.projects.getWithVersion(parsed.projectId);
    if (current?.project.workflowState === "DRAFT")
      await this.workflow.transition({
        projectId: parsed.projectId,
        projectVersion: parsed.projectVersion,
        expectedState: "DRAFT",
        expectedRowVersion: current.rowVersion,
        targetState: "CLARIFYING",
        actor: "lead-agent",
        reason: "Project intake clarification started.",
        idempotencyKey: `workflow-clarifying-${parsed.idempotencyKey}`,
      });
    return plan;
  }
  async refreshClarifications(input: LeadAgentInput) {
    const parsed = LeadAgentInputSchema.parse(input);
    const existing = await this.clarifications.getSession(parsed.projectId, parsed.projectVersion);
    if (!existing)
      throw new LeadError("CLARIFICATION_NOT_FOUND", "Clarification session was not found.");
    if (existing.answers.some((answer) => answer.status !== "unresolved"))
      throw new LeadError("CLARIFICATION_REFRESH_NOT_ALLOWED", "Clarification questions cannot be refreshed after an answer has been accepted.");

    const analysis = await this.analyzeProjectPrompt(parsed);
    const skillSelection = this.skillSelections.get(key(parsed.projectId, parsed.projectVersion));
    const plan = validateClarificationPlanLanguage(ClarificationPlanSchema.parse(await this.provider.proposeClarifications(
      { analysis, operatorLanguage: parsed.operatorLanguage, siteLanguage: parsed.siteLanguage, availableAssets: parsed.availableAssets },
      skillSelection?.contexts,
      skillSelection?.identityChecksum,
    )), parsed.operatorLanguage);
    const supersededQuestions = existing.questions.map((question) => ({
      question,
      supersededAt: now(),
      reason: `Superseded by explicit clarification refresh for operatorLanguage=${parsed.operatorLanguage ?? FACTORY_OPERATOR_LANGUAGE}.`,
    }));
    const clarificationVersion = (existing.clarificationVersion ?? 1) + 1;
    const refreshed = ClarificationSessionSchema.parse({
      schemaVersion: 1,
      documentType: "clarification-log",
      projectId: parsed.projectId,
      projectVersion: parsed.projectVersion,
      createdAt: existing.createdAt,
      updatedAt: now(),
      clarificationPolicyVersion: CLARIFICATION_POLICY_VERSION,
      clarificationVersion,
      operatorLanguage: parsed.operatorLanguage ?? FACTORY_OPERATOR_LANGUAGE,
      questions: plan.questions.map((question) => ({
        id: versionedQuestionId(question.id, clarificationVersion),
        requirementKey: question.requirementKey,
        category: question.category,
        question: question.question,
        reason: question.reason,
        required: question.required,
        blocking: question.blocking,
        askedAt: plan.generatedAt,
        answerStatus: "unresolved" as const,
        fingerprint: question.fingerprint,
        evidence: ["lead-refresh"],
      })),
      answers: [],
      supersededQuestions: [...(existing.supersededQuestions ?? []), ...supersededQuestions],
    });
    await this.clarifications.saveSession(refreshed, `clarification-refresh-${parsed.idempotencyKey}`);
    await this.dependencies.memory.writeSnapshot(parsed.projectId, parsed.projectVersion, { "clarification-log.json": refreshed });
    await this.appendDecision(
      parsed.projectId,
      parsed.projectVersion,
      "clarification-language-refresh",
      `Refreshed clarification questions for operatorLanguage=${parsed.operatorLanguage ?? FACTORY_OPERATOR_LANGUAGE}.`,
      false,
      "not-required",
      "workbench-user",
    );
    return refreshed;
  }
  async recordClarificationAnswer(input: {
    projectId: string;
    projectVersion: number;
    questionId: string;
    status: ClarificationAnswer["status"];
    answer?: string;
    answeredBy: string;
    idempotencyKey: string;
  }) {
    const session = await this.clarifications.getSession(
      input.projectId,
      input.projectVersion,
    );
    if (!session)
      throw new LeadError(
        "CLARIFICATION_NOT_FOUND",
        "Clarification session was not found.",
      );
    const question = session.questions.find(
      (candidate) => candidate.id === input.questionId,
    );
    if (!question)
      throw new LeadError(
        "CLARIFICATION_NOT_FOUND",
        "Clarification question was not found.",
      );
    const answerHash = checksumPersistedDocument({
      ...input,
      answer: input.answer ?? "",
    });
    const priorHash = this.answerKeys.get(input.idempotencyKey);
    if (priorHash) {
      if (priorHash !== answerHash)
        throw new LeadError(
          "IDEMPOTENCY_CONFLICT",
          "Answer idempotency key was reused with different content.",
        );
      return session;
    }
    if (question.blocking && input.status === "deferred")
      throw new LeadError(
        "BLOCKING_CLARIFICATIONS_REMAIN",
        "Blocking clarification questions cannot be intentionally deferred.",
      );
    const answer = {
      questionId: input.questionId,
      status: input.status,
      ...(input.answer !== undefined ? { answer: input.answer } : {}),
      answeredAt: now(),
      answeredBy: input.answeredBy,
    };
    const next = ClarificationSessionSchema.parse({
      ...session,
      updatedAt: now(),
      questions: session.questions.map((candidate) =>
        candidate.id === input.questionId
          ? { ...candidate, answerStatus: input.status }
          : candidate,
      ),
      answers: [...session.answers, answer],
    });
    await this.clarifications.saveSession(next, input.idempotencyKey);
    if (question.requirementKey === "languages" && input.status === "answered") {
      const siteLanguage = normalizeSiteLanguage(input.answer);
      if (siteLanguage !== "UNRESOLVED") await this.projects.updateSiteLanguage(input.projectId, siteLanguage);
    }
    this.answerKeys.set(input.idempotencyKey, answerHash);
    if (
      session.answers.some(
        (candidate) => candidate.questionId === input.questionId,
      )
    )
      await this.appendDecision(
        input.projectId,
        input.projectVersion,
        "clarification-answer-change",
        `Updated answer for ${question.requirementKey ?? question.id}`,
        false,
        "not-required",
        input.answeredBy,
      );
    await this.dependencies.memory.writeSnapshot(
      input.projectId,
      input.projectVersion,
      { "clarification-log.json": next },
    );
    return next;
  }
  async getClarificationStatus(projectId: string, projectVersion: number) {
    const session = await this.reconcileClarificationSession(
      await this.clarifications.getSession(projectId, projectVersion),
    );
    if (!session)
      throw new LeadError(
        "CLARIFICATION_NOT_FOUND",
        "Clarification session was not found.",
      );
    return {
      session,
      blockingUnresolved: session.questions.filter(
        (question) =>
          question.blocking && question.answerStatus === "unresolved",
      ),
      unresolved: session.questions.filter(
        (question) => question.answerStatus === "unresolved",
      ),
    };
  }
  private async reconcileClarificationSession(
    session: ClarificationSession | null,
  ) {
    if (!session) return null;
    const candidates = session.questions.filter((question) =>
      isWorkflowRequirement(question),
    );
    const stalePolicy =
      session.clarificationPolicyVersion !== CLARIFICATION_POLICY_VERSION;
    if (!candidates.length && !stalePolicy) return session;
    const superseded = candidates.map((question) => ({
      question,
      supersededAt: now(),
      reason: `Classified as ${classifyRequirementCandidate(question)} by clarification policy v${CLARIFICATION_POLICY_VERSION}.`,
    }));
    const next = ClarificationSessionSchema.parse({
      ...session,
      clarificationPolicyVersion: CLARIFICATION_POLICY_VERSION,
      updatedAt: now(),
      questions: session.questions.filter(
        (question) => !isWorkflowRequirement(question),
      ),
      ...(superseded.length || session.supersededQuestions
        ? {
            supersededQuestions: [
              ...(session.supersededQuestions ?? []),
              ...superseded,
            ],
          }
        : {}),
    });
    await this.clarifications.saveSession(
      next,
      `clarification-policy-reconcile-${session.projectId}-${session.projectVersion}-v${CLARIFICATION_POLICY_VERSION}`,
    );
    await this.dependencies.memory.writeSnapshot(
      session.projectId,
      session.projectVersion,
      { "clarification-log.json": next },
    );
    if (superseded.length)
      await this.appendDecision(
        session.projectId,
        session.projectVersion,
        "clarification-policy-reconciliation",
        `Superseded ${superseded.length} workflow clarification candidate(s).`,
        false,
        "not-required",
        "lead-agent",
      );
    return next;
  }
  async buildBriefDraft(projectId: string, projectVersion: number) {
    const analysis = this.analyses.get(key(projectId, projectVersion));
    if (!analysis)
      throw new LeadError(
        "LEAD_ANALYSIS_INVALID",
        "Prompt analysis must be completed first.",
      );
    const skillSelection = this.skillSelections.get(
      key(projectId, projectVersion),
    );
    const session = await this.clarifications.getSession(
      projectId,
      projectVersion,
    );
    if (!session)
      throw new LeadError(
        "CLARIFICATION_REQUIRED",
        "Clarifications must be planned before building a brief.",
      );
    const draft = BriefDraftSchema.parse(
      await this.provider.assembleBriefDraft(
        { analysis, session },
        skillSelection?.contexts,
        skillSelection?.identityChecksum,
      ),
    );
    this.drafts.set(key(projectId, projectVersion), draft);
    await this.documents.save(
      draft.requirements,
      `requirements-draft-${projectId}-${projectVersion}-${draft.briefChecksum}`,
    );
    await this.dependencies.memory.writeSnapshot(projectId, projectVersion, {
      "clarification-log.json": session,
      "requirements.json": draft.requirements,
    });
    const current = await this.projects.getWithVersion(projectId);
    if (
      draft.readyForApproval &&
      current?.project.workflowState === "CLARIFYING"
    )
      await this.workflow.transition({
        projectId,
        projectVersion,
        expectedState: "CLARIFYING",
        expectedRowVersion: current.rowVersion,
        targetState: "AWAITING_BRIEF_APPROVAL",
        actor: "lead-agent",
        reason: "Clarifications are complete and the brief awaits approval.",
        context: {
          requirements: draft.requirements,
          clarificationSession: session,
        },
        idempotencyKey: `workflow-brief-${projectId}-${projectVersion}-${draft.briefChecksum}`,
      });
    return draft;
  }
  async approveBrief(input: BriefApprovalRequest) {
    const request = BriefApprovalRequestSchema.parse(input);
    const draft = this.drafts.get(
      key(request.projectId, request.projectVersion),
    );
    if (!draft)
      throw new LeadError(
        "BRIEF_NOT_READY",
        "A current brief draft is required.",
      );
    if (draft.briefChecksum !== request.briefChecksum)
      throw new LeadError(
        "BRIEF_CHECKSUM_MISMATCH",
        "The brief checksum is stale.",
      );
    if (!draft.readyForApproval)
      throw new LeadError(
        "BRIEF_NOT_READY",
        "The brief is not ready for approval.",
      );
    const projectForApproval = await this.projects.getWithVersion(request.projectId);
    if (projectForApproval?.project.siteLanguage === "UNRESOLVED") throw new LeadError("BRIEF_NOT_READY", "The customer website language must be explicitly confirmed before approval.");
    const current = projectForApproval;
    if (!current || current.project.workflowState !== "AWAITING_BRIEF_APPROVAL")
      throw new LeadError(
        "WORKFLOW_STATE_INVALID",
        "The project is not awaiting brief approval.",
      );
    if (current.rowVersion !== request.expectedRowVersion)
      throw new LeadError(
        "BRIEF_APPROVAL_STALE",
        "The project row version is stale.",
      );
    const approved = RequirementSpecificationSchema.parse({
      ...draft.requirements,
      updatedAt: now(),
      briefStatus: "approved",
      approval: {
        approved: true,
        approvedAt: request.approvedAt,
        approvedBy: request.approvedBy,
        approvedRequirementsChecksum: request.briefChecksum,
      },
      ...(request.approvalNote
        ? { briefApprovalNote: request.approvalNote }
        : {}),
    });
    await this.documents.save(approved, request.idempotencyKey);
    await this.dependencies.memory.writeSnapshot(
      request.projectId,
      request.projectVersion,
      { "requirements.json": approved },
    );
    const transition = await this.workflow.transition({
      projectId: request.projectId,
      projectVersion: request.projectVersion,
      expectedState: "AWAITING_BRIEF_APPROVAL",
      expectedRowVersion: request.expectedRowVersion,
      targetState: "AWAITING_DESIGN_SELECTION",
      actor: request.approvedBy,
      reason: "User approved the Project Brief.",
      context: {
        requirements: approved,
        requirementsChecksum: request.briefChecksum,
      },
      idempotencyKey: request.idempotencyKey,
    });
    await this.appendDecision(
      request.projectId,
      request.projectVersion,
      "brief-approval",
      "Project Brief approved by user.",
      false,
      "not-required",
      request.approvedBy,
    );
    const result = {
      brief: {
        ...draft,
        requirements: approved,
        briefChecksum: request.briefChecksum,
      },
      projectState: "AWAITING_DESIGN_SELECTION" as const,
      rowVersion: transition.rowVersion,
    };
    this.drafts.set(
      key(request.projectId, request.projectVersion),
      result.brief,
    );
    return result;
  }
  async requestBriefRevision(input: {
    projectId: string;
    projectVersion: number;
    requirementKeys: string[];
    reason: string;
    requestedBy: string;
    idempotencyKey: string;
  }) {
    const current = await this.projects.getWithVersion(input.projectId);
    if (
      !current ||
      !["AWAITING_BRIEF_APPROVAL", "AWAITING_DESIGN_SELECTION"].includes(
        current.project.workflowState,
      )
    )
      throw new LeadError(
        "BRIEF_REVISION_REQUIRED",
        "Brief revision is only available before implementation.",
      );
    const existing = await this.documents.get(
      input.projectId,
      input.projectVersion,
      "requirements",
    );
    if (!existing || existing.documentType !== "requirements")
      throw new LeadError(
        "BRIEF_NOT_READY",
        "Requirements draft was not found.",
      );
    const next = RequirementSpecificationSchema.parse({
      ...existing,
      updatedAt: now(),
      briefStatus: "draft",
      approval: { approved: false },
      unresolvedItems: [
        ...existing.unresolvedItems,
        ...input.requirementKeys.map((requirementKey) => ({
          id: randomUUID(),
          description: `Reconfirm ${requirementKey}: ${input.reason}`,
          blocking: true,
        })),
      ],
    });
    await this.documents.save(next, input.idempotencyKey);
    await this.dependencies.memory.writeSnapshot(
      input.projectId,
      input.projectVersion,
      { "requirements.json": next },
    );
    if (current.project.workflowState === "AWAITING_DESIGN_SELECTION") {
      const first = await this.workflow.transition({
        projectId: input.projectId,
        projectVersion: input.projectVersion,
        expectedState: "AWAITING_DESIGN_SELECTION",
        expectedRowVersion: current.rowVersion,
        targetState: "AWAITING_BRIEF_APPROVAL",
        actor: input.requestedBy,
        reason: "User requested a Project Brief revision.",
        idempotencyKey: `${input.idempotencyKey}-approval`,
      });
      await this.workflow.transition({
        projectId: input.projectId,
        projectVersion: input.projectVersion,
        expectedState: "AWAITING_BRIEF_APPROVAL",
        expectedRowVersion: first.rowVersion,
        targetState: "CLARIFYING",
        actor: input.requestedBy,
        reason: "Project Brief revision reopened clarification.",
        idempotencyKey: `${input.idempotencyKey}-clarifying`,
      });
    } else
      await this.workflow.transition({
        projectId: input.projectId,
        projectVersion: input.projectVersion,
        expectedState: "AWAITING_BRIEF_APPROVAL",
        expectedRowVersion: current.rowVersion,
        targetState: "CLARIFYING",
        actor: input.requestedBy,
        reason: "Project Brief revision reopened clarification.",
        idempotencyKey: input.idempotencyKey,
      });
    await this.appendDecision(
      input.projectId,
      input.projectVersion,
      "brief-revision",
      input.reason,
      true,
      "approved",
      input.requestedBy,
    );
    this.drafts.delete(key(input.projectId, input.projectVersion));
    return next;
  }
  private async appendDecision(
    projectId: string,
    version: number,
    category: string,
    decision: string,
    requirementChange: boolean,
    userApprovalStatus: "not-required" | "approved",
    actor: string,
  ) {
    const record = DecisionRecordSchema.parse({
      id: randomUUID(),
      timestamp: now(),
      actorType: actor === "lead-agent" ? "system" : "user",
      actorIdentifier: actor,
      category,
      decision,
      rationale: decision,
      affectedDocuments: ["clarification-log.json", "requirements.json"],
      requirementChange,
      userApprovalRequired: requirementChange,
      userApprovalStatus,
    });
    await this.decisions.append(projectId, version, record);
    await this.dependencies.memory.appendDecision(projectId, version, record);
  }
}
export function createLeadAgentService(dependencies: LeadServiceDependencies) {
  return new LeadAgentService(dependencies);
}
