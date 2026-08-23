import { randomUUID } from "node:crypto";
import { z } from "zod";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { DecisionRecordSchema } from "@/domain/workflow/decision";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import {
  appendDecisionInTransaction,
  DecisionRepository,
  DocumentRepository,
  ProjectRepository,
  saveDocumentCASInTransaction,
  saveDocumentInTransaction,
  transitionWorkflowInTransaction,
  WorkflowPersistenceService,
} from "@/persistence/database/repositories";
import { mapRowToDocument } from "@/persistence/database/mapping";
import type { PersistenceDatabase, PersistenceTransaction } from "@/persistence/database/types";
import { PlannerError } from "./errors";
import { PersistenceError } from "@/persistence/database/errors";
import {
  buildPlanningPackage,
  evaluatePlanningAcceptanceReadiness,
  planningDocumentChecksum,
  planningSemanticChecksum,
  validatePlanningAdmission,
} from "./deterministic";
import {
  PlannerAgentInputSchema,
  PlanningPackageSchema,
  type PlannerAgentInput,
  type PlanningPackage,
} from "./contracts";
import {
  EmptyPlannerSkillSelectionPort,
  type PlannerArchitectureProvider,
  type PlannerDocumentationPort,
  type PlannerMemoryPort,
  type PlannerAcceptanceFaultInjector,
  type PlannerSkillSelectionPort,
} from "./ports";
import { requestPlannerDocumentation } from "../../integrations/context7/planner";
import { isPlaceholderImageApprovalBlocker } from "../../integrations/openai/adapters";
import { plannerAgentDefinition } from "@/agents/catalog";
import {
  ArchitectureReviewResultSchema,
  type ArchitectureReviewResult,
} from "@/domain/review/schema";
import type { AgentSkillSelection } from "@/skills/runtime/resolver";
import { buildPhase7CContractPackage } from "@/domain/contracts/phase7c";

const now = () => new Date().toISOString();
export type PlannerServiceDependencies = {
  database: PersistenceDatabase;
  memory: PlannerMemoryPort;
  provider?: PlannerArchitectureProvider;
  skills?: PlannerSkillSelectionPort;
  context7?: PlannerDocumentationPort;
  resolveSkills?: (input: PlannerAgentInput) => Promise<AgentSkillSelection>;
  acceptanceFaultInjector?: PlannerAcceptanceFaultInjector;
};

