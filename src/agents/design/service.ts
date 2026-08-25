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
  DesignGenerationResultSchema,
  DesignRevisionRequestSchema,
  DesignSelectionRequestSchema,
  type DesignAgentInput,
  type DesignGenerationResult,
  type DesignRevisionRequest,
  type DesignSelectionRequest,
} from "./contracts";
import { DesignError } from "./errors";
import {
  buildDesignDirectionSet,
  directionChecksum,
  directionSetChecksum,
  validateDesignDirectionSet,
} from "./deterministic";
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

const now = () => new Date().toISOString();
type DesignServiceDependencies = {
  database: PersistenceDatabase;
  memory: DesignMemoryPort;
  provider?: DesignDirectionProvider;
  skills?: DesignSkillSelectionPort;
  explorationTool?: DesignExplorationToolPort;
  resolveSkills?: (input: DesignAgentInput) => Promise<AgentSkillSelection>;
  professionalPipeline?: ProfessionalDesignCapabilityPipeline;
};

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
    if (!evaluatePlanningAcceptanceReadiness({ planningPackage: planning }).readyForAcceptance)
      throw new DesignError(
        "DESIGN_BLOCKED",
        "The accepted planning package contains unresolved technical blockers.",
      );
    return { brief, planning, canonicalBrief: canonical?.brief };
  }
  async generateDesignDirections(rawInput: DesignAgentInput, options: { replaceExisting?: boolean } = {}): Promise<DesignGenerationResult> {
    const input = this.parseInput(rawInput);
    assertWorkbenchStyleIsolation(input);
    const validated = await this.validateInput(input);
    const providerInput = validated.canonicalBrief
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
    const skillSelection = this.resolveSkills
      ? await this.resolveSkills(providerInput)
      : undefined;
    await this.skills.select({ role: "design", taskType: "visual-direction" });
    await this.explorationTool.explore(providerInput).catch(() => null);
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
      if (error instanceof DesignError) throw error;
      if (error instanceof z.ZodError) {
        const directionIssue = error.issues.find(
          (issue) => issue.path[0] === "directions",
        );
        const countIssue =
          directionIssue &&
          (directionIssue.code === "too_small" ||
            directionIssue.code === "too_big");
        throw new DesignError(
          countIssue
            ? "DESIGN_DIRECTION_COUNT_INVALID"
            : "DESIGN_DIRECTION_SCHEMA_INVALID",
          countIssue
            ? "Design provider returned a direction set with a cardinality other than exactly three."
            : "Design provider returned a direction set that failed the strict direction contract.",
          error,
        );
      }
      throw new DesignError(
        "DESIGN_PROVIDER_FAILED",
        "Design provider failed.",
        error,
      );
    }
    if (this.professionalPipeline) {
      try {
      set = (await this.professionalPipeline.run({ projectId: input.projectId, projectVersion: input.projectVersion, directionSet: set, prompt: providerInput.approvedBrief.projectSummary, idempotencyKey: input.idempotencyKey })).directionSet;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const code = message.startsWith("DESIGN_SKILL_NOT_AVAILABLE_THROUGH_APPROVED_SOURCE") ? "DESIGN_SKILL_NOT_AVAILABLE_THROUGH_APPROVED_SOURCE" : message.startsWith("FONTPAIR_") ? "FONTPAIR_SOURCE_INTEGRATION_UNRESOLVED" : message.startsWith("IMPECCABLE_") ? "IMPECCABLE_DETECTOR_INTEGRATION_UNRESOLVED" : message.startsWith("PHASE_7F_EVIDENCE_INVALID") ? "PHASE_7F_EVIDENCE_INVALID" : message.startsWith("UNAPPROVED_DESIGN_DEPENDENCY") ? "UNAPPROVED_DESIGN_DEPENDENCY" : "DESIGN_PROVIDER_FAILED";
        throw new DesignError(code, "Professional design capability pipeline failed.", error);
      }
    }
    if (
      set.projectId !== input.projectId ||
      set.projectVersion !== input.projectVersion ||
      set.directions.length !== 3
    )
      throw new DesignError(
        "DESIGN_DIRECTION_COUNT_INVALID",
        "Exactly three directions for the current project version are required.",
      );
    const readiness = validateDesignDirectionSet(providerInput, set);
    if (!readiness.readyForSelection) {
      const code = readiness.blockingReasons.includes(
        "DESIGN_DIRECTION_DUPLICATE",
      )
        ? "DESIGN_DIRECTION_DUPLICATE"
        : readiness.blockingReasons.includes("DESIGN_DIRECTIONS_TOO_SIMILAR")
          ? "DESIGN_DIRECTIONS_TOO_SIMILAR"
          : readiness.blockingReasons.includes("DESIGN_DIRECTION_COUNT_INVALID")
            ? "DESIGN_DIRECTION_COUNT_INVALID"
            : "DESIGN_DIRECTION_SCHEMA_INVALID";
      throw new DesignError(
        code,
        `Design provider output was rejected: ${readiness.blockingReasons.slice(0, 8).join(", ") || "strict readiness validation failed"}.`,
        readiness,
      );
    }
    const generatedAt = now();
    set = DesignDirectionSetSchema.parse({
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
    const persistedSet = await this.dependencies.database.transaction(async (tx) => {
      const projectRow = await tx.getProject(input.projectId);
      const briefRow = await tx.getDocument(input.projectId, input.projectVersion, "requirements");
      const planningRow = await tx.getDocument(input.projectId, input.projectVersion, "planning-package");
      const reviewRow = await tx.getDocument(input.projectId, input.projectVersion, "architecture-review");
      if (!projectRow || projectRow.current_version !== input.projectVersion || projectRow.workflow_state !== "AWAITING_DESIGN_SELECTION" || projectRow.row_version !== input.expectedRowVersion) throw new DesignError("DESIGN_SELECTION_STALE", "Design generation became stale before its canonical commit.");
      const brief = briefRow ? mapRowToDocument(briefRow) : null;
      const planning = planningRow ? mapRowToDocument(planningRow) : null;
      const review = reviewRow ? mapRowToDocument(reviewRow) : null;
      const briefV3 = await tx.getDocument(input.projectId, input.projectVersion, "brief-v3");
      if (briefV3?.documentType === "brief-v3") {
        const currentBrief = BriefV3DocumentSchema.parse(briefV3);
        if (!currentBrief.approval?.approved || currentBrief.approval.approvedCanonicalChecksum !== currentBrief.briefChecksum || input.approvedBriefChecksum !== currentBrief.briefChecksum || (input.canonicalBrief && canonicalBriefChecksum(input.canonicalBrief) !== currentBrief.briefChecksum)) throw new DesignError("DESIGN_BRIEF_STALE", "The approved CanonicalBriefV3 changed before Design commit.");
      } else if (!brief || brief.documentType !== "requirements" || (!brief.approval.approvedRequirementsChecksum ? checksumPersistedDocument(brief) !== input.approvedBriefChecksum : brief.approval.approvedRequirementsChecksum !== input.approvedBriefChecksum && checksumPersistedDocument(brief) !== input.approvedBriefChecksum)) throw new DesignError("DESIGN_BRIEF_STALE", "The approved Brief changed before Design commit.");
      if (!planning || planning.documentType !== "planning-package" || (!planning.acceptance?.checksum ? checksumPersistedDocument(planning) !== input.acceptedPlanningChecksum : planning.acceptance.checksum !== input.acceptedPlanningChecksum && checksumPersistedDocument(planning) !== input.acceptedPlanningChecksum)) throw new DesignError("DESIGN_PLANNING_STALE", "Accepted Planning changed before Design commit.");
      if (!review || review.documentType !== "architecture-review" || review.result.verdict !== "APPROVED" || review.approvedBriefChecksum !== input.approvedBriefChecksum || review.acceptedPlanningChecksum !== input.acceptedPlanningChecksum) throw new DesignError("DESIGN_ARCHITECTURE_REVIEW_STALE", "Architecture Review changed before Design commit.");
      const existingRow = await tx.getDocument(input.projectId, input.projectVersion, "design-directions");
      if (!options.replaceExisting && existingRow) {
        const existing = mapRowToDocument(existingRow);
        if (existing.documentType === "design-directions" && existing.approvedBriefChecksum === input.approvedBriefChecksum && existing.acceptedPlanningChecksum === input.acceptedPlanningChecksum) return existing;
      }
      return saveDocumentInTransaction(tx, set, `design-directions-${input.projectId}-${input.projectVersion}-${input.idempotencyKey}`);
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
        directionSetChecksum: directionSetChecksum(set),
      },
    });
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
    const context = await this.loadDurableContext(projectId, projectVersion);
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
    const requirements = await this.documents.get(
      request.projectId,
      request.projectVersion,
      "requirements",
    );
    const planning = await this.documents.get(
      request.projectId,
      request.projectVersion,
      "planning-package",
    );
    if (
      !requirements ||
      requirements.documentType !== "requirements" ||
      !requirements.approval.approved
    )
      throw new DesignError(
        "DESIGN_BRIEF_STALE",
        "Approved requirements are unavailable.",
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
      const planningRow = await tx.getDocument(request.projectId, request.projectVersion, "planning-package");
      const reviewRow = await tx.getDocument(request.projectId, request.projectVersion, "architecture-review");
      const directionRow = await tx.getDocument(request.projectId, request.projectVersion, "design-directions");
      if (!projectRow || projectRow.current_version !== request.projectVersion || projectRow.workflow_state !== "AWAITING_DESIGN_SELECTION" || projectRow.row_version !== request.expectedRowVersion) throw new DesignError("DESIGN_SELECTION_STALE", "Design selection became stale before its canonical commit.");
      if (!requirementsRow || !planningRow || !reviewRow || requirementsRow.checksum !== checksumPersistedDocument(requirements) || planningRow.checksum !== checksumPersistedDocument(planning) || reviewRow.checksum !== checksumPersistedDocument(reviewDocument)) throw new DesignError("DESIGN_SELECTION_STALE", "A canonical Design input changed before selection commit.");
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
    const amendment = buildDesignDependencyAmendment({ amendmentId: randomUUID(), projectId: input.projectId, projectVersion: input.projectVersion, directionId: input.directionId, reason: input.reason, requestedBy: input.requestedBy, requestedAt: input.requestedAt ?? now() }, { projectId: input.projectId, projectVersion: input.projectVersion, plannedDependencies: [{ name: "motion", runtime: "runtime", required: true }] });
    await this.documents.save(amendment, `design-dependency-amendment-${input.projectId}-${input.projectVersion}`);
    await this.dependencies.memory.writeSnapshot(input.projectId, input.projectVersion, { "design-dependency-amendment.json": amendment });
    return amendment;
  }
  async approveDesignDependencyAmendment(input: { projectId: string; projectVersion: number; approvedBy: string; approvedAt?: string }) {
    const current = await this.documents.get(input.projectId, input.projectVersion, "design-dependency-amendment");
    if (!current || current.documentType !== "design-dependency-amendment") throw new DesignError("UNAPPROVED_DESIGN_DEPENDENCY", "No proposed design dependency amendment is available.");
    const amendment = approveDesignDependencyAmendment(DesignDependencyAmendmentSchema.parse(current), { approvedBy: input.approvedBy, approvedAt: input.approvedAt ?? now() }, { projectId: input.projectId, projectVersion: input.projectVersion, plannedDependencies: [{ name: "motion", runtime: "runtime", required: true }] });
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
