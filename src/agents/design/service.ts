import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  DesignRepository,
  DecisionRepository,
  DocumentRepository,
  ProjectRepository,
  WorkflowPersistenceService,
  appendDecisionInTransaction,
  saveDocumentInTransaction,
  saveDocumentCASInTransaction,
  transitionWorkflowInTransaction,
} from "@/persistence/database/repositories";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { mapRowToDocument } from "@/persistence/database/mapping";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { BriefV3DocumentSchema } from "@/persistence/database/brief-revision-v3-contracts";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { canonicalBriefToPlannerBrief } from "@/agents/planner/brief-context";
import { resolveLogoPolicy } from "@/domain/requirements/logo-policy";
import { planningSemanticChecksum } from "@/agents/planner/deterministic";
import {
  DesignDirectionSetSchema,
  SelectedDesignSchema,
  type DesignDirectionSet,
} from "@/domain/design/schema";
import { ArchitectureReviewRecordSchema } from "@/domain/review/schema";
import { DecisionRecordSchema } from "@/domain/workflow/decision";
import { PlanningPackageSchema } from "@/agents/planner/contracts";
import { evaluatePlanningAcceptanceReadiness } from "@/agents/planner/deterministic";
import type { PersistenceDatabase } from "@/persistence/database/types";
import {
  DesignAgentInputSchema,
  DesignAdmissionFindingSchema,
  DesignAdmissionInvalidationRequestSchema,
  DesignCandidateReplayRequestSchema,
  DesignAttemptExecutionEvidenceSchema,
  DesignGenerationAttemptHistorySchema,
  DesignGenerationResultSchema,
  DesignGenerationAttemptSchema,
  DesignOutcomeUnknownReconciliationRequestSchema,
  DesignFreshAttemptAuthorizationSchema,
  DesignProviderObservationSchema,
  DesignRevisionRequestSchema,
  DesignSelectionRequestSchema,
  type DesignAgentInput,
  type DesignAdmissionFinding,
  type DesignAdmissionInvalidationRequest,
  type DesignCandidateReplayRequest,
  type DesignOutcomeUnknownReconciliationRequest,
  type DesignGenerationAttempt,
  type DesignGenerationAttemptHistory,
  type DesignGenerationResult,
  type DesignRevisionRequest,
  type DesignSelectionRequest,
} from "./contracts";
import { DesignError } from "./errors";
import { isAiProviderError } from "@/integrations/openai/errors";
import { ProviderFailureDiagnosticSchema } from "@/domain/shared/provider-failure";
import {
  buildDesignDirectionSet,
  directionChecksum,
  directionSetChecksum,
  validateDesignDirectionSet,
} from "./deterministic";
import { buildDesignCanonicalContent } from "./canonical-content";
import {
  EmptyDesignExplorationToolPort,
  EmptyDesignSkillSelectionPort,
  type DesignDirectionProvider,
  type DesignExplorationToolPort,
  type DesignMemoryPort,
  type DesignSkillSelectionPort,
} from "./ports";
import { designAgentDefinition } from "@/agents/catalog";
import type { AgentSkillSelection } from "@/skills/runtime/resolver";
import { assertWorkbenchStyleIsolation } from "@/integrations/design/isolation";
import { ProfessionalDesignCapabilityPipeline } from "./professional";
import { approveDesignDependencyAmendment, buildDesignDependencyAmendment, DesignDependencyAmendmentSchema } from "@/domain/design/capability";
import type { SourceCurrentnessPort } from "@/domain/shared/source-head";

const now = () => new Date().toISOString();
type DesignServiceDependencies = {
  database: PersistenceDatabase;
  memory: DesignMemoryPort;
  provider?: DesignDirectionProvider;
  skills?: DesignSkillSelectionPort;
  explorationTool?: DesignExplorationToolPort;
  resolveSkills?: (input: DesignAgentInput) => Promise<AgentSkillSelection>;
  professionalPipeline?: ProfessionalDesignCapabilityPipeline;
  source?: SourceCurrentnessPort;
};

function diagnosticFor(error: unknown) {
  if (isAiProviderError(error)) return error.diagnostic;
  if (error instanceof DesignError && error.diagnostic && typeof error.diagnostic === "object") return error.diagnostic as Record<string, unknown>;
  return undefined;
}

function failureDiagnosticFor(error: unknown) {
  if (isAiProviderError(error) && error.failureDiagnostic) return ProviderFailureDiagnosticSchema.parse(error.failureDiagnostic);
  if (error instanceof DesignError && error.failureDiagnostic) return ProviderFailureDiagnosticSchema.parse(error.failureDiagnostic);
  return undefined;
}

function observationFor(error: unknown, fallbackModel?: string) {
  const diagnostic = diagnosticFor(error) as Record<string, unknown> | undefined;
  const failure = failureDiagnosticFor(error);
  return DesignProviderObservationSchema.parse({
    provider: "openai",
    model: (failure?.model as string | undefined) ?? fallbackModel ?? null,
    requestAttempted: diagnostic?.requestAttempted ?? failure?.requestAttempted ?? true,
    requestId: (diagnostic?.requestId as string | undefined) ?? failure?.requestId ?? null,
    responseReceived: diagnostic?.responseReceived ?? failure?.responseReceived ?? false,
    httpStatus: diagnostic?.httpStatus ?? failure?.httpStatus ?? null,
    choicesCount: diagnostic?.choicesCount ?? failure?.choicesCount ?? null,
    finishReason: diagnostic?.finishReason ?? failure?.finishReason ?? null,
    refusalPresent: diagnostic?.refusalPresent ?? failure?.refusalPresent ?? null,
    parsedPresent: diagnostic?.parsedPresent ?? null,
    inputTokens: diagnostic?.inputTokens ?? failure?.inputTokens ?? null,
    outputTokens: diagnostic?.outputTokens ?? failure?.outputTokens ?? null,
    totalTokens: diagnostic?.totalTokens ?? failure?.totalTokens ?? null,
    jsonParseSucceeded: diagnostic?.jsonParseSucceeded ?? failure?.jsonParseSucceeded ?? null,
    rawContentBytes: diagnostic?.rawContentBytes ?? failure?.rawContentBytes ?? null,
    rawContentChecksum: diagnostic?.rawContentChecksum ?? failure?.rawContentChecksum ?? null,
    zodIssueCount: diagnostic?.zodIssueCount ?? failure?.zodIssueCount ?? null,
    zodIssuesTruncated: diagnostic?.zodIssuesTruncated ?? failure?.zodIssuesTruncated ?? null,
    completeZodIssuesChecksum: diagnostic?.completeZodIssuesChecksum ?? failure?.completeZodIssuesChecksum ?? null,
  });
}

function executionEvidence(boundary: "NOT_STARTED" | "STARTED" | "RESPONSE_RECEIVED" | "RESPONSE_UNKNOWN", previous?: DesignGenerationAttempt["executionEvidence"], at = now()) {
  return DesignAttemptExecutionEvidenceSchema.parse({
    schemaVersion: 1,
    processId: Number.isSafeInteger(process.pid) && process.pid > 0 ? process.pid : null,
    processGeneration: z.string().uuid().safeParse(process.env.FACTORY_SERVER_GENERATION).success ? process.env.FACTORY_SERVER_GENERATION : null,
    processStartedAt: z.string().datetime().safeParse(process.env.FACTORY_SERVER_STARTED_AT).success ? process.env.FACTORY_SERVER_STARTED_AT : null,
    configuredTimeoutMs: previous?.configuredTimeoutMs ?? null,
    deadlineAt: previous?.deadlineAt ?? null,
    providerBoundary: boundary,
    providerBoundaryAt: at,
  });
}

function observationForSet(set: DesignDirectionSet) {
  const provider = set.provider;
  if (!provider || provider.name !== "openai") return undefined;
  return DesignProviderObservationSchema.parse({
    provider: "openai",
    model: provider.model ?? null,
    requestAttempted: true,
    requestId: provider.requestId ?? null,
    responseReceived: provider.responseReceived ?? true,
    httpStatus: null,
    choicesCount: null,
    finishReason: provider.finishReason ?? null,
    refusalPresent: provider.refusalPresent ?? false,
    parsedPresent: provider.parsedPresent ?? true,
    inputTokens: provider.inputTokens ?? null,
    outputTokens: provider.outputTokens ?? null,
    totalTokens: provider.totalTokens ?? null,
    jsonParseSucceeded: true,
    rawContentBytes: provider.rawContentBytes ?? null,
    rawContentChecksum: provider.rawContentChecksum ?? null,
    zodIssueCount: null,
    zodIssuesTruncated: null,
    completeZodIssuesChecksum: null,
  });
}

const DESIGN_AUTHORITIES = ["CanonicalBriefV3", "acceptedPlanningPackage", "approvedArchitectureReview"];
const admissionFinding = (input: {
  code: string;
  expectedInvariant: string;
  actualCategory: string;
  validatorPredicate: string;
  directionIndex?: number | null;
  fieldPath?: string | null;
}) => DesignAdmissionFindingSchema.parse({
  code: input.code,
  severity: "BLOCKING",
  directionIndex: input.directionIndex ?? null,
  directionRole: input.directionIndex == null ? null : `direction-${input.directionIndex}`,
  fieldPath: input.fieldPath ?? null,
  expectedInvariant: input.expectedInvariant,
  actualCategory: input.actualCategory,
  relatedAuthorities: DESIGN_AUTHORITIES,
  validatorPredicate: input.validatorPredicate,
});

function admissionFindingForPipeline(code: string): DesignAdmissionFinding {
  return admissionFinding({
    code,
    expectedInvariant: "Professional Design capability admission must complete with current approved evidence.",
    actualCategory: code,
    validatorPredicate: "ProfessionalDesignCapabilityPipeline.run",
    fieldPath: "professionalDesign",
  });
}

function admissionFindingsForReadiness(set: DesignDirectionSet, readiness: { blockingReasons: readonly string[] }): DesignAdmissionFinding[] {
  return readiness.blockingReasons.flatMap((code) => {
    const directionIndexes = code.startsWith("DESIGN_CANONICAL_")
      ? set.directions.map((_, index) => index)
      : code === "DESIGN_DIRECTION_REQUIREMENT_VIOLATION"
      ? set.directions.map((direction, index) => direction.approvedRequirementReferences?.length && direction.planningReferences?.length ? -1 : index).filter((index) => index >= 0)
      : code === "DESIGN_DIRECTION_NOT_FEASIBLE"
        ? set.directions.map((direction, index) => direction.responsiveDetails && direction.motionDetails && direction.colorRoles ? -1 : index).filter((index) => index >= 0)
        : [];
    const indexes: Array<number | null> = directionIndexes.length ? directionIndexes : [null];
    return indexes.map((directionIndex) => admissionFinding({
      code,
      directionIndex,
      fieldPath: code.startsWith("DESIGN_CANONICAL_") ? "direction.canonicalContent" : code === "DESIGN_DIRECTION_REQUIREMENT_VIOLATION" ? "approvedRequirementReferences|planningReferences" : code === "DESIGN_DIRECTION_NOT_FEASIBLE" ? "responsiveDetails|motionDetails|colorRoles" : code === "IMAGE_SOURCE_PENDING" ? "imageSourceDecision" : "directions",
      expectedInvariant: code.startsWith("DESIGN_CANONICAL_") ? "Every direction must preserve the exact host-owned canonical Design content binding; only an explicit typed contradiction may block admission." : code === "DESIGN_DIRECTION_DUPLICATE" || code === "DESIGN_DIRECTIONS_TOO_SIMILAR" ? "The three directions must have distinct structured design strategies." : "The Design direction set must satisfy the current deterministic admission predicate.",
      actualCategory: code,
      validatorPredicate: "validateDesignDirectionSet",
    }));
  });
}

