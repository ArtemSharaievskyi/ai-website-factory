import { randomUUID } from "node:crypto";
import { z } from "zod";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { DecisionRecordSchema } from "@/domain/workflow/decision";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import {
  DecisionRepository,
  DocumentRepository,
  ProjectRepository,
  WorkflowPersistenceService,
} from "@/persistence/database/repositories";
import type { PersistenceDatabase } from "@/persistence/database/types";
import { PlannerError } from "./errors";
import { PersistenceError } from "@/persistence/database/errors";
import {
  buildPlanningPackage,
  planningChecksum,
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
};

export class PlannerArchitectService {
  private readonly projects;
  private readonly documents;
  private readonly decisions;
  private readonly workflow;
  private readonly provider: PlannerArchitectureProvider;
  private readonly skills: PlannerSkillSelectionPort;
  private readonly resolveSkills?: PlannerServiceDependencies["resolveSkills"];
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
      checksum: planningChecksum(packageValue),
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
    const admission = validatePlanningAdmission(packageValue);
    const blockers = [...packageValue.blockers, ...admission.blockers];
    return {
      ready: blockers.length === 0,
      blockers: [...new Set(blockers)],
      checksum: planningChecksum(packageValue),
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
    const current = await this.projects.getWithVersion(input.projectId);
    if (
      !current ||
      current.project.workflowState !== "AWAITING_DESIGN_SELECTION"
    )
      throw new PlannerError(
        "PLANNER_WORKFLOW_STATE_INVALID",
        "Planning acceptance is only available while awaiting design selection.",
      );
    if (current.rowVersion !== input.expectedRowVersion)
      throw new PlannerError(
        "PLANNING_STALE",
        "The project row version is stale.",
      );
    const acceptedArchitecture = TechnicalArchitectureAcceptance(
      validation.package.architecture,
      input.acceptedAt,
      input.acceptedBy,
    );
    const acceptedPackage = PlanningPackageSchema.parse({
      ...validation.package,
      architecture: acceptedArchitecture,
      accepted: true,
      acceptance: {
        acceptedAt: input.acceptedAt,
        acceptedBy: input.acceptedBy,
        checksum: input.planningChecksum,
      },
      updatedAt: input.acceptedAt,
    });
    const phase7cContractPackage = buildPhase7CContractPackage({
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      createdAt: input.acceptedAt,
      approvedBriefChecksum: acceptedPackage.approvedBriefChecksum,
      planningChecksum: input.planningChecksum,
      architectureChecksum: checksumPersistedDocument(acceptedArchitecture),
      designChecksum: "0".repeat(64),
      planning: acceptedPackage,
    });
    await this.persistPackage(acceptedPackage, input.idempotencyKey);
    await this.documents.save(
      phase7cContractPackage,
      `planning-phase-7c-${input.projectId}-${input.projectVersion}-${input.idempotencyKey}`,
    );
    this.packages.set(
      this.packageKey(input.projectId, input.projectVersion),
      acceptedPackage,
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
    await this.dependencies.memory.appendDecision(
      input.projectId,
      input.projectVersion,
      record,
    );
    await this.dependencies.memory.writeSnapshot(
      input.projectId,
      input.projectVersion,
      {
        "planning-package.json": acceptedPackage,
        "architecture.json": acceptedArchitecture,
        "content-plan.json": acceptedPackage.content,
        "asset-manifest.json": acceptedPackage.assets,
        "phase-7c-contract-package.json": phase7cContractPackage,
      },
    );
    const transition = await this.workflow.transition({
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      expectedState: "AWAITING_DESIGN_SELECTION",
      expectedRowVersion: current.rowVersion,
      targetState: "ARCHITECTURE_REVIEW",
      actor: input.acceptedBy,
      reason:
        "Planning Acceptance completed; architecture review is required before Design.",
      idempotencyKey: `${input.idempotencyKey}:architecture-review`,
    });
    return {
      package: acceptedPackage,
      planningChecksum: planningChecksum(acceptedPackage),
      projectState: "ARCHITECTURE_REVIEW" as const,
      rowVersion: transition.rowVersion,
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
      planningChecksum: planningChecksum(next),
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