export class PlannerArchitectService {
  private readonly projects;
  private readonly documents;
  private readonly decisions;
  private readonly workflow;
  private readonly provider: PlannerArchitectureProvider;
  private readonly skills: PlannerSkillSelectionPort;
  private readonly resolveSkills?: PlannerServiceDependencies["resolveSkills"];
  private readonly acceptanceFaultInjector?: PlannerServiceDependencies["acceptanceFaultInjector"];
  private readonly skillSelections = new Map<string, AgentSkillSelection>();
  private readonly packages = new Map<string, PlanningPackage>();
  private readonly inputKeys = new Map<string, string>();
  private readonly architectureCorrectionCycles = new Map<string, number>();
  constructor(private readonly dependencies: PlannerServiceDependencies) {
    this.projects = new ProjectRepository(dependencies.database);
    this.documents = new DocumentRepository(dependencies.database);
    this.decisions = new DecisionRepository(dependencies.database);
    this.workflow = new WorkflowPersistenceService(dependencies.database);
    this.provider = dependencies.provider ?? {
      plan: async (input) => buildPlanningPackage(input),
    };
    this.skills = dependencies.skills ?? new EmptyPlannerSkillSelectionPort();
    this.resolveSkills = dependencies.resolveSkills;
    this.acceptanceFaultInjector = dependencies.acceptanceFaultInjector;
  }
  getAgentDefinition() {
    return plannerAgentDefinition;
  }
  private packageKey(projectId: string, version: number) {
    return `${projectId}:${version}`;
  }
  private parseInput(input: PlannerAgentInput) {
    try {
      return PlannerAgentInputSchema.parse(input);
    } catch (error) {
      throw new PlannerError(
        "PLANNER_INPUT_INVALID",
        "Planner input did not match the strict contract.",
        error,
      );
    }
  }
  private validateBrief(input: PlannerAgentInput) {
    const brief = RequirementSpecificationSchema.parse(input.approvedBrief);
    if (!brief.approval.approved || brief.briefStatus !== "approved")
      throw new PlannerError(
        "BRIEF_NOT_APPROVED",
        "Only an approved Project Brief can be planned.",
      );
    const payloadChecksum = checksumPersistedDocument(brief);
    if (
      input.approvedBriefChecksum !== payloadChecksum &&
      input.approvedBriefChecksum !==
        brief.approval.approvedRequirementsChecksum
    )
      throw new PlannerError(
        "BRIEF_CHECKSUM_MISMATCH",
        "The approved Brief checksum is stale.",
      );
    if (brief.unresolvedItems.some((item) => item.blocking))
      throw new PlannerError(
        "BLOCKING_CLARIFICATIONS_REMAIN",
        "Blocking clarification items remain in the approved Brief.",
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
      throw new PlannerError(
        "UNAPPROVED_REQUIREMENT_CHANGE",
        "An unapproved requirement change prevents planning.",
      );
    return brief;
  }
  async planApprovedProject(rawInput: PlannerAgentInput) {
    const input = this.parseInput(rawInput);
    if (input.currentWorkflowState !== "AWAITING_DESIGN_SELECTION")
      throw new PlannerError(
        "PLANNER_WORKFLOW_STATE_INVALID",
        "Planning starts only while awaiting design selection.",
      );
    const brief = this.validateBrief(input);
    const project = await this.projects.getWithVersion(input.projectId);
    if (!project || project.project.currentVersion !== input.projectVersion)
      throw new PlannerError(
        "PROJECT_VERSION_MISMATCH",
        "The Planner project version does not match the approved Brief.",
      );
    if (project.project.workflowState !== "AWAITING_DESIGN_SELECTION")
      throw new PlannerError(
        "PLANNER_WORKFLOW_STATE_INVALID",
        "Planning starts only while awaiting design selection.",
      );
    if (project.rowVersion !== input.expectedRowVersion)
      throw new PlannerError(
        "PLANNING_STALE",
        "The project row version is stale.",
      );
    const skillSelection = this.resolveSkills
      ? await this.resolveSkills(input)
      : undefined;
    const requestHash = checksumPersistedDocument({
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      approvedBriefChecksum: input.approvedBriefChecksum,
      skillContextChecksum: skillSelection?.identityChecksum ?? "none",
    });
    const previous = this.inputKeys.get(input.idempotencyKey);
    if (previous && previous !== requestHash)
      throw new PlannerError(
        "IDEMPOTENCY_CONFLICT",
        "Planner idempotency key was reused with different input.",
      );
    if (previous)
      return this.packages.get(
        this.packageKey(input.projectId, input.projectVersion),
      )!;
    await this.skills.select({
      role: "planner-architect",
      taskType: "product-scope",
    });
    let planningPackage: PlanningPackage;
    try {
      const documentationExcerpts =
        input.allowedTools?.includes("Context7-read") &&
        this.dependencies.context7
          ? await requestPlannerDocumentation(this.dependencies.context7, {
              allowedTools: input.allowedTools,
              packageName: "next",
              resolvedLibraryId: "next",
              topic: "Next.js App Router metadata API",
              reason:
                "Confirm current framework capability during technical planning",
              projectId: input.projectId,
              projectVersion: input.projectVersion,
              taskType: "technical-architecture",
            })
          : [];
      planningPackage = PlanningPackageSchema.parse(
        await this.provider.plan(
          { ...input, approvedBrief: brief, documentationExcerpts },
          skillSelection?.contexts,
          skillSelection?.identityChecksum,
        ),
      );
    } catch (error) {
      if (error instanceof PlannerError) throw error;
      if (error instanceof z.ZodError)
        throw new PlannerError(
          "PLANNING_PACKAGE_INVALID",
          "Planner output did not match the strict contract.",
          error,
        );
      throw new PlannerError(
        "PLANNER_PROVIDER_FAILED",
        "Planner provider failed.",
        error,
      );
    }
    if (
      planningPackage.approvedBriefChecksum !== input.approvedBriefChecksum &&
      planningPackage.approvedBriefChecksum !==
        brief.approval.approvedRequirementsChecksum
    )
      throw new PlannerError(
        "BRIEF_CHECKSUM_MISMATCH",
        "Planner output references a different Brief.",
      );
    if (!validatePlanningAdmission(planningPackage).ready)
      throw new PlannerError(
        "PLANNING_PACKAGE_INVALID",
        "Planner output failed deterministic admission.",
      );
    this.inputKeys.set(input.idempotencyKey, requestHash);
    if (skillSelection)
      this.skillSelections.set(
        this.packageKey(input.projectId, input.projectVersion),
        skillSelection,
      );
    this.packages.set(
      this.packageKey(input.projectId, input.projectVersion),
      planningPackage,
    );
    await this.persistPackage(planningPackage, input.idempotencyKey);
    return planningPackage;
  }
  async getPlanningStatus(projectId: string, projectVersion: number) {
    const packageValue =
      this.packages.get(this.packageKey(projectId, projectVersion)) ??
      (await this.documents.get(projectId, projectVersion, "planning-package"));
    if (!packageValue || packageValue.documentType !== "planning-package")
      throw new PlannerError(
        "PLANNING_NOT_ACCEPTED",
        "No planning package is available.",
      );
    return {
      package: packageValue,
      checksum: planningDocumentChecksum(packageValue),
      blockers: packageValue.blockers,
      accepted: packageValue.accepted,
    };
  }
  async reconcilePersistedPlanningPackage(
    projectId: string,
    projectVersion: number,
    idempotencyKey: string,
  ) {
    const brief = await this.documents.get(
      projectId,
      projectVersion,
      "requirements",
    );
    const status = await this.getPlanningStatus(projectId, projectVersion);
    if (!brief || brief.documentType !== "requirements")
      throw new PlannerError(
        "PLANNING_NOT_ACCEPTED",
        "No approved Brief is available for planning reconciliation.",
      );
    if (!brief.approval.approved || brief.briefStatus !== "approved")
      throw new PlannerError(
        "BRIEF_NOT_APPROVED",
        "Only an approved Project Brief can be reconciled.",
      );
    const blockers = status.package.blockers.filter(
      (blocker) =>
        !(
          brief.imageSourceDecision === "placeholders" &&
          isPlaceholderImageApprovalBlocker(blocker)
        ),
    );
    if (blockers.length === status.package.blockers.length)
      return status.package;
    const corrected = PlanningPackageSchema.parse({
      ...status.package,
      blockers,
      updatedAt: now(),
    });
    if (!validatePlanningAdmission(corrected).ready)
      throw new PlannerError(
        "PLANNING_PACKAGE_INVALID",
        "Reconciled planning package failed deterministic admission.",
      );
    await this.persistPackage(corrected, idempotencyKey);
    this.packages.set(this.packageKey(projectId, projectVersion), corrected);
    return corrected;
  }
  async validatePlanningPackage(projectId: string, projectVersion: number) {
    const status = await this.getPlanningStatus(projectId, projectVersion);
    const packageValue = PlanningPackageSchema.parse(status.package);
    const context = await this.planningAcceptanceContext(projectId, projectVersion);
    const readiness = evaluatePlanningAcceptanceReadiness({ planningPackage: packageValue, context });
    return {
      ready: readiness.readyForAcceptance,
      blockers: readiness.blockingItems.map((item) => item.reason),
      deferredItems: readiness.deferredItems,
      readiness,
      checksum: planningDocumentChecksum(packageValue),
      package: packageValue,
    };
  }
  async acceptPlanningPackage(input: {
    projectId: string;
    projectVersion: number;
    planningChecksum: string;
    acceptedBy: string;
    acceptedAt: string;
    expectedRowVersion: number;
    idempotencyKey: string;
  }) {
    const validation = await this.validatePlanningPackage(
      input.projectId,
      input.projectVersion,
    );
    if (validation.checksum !== input.planningChecksum)
      throw new PlannerError(
        "PLANNING_CHECKSUM_MISMATCH",
        "The planning package checksum is stale.",
      );
    if (!validation.ready)
      throw new PlannerError(
        "ARCHITECTURE_BLOCKED",
        `Planning blockers must be resolved before acceptance: ${validation.blockers.slice(0, 10).join(", ")}.`,
      );
    const record = DecisionRecordSchema.parse({
      id: randomUUID(),
      timestamp: input.acceptedAt,
      actorType: "user",
      actorIdentifier: input.acceptedBy,
      category: "planning-acceptance",
      decision: "Planning package accepted for architecture review.",
      rationale:
        "All planning documents are complete, traceable, and within the fixed stack.",
      affectedDocuments: [
        "planning-package.json",
        "architecture.json",
        "content-plan.json",
        "asset-manifest.json",
      ],
      requirementChange: false,
      userApprovalRequired: false,
      userApprovalStatus: "not-required",
    });
    const committed = await this.dependencies.database.transaction(async (tx) => {
      const current = await tx.getProject(input.projectId);
      if (!current || current.current_version !== input.projectVersion || current.workflow_state !== "AWAITING_DESIGN_SELECTION")
        throw new PlannerError(
          "PLANNER_WORKFLOW_STATE_INVALID",
          "Planning acceptance is only available while awaiting design selection.",
        );
      if (current.row_version !== input.expectedRowVersion)
        throw new PlannerError("PLANNING_STALE", "The project row version is stale.");
      const packageRow = await tx.getDocument(input.projectId, input.projectVersion, "planning-package");
      if (!packageRow) throw new PlannerError("PLANNING_NOT_ACCEPTED", "No planning package is available.");
      const packageValue = PlanningPackageSchema.parse(mapRowToDocument(packageRow));
      const checksum = planningDocumentChecksum(packageValue);
      if (checksum !== input.planningChecksum)
        throw new PlannerError("PLANNING_CHECKSUM_MISMATCH", "The planning package checksum is stale.");
      if (packageValue.accepted)
        throw new PlannerError("PLANNING_STALE", "The planning package has already been accepted.");
      const briefRow = (await tx.getDocument(input.projectId, input.projectVersion, "brief-v3")) ?? (await tx.getDocument(input.projectId, input.projectVersion, "requirements"));
      if (!briefRow) throw new PlannerError("BRIEF_NOT_APPROVED", "An approved Brief is required for Planning Acceptance.");
      const brief = mapRowToDocument(briefRow);
      const briefCurrent = brief.documentType === "brief-v3"
        ? Boolean(brief.approval?.approved && packageValue.approvedBriefChecksum === brief.briefChecksum)
        : brief.documentType === "requirements"
          ? Boolean(brief.approval.approved && brief.briefStatus === "approved" && (packageValue.approvedBriefChecksum === checksumPersistedDocument(brief) || packageValue.approvedBriefChecksum === brief.approval.approvedRequirementsChecksum))
          : false;
      if (!briefCurrent) throw new PlannerError("BRIEF_CHECKSUM_MISMATCH", "The approved Brief checksum is stale.");
      const context = await this.planningAcceptanceContextInTransaction(tx, input.projectId, input.projectVersion);
      const readiness = evaluatePlanningAcceptanceReadiness({ planningPackage: packageValue, context });
      if (!readiness.readyForAcceptance)
        throw new PlannerError(
          "ARCHITECTURE_BLOCKED",
          `Planning blockers must be resolved before acceptance: ${readiness.blockingItems.slice(0, 10).map((item) => item.reason).join(", ")}.`,
        );
      const acceptedArchitecture = TechnicalArchitectureAcceptance(packageValue.architecture, input.acceptedAt, input.acceptedBy);
      const acceptedPackage = PlanningPackageSchema.parse({
        ...packageValue,
        architecture: acceptedArchitecture,
        accepted: true,
        acceptance: { acceptedAt: input.acceptedAt, acceptedBy: input.acceptedBy, checksum: input.planningChecksum },
        updatedAt: input.acceptedAt,
      });
      const phase7cContractPackage = buildPhase7CContractPackage({
        projectId: input.projectId,
        projectVersion: input.projectVersion,
        createdAt: input.acceptedAt,
        approvedBriefChecksum: acceptedPackage.approvedBriefChecksum,
        planningChecksum: planningSemanticChecksum(acceptedPackage),
        architectureChecksum: checksumPersistedDocument(acceptedArchitecture),
        designChecksum: "0".repeat(64),
        planning: acceptedPackage,
      });
      await saveDocumentCASInTransaction(tx, acceptedPackage, packageRow.rowVersion, packageRow.checksum);
      const architectureRow = await tx.getDocument(input.projectId, input.projectVersion, "architecture");
      const architectureChecksum = checksumPersistedDocument(packageValue.architecture);
      if (architectureRow && architectureRow.checksum !== architectureChecksum) throw new PlannerError("PLANNING_STALE", "The planning architecture is stale.");
      await saveDocumentCASInTransaction(tx, acceptedArchitecture, architectureRow?.rowVersion ?? null, architectureRow?.checksum ?? null);
      await saveDocumentInTransaction(tx, phase7cContractPackage, `planning-phase-7c-${input.projectId}-${input.projectVersion}-${input.idempotencyKey}`);
      await this.acceptanceFaultInjector?.hit("after-acceptance-write");
      await this.acceptanceFaultInjector?.hit("before-decision-write");
      await appendDecisionInTransaction(tx, input.projectId, input.projectVersion, record);
      await this.acceptanceFaultInjector?.hit("after-decision-write");
      await this.acceptanceFaultInjector?.hit("before-workflow-transition");
      const transition = await transitionWorkflowInTransaction(tx, {
        projectId: input.projectId,
        projectVersion: input.projectVersion,
        expectedState: "AWAITING_DESIGN_SELECTION",
        expectedRowVersion: input.expectedRowVersion,
        targetState: "ARCHITECTURE_REVIEW",
        actor: input.acceptedBy,
        reason: "Planning Acceptance completed; architecture review is required before Design.",
        idempotencyKey: `${input.idempotencyKey}:architecture-review`,
      });
      return { acceptedPackage, acceptedArchitecture, phase7cContractPackage, record, transition };
    });
    this.packages.set(this.packageKey(input.projectId, input.projectVersion), committed.acceptedPackage);
    await this.syncPlanningAcceptanceProjection({
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      package: committed.acceptedPackage,
      architecture: committed.acceptedArchitecture,
      content: committed.acceptedPackage.content,
      assets: committed.acceptedPackage.assets,
      phase7cContractPackage: committed.phase7cContractPackage,
      decision: committed.record,
    });
    return {
      package: committed.acceptedPackage,
      planningChecksum: planningDocumentChecksum(committed.acceptedPackage),
      projectState: "ARCHITECTURE_REVIEW" as const,
      rowVersion: committed.transition.rowVersion,
    };
  }
  async requestPlanningClarification(input: {
    projectId: string;
    projectVersion: number;
    blockers: string[];
    requestedBy: string;
    idempotencyKey: string;
  }) {
    const record = DecisionRecordSchema.parse({
      id: randomUUID(),
      timestamp: now(),
      actorType: "user",
      actorIdentifier: input.requestedBy,
      category: "planning-clarification",
      decision: input.blockers.join(", "),
      rationale:
        "Planning blockers require Lead clarification before acceptance.",
      affectedDocuments: ["planning-package.json"],
      requirementChange: false,
      userApprovalRequired: false,
      userApprovalStatus: "not-required",
    });
    await this.dependencies.memory.appendDecision(
      input.projectId,
      input.projectVersion,
      record,
    );
    return { blockers: input.blockers, decisionId: record.id };
  }
  async correctAfterArchitectureReview(
    input: PlannerAgentInput & {
      architectureReview: ArchitectureReviewResult;
      currentPlanningPackage: PlanningPackage;
      currentPlanningChecksum?: string;
    },
  ) {
    const {
      architectureReview,
      currentPlanningPackage,
      currentPlanningChecksum,
      ...plannerInput
    } = input;
    const review = ArchitectureReviewResultSchema.parse(architectureReview);
    if (review.verdict !== "CHANGES_REQUIRED")
      throw new PlannerError(
        "PLANNING_PACKAGE_INVALID",
        "Planner correction requires CHANGES_REQUIRED architecture findings.",
      );
    const key = this.packageKey(input.projectId, input.projectVersion);
    const cycle = this.architectureCorrectionCycles.get(key) ?? 0;
    if (cycle >= 2)
      throw new PlannerError(
        "PLANNING_CORRECTION_EXHAUSTED",
        "The maximum architecture correction cycle count has been reached.",
      );
    const parsed = this.parseInput({
      ...plannerInput,
      currentWorkflowState: "AWAITING_DESIGN_SELECTION",
    });
    const brief = this.validateBrief(parsed);
    const current = await this.projects.getWithVersion(input.projectId);
    if (!current || current.project.workflowState !== "ARCHITECTURE_REVIEW")
      throw new PlannerError(
        "PLANNER_WORKFLOW_STATE_INVALID",
        "Planner correction is only available during architecture review.",
      );
    if (
      currentPlanningChecksum &&
      currentPlanningChecksum !==
        checksumPersistedDocument(currentPlanningPackage)
    )
      throw new PlannerError(
        "PLANNING_STALE",
        "The correction PlanningPackage is stale.",
      );
    const skillSelection = this.resolveSkills
      ? await this.resolveSkills(parsed)
      : undefined;
    let corrected: PlanningPackage;
    try {
      corrected = PlanningPackageSchema.parse(
        await this.provider.plan({
          ...parsed,
          approvedBrief: brief,
          architectureReview: review,
          currentPlanningPackage,
          correctionOnly: true,
        } as PlannerAgentInput & {
          architectureReview: ArchitectureReviewResult;
          currentPlanningPackage: PlanningPackage;
          correctionOnly: boolean;
        }, skillSelection?.contexts, skillSelection?.identityChecksum),
      );
    } catch (error) {
      if (error instanceof z.ZodError)
        throw new PlannerError(
          "PLANNING_PACKAGE_INVALID",
          "Planner correction did not match the strict contract.",
          error,
        );
      throw new PlannerError(
        "PLANNER_PROVIDER_FAILED",
        "Planner correction failed.",
        error,
      );
    }
    const next = PlanningPackageSchema.parse({
      ...corrected,
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      approvedBriefChecksum: parsed.approvedBriefChecksum,
      accepted: false,
      acceptance: {},
      updatedAt: now(),
    });
    if (!validatePlanningAdmission(next).ready)
      throw new PlannerError(
        "PLANNING_PACKAGE_INVALID",
        "Planner correction failed deterministic admission.",
      );
    await this.persistPackage(next, input.idempotencyKey);
    this.packages.set(key, next);
    this.architectureCorrectionCycles.set(key, cycle + 1);
    const transition = await this.workflow.transition({
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      expectedState: "ARCHITECTURE_REVIEW",
      expectedRowVersion: current.rowVersion,
      targetState: "AWAITING_DESIGN_SELECTION",
      actor: "planner-architect",
      reason: `Architecture findings corrected in bounded cycle ${cycle + 1}. Planning Acceptance must run again.`,
      idempotencyKey: `${input.idempotencyKey}:planning-correction`,
    });
    return {
      package: next,
      planningChecksum: planningDocumentChecksum(next),
      projectState: "AWAITING_DESIGN_SELECTION" as const,
      rowVersion: transition.rowVersion,
      correctionCycle: cycle + 1,
      approvedBrief: brief,
    };
  }
  async rebuildPlanningPackageAfterBriefRevision(input: PlannerAgentInput) {
    this.packages.delete(
      this.packageKey(input.projectId, input.projectVersion),
    );
    return this.planApprovedProject(input);
  }
  private async persistPackage(
    packageValue: PlanningPackage,
    idempotencyKey: string,
  ) {
    const save = async (
      document:
        | PlanningPackage
        | PlanningPackage["architecture"]
        | PlanningPackage["content"]
        | PlanningPackage["assets"],
      documentType: string,
    ) => {
      try {
        await this.documents.save(
          document,
          `planning-${documentType}-${packageValue.projectId}-${packageValue.projectVersion}-${idempotencyKey}`,
        );
      } catch (error) {
        if (error instanceof PersistenceError)
          throw new PersistenceError(
            error.code,
            `Planner persistence failed while saving ${documentType}.`,
            { documentType },
            error,
          );
        throw error;
      }
    };
    await save(packageValue, "package");
    await save(packageValue.architecture, "architecture");
    await save(packageValue.content, "content");
    await save(packageValue.assets, "assets");
    await this.dependencies.memory.writeSnapshot(
      packageValue.projectId,
      packageValue.projectVersion,
      {
        "planning-package.json": packageValue,
        "architecture.json": packageValue.architecture,
        "content-plan.json": packageValue.content,
        "asset-manifest.json": packageValue.assets,
      },
    );
  }

  async reconcileAcceptedPlanningProjection(projectId: string, projectVersion: number) {
    const canonical = await this.dependencies.database.transaction(async (tx) => {
      const packageRow = await tx.getDocument(projectId, projectVersion, "planning-package");
      const phase7cRow = await tx.getDocument(projectId, projectVersion, "phase-7c-contract-package");
      const decisions = await tx.listDecisions(projectId, projectVersion);
      if (!packageRow) throw new PlannerError("PLANNING_NOT_ACCEPTED", "No planning package is available.");
      const packageValue = PlanningPackageSchema.parse(mapRowToDocument(packageRow));
      const decision = decisions.filter((candidate) => candidate.category === "planning-acceptance").at(-1);
      if (!packageValue.accepted || !packageValue.acceptance.acceptedAt || !decision)
        throw new PlannerError("PLANNING_NOT_ACCEPTED", "Planning Acceptance has not been committed.");
      const phase7c = phase7cRow ? mapRowToDocument(phase7cRow) : null;
      return {
        package: packageValue,
        architecture: packageValue.architecture,
        content: packageValue.content,
        assets: packageValue.assets,
        phase7cContractPackage: phase7c?.documentType === "phase-7c-contract-package" ? phase7c : buildPhase7CContractPackage({ projectId, projectVersion, createdAt: packageValue.updatedAt, approvedBriefChecksum: packageValue.approvedBriefChecksum, planningChecksum: planningSemanticChecksum(packageValue), architectureChecksum: checksumPersistedDocument(packageValue.architecture), designChecksum: "0".repeat(64), planning: packageValue }),
        decision,
      };
    });
    this.packages.set(this.packageKey(projectId, projectVersion), canonical.package);
    await this.syncPlanningAcceptanceProjection({ projectId, projectVersion, ...canonical });
    return { projectId, projectVersion, projectionStatus: "SYNCED" as const };
  }

  private async syncPlanningAcceptanceProjection(input: { projectId: string; projectVersion: number; package: PlanningPackage; architecture: PlanningPackage["architecture"]; content: PlanningPackage["content"]; assets: PlanningPackage["assets"]; phase7cContractPackage: ReturnType<typeof buildPhase7CContractPackage>; decision: z.infer<typeof DecisionRecordSchema> }) {
    try {
      await this.dependencies.memory.writeDecisionProjection(input.projectId, input.projectVersion, input.decision);
      await this.dependencies.memory.writeSnapshot(input.projectId, input.projectVersion, {
        "planning-package.json": input.package,
        "architecture.json": input.architecture,
        "content-plan.json": input.content,
        "asset-manifest.json": input.assets,
        "phase-7c-contract-package.json": input.phase7cContractPackage,
      });
    } catch (error) {
      throw new PlannerError("PLANNING_PROJECTION_FAILED", "Planning Acceptance was persisted, but its derived Project Memory projection failed.", error);
    }
  }

  private async planningAcceptanceContext(projectId: string, projectVersion: number) {
    const canonical = await this.documents.get(projectId, projectVersion, "brief-v3");
    if (canonical?.documentType === "brief-v3") return { legalPlaceholderPolicy: canonical.brief.legal.placeholderPolicy } as const;
    const legacy = await this.documents.get(projectId, projectVersion, "requirements");
    const policy = legacy?.documentType === "requirements" ? legacy.legalComplianceConstraints?.placeholderPolicy : undefined;
    return policy ? { legalPlaceholderPolicy: policy } as const : undefined;
  }

  private async planningAcceptanceContextInTransaction(tx: PersistenceTransaction, projectId: string, projectVersion: number) {
    const canonicalRow = await tx.getDocument(projectId, projectVersion, "brief-v3");
    const canonical = canonicalRow ? mapRowToDocument(canonicalRow) : null;
    if (canonical?.documentType === "brief-v3") return { legalPlaceholderPolicy: canonical.brief.legal.placeholderPolicy } as const;
    const legacyRow = await tx.getDocument(projectId, projectVersion, "requirements");
    const legacy = legacyRow ? mapRowToDocument(legacyRow) : null;
    const policy = legacy?.documentType === "requirements" ? legacy.legalComplianceConstraints?.placeholderPolicy : undefined;
    return policy ? { legalPlaceholderPolicy: policy } as const : undefined;
  }
}
function TechnicalArchitectureAcceptance(
  architecture: PlanningPackage["architecture"],
  acceptedAt: string,
  acceptedBy: string,
) {
  return {
    ...architecture,
    acceptance: { accepted: true, acceptedAt, acceptedBy },
  };
}
export function createPlannerArchitectService(
  dependencies: PlannerServiceDependencies,
) {
  return new PlannerArchitectService(dependencies);
}