function providerAttemptFields(observation: z.infer<typeof DesignProviderObservationSchema>): Partial<DesignGenerationAttempt> {
  return {
    providerAttempted: observation.requestAttempted,
    responseReceived: observation.responseReceived,
    ...(observation.model ? { providerModel: observation.model } : {}),
    ...(observation.requestId ? { providerRequestId: observation.requestId } : {}),
    ...(observation.finishReason !== null ? { finishReason: observation.finishReason } : { finishReason: null }),
    ...(observation.inputTokens === null ? {} : { inputTokens: observation.inputTokens }),
    ...(observation.outputTokens === null ? {} : { outputTokens: observation.outputTokens }),
    ...(observation.totalTokens === null ? {} : { totalTokens: observation.totalTokens }),
  };
}

function providerFailureState(error: unknown): DesignGenerationAttempt["state"] {
  const diagnostic = diagnosticFor(error) as Record<string, unknown> | undefined;
  if (error instanceof z.ZodError) return "DOMAIN_FAILED";
  if (diagnostic?.stage === "structured_parse" || diagnostic?.stage === "domain_validation" || diagnostic?.jsonParseSucceeded !== undefined) return "WIRE_FAILED";
  if (diagnostic?.stage === "provider_normalization") return "DOMAIN_FAILED";
  return "PROVIDER_FAILED";
}

function designErrorFromProvider(error: unknown) {
  if (error instanceof DesignError) return error;
  if (isAiProviderError(error)) return new DesignError("DESIGN_PROVIDER_FAILED", "Design provider failed.", error, error.diagnostic, error.failureDiagnostic);
  if (error instanceof z.ZodError) {
    const directionIssue = error.issues.find((issue) => issue.path[0] === "directions");
    const countIssue = directionIssue && (directionIssue.code === "too_small" || directionIssue.code === "too_big");
    return new DesignError(countIssue ? "DESIGN_DIRECTION_COUNT_INVALID" : "DESIGN_DIRECTION_SCHEMA_INVALID", countIssue ? "Design provider returned a direction set with a cardinality other than exactly three." : "Design provider returned a direction set that failed the strict direction contract.", error);
  }
  return new DesignError("DESIGN_PROVIDER_FAILED", "Design provider failed.", error);
}

export class DesignAgentService {
  private readonly projects;
  private readonly documents;
  private readonly designs;
  private readonly decisions;
  private readonly workflow;
  private readonly provider: DesignDirectionProvider;
  private readonly skills: DesignSkillSelectionPort;
  private readonly explorationTool: DesignExplorationToolPort;
  private readonly resolveSkills?: DesignServiceDependencies["resolveSkills"];
  private readonly professionalPipeline?: ProfessionalDesignCapabilityPipeline;
  constructor(private readonly dependencies: DesignServiceDependencies) {
    this.projects = new ProjectRepository(dependencies.database);
    this.documents = new DocumentRepository(dependencies.database);
    this.designs = new DesignRepository(dependencies.database);
    this.decisions = new DecisionRepository(dependencies.database);
    this.workflow = new WorkflowPersistenceService(dependencies.database);
    this.provider = dependencies.provider ?? {
      proposeDesignDirections: async (input) => buildDesignDirectionSet(input),
    };
    this.skills = dependencies.skills ?? new EmptyDesignSkillSelectionPort();
    this.explorationTool =
      dependencies.explorationTool ?? new EmptyDesignExplorationToolPort();
    this.resolveSkills = dependencies.resolveSkills;
    this.professionalPipeline = dependencies.professionalPipeline;
  }
  getAgentDefinition() {
    return designAgentDefinition;
  }
  private async loadDurableContext(projectId: string, projectVersion: number, idempotencyKey = "design-recovered") {
    const current = await this.projects.getWithVersion(projectId);
    const brief = await this.documents.get(projectId, projectVersion, "requirements");
    const briefV3Document = await this.documents.get(projectId, projectVersion, "brief-v3");
    const planning = await this.documents.get(projectId, projectVersion, "planning-package");
    if (!current || !brief || brief.documentType !== "requirements") throw new DesignError("DESIGN_BRIEF_STALE", "Durable approved requirements are unavailable.");
    if (!planning || planning.documentType !== "planning-package") throw new DesignError("DESIGN_PLANNING_STALE", "Durable accepted planning is unavailable.");
    const canonical = briefV3Document?.documentType === "brief-v3" ? BriefV3DocumentSchema.parse(briefV3Document) : undefined;
    const currentBrief = canonical?.approval?.approved && canonical.approval.approvedCanonicalChecksum === canonical.briefChecksum
      ? canonicalBriefToPlannerBrief(canonical.brief, brief, canonical.approval)
      : brief;
    const decisions = await this.decisions.list(projectId, projectVersion);
    const visualStatements = currentBrief.brandVisualRequirements ? Object.values(currentBrief.brandVisualRequirements).flatMap((items) => items.flatMap((item) => typeof item === "object" && item && "statement" in item ? String(item.statement) : [])) : [];
    const prohibitedStatements = currentBrief.prohibitedRequirements?.flatMap((item) => item.statement) ?? [];
    return DesignAgentInputSchema.parse({ projectId, projectVersion, approvedBrief: currentBrief, ...(canonical ? { canonicalBrief: canonical.brief } : {}), approvedBriefChecksum: canonical?.briefChecksum ?? checksumPersistedDocument(currentBrief), acceptedPlanningPackage: planning, acceptedPlanningChecksum: checksumPersistedDocument(planning), contentPlan: planning.content, assetManifest: planning.assets, suppliedBrandMetadata: currentBrief.brandVisualRequirements ?? {}, suppliedLogoMetadata: { ...currentBrief.suppliedLogoLocation, ...(currentBrief.assetRequirements ? { requiredAssets: currentBrief.assetRequirements.requiredAssets.map((asset) => ({ reference: asset.reference, role: asset.role, replacementForbidden: asset.replacementForbidden })) } : {}) }, imageSourceDecision: currentBrief.imageSourceDecision, designPreferences: visualStatements, explicitDesignExclusions: [...currentBrief.explicitExclusions, ...prohibitedStatements], currentWorkflowState: current.project.workflowState, existingDecisions: decisions, allowedSkills: [], idempotencyKey, expectedRowVersion: current.rowVersion });
  }
  private parseInput(raw: DesignAgentInput) {
    try {
      return DesignAgentInputSchema.parse(raw);
    } catch (error) {
      throw new DesignError(
        "DESIGN_INPUT_INVALID",
        "Design input did not match the strict contract.",
        error,
      );
    }
  }
  private async saveAttempt(attempt: DesignGenerationAttempt, previous?: DesignGenerationAttempt) {
    return this.dependencies.database.transaction(async (tx) => {
      const currentRow = await tx.getDocument(attempt.projectId, attempt.projectVersion, "design-generation-attempt");
      const expectedChecksum = previous ? checksumPersistedDocument(previous) : null;
      if (previous && (!currentRow || currentRow.checksum !== expectedChecksum)) throw new DesignError("DESIGN_CONTRACT_STALE", "The Design attempt changed before its next durable transition.");
      const saved = await saveDocumentCASInTransaction(tx, attempt, previous ? currentRow!.rowVersion : null, expectedChecksum);
      return DesignGenerationAttemptSchema.parse(saved);
    });
  }
  private async preserveAttemptHistory(attempt: DesignGenerationAttempt) {
    const existing = await this.documents.get(attempt.projectId, attempt.projectVersion, "design-generation-attempt-history");
    const history = existing?.documentType === "design-generation-attempt-history"
      ? DesignGenerationAttemptHistorySchema.parse(existing)
      : undefined;
    if (history?.records.some((record) => record.attemptId === attempt.attemptId)) return history;
    const timestamp = now();
    return DesignGenerationAttemptHistorySchema.parse(await this.documents.save({
      schemaVersion: 1,
      documentType: "design-generation-attempt-history",
      projectId: attempt.projectId,
      projectVersion: attempt.projectVersion,
      createdAt: history?.createdAt ?? attempt.createdAt,
      updatedAt: timestamp,
      records: [...(history?.records ?? []), attempt],
    } satisfies DesignGenerationAttemptHistory));
  }
  private bindCanonicalContent(input: DesignAgentInput, candidate: DesignDirectionSet) {
    return DesignDirectionSetSchema.parse({
      ...candidate,
      directions: candidate.directions.map((direction) => {
        const hostDirection = { ...direction } as Record<string, unknown>;
        delete hostDirection.canonicalContent;
        return { ...hostDirection, ...(input.canonicalContent ? { canonicalContent: input.canonicalContent } : {}) };
      }),
    });
  }
  private async readSourceHead() {
    if (!this.dependencies.source) return undefined;
    try {
      const current = await this.dependencies.source.read();
      if (!current.trackedWorktreeClean) throw new DesignError("DESIGN_CONTRACT_STALE", "Design source currentness is not clean.", undefined, {
        sourceCurrentness: {
          disallowedPathCount: current.disallowedPaths?.length ?? 0,
          paths: (current.disallowedPaths ?? []).slice(0, 8),
        },
      });
      return current.head;
    } catch (error) {
      if (error instanceof DesignError) throw error;
      throw new DesignError("DESIGN_CONTRACT_STALE", "Design source currentness could not be verified.");
    }
  }
  private async failAttempt(attempt: DesignGenerationAttempt, state: DesignGenerationAttempt["state"], error: unknown, admissionFindings?: readonly DesignAdmissionFinding[]) {
    const designError = designErrorFromProvider(error);
    const failureDiagnostic = failureDiagnosticFor(error);
    const errorHasProviderObservation = diagnosticFor(error) !== undefined || failureDiagnostic !== undefined;
    const findings = admissionFindings?.length ? admissionFindings : attempt.admissionFindings;
    return this.saveAttempt(DesignGenerationAttemptSchema.parse({
      ...attempt,
      state,
      updatedAt: now(),
      failureCode: designError.code,
      ...(findings ? { admissionFindingCount: findings.length, admissionFindingsChecksum: checksumPersistedDocument(findings), admissionFindings: findings } : {}),
      ...(failureDiagnostic ? { failureDiagnostic } : {}),
      ...(errorHasProviderObservation ? { providerObservation: observationFor(error), ...providerAttemptFields(observationFor(error)) } : attempt.providerObservation ? { providerObservation: attempt.providerObservation, ...providerAttemptFields(attempt.providerObservation) } : {}),
    }), attempt);
  }
  private async commitDesignAdmission(input: DesignAgentInput, set: DesignDirectionSet, attempt: DesignGenerationAttempt, readiness: ReturnType<typeof validateDesignDirectionSet>, replaceExisting: boolean) {
    const generatedAt = now();
    const committedSet = DesignDirectionSetSchema.parse({
      ...set,
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      createdAt: generatedAt,
      updatedAt: generatedAt,
      generatedAt,
      generatedBy: "factory-design-agent",
      readyForSelection: readiness.readyForSelection,
      blockingReasons: readiness.blockingReasons,
      warnings: readiness.warnings,
      approvedBriefChecksum: input.approvedBriefChecksum,
      acceptedPlanningChecksum: input.acceptedPlanningChecksum,
      generationIdempotencyKey: input.idempotencyKey,
    });
    const completedObservation = observationForSet(committedSet) ?? attempt.providerObservation;
    const completedAttempt = DesignGenerationAttemptSchema.parse({
      ...attempt,
      state: "PERSISTED",
      updatedAt: generatedAt,
      ...(completedObservation ? { providerObservation: completedObservation, ...providerAttemptFields(completedObservation) } : {}),
    });
    const persistedSet = await this.dependencies.database.transaction(async (tx) => {
      const projectRow = await tx.getProject(input.projectId);
      const briefRow = await tx.getDocument(input.projectId, input.projectVersion, "requirements");
      const planningRow = await tx.getDocument(input.projectId, input.projectVersion, "planning-package");
      const reviewRow = await tx.getDocument(input.projectId, input.projectVersion, "architecture-review");
      if (!projectRow || projectRow.current_version !== input.projectVersion || projectRow.workflow_state !== "AWAITING_DESIGN_SELECTION" || projectRow.row_version !== input.expectedRowVersion) throw new DesignError("DESIGN_SELECTION_STALE", "Design generation became stale before its canonical commit.");
      const attemptRow = await tx.getDocument(input.projectId, input.projectVersion, "design-generation-attempt");
      if (!attemptRow || attemptRow.checksum !== checksumPersistedDocument(attempt)) throw new DesignError("DESIGN_CONTRACT_STALE", "The Design provider attempt changed before its canonical commit.");
      if (input.canonicalContent && attempt.canonicalContentChecksum !== input.canonicalContent.contentChecksum) throw new DesignError("DESIGN_CANONICAL_CONTENT_STALE", "The Design attempt is not bound to the current host-owned canonical content.");
      const brief = briefRow ? mapRowToDocument(briefRow) : null;
      const planning = planningRow ? mapRowToDocument(planningRow) : null;
      const review = reviewRow ? mapRowToDocument(reviewRow) : null;
      const briefV3Row = await tx.getDocument(input.projectId, input.projectVersion, "brief-v3");
      const briefV3 = briefV3Row ? mapRowToDocument(briefV3Row) : null;
      if (briefV3?.documentType === "brief-v3") {
        const currentBrief = BriefV3DocumentSchema.parse(briefV3);
        if (!currentBrief.approval?.approved || currentBrief.approval.approvedCanonicalChecksum !== currentBrief.briefChecksum || input.approvedBriefChecksum !== currentBrief.briefChecksum || (input.canonicalBrief && canonicalBriefChecksum(input.canonicalBrief) !== currentBrief.briefChecksum)) throw new DesignError("DESIGN_BRIEF_STALE", "The approved CanonicalBriefV3 changed before Design commit.");
      } else if (!brief || brief.documentType !== "requirements" || (!brief.approval.approvedRequirementsChecksum ? checksumPersistedDocument(brief) !== input.approvedBriefChecksum : brief.approval.approvedRequirementsChecksum !== input.approvedBriefChecksum && checksumPersistedDocument(brief) !== input.approvedBriefChecksum)) throw new DesignError("DESIGN_BRIEF_STALE", "The approved Brief changed before Design commit.");
      if (!planning || planning.documentType !== "planning-package" || (!planning.acceptance?.checksum ? checksumPersistedDocument(planning) !== input.acceptedPlanningChecksum : planning.acceptance.checksum !== input.acceptedPlanningChecksum && checksumPersistedDocument(planning) !== input.acceptedPlanningChecksum)) throw new DesignError("DESIGN_PLANNING_STALE", "Accepted Planning changed before Design commit.");
      if (!review || review.documentType !== "architecture-review" || review.result.verdict !== "APPROVED" || review.approvedBriefChecksum !== input.approvedBriefChecksum || review.acceptedPlanningChecksum !== input.acceptedPlanningChecksum) throw new DesignError("DESIGN_ARCHITECTURE_REVIEW_STALE", "Architecture Review changed before Design commit.");
      const existingRow = await tx.getDocument(input.projectId, input.projectVersion, "design-directions");
      if (!replaceExisting && existingRow) {
        const existing = mapRowToDocument(existingRow);
        if (existing.documentType === "design-directions" && existing.approvedBriefChecksum === input.approvedBriefChecksum && existing.acceptedPlanningChecksum === input.acceptedPlanningChecksum) return existing;
      }
      await saveDocumentCASInTransaction(tx, completedAttempt, attemptRow.rowVersion, attemptRow.checksum);
      return saveDocumentInTransaction(tx, committedSet, `design-directions-${input.projectId}-${input.projectVersion}-${input.idempotencyKey}`);
    }).catch(async (error) => {
      const failure = designErrorFromProvider(error);
      await this.failAttempt(attempt, "PERSISTENCE_FAILED", failure);
      throw failure;
    });
    try {
      await this.dependencies.memory.writeSnapshot(input.projectId, input.projectVersion, { "design-directions.json": persistedSet });
    } catch (error) {
      throw new DesignError("DESIGN_PROVIDER_FAILED", "Design was committed but its projection could not be synchronized.", error);
    }
    return DesignGenerationResultSchema.parse({
      directionSet: persistedSet,
      readiness: {
        ...readiness,
        directionSetChecksum: directionSetChecksum(committedSet),
      },
    });
  }
  private async admitCandidate(input: DesignAgentInput, attempt: DesignGenerationAttempt, candidate: DesignDirectionSet, replaceExisting = false) {
    let set = this.bindCanonicalContent(input, candidate);
    const providerInput = input.canonicalBrief
      ? { ...input, canonicalBrief: input.canonicalBrief, approvedBrief: input.approvedBrief }
      : input;
    if (this.professionalPipeline) {
      try {
        set = (await this.professionalPipeline.run({ projectId: input.projectId, projectVersion: input.projectVersion, directionSet: set, prompt: providerInput.approvedBrief.projectSummary, idempotencyKey: input.idempotencyKey })).directionSet;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const code = message.startsWith("DESIGN_SKILL_NOT_AVAILABLE_THROUGH_APPROVED_SOURCE") ? "DESIGN_SKILL_NOT_AVAILABLE_THROUGH_APPROVED_SOURCE" : message.startsWith("FONTPAIR_") ? "FONTPAIR_SOURCE_INTEGRATION_UNRESOLVED" : message.startsWith("IMPECCABLE_") ? "IMPECCABLE_DETECTOR_INTEGRATION_UNRESOLVED" : message.startsWith("PHASE_7F_EVIDENCE_INVALID") ? "PHASE_7F_EVIDENCE_INVALID" : message.startsWith("UNAPPROVED_DESIGN_DEPENDENCY") ? "UNAPPROVED_DESIGN_DEPENDENCY" : "DESIGN_PROVIDER_FAILED";
        const failure = new DesignError(code, "Professional design capability pipeline failed.", error);
        await this.failAttempt(attempt, "ADMISSION_FAILED", failure, [admissionFindingForPipeline(code)]);
        throw failure;
      }
    }
    set = this.bindCanonicalContent(providerInput, set);
    if (set.projectId !== input.projectId || set.projectVersion !== input.projectVersion || set.directions.length !== 3) {
      const failure = new DesignError("DESIGN_DIRECTION_COUNT_INVALID", "Exactly three directions for the current project version are required.");
      await this.failAttempt(attempt, "DOMAIN_FAILED", failure);
      throw failure;
    }
    const readiness = validateDesignDirectionSet(providerInput, set);
    if (!readiness.readyForSelection) {
      const canonicalCode = readiness.blockingReasons.find((reason) => reason.startsWith("DESIGN_CANONICAL_"));
      const code = canonicalCode
        ? canonicalCode as DesignError["code"]
        : readiness.blockingReasons.includes("DESIGN_DIRECTION_DUPLICATE")
        ? "DESIGN_DIRECTION_DUPLICATE"
        : readiness.blockingReasons.includes("DESIGN_DIRECTIONS_TOO_SIMILAR")
          ? "DESIGN_DIRECTIONS_TOO_SIMILAR"
          : readiness.blockingReasons.includes("DESIGN_DIRECTION_COUNT_INVALID")
            ? "DESIGN_DIRECTION_COUNT_INVALID"
            : "DESIGN_DIRECTION_SCHEMA_INVALID";
      const failure = new DesignError(code, `Design provider output was rejected: ${readiness.blockingReasons.slice(0, 8).join(", ") || "strict readiness validation failed"}.`, readiness);
      await this.failAttempt(attempt, "ADMISSION_FAILED", failure, admissionFindingsForReadiness(set, readiness));
      throw failure;
    }
    return this.commitDesignAdmission(input, set, attempt, readiness, replaceExisting);
  }
  private async validateInput(input: DesignAgentInput, allowReady = false) {
    const persistedV3 = await this.documents.get(input.projectId, input.projectVersion, "brief-v3");
    const canonical = persistedV3?.documentType === "brief-v3" ? BriefV3DocumentSchema.parse(persistedV3) : undefined;
    if (canonical && (!canonical.approval?.approved || canonical.approval.approvedCanonicalChecksum !== canonical.briefChecksum || (input.canonicalBrief && canonicalBriefChecksum(input.canonicalBrief) !== canonical.briefChecksum) || input.approvedBriefChecksum !== canonical.briefChecksum))
      throw new DesignError("DESIGN_BRIEF_STALE", "The Design input is not bound to the current approved CanonicalBriefV3.");
    const brief = canonical
      ? canonicalBriefToPlannerBrief(canonical.brief, RequirementSpecificationSchema.parse(input.approvedBrief), canonical.approval)
      : input.canonicalBrief
        ? canonicalBriefToPlannerBrief(input.canonicalBrief, RequirementSpecificationSchema.parse(input.approvedBrief))
        : RequirementSpecificationSchema.parse(input.approvedBrief);
    const planning = PlanningPackageSchema.parse(input.acceptedPlanningPackage);
    if (!brief.approval.approved || brief.briefStatus !== "approved")
      throw new DesignError(
        "DESIGN_BRIEF_STALE",
        "The Project Brief is not approved.",
      );
    if (!planning.accepted || !planning.architecture.acceptance.accepted)
      throw new DesignError(
        "DESIGN_PLANNING_STALE",
        "The planning package is not accepted.",
      );
    if (!canonical && input.canonicalBrief && canonicalBriefChecksum(input.canonicalBrief) !== input.approvedBriefChecksum)
      throw new DesignError("DESIGN_BRIEF_STALE", "The Design input is not bound to the current approved CanonicalBriefV3.");
    if (
      input.approvedBriefChecksum !== checksumPersistedDocument(brief) &&
      input.approvedBriefChecksum !==
        brief.approval.approvedRequirementsChecksum
    )
      throw new DesignError(
        "DESIGN_BRIEF_STALE",
        "The approved Brief checksum is stale.",
      );
    if (
      input.acceptedPlanningChecksum !== checksumPersistedDocument(planning) &&
      input.acceptedPlanningChecksum !== planning.acceptance.checksum
    )
      throw new DesignError(
        "DESIGN_PLANNING_STALE",
        "The accepted planning checksum is stale.",
      );
    if (checksumPersistedDocument(input.assetManifest) !== checksumPersistedDocument(planning.assets))
      throw new DesignError(
        "DESIGN_PLANNING_STALE",
        "The Design asset manifest is stale relative to accepted Planning.",
      );
    if (!(
      input.currentWorkflowState === "AWAITING_DESIGN_SELECTION" ||
      (allowReady && input.currentWorkflowState === "READY_FOR_IMPLEMENTATION")
    ))
      throw new DesignError(
        "DESIGN_WORKFLOW_STATE_INVALID",
        "Design work is only available before implementation.",
      );
    const architectureReview = await this.documents.get(
      input.projectId,
      input.projectVersion,
      "architecture-review",
    );
    if (
      !architectureReview ||
      architectureReview.documentType !== "architecture-review"
    )
      throw new DesignError(
        "DESIGN_ARCHITECTURE_REVIEW_REQUIRED",
        "A current approved Architecture Review is required before Design.",
      );
    const review = ArchitectureReviewRecordSchema.parse(architectureReview);
    if (
      review.result.verdict !== "APPROVED" ||
      review.approvedBriefChecksum !== input.approvedBriefChecksum ||
      review.acceptedPlanningChecksum !== input.acceptedPlanningChecksum
    )
      throw new DesignError(
        "DESIGN_ARCHITECTURE_REVIEW_STALE",
        "The approved Architecture Review is stale or not approved.",
      );
    const phase7c = await this.documents.get(
      input.projectId,
      input.projectVersion,
      "phase-7c-contract-package",
    );
    if (phase7c) {
      if (
        phase7c.documentType !== "phase-7c-contract-package" ||
        phase7c.currentness.status !== "CURRENT" ||
        phase7c.approvedBriefChecksum !== input.approvedBriefChecksum ||
        phase7c.planningChecksum !== planningSemanticChecksum(planning) ||
        phase7c.architectureChecksum !== checksumPersistedDocument(planning.architecture)
      )
        throw new DesignError(
          "DESIGN_PLANNING_STALE",
          "The current Phase 7C contract package is stale before Design.",
        );
    }
    if (brief.imagesRequired && input.imageSourceDecision === "pending")
      throw new DesignError(
        "IMAGE_SOURCE_PENDING",
        "Image sourcing must be resolved before design.",
      );
    const logoPolicy = resolveLogoPolicy(brief);
    if (
      logoPolicy.mode === "USER_SUPPLIED_LOGO" &&
      input.suppliedLogoMetadata.status !== "provided"
    )
      throw new DesignError(
        "LOGO_FILE_MISSING",
        "Required supplied logo metadata is missing.",
      );
    if (logoPolicy.mode === "TEXT_WORDMARK" && !logoPolicy.wordmarkText)
      throw new DesignError(
        "DESIGN_INPUT_INVALID",
        "Text wordmark text is missing.",
      );
    if (
      input.existingDecisions.some(
        (decision) =>
          typeof decision === "object" &&
          decision !== null &&
          "requirementChange" in decision &&
          (decision as { requirementChange?: unknown }).requirementChange ===
            true &&
          (decision as { userApprovalStatus?: unknown }).userApprovalStatus !==
            "approved",
      )
    )
      throw new DesignError(
        "UNAPPROVED_REQUIREMENT_CHANGE",
        "An unapproved requirement change blocks design.",
      );
    if (!evaluatePlanningAcceptanceReadiness({ planningPackage: planning, context: canonical ? { legalPlaceholderPolicy: canonical.brief.legal.placeholderPolicy, canonicalBrief: canonical.brief } : undefined }).readyForAcceptance)
      throw new DesignError(
        "DESIGN_BLOCKED",
        "The accepted planning package contains unresolved technical blockers.",
      );
    return { brief, planning, canonicalBrief: canonical?.brief };
  }
  async generateDesignDirections(rawInput: DesignAgentInput, options: { replaceExisting?: boolean; freshAttemptAuthorization?: unknown } = {}): Promise<DesignGenerationResult> {
    const input = this.parseInput(rawInput);
    assertWorkbenchStyleIsolation(input);
    const validated = await this.validateInput(input);
    let providerInput: DesignAgentInput = validated.canonicalBrief
      ? { ...input, approvedBrief: validated.brief, canonicalBrief: validated.canonicalBrief }
      : { ...input, approvedBrief: validated.brief };
    const project = await this.projects.getWithVersion(input.projectId);
    if (!project || project.project.currentVersion !== input.projectVersion)
      throw new DesignError(
        "DESIGN_INPUT_INVALID",
        "The project version does not match the design input.",
      );
    if (project.project.workflowState !== "AWAITING_DESIGN_SELECTION")
      throw new DesignError(
        "DESIGN_WORKFLOW_STATE_INVALID",
        "Design directions can only be generated while awaiting selection.",
      );
    if (project.rowVersion !== input.expectedRowVersion)
      throw new DesignError(
        "DESIGN_SELECTION_STALE",
        "The project row version is stale.",
      );
    const sourceHead = await this.readSourceHead();
    const persisted = await this.documents.get(input.projectId, input.projectVersion, "design-directions");
    if (!options.replaceExisting && persisted?.documentType === "design-directions" && persisted.approvedBriefChecksum === input.approvedBriefChecksum && persisted.acceptedPlanningChecksum === input.acceptedPlanningChecksum && persisted.generationIdempotencyKey && persisted.generationIdempotencyKey !== input.idempotencyKey) throw new DesignError("IDEMPOTENCY_CONFLICT", "Design generation idempotency key was reused with different input.");
    if (!options.replaceExisting && persisted?.documentType === "design-directions" && persisted.approvedBriefChecksum === input.approvedBriefChecksum && persisted.acceptedPlanningChecksum === input.acceptedPlanningChecksum) {
      try {
        await this.dependencies.memory.writeSnapshot(input.projectId, input.projectVersion, { "design-directions.json": persisted });
      } catch (error) {
        throw new DesignError("DESIGN_PROVIDER_FAILED", "Design replay could not resynchronize its projection.", error);
      }
      return DesignGenerationResultSchema.parse({ directionSet: persisted, readiness: { readyForSelection: persisted.readyForSelection, blockingReasons: persisted.blockingReasons ?? [], warnings: persisted.warnings ?? [], directionSetChecksum: directionSetChecksum(persisted) } });
    }
    const architectureReview = await this.documents.get(input.projectId, input.projectVersion, "architecture-review");
    if (!architectureReview || architectureReview.documentType !== "architecture-review") throw new DesignError("DESIGN_ARCHITECTURE_REVIEW_REQUIRED", "A current approved Architecture Review is required before Design.");
    const architectureChecksum = checksumPersistedDocument(architectureReview);
    if (validated.canonicalBrief) {
      try {
        providerInput = DesignAgentInputSchema.parse({
          ...providerInput,
          canonicalContent: buildDesignCanonicalContent({
            brief: validated.canonicalBrief,
            briefChecksum: input.approvedBriefChecksum,
            planning: validated.planning,
            planningChecksum: input.acceptedPlanningChecksum,
            architectureChecksum,
          }),
        });
      } catch (error) {
        if (error instanceof DesignError) throw error;
        throw new DesignError("DESIGN_INPUT_INVALID", "The host-owned Design canonical context did not match its strict contract.", error);
      }
    }
    try { this.provider.preflight?.(); } catch (error) { throw designErrorFromProvider(error); }
    const existingAttemptDocument = await this.documents.get(input.projectId, input.projectVersion, "design-generation-attempt");
    let attempt = existingAttemptDocument?.documentType === "design-generation-attempt"
      ? DesignGenerationAttemptSchema.parse(existingAttemptDocument)
      : undefined;
    const freshAttemptAuthorization = options.freshAttemptAuthorization === undefined ? undefined : DesignFreshAttemptAuthorizationSchema.parse(options.freshAttemptAuthorization);
    if (freshAttemptAuthorization && !options.replaceExisting) throw new DesignError("IDEMPOTENCY_CONFLICT", "A fresh Design attempt authorization must explicitly replace the current attempt frontier.");
    if (attempt?.state === "OUTCOME_UNKNOWN" && !freshAttemptAuthorization) throw new DesignError("DESIGN_OUTCOME_UNKNOWN", "The Design provider outcome remains unknown. Explicit fresh-attempt authority is required before another provider call.");
    if (attempt && attempt.operationKey === input.idempotencyKey) {
      if (attempt.approvedBriefChecksum !== input.approvedBriefChecksum || attempt.acceptedPlanningChecksum !== input.acceptedPlanningChecksum || attempt.architectureChecksum !== architectureChecksum || attempt.expectedRowVersion !== input.expectedRowVersion) throw new DesignError("DESIGN_CONTRACT_STALE", "The Design operation is bound to stale canonical inputs.");
      if (attempt.state === "PERSISTED" && persisted?.documentType === "design-directions") {
        try { await this.dependencies.memory.writeSnapshot(input.projectId, input.projectVersion, { "design-directions.json": persisted }); } catch (error) { throw new DesignError("DESIGN_PROVIDER_FAILED", "Design replay could not resynchronize its projection.", error); }
        return DesignGenerationResultSchema.parse({ directionSet: persisted, readiness: { readyForSelection: persisted.readyForSelection, blockingReasons: persisted.blockingReasons ?? [], warnings: persisted.warnings ?? [], directionSetChecksum: directionSetChecksum(persisted) } });
      }
      if (attempt.state === "REPLAY_STARTED") throw new DesignError("DESIGN_PROVIDER_FAILED", "A zero-call Design candidate replay is already active and will not be replaced by provider generation.", attempt.failureDiagnostic, undefined, attempt.failureDiagnostic);
      if (["PROVIDER_FAILED", "WIRE_FAILED", "DOMAIN_FAILED", "ADMISSION_FAILED", "PERSISTENCE_FAILED"].includes(attempt.state) && !freshAttemptAuthorization) throw new DesignError((attempt.failureCode as DesignError["code"] | undefined) ?? "DESIGN_PROVIDER_FAILED", "The Design operation has a durable terminal failure and will not be retried without explicit fresh-attempt authority.", attempt.failureDiagnostic, undefined, attempt.failureDiagnostic);
      if (attempt.state === "PROVIDER_STARTED" || (attempt.state === "OUTCOME_UNKNOWN" && !freshAttemptAuthorization)) throw new DesignError("DESIGN_OUTCOME_UNKNOWN", "The Design provider attempt has an indeterminate durable outcome and requires explicit fresh-attempt authority before another provider call.", attempt.failureDiagnostic, undefined, attempt.failureDiagnostic);
    } else if (attempt && !options.replaceExisting) {
      throw new DesignError("IDEMPOTENCY_CONFLICT", "A different Design generation operation is already bound to the current project.");
    }
    const previousAttempt = attempt;
    if (attempt && (attempt.operationKey !== input.idempotencyKey || Boolean(freshAttemptAuthorization)) && options.replaceExisting) await this.preserveAttemptHistory(attempt);
    attempt = DesignGenerationAttemptSchema.parse({
      schemaVersion: 1,
      documentType: "design-generation-attempt",
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      createdAt: now(),
      updatedAt: now(),
      attemptId: randomUUID(),
      operationKey: input.idempotencyKey,
      state: "CREATED",
      expectedRowVersion: input.expectedRowVersion,
      approvedBriefChecksum: input.approvedBriefChecksum,
      acceptedPlanningChecksum: input.acceptedPlanningChecksum,
      architectureChecksum,
      ...(providerInput.canonicalContent ? { canonicalContentChecksum: providerInput.canonicalContent.contentChecksum } : {}),
      selectedSkillIds: [],
      selectedSkillChecksums: [],
      ...(sourceHead ? { sourceHead } : {}),
      executionEvidence: executionEvidence("NOT_STARTED"),
      ...(freshAttemptAuthorization ? { freshAttemptAuthorization } : {}),
    });
    attempt = await this.saveAttempt(attempt, previousAttempt);
    attempt = await this.saveAttempt(DesignGenerationAttemptSchema.parse({ ...attempt, state: "CLAIMED", updatedAt: now() }), attempt);
    let skillSelection: AgentSkillSelection | undefined;
    try {
      skillSelection = this.resolveSkills
        ? await this.resolveSkills(providerInput)
        : undefined;
      attempt = await this.saveAttempt(DesignGenerationAttemptSchema.parse({ ...attempt, selectedSkillIds: skillSelection?.selectedSkillIds ?? [], selectedSkillChecksums: skillSelection?.selectedSkillChecksums ?? [], updatedAt: now() }), attempt);
      await this.skills.select({ role: "design", taskType: "visual-direction" });
      await this.explorationTool.explore(providerInput).catch(() => null);
      attempt = await this.saveAttempt(DesignGenerationAttemptSchema.parse({ ...attempt, state: "PROVIDER_STARTED", executionEvidence: executionEvidence("STARTED", attempt.executionEvidence), updatedAt: now() }), attempt);
    } catch (error) {
      const failure = designErrorFromProvider(error);
      try {
        await this.failAttempt(attempt, "PROVIDER_FAILED", failure);
      } catch {
        // Preserve the original setup failure; the operation ledger still records it.
      }
      throw failure;
    }
    let set: DesignDirectionSet;
    try {
      set = DesignDirectionSetSchema.parse(
        await this.provider.proposeDesignDirections(
          providerInput,
          skillSelection?.contexts,
          skillSelection?.identityChecksum,
        ),
      );
    } catch (error) {
      const failure = designErrorFromProvider(error);
      await this.failAttempt(attempt, providerFailureState(error), failure);
      throw failure;
    }
    const providerObservation = observationForSet(set);
    const normalizedCandidateChecksum = directionSetChecksum(set);
    const providerResultChecksum = providerObservation?.rawContentChecksum ?? normalizedCandidateChecksum;
    attempt = await this.saveAttempt(DesignGenerationAttemptSchema.parse({
      ...attempt,
      ...(providerObservation ? { providerObservation, ...providerAttemptFields(providerObservation) } : { providerAttempted: true, responseReceived: true }),
      executionEvidence: executionEvidence("RESPONSE_RECEIVED", attempt.executionEvidence),
      providerResultChecksum,
      normalizedCandidateSchemaVersion: 1,
      normalizedCandidateChecksum,
      normalizedCandidate: set,
      updatedAt: now(),
    }), attempt);
    return this.admitCandidate(providerInput, attempt, set, Boolean(options.replaceExisting));
  }
  async reconcileIndeterminateDesignAttempt(rawRequest: DesignOutcomeUnknownReconciliationRequest): Promise<DesignGenerationAttempt> {
    let request: DesignOutcomeUnknownReconciliationRequest;
    try {
      request = DesignOutcomeUnknownReconciliationRequestSchema.parse(rawRequest);
    } catch (error) {
      throw new DesignError("DESIGN_INPUT_INVALID", "Design outcome reconciliation input did not match the strict contract.", error);
    }
    const reconciledAt = now();
    return this.dependencies.database.transaction(async (tx) => {
      const projectRow = await tx.getProject(request.projectId);
      const versionRow = await tx.getVersion(request.projectId, request.projectVersion);
      if (!projectRow || !versionRow || projectRow.current_version !== request.projectVersion || projectRow.workflow_state !== "AWAITING_DESIGN_SELECTION" || projectRow.row_version !== request.expectedRowVersion || versionRow.immutable) {
        throw new DesignError("DESIGN_SELECTION_STALE", "The indeterminate Design attempt is not current for reconciliation.");
      }
      const briefRow = await tx.getDocument(request.projectId, request.projectVersion, "brief-v3");
      const planningRow = await tx.getDocument(request.projectId, request.projectVersion, "planning-package");
      const reviewRow = await tx.getDocument(request.projectId, request.projectVersion, "architecture-review");
      const attemptRow = await tx.getDocument(request.projectId, request.projectVersion, "design-generation-attempt");
      const directionsRow = await tx.getDocument(request.projectId, request.projectVersion, "design-directions");
      if (!briefRow || !planningRow || !reviewRow || !attemptRow || directionsRow) throw new DesignError("DESIGN_CONTRACT_STALE", "The Design reconciliation inputs are incomplete or a canonical Design result already exists.");
      const brief = BriefV3DocumentSchema.parse(mapRowToDocument(briefRow));
      const planning = PlanningPackageSchema.parse(mapRowToDocument(planningRow));
      const review = ArchitectureReviewRecordSchema.parse(mapRowToDocument(reviewRow));
      const attempt = DesignGenerationAttemptSchema.parse(mapRowToDocument(attemptRow));
      const planningChecksum = checksumPersistedDocument(planning);
      const reviewChecksum = checksumPersistedDocument(review);
      if (!brief.approval?.approved || brief.approval.approvedCanonicalChecksum !== brief.briefChecksum || attempt.approvedBriefChecksum !== brief.briefChecksum || !planning.accepted || attempt.acceptedPlanningChecksum !== planningChecksum || review.result.verdict !== "APPROVED" || review.approvedBriefChecksum !== brief.briefChecksum || review.acceptedPlanningChecksum !== planningChecksum || attempt.architectureChecksum !== reviewChecksum) {
        throw new DesignError("DESIGN_CONTRACT_STALE", "An approved upstream Design input changed before outcome reconciliation.");
      }
      if (attempt.projectId !== request.projectId || attempt.projectVersion !== request.projectVersion || attempt.operationKey !== request.operationKey || attempt.expectedRowVersion !== request.expectedRowVersion || attempt.attemptId !== request.attemptId) {
        throw new DesignError("DESIGN_CONTRACT_STALE", "The reconciliation request is not bound to the current Design attempt.");
      }
      const operation = await tx.getOperation({ operation: "workbench.design", key: request.operationKey, payloadHash: request.operationPayloadHash });
      const operationResult = operation?.result && typeof operation.result === "object" && !Array.isArray(operation.result) ? operation.result as Record<string, unknown> : undefined;
      const operationAttemptId = typeof operationResult?.attemptId === "string" ? operationResult.attemptId : undefined;
      if (!operation || (operationAttemptId !== undefined && operationAttemptId !== request.attemptId)) throw new DesignError("DESIGN_CONTRACT_STALE", "The current Design operation is not fenced to the requested attempt.");
      if (attempt.state === "OUTCOME_UNKNOWN") {
        if (attempt.outcomeUnknown?.sourceAttemptChecksum !== request.expectedAttemptChecksum || operation.status !== "FAILED" || operationResult?.code !== "OUTCOME_UNKNOWN") throw new DesignError("DESIGN_CONTRACT_STALE", "The existing Design outcome reconciliation does not match this request.");
        return attempt;
      }
      if (attempt.state !== "PROVIDER_STARTED" || attemptRow.checksum !== request.expectedAttemptChecksum || operation.status !== "IN_PROGRESS") throw new DesignError("DESIGN_CONTRACT_STALE", "The Design attempt is no longer eligible for outcome reconciliation.");
      const outcomeUnknown = {
        schemaVersion: 1 as const,
        code: "OUTCOME_UNKNOWN" as const,
        sourceState: "PROVIDER_STARTED" as const,
        providerReceipt: "UNKNOWN" as const,
        providerUsage: "UNKNOWN" as const,
        providerCost: "UNKNOWN" as const,
        reconciledAt,
        reconciledBy: "workbench-design-reconciliation",
        sourceAttemptChecksum: request.expectedAttemptChecksum,
      };
      const reconciledAttempt = DesignGenerationAttemptSchema.parse({
        ...attempt,
        state: "OUTCOME_UNKNOWN",
        updatedAt: reconciledAt,
        failureCode: "OUTCOME_UNKNOWN",
        outcomeUnknown,
        ...(attempt.executionEvidence ? { executionEvidence: executionEvidence("RESPONSE_UNKNOWN", attempt.executionEvidence, reconciledAt) } : {}),
      });
      const historyRow = await tx.getDocument(request.projectId, request.projectVersion, "design-generation-attempt-history");
      const existingHistory = historyRow ? DesignGenerationAttemptHistorySchema.parse(mapRowToDocument(historyRow)) : undefined;
      if (!existingHistory?.records.some((record) => record.attemptId === attempt.attemptId)) {
        const history = DesignGenerationAttemptHistorySchema.parse({
          schemaVersion: 1,
          documentType: "design-generation-attempt-history",
          projectId: request.projectId,
          projectVersion: request.projectVersion,
          createdAt: existingHistory?.createdAt ?? attempt.createdAt,
          updatedAt: reconciledAt,
          records: [...(existingHistory?.records ?? []), attempt],
        });
        await saveDocumentCASInTransaction(tx, history, historyRow?.rowVersion ?? null, historyRow?.checksum ?? null);
      }
      await saveDocumentCASInTransaction(tx, reconciledAttempt, attemptRow.rowVersion, attemptRow.checksum);
      await tx.failOperation({
        operation: "workbench.design",
        key: request.operationKey,
        payloadHash: request.operationPayloadHash,
        result: {
          status: "FAILED",
          code: "OUTCOME_UNKNOWN",
          outcome: "OUTCOME_UNKNOWN",
          attemptId: request.attemptId,
          providerReceipt: "UNKNOWN",
          providerUsage: "UNKNOWN",
          providerCost: "UNKNOWN",
          canonicalDesignPersisted: false,
          reconciledAt,
        },
      });
      return reconciledAttempt;
    });
  }
  async replayDesignCandidate(rawRequest: DesignCandidateReplayRequest): Promise<DesignGenerationResult> {
    let request: DesignCandidateReplayRequest;
    try {
      request = DesignCandidateReplayRequestSchema.parse(rawRequest);
    } catch (error) {
      throw new DesignError("DESIGN_INPUT_INVALID", "Design candidate replay input did not match the strict contract.", error);
    }
    const current = await this.projects.getWithVersion(request.projectId);
    if (!current || current.project.currentVersion !== request.projectVersion || current.project.workflowState !== "AWAITING_DESIGN_SELECTION") throw new DesignError("DESIGN_SELECTION_STALE", "The Design candidate replay is not current for this project version.");
    if (current.rowVersion !== request.expectedRowVersion) throw new DesignError("DESIGN_SELECTION_STALE", "The Design candidate replay row version is stale.");
    const durable = await this.loadDurableContext(request.projectId, request.projectVersion, request.operationKey);
    const input = DesignAgentInputSchema.parse({ ...durable, idempotencyKey: request.operationKey, expectedRowVersion: request.expectedRowVersion });
    const validated = await this.validateInput(input);
    let admissionInput = DesignAgentInputSchema.parse({
      ...input,
      approvedBrief: validated.brief,
      canonicalBrief: validated.canonicalBrief ?? input.canonicalBrief,
      acceptedPlanningPackage: validated.planning,
      contentPlan: validated.planning.content,
      assetManifest: validated.planning.assets,
    });
    const persisted = await this.documents.get(request.projectId, request.projectVersion, "design-directions");
    if (persisted?.documentType === "design-directions") {
      if (persisted.generationIdempotencyKey === request.operationKey && persisted.approvedBriefChecksum === input.approvedBriefChecksum && persisted.acceptedPlanningChecksum === input.acceptedPlanningChecksum) {
        try {
          await this.dependencies.memory.writeSnapshot(request.projectId, request.projectVersion, { "design-directions.json": persisted });
        } catch (error) {
          throw new DesignError("DESIGN_PROVIDER_FAILED", "Design replay could not resynchronize its projection.", error);
        }
        return DesignGenerationResultSchema.parse({ directionSet: persisted, readiness: { readyForSelection: persisted.readyForSelection, blockingReasons: persisted.blockingReasons ?? [], warnings: persisted.warnings ?? [], directionSetChecksum: directionSetChecksum(persisted) } });
      }
      throw new DesignError("IDEMPOTENCY_CONFLICT", "A different current Design direction set already exists for this project.");
    }
    const currentAttemptDocument = await this.documents.get(request.projectId, request.projectVersion, "design-generation-attempt");
    const currentAttempt = currentAttemptDocument?.documentType === "design-generation-attempt" ? DesignGenerationAttemptSchema.parse(currentAttemptDocument) : undefined;
    const historyDocument = await this.documents.get(request.projectId, request.projectVersion, "design-generation-attempt-history");
    const history = historyDocument?.documentType === "design-generation-attempt-history" ? DesignGenerationAttemptHistorySchema.parse(historyDocument) : undefined;
    const existingReplay = currentAttempt?.operationKey === request.operationKey ? currentAttempt : undefined;
    if (existingReplay && existingReplay.state !== "REPLAY_STARTED") throw new DesignError("DESIGN_PROVIDER_FAILED", "The Design replay operation has a durable terminal outcome and will not be retried.", existingReplay.failureDiagnostic, undefined, existingReplay.failureDiagnostic);
    if (existingReplay && existingReplay.replayOfAttemptId !== request.historicalAttemptId) throw new DesignError("IDEMPOTENCY_CONFLICT", "The Design replay operation is bound to a different historical attempt.");
    const sourceAttempt = existingReplay
      ? existingReplay
      : currentAttempt?.attemptId === request.historicalAttemptId
        ? currentAttempt
        : history?.records.find((record) => record.attemptId === request.historicalAttemptId);
    if (!sourceAttempt?.normalizedCandidate || sourceAttempt.normalizedCandidateSchemaVersion !== 1 || !sourceAttempt.normalizedCandidateChecksum || !sourceAttempt.providerResultChecksum) throw new DesignError("DESIGN_PROVIDER_FAILED", "The requested Design attempt has no replayable typed candidate.");
    if (sourceAttempt.projectId !== request.projectId || sourceAttempt.projectVersion !== request.projectVersion || sourceAttempt.expectedRowVersion !== request.expectedRowVersion || sourceAttempt.approvedBriefChecksum !== input.approvedBriefChecksum || sourceAttempt.acceptedPlanningChecksum !== input.acceptedPlanningChecksum) throw new DesignError("DESIGN_CONTRACT_STALE", "The persisted Design candidate is not bound to the current canonical inputs.");
    const architectureReview = await this.documents.get(request.projectId, request.projectVersion, "architecture-review");
    if (!architectureReview || architectureReview.documentType !== "architecture-review" || checksumPersistedDocument(architectureReview) !== sourceAttempt.architectureChecksum) throw new DesignError("DESIGN_ARCHITECTURE_REVIEW_STALE", "The persisted Design candidate is not bound to the current approved Architecture Review.");
    if (validated.canonicalBrief) {
      admissionInput = DesignAgentInputSchema.parse({
        ...admissionInput,
        canonicalContent: buildDesignCanonicalContent({
          brief: validated.canonicalBrief,
          briefChecksum: input.approvedBriefChecksum,
          planning: validated.planning,
          planningChecksum: input.acceptedPlanningChecksum,
          architectureChecksum: checksumPersistedDocument(architectureReview),
        }),
      });
    }
    if (sourceAttempt.canonicalContentChecksum && sourceAttempt.canonicalContentChecksum !== admissionInput.canonicalContent?.contentChecksum) throw new DesignError("DESIGN_CANONICAL_CONTENT_STALE", "The persisted Design candidate is not bound to the current host-owned canonical content.");
    const sourceHead = await this.readSourceHead();
    if (sourceHead && !sourceAttempt.sourceHead) throw new DesignError("DESIGN_CONTRACT_STALE", "The persisted Design candidate has no source-head binding.");
    const candidate = DesignDirectionSetSchema.parse(sourceAttempt.normalizedCandidate);
    const candidateChecksum = directionSetChecksum(candidate);
    if (candidate.projectId !== request.projectId || candidate.projectVersion !== request.projectVersion || candidateChecksum !== sourceAttempt.normalizedCandidateChecksum) throw new DesignError("DESIGN_CONTRACT_STALE", "The persisted Design candidate checksum or project binding is invalid.");
    let attempt = existingReplay;
    if (!attempt) {
      const previousAttempt = currentAttempt;
      if (currentAttempt) await this.preserveAttemptHistory(currentAttempt);
      const observation = sourceAttempt.providerObservation;
      attempt = DesignGenerationAttemptSchema.parse({
        schemaVersion: 1,
        documentType: "design-generation-attempt",
        projectId: request.projectId,
        projectVersion: request.projectVersion,
        createdAt: now(),
        updatedAt: now(),
        attemptId: randomUUID(),
        operationKey: request.operationKey,
        state: "REPLAY_STARTED",
        expectedRowVersion: request.expectedRowVersion,
        approvedBriefChecksum: input.approvedBriefChecksum,
        acceptedPlanningChecksum: input.acceptedPlanningChecksum,
        architectureChecksum: checksumPersistedDocument(architectureReview),
        ...(admissionInput.canonicalContent ? { canonicalContentChecksum: admissionInput.canonicalContent.contentChecksum } : {}),
        selectedSkillIds: sourceAttempt.selectedSkillIds,
        selectedSkillChecksums: sourceAttempt.selectedSkillChecksums,
        ...(sourceHead ? { sourceHead } : {}),
        ...(sourceAttempt.providerAttempted === undefined ? {} : { providerAttempted: sourceAttempt.providerAttempted }),
        ...(sourceAttempt.responseReceived === undefined ? {} : { responseReceived: sourceAttempt.responseReceived }),
        ...(sourceAttempt.providerModel ? { providerModel: sourceAttempt.providerModel } : {}),
        ...(sourceAttempt.providerRequestId ? { providerRequestId: sourceAttempt.providerRequestId } : {}),
        ...(sourceAttempt.finishReason !== undefined ? { finishReason: sourceAttempt.finishReason } : {}),
        ...(sourceAttempt.inputTokens === undefined ? {} : { inputTokens: sourceAttempt.inputTokens }),
        ...(sourceAttempt.outputTokens === undefined ? {} : { outputTokens: sourceAttempt.outputTokens }),
        ...(sourceAttempt.totalTokens === undefined ? {} : { totalTokens: sourceAttempt.totalTokens }),
        providerResultChecksum: sourceAttempt.providerResultChecksum,
        normalizedCandidateSchemaVersion: 1,
        normalizedCandidateChecksum: candidateChecksum,
        normalizedCandidate: candidate,
        replayOfAttemptId: sourceAttempt.attemptId,
        replayProviderResultChecksum: sourceAttempt.providerResultChecksum,
        replayNormalizedCandidateChecksum: candidateChecksum,
        ...(observation ? { providerObservation: observation } : {}),
      });
      attempt = await this.saveAttempt(attempt, previousAttempt);
    }
    return this.admitCandidate(admissionInput, attempt, candidate);
  }
  async invalidateDesignDirectionSet(rawRequest: DesignAdmissionInvalidationRequest): Promise<DesignGenerationAttempt> {
    let request: DesignAdmissionInvalidationRequest;
    try {
      request = DesignAdmissionInvalidationRequestSchema.parse(rawRequest);
    } catch (error) {
      throw new DesignError("DESIGN_INPUT_INVALID", "Design admission invalidation input did not match the strict contract.", error);
    }
    const current = await this.projects.getWithVersion(request.projectId);
    if (!current || current.project.currentVersion !== request.projectVersion || current.project.workflowState !== "AWAITING_DESIGN_SELECTION" || current.rowVersion !== request.expectedRowVersion) throw new DesignError("DESIGN_SELECTION_STALE", "The Design admission invalidation is not current for this project version.");
    const directionDocument = await this.documents.get(request.projectId, request.projectVersion, "design-directions");
    if (!directionDocument || directionDocument.documentType !== "design-directions" || directionSetChecksum(directionDocument) !== request.directionSetChecksum) throw new DesignError("DESIGN_SET_CHECKSUM_MISMATCH", "The Design admission invalidation does not reference the current direction set.");
    const currentAttemptDocument = await this.documents.get(request.projectId, request.projectVersion, "design-generation-attempt");
    const currentAttempt = currentAttemptDocument?.documentType === "design-generation-attempt" ? DesignGenerationAttemptSchema.parse(currentAttemptDocument) : undefined;
    if (currentAttempt?.operationKey === request.operationKey && currentAttempt.state === "ADMISSION_FAILED") return currentAttempt;
    const findings = [admissionFinding({ code: "DESIGN_CANONICAL_CONTENT_STALE", expectedInvariant: "The current Design direction set must remain bound to the host-owned canonical content projection.", actualCategory: "DESIGN_CANONICAL_CONTENT_STALE", validatorPredicate: "validateDesignDirectionSet", directionIndex: null, fieldPath: "direction.canonicalContent" })];
    const invalidatedAttempt = DesignGenerationAttemptSchema.parse({
      ...(currentAttempt ?? {
        schemaVersion: 1,
        documentType: "design-generation-attempt",
        projectId: request.projectId,
        projectVersion: request.projectVersion,
        createdAt: now(),
        attemptId: randomUUID(),
        expectedRowVersion: request.expectedRowVersion,
        approvedBriefChecksum: directionDocument.approvedBriefChecksum ?? "0".repeat(64),
        acceptedPlanningChecksum: directionDocument.acceptedPlanningChecksum ?? "0".repeat(64),
        architectureChecksum: "0".repeat(64),
        selectedSkillIds: [],
        selectedSkillChecksums: [],
      }),
      updatedAt: now(),
      attemptId: randomUUID(),
      operationKey: request.operationKey,
      state: "ADMISSION_FAILED",
      expectedRowVersion: request.expectedRowVersion,
      failureCode: "DESIGN_CANONICAL_CONTENT_STALE",
      admissionFindingCount: findings.length,
      admissionFindingsChecksum: checksumPersistedDocument(findings),
      admissionFindings: findings,
      ...(currentAttempt?.replayOfAttemptId ? { replayOfAttemptId: currentAttempt.replayOfAttemptId } : currentAttempt ? { replayOfAttemptId: currentAttempt.attemptId } : {}),
      ...(currentAttempt?.providerResultChecksum ? { replayProviderResultChecksum: currentAttempt.providerResultChecksum } : {}),
      ...(currentAttempt?.normalizedCandidateChecksum ? { replayNormalizedCandidateChecksum: currentAttempt.normalizedCandidateChecksum } : {}),
    });
    await this.dependencies.database.transaction(async (tx) => {
      const projectRow = await tx.getProject(request.projectId);
      const directionRow = await tx.getDocument(request.projectId, request.projectVersion, "design-directions");
      if (!projectRow || projectRow.current_version !== request.projectVersion || projectRow.workflow_state !== "AWAITING_DESIGN_SELECTION" || projectRow.row_version !== request.expectedRowVersion || !directionRow || directionRow.checksum !== checksumPersistedDocument(directionDocument)) throw new DesignError("DESIGN_SELECTION_STALE", "The Design admission invalidation became stale before its canonical commit.");
      if (currentAttempt) {
        const historyRow = await tx.getDocument(request.projectId, request.projectVersion, "design-generation-attempt-history");
        const priorHistory = historyRow ? mapRowToDocument(historyRow) : undefined;
        const history = priorHistory?.documentType === "design-generation-attempt-history" ? DesignGenerationAttemptHistorySchema.parse(priorHistory) : undefined;
        if (!history?.records.some((record) => record.attemptId === currentAttempt.attemptId)) await saveDocumentInTransaction(tx, DesignGenerationAttemptHistorySchema.parse({ schemaVersion: 1, documentType: "design-generation-attempt-history", projectId: request.projectId, projectVersion: request.projectVersion, createdAt: history?.createdAt ?? currentAttempt.createdAt, updatedAt: now(), records: [...(history?.records ?? []), currentAttempt] }));
      }
      await tx.deleteDocument(request.projectId, request.projectVersion, "design-directions");
      await saveDocumentInTransaction(tx, invalidatedAttempt);
    });
    await this.dependencies.memory.removeDocument?.(request.projectId, request.projectVersion, "design-directions");
    return invalidatedAttempt;
  }
  async reconcileDesignProjection(projectId: string, projectVersion: number) {
    const set = await this.documents.get(projectId, projectVersion, "design-directions");
    const selected = await this.documents.get(projectId, projectVersion, "selected-design");
    if (!set || set.documentType !== "design-directions") throw new DesignError("DESIGN_SET_NOT_READY", "No canonical Design direction set is available.");
    await this.dependencies.memory.writeSnapshot(projectId, projectVersion, { "design-directions.json": set, ...(selected?.documentType === "selected-design" ? { "selected-design.json": selected } : {}) });
    return { set, selected: selected?.documentType === "selected-design" ? selected : null };
  }
  async getDesignDirectionSet(projectId: string, projectVersion: number) {
    const set = await this.documents.get(projectId, projectVersion, "design-directions");
    if (!set || set.documentType !== "design-directions")
      throw new DesignError(
        "DESIGN_SET_NOT_READY",
        "No design direction set is available.",
      );
    return set;
  }
  async validateDesignDirectionSet(projectId: string, projectVersion: number) {
    const set = await this.getDesignDirectionSet(projectId, projectVersion);
    let context = await this.loadDurableContext(projectId, projectVersion);
    const architectureReview = await this.documents.get(projectId, projectVersion, "architecture-review");
    if (context.canonicalBrief && architectureReview?.documentType === "architecture-review") {
      context = DesignAgentInputSchema.parse({
        ...context,
        canonicalContent: buildDesignCanonicalContent({
          brief: context.canonicalBrief,
          briefChecksum: context.approvedBriefChecksum,
          planning: context.acceptedPlanningPackage,
          planningChecksum: context.acceptedPlanningChecksum,
          architectureChecksum: checksumPersistedDocument(architectureReview),
        }),
      });
    }
    const readiness = validateDesignDirectionSet(context, set);
    return { set, readiness };
  }
  async getDesignSelectionStatus(projectId: string, projectVersion: number) {
    const set = await this.getDesignDirectionSet(projectId, projectVersion);
    const selected = await this.documents.get(
      projectId,
      projectVersion,
      "selected-design",
    );
    return {
      set,
      selected: selected?.documentType === "selected-design" ? selected : null,
      readyForSelection: set.readyForSelection,
      directionSetChecksum: directionSetChecksum(set),
    };
  }
  async selectDesignDirection(rawInput: DesignSelectionRequest) {
    let request: DesignSelectionRequest;
    try {
      request = DesignSelectionRequestSchema.parse(rawInput);
    } catch (error) {
      throw new DesignError(
        "DESIGN_INPUT_INVALID",
        "Design selection input did not match the strict contract.",
        error,
      );
    }
    const current = await this.projects.getWithVersion(request.projectId);
    if (!current || current.project.currentVersion !== request.projectVersion)
      throw new DesignError(
        "DESIGN_SELECTION_STALE",
        "The project version is stale.",
      );
    const reviewDocument = await this.documents.get(
      request.projectId,
      request.projectVersion,
      "architecture-review",
    );
    const directionDocument = await this.documents.get(
      request.projectId,
      request.projectVersion,
      "design-directions",
    );
    if (
      !reviewDocument ||
      reviewDocument.documentType !== "architecture-review" ||
      reviewDocument.result.verdict !== "APPROVED" ||
      !directionDocument ||
      directionDocument.documentType !== "design-directions" ||
      directionDocument.acceptedPlanningChecksum !==
        reviewDocument.acceptedPlanningChecksum
    )
      throw new DesignError(
        "DESIGN_ARCHITECTURE_REVIEW_STALE",
        "A current approved Architecture Review is required for Design selection.",
      );
    const existing = await this.documents.get(request.projectId, request.projectVersion, "selected-design");
    const set = await this.getDesignDirectionSet(
      request.projectId,
      request.projectVersion,
    );
    if (!set.readyForSelection)
      throw new DesignError(
        "DESIGN_SET_NOT_READY",
        "The design direction set is not ready for selection.",
      );
    if (directionSetChecksum(set) !== request.directionSetChecksum)
      throw new DesignError(
        "DESIGN_SET_CHECKSUM_MISMATCH",
        "The design direction set checksum is stale.",
      );
    const direction = set.directions.find(
      (candidate) => candidate.id === request.selectedDirectionId,
    );
    if (!direction)
      throw new DesignError(
        "DESIGN_DIRECTION_NOT_FOUND",
        "The selected direction is not part of the current set.",
      );
    if (directionChecksum(direction) !== request.selectedDirectionChecksum)
      throw new DesignError(
        "DESIGN_SELECTION_STALE",
        "The selected direction checksum is stale.",
      );
    if (direction.professionalDesign?.motion.suitability === "MOTION") {
      const amendment = await this.documents.get(request.projectId, request.projectVersion, "design-dependency-amendment");
      if (!amendment || amendment.documentType !== "design-dependency-amendment" || DesignDependencyAmendmentSchema.parse(amendment).status !== "USER_APPROVED" || amendment.directionId !== direction.id) throw new DesignError("UNAPPROVED_DESIGN_DEPENDENCY", "The selected direction requires a user-approved Motion dependency amendment before implementation.");
    }
    if (existing?.documentType === "selected-design") {
      if (existing.selectionIdempotencyKey && existing.selectionIdempotencyKey !== request.idempotencyKey) throw new DesignError("DESIGN_SELECTION_CONFLICT", "Design selection idempotency key was reused with different input.");
      if (existing.directionSetId === request.designDirectionSetId && existing.selectedDirectionId === request.selectedDirectionId && existing.selectedDirectionChecksum === request.selectedDirectionChecksum) {
        try {
          await this.dependencies.memory.writeSnapshot(request.projectId, request.projectVersion, { "design-directions.json": set, "selected-design.json": existing });
          const selectionDecision = (await this.decisions.list(request.projectId, request.projectVersion)).find((decision) => decision.category === "design-selection");
          if (selectionDecision) await this.dependencies.memory.appendDecision(request.projectId, request.projectVersion, selectionDecision);
        } catch (error) {
          throw new DesignError("DESIGN_PROVIDER_FAILED", "Design selection replay could not resynchronize its projection.", error);
        }
        return { selectedDesign: existing, projectState: "READY_FOR_IMPLEMENTATION" as const, rowVersion: (await this.projects.getWithVersion(request.projectId))?.rowVersion ?? request.expectedRowVersion };
      }
    }
    if (
      !current ||
      current.project.workflowState !== "AWAITING_DESIGN_SELECTION"
    )
      throw new DesignError(
        "DESIGN_WORKFLOW_STATE_INVALID",
        "Selection is only available while awaiting design selection.",
      );
    if (current.rowVersion !== request.expectedRowVersion)
      throw new DesignError(
        "DESIGN_SELECTION_STALE",
        "The project row version is stale.",
      );
    const requirementsDocument = await this.documents.get(
      request.projectId,
      request.projectVersion,
      "requirements",
    );
    const briefV3Document = await this.documents.get(
      request.projectId,
      request.projectVersion,
      "brief-v3",
    );
    const planning = await this.documents.get(
      request.projectId,
      request.projectVersion,
      "planning-package",
    );
    const canonicalBrief = briefV3Document?.documentType === "brief-v3"
      ? BriefV3DocumentSchema.parse(briefV3Document)
      : undefined;
    if (!requirementsDocument || requirementsDocument.documentType !== "requirements")
      throw new DesignError(
        "DESIGN_BRIEF_STALE",
        "Approved requirements are unavailable.",
      );
    const requirements = canonicalBrief
      ? canonicalBriefToPlannerBrief(
          canonicalBrief.brief,
          requirementsDocument,
          canonicalBrief.approval,
        )
      : requirementsDocument;
    if (canonicalBrief
      ? !canonicalBrief.approval?.approved
        || canonicalBrief.approval.approvedCanonicalChecksum !== canonicalBrief.briefChecksum
        || directionDocument.approvedBriefChecksum !== canonicalBrief.briefChecksum
        || reviewDocument.approvedBriefChecksum !== canonicalBrief.briefChecksum
      : !requirements.approval.approved)
      throw new DesignError(
        "DESIGN_BRIEF_STALE",
        "The approved Brief is unavailable or stale.",
      );
    if (
      !planning ||
      planning.documentType !== "planning-package" ||
      !planning.accepted
    )
      throw new DesignError(
        "DESIGN_PLANNING_STALE",
        "Accepted planning package is unavailable.",
      );
    const decisions = await this.decisions.list(
      request.projectId,
      request.projectVersion,
    );
    if (
      decisions.some(
        (decision) =>
          decision.requirementChange &&
          decision.userApprovalStatus !== "approved",
      )
    )
      throw new DesignError(
        "UNAPPROVED_REQUIREMENT_CHANGE",
        "An unapproved requirement change blocks selection.",
      );
    const selected = SelectedDesignSchema.parse({
      schemaVersion: 1,
      documentType: "selected-design",
      projectId: request.projectId,
      projectVersion: request.projectVersion,
      createdAt: request.selectedAt,
      updatedAt: request.selectedAt,
      directionSetId: request.designDirectionSetId,
      selectedDirectionId: request.selectedDirectionId,
      selectedAt: request.selectedAt,
      selectedBy: request.selectedBy,
      selectionNotes: request.selectionNotes ?? "",
      selectedDirectionChecksum: request.selectedDirectionChecksum,
      selectionIdempotencyKey: request.idempotencyKey,
      ...(direction.professionalDesign ? { selectedDirectionContract: direction.professionalDesign } : {}),
      ...(direction.professionalDesign ? { designContract: { directionSetChecksum: directionSetChecksum(set), selectedDirectionChecksum: request.selectedDirectionChecksum, visualSystemChecksum: direction.professionalDesign.visualSystem.tokenChecksum, typographyChecksum: direction.professionalDesign.typography.checksum, motionChecksum: direction.professionalDesign.motion.checksum, interactionChecksum: checksumPersistedDocument(direction.professionalDesign.interactions), selectedAt: request.selectedAt, currentness: { status: "CURRENT" as const, checkedAt: request.selectedAt } } } : {}),
    });
    if (selected.directionSetId !== set.setId)
      throw new DesignError(
        "DESIGN_DIRECTION_NOT_FOUND",
        "The selection does not reference the current direction set.",
      );
    const record = DecisionRecordSchema.parse({
      id: randomUUID(),
      timestamp: request.selectedAt,
      actorType: "user",
      actorIdentifier: request.selectedBy,
      category: "design-selection",
      decision: `Selected ${direction.label}.`,
      rationale:
        request.selectionNotes ?? "User explicitly selected a direction.",
      affectedDocuments: ["design-directions.json", "selected-design.json"],
      requirementChange: false,
      userApprovalRequired: false,
      userApprovalStatus: "not-required",
    });
    const transition = await this.dependencies.database.transaction(async (tx) => {
      const projectRow = await tx.getProject(request.projectId);
      const requirementsRow = await tx.getDocument(request.projectId, request.projectVersion, "requirements");
      const briefV3Row = await tx.getDocument(request.projectId, request.projectVersion, "brief-v3");
      const planningRow = await tx.getDocument(request.projectId, request.projectVersion, "planning-package");
      const reviewRow = await tx.getDocument(request.projectId, request.projectVersion, "architecture-review");
      const directionRow = await tx.getDocument(request.projectId, request.projectVersion, "design-directions");
      if (!projectRow || projectRow.current_version !== request.projectVersion || projectRow.workflow_state !== "AWAITING_DESIGN_SELECTION" || projectRow.row_version !== request.expectedRowVersion) throw new DesignError("DESIGN_SELECTION_STALE", "Design selection became stale before its canonical commit.");
      if (!requirementsRow || !planningRow || !reviewRow || requirementsRow.checksum !== checksumPersistedDocument(requirementsDocument) || planningRow.checksum !== checksumPersistedDocument(planning) || reviewRow.checksum !== checksumPersistedDocument(reviewDocument)) throw new DesignError("DESIGN_SELECTION_STALE", "A canonical Design input changed before selection commit.");
      if (canonicalBrief && (!briefV3Row || briefV3Row.checksum !== checksumPersistedDocument(canonicalBrief))) throw new DesignError("DESIGN_SELECTION_STALE", "The approved CanonicalBriefV3 changed before selection commit.");
      if (!directionRow || mapRowToDocument(directionRow).documentType !== "design-directions" || directionRow.checksum !== checksumPersistedDocument(set)) throw new DesignError("DESIGN_SET_CHECKSUM_MISMATCH", "The current Design direction set changed before selection commit.");
      await saveDocumentInTransaction(tx, selected, request.idempotencyKey);
      await appendDecisionInTransaction(tx, request.projectId, request.projectVersion, record);
      return transitionWorkflowInTransaction(tx, { projectId: request.projectId, projectVersion: request.projectVersion, expectedState: "AWAITING_DESIGN_SELECTION", expectedRowVersion: request.expectedRowVersion, targetState: "READY_FOR_IMPLEMENTATION", actor: request.selectedBy, reason: "User selected a design direction.", context: { requirements, requirementsChecksum: requirements.approval.approvedRequirementsChecksum, designSet: set, selectedDesign: selected, selectedDirectionChecksum: request.selectedDirectionChecksum, architecture: planning.architecture, decisions }, idempotencyKey: request.idempotencyKey });
    });
    try {
      await this.dependencies.memory.writeSnapshot(request.projectId, request.projectVersion, { "design-directions.json": set, "selected-design.json": selected });
      await this.dependencies.memory.appendDecision(request.projectId, request.projectVersion, record);
    } catch (error) {
      throw new DesignError("DESIGN_PROVIDER_FAILED", "Design selection was committed but its projection could not be synchronized.", error);
    }
    return {
      selectedDesign: selected,
      projectState: "READY_FOR_IMPLEMENTATION" as const,
      rowVersion: transition.rowVersion,
    };
  }
  async proposeDesignDependencyAmendment(input: { projectId: string; projectVersion: number; directionId: string; reason: string; requestedBy: string; requestedAt?: string }) {
    const set = await this.getDesignDirectionSet(input.projectId, input.projectVersion);
    const direction = set.directions.find((candidate) => candidate.id === input.directionId);
    if (!direction) throw new DesignError("DESIGN_DIRECTION_NOT_FOUND", "The dependency amendment must reference a current direction.");
    if (direction.professionalDesign?.motion.suitability !== "MOTION") throw new DesignError("MOTION_STRATEGY_MISMATCH", "The selected direction does not request Motion.");
    const amendment = buildDesignDependencyAmendment({ amendmentId: randomUUID(), projectId: input.projectId, projectVersion: input.projectVersion, directionId: input.directionId, reason: input.reason, requestedBy: input.requestedBy, requestedAt: input.requestedAt ?? now() }, { projectId: input.projectId, projectVersion: input.projectVersion, plannedDependencies: [{ name: "motion@12.43.0", runtime: "runtime", required: true }] });
    await this.documents.save(amendment, `design-dependency-amendment-${input.projectId}-${input.projectVersion}`);
    await this.dependencies.memory.writeSnapshot(input.projectId, input.projectVersion, { "design-dependency-amendment.json": amendment });
    return amendment;
  }
  async approveDesignDependencyAmendment(input: { projectId: string; projectVersion: number; approvedBy: string; approvedAt?: string }) {
    const current = await this.documents.get(input.projectId, input.projectVersion, "design-dependency-amendment");
    if (!current || current.documentType !== "design-dependency-amendment") throw new DesignError("UNAPPROVED_DESIGN_DEPENDENCY", "No proposed design dependency amendment is available.");
    const amendment = approveDesignDependencyAmendment(DesignDependencyAmendmentSchema.parse(current), { approvedBy: input.approvedBy, approvedAt: input.approvedAt ?? now() }, { projectId: input.projectId, projectVersion: input.projectVersion, plannedDependencies: [{ name: "motion@12.43.0", runtime: "runtime", required: true }] });
    await this.documents.save(amendment, `design-dependency-amendment-approved-${amendment.amendmentId}`);
    await this.dependencies.memory.writeSnapshot(input.projectId, input.projectVersion, { "design-dependency-amendment.json": amendment });
    return amendment;
  }
  async rejectDesignDirectionSet(rawInput: DesignRevisionRequest) {
    return this.regenerateDesignDirections(rawInput);
  }
  async regenerateDesignDirections(rawInput: DesignRevisionRequest) {
    const request = DesignRevisionRequestSchema.parse(rawInput);
    const current = await this.projects.getWithVersion(request.projectId);
    if (
      !current ||
      !["AWAITING_DESIGN_SELECTION", "READY_FOR_IMPLEMENTATION"].includes(
        current.project.workflowState,
      )
    )
      throw new DesignError(
        "DESIGN_WORKFLOW_STATE_INVALID",
        "Design regeneration is only available before implementation.",
      );
    const prior = await this.getDesignDirectionSet(
      request.projectId,
      request.projectVersion,
    );
    const context = await this.loadDurableContext(request.projectId, request.projectVersion, request.idempotencyKey);
    let expectedRowVersion = current.rowVersion;
    if (current.project.workflowState === "READY_FOR_IMPLEMENTATION") {
      const transitioned = await this.workflow.transition({
        projectId: request.projectId,
        projectVersion: request.projectVersion,
        expectedState: "READY_FOR_IMPLEMENTATION",
        expectedRowVersion: current.rowVersion,
        targetState: "AWAITING_DESIGN_SELECTION",
        actor: request.requestedBy,
        reason: "Design revision requested before implementation.",
        idempotencyKey: `${request.idempotencyKey}-reopen`,
      });
      expectedRowVersion = transitioned.rowVersion;
      await this.documents.delete(
        request.projectId,
        request.projectVersion,
        "selected-design",
      );
      await this.dependencies.memory.removeDocument?.(
        request.projectId,
        request.projectVersion,
        "selected-design",
      );
    }
    const nextInput = {
      ...context,
      currentWorkflowState: "AWAITING_DESIGN_SELECTION" as const,
      expectedRowVersion,
      idempotencyKey: request.idempotencyKey,
    };
    const result = await this.generateDesignDirections(nextInput, { replaceExisting: true });
    const superseded = DesignDirectionSetSchema.parse({
      ...result.directionSet,
      supersedesSetId: prior.setId,
    });
    await this.documents.save(
      superseded,
      `design-directions-superseded-${request.idempotencyKey}`,
    );
    const record = DecisionRecordSchema.parse({
      id: randomUUID(),
      timestamp: now(),
      actorType: "user",
      actorIdentifier: request.requestedBy,
      category: "design-revision",
      decision: "Previous design direction set superseded.",
      rationale: request.reason,
      affectedDocuments: ["design-directions.json", "selected-design.json"],
      requirementChange: false,
      userApprovalRequired: false,
      userApprovalStatus: "not-required",
    });
    await this.decisions.append(
      request.projectId,
      request.projectVersion,
      record,
    );
    await this.dependencies.memory.appendDecision(
      request.projectId,
      request.projectVersion,
      record,
    );
    return {
      ...result,
      directionSet: superseded,
      readiness: {
        ...result.readiness,
        directionSetChecksum: directionSetChecksum(superseded),
      },
    };
  }
}
export function createDesignAgentService(
  dependencies: DesignServiceDependencies,
) {
  return new DesignAgentService(dependencies);
}
