import { randomUUID } from "node:crypto";
import { z } from "zod";
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
} from "@/persistence/database/repositories";
import { mapRowToDocument } from "@/persistence/database/mapping";
import type { PersistenceDatabase, PersistenceTransaction } from "@/persistence/database/types";
import { PlannerError } from "./errors";
import { PersistenceError } from "@/persistence/database/errors";
import {
  buildPlanningPackage,
  evaluatePlanningAcceptanceReadiness,
  isClientOnlyFormBrief,
  isNoBackendBrief,
  planningDocumentChecksum,
  planningSemanticChecksum,
  validatePlanningAdmission,
  validatePlanningPackageAgainstBrief,
} from "./deterministic";
import {
  PlannerAgentInputSchema,
  PlanningPackageSchema,
  type PlannerAgentInput,
  type PlanningPackage,
} from "./contracts";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
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
import { BriefV3DocumentSchema } from "@/persistence/database/brief-revision-v3-contracts";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { canonicalBriefToPlannerBrief, effectivePlannerBrief } from "./brief-context";
import { admitPlanningRefresh, PlanningAdmissionError, type PlanningRefreshDomain } from "./refresh-admission";

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
  private validateBrief(input: PlannerAgentInput, currentCanonical?: z.infer<typeof BriefV3DocumentSchema>) {
    const brief = currentCanonical
      ? canonicalBriefToPlannerBrief(
          currentCanonical.brief,
          RequirementSpecificationSchema.parse(input.approvedBrief),
          currentCanonical.approval,
        )
      : effectivePlannerBrief(input);
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
  private async validateCurrentCanonicalBrief(input: PlannerAgentInput) {
    const stored = await this.documents.get(
      input.projectId,
      input.projectVersion,
      "brief-v3",
    );
    if (!stored || stored.documentType !== "brief-v3") return;
    const document = BriefV3DocumentSchema.parse(stored);
    if (
      !document.approval?.approved ||
      document.approval.approvedCanonicalChecksum !== document.briefChecksum ||
      (input.canonicalBrief && canonicalBriefChecksum(input.canonicalBrief) !== document.briefChecksum) ||
      input.approvedBriefChecksum !== document.briefChecksum
    )
      throw new PlannerError(
        "BRIEF_CHECKSUM_MISMATCH",
        "The Planner input is not bound to the current approved CanonicalBriefV3.",
      );
    return document;
  }
  private admitPlanningCandidate(input: {
    plannerInput: PlannerAgentInput;
    canonicalBrief?: z.infer<typeof BriefV3DocumentSchema>["brief"];
    candidate: PlanningPackage;
    current?: PlanningPackage;
    authorizedDomains?: readonly PlanningRefreshDomain[];
  }) {
    let admission;
    try {
      admission = admitPlanningRefresh({
        candidate: input.candidate,
        current: input.current,
        canonicalBrief: input.canonicalBrief,
        authorizedDomains: input.authorizedDomains,
        projectId: input.plannerInput.projectId,
        projectVersion: input.plannerInput.projectVersion,
        approvedBriefChecksum: input.plannerInput.approvedBriefChecksum,
        timestamp: now(),
      });
    } catch (error) {
      if (error instanceof PlanningAdmissionError)
        throw new PlannerError(
          "PLANNING_PACKAGE_INVALID",
          `Planner output failed deterministic refresh admission: ${error.message}.`,
          error,
        );
      throw error;
    }
    if (admission.blockers.length > 0)
      throw new PlannerError(
        "PLANNING_PACKAGE_INVALID",
        `Planner output failed deterministic refresh admission: ${admission.blockers.slice(0, 8).join(", ")}.`,
        admission,
      );
    return admission.candidate;
  }
  async planApprovedProject(rawInput: PlannerAgentInput) {
    const input = this.parseInput(rawInput);
    if (input.currentWorkflowState !== "AWAITING_DESIGN_SELECTION")
      throw new PlannerError(
        "PLANNER_WORKFLOW_STATE_INVALID",
        "Planning starts only while awaiting design selection.",
      );
    const currentCanonical = await this.validateCurrentCanonicalBrief(input);
    const brief = this.validateBrief(input, currentCanonical);
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
    const existingPlanning = await this.documents.getWithMetadata(
      input.projectId,
      input.projectVersion,
      "planning-package",
    );
    const persistedPlanningPackage =
      existingPlanning?.document.documentType === "planning-package"
        ? PlanningPackageSchema.parse(existingPlanning.document)
        : undefined;
    // A previously persisted invalid V3 proposal is historical evidence, not
    // a trusted refresh baseline. A later explicitly authorized refresh may
    // replace it through the existing CAS row, but it must prove the current
    // Brief from scratch.
    const currentPlanningPackage = (() => {
      if (!persistedPlanningPackage || !currentCanonical) return persistedPlanningPackage;
      try {
        const baseline = admitPlanningRefresh({
          candidate: persistedPlanningPackage,
          current: persistedPlanningPackage,
          canonicalBrief: currentCanonical.brief,
          projectId: input.projectId,
          projectVersion: input.projectVersion,
          approvedBriefChecksum: currentCanonical.briefChecksum,
          timestamp: persistedPlanningPackage.updatedAt,
        });
        return baseline.blockers.length === 0 ? persistedPlanningPackage : undefined;
      } catch (error) {
        if (error instanceof PlanningAdmissionError) return undefined;
        throw error;
      }
    })();
    await this.validateCurrentCanonicalBrief(input);
    const skillSelection = this.resolveSkills
      ? await this.resolveSkills(currentCanonical ? { ...input, canonicalBrief: currentCanonical.brief } : input)
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
      // Re-check the host-owned currentness token immediately before provider
      // spend; skill/context preparation may have overlapped a Brief update.
      await this.validateCurrentCanonicalBrief(input);
      planningPackage = PlanningPackageSchema.parse(
        await this.provider.plan(
          { ...input, approvedBrief: brief, ...(currentCanonical ? { canonicalBrief: currentCanonical.brief } : {}), documentationExcerpts },
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
    const currentAfterProvider = await this.validateCurrentCanonicalBrief(input);
    const projectAfterProvider = await this.projects.getWithVersion(input.projectId);
    if (!projectAfterProvider || projectAfterProvider.rowVersion !== input.expectedRowVersion || projectAfterProvider.project.workflowState !== "AWAITING_DESIGN_SELECTION")
      throw new PlannerError("PLANNING_STALE", "The project changed while the Planner was running.");
    if (currentAfterProvider?.briefChecksum !== currentCanonical?.briefChecksum)
      throw new PlannerError("PLANNING_STALE", "The approved CanonicalBriefV3 changed while the Planner was running.");
    const planningAfterProvider = await this.documents.getWithMetadata(
      input.projectId,
      input.projectVersion,
      "planning-package",
    );
    if (planningAfterProvider?.rowVersion !== existingPlanning?.rowVersion || planningAfterProvider?.checksum !== existingPlanning?.checksum)
      throw new PlannerError("PLANNING_STALE", "The current PlanningPackage changed while the Planner was running.");
    planningPackage = this.admitPlanningCandidate({
      plannerInput: input,
      canonicalBrief: currentAfterProvider?.brief,
      candidate: planningPackage,
      current: currentPlanningPackage,
    });
    if (!validatePlanningAdmission(planningPackage).ready)
      throw new PlannerError(
        "PLANNING_PACKAGE_INVALID",
        "Planner output failed deterministic admission.",
      );
    const contractIssues = validatePlanningPackageAgainstBrief(brief, planningPackage);
    if (contractIssues.length > 0)
      throw new PlannerError(
        "PLANNING_PACKAGE_INVALID",
        `Planner output violated approved form behavior: ${contractIssues.join(", ")}.`,
      );
    await this.persistPackage(planningPackage, input.idempotencyKey, existingPlanning, {
      rowVersion: input.expectedRowVersion,
      workflowState: "AWAITING_DESIGN_SELECTION",
    });
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
    return planningPackage;
  }
  async getPlanningStatus(projectId: string, projectVersion: number) {
    // Project Memory and the in-process cache are projections. Always rebuild
    // status from the persisted current document before exposing it.
    const packageValue = await this.documents.get(
      projectId,
      projectVersion,
      "planning-package",
    );
    if (!packageValue || packageValue.documentType !== "planning-package")
      throw new PlannerError(
        "PLANNING_NOT_ACCEPTED",
        "No planning package is available.",
      );
    const admissionBlockers: string[] = [];
    const briefV3 = await this.documents.get(projectId, projectVersion, "brief-v3");
    if (briefV3?.documentType === "brief-v3") {
      try {
        const canonical = BriefV3DocumentSchema.parse(briefV3);
        const admission = admitPlanningRefresh({
          candidate: packageValue,
          current: packageValue,
          canonicalBrief: canonical.brief,
          projectId,
          projectVersion,
          approvedBriefChecksum: canonical.briefChecksum,
          timestamp: packageValue.updatedAt,
        });
        admissionBlockers.push(...admission.blockers);
      } catch (error) {
        if (error instanceof PlanningAdmissionError)
          admissionBlockers.push(error.message);
        else throw error;
      }
    }
    return {
      package: packageValue,
      checksum: planningDocumentChecksum(packageValue),
      blockers: [...new Set([...packageValue.blockers, ...admissionBlockers])],
      accepted: packageValue.accepted,
    };
  }
  async reconcilePersistedPlanningPackage(
    projectId: string,
    projectVersion: number,
    idempotencyKey: string,
  ) {
    const brief = await this.documents.get(projectId, projectVersion, "requirements");
    const briefV3 = await this.documents.get(projectId, projectVersion, "brief-v3");
    const storedPlanning = await this.documents.getWithMetadata(projectId, projectVersion, "planning-package");
    if (!storedPlanning || storedPlanning.document.documentType !== "planning-package")
      throw new PlannerError("PLANNING_NOT_ACCEPTED", "No planning package is available.");
    const persistedPackage = PlanningPackageSchema.parse(storedPlanning.document);
    const status = {
      package: persistedPackage,
      checksum: planningDocumentChecksum(persistedPackage),
      blockers: persistedPackage.blockers,
      accepted: persistedPackage.accepted,
    };
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
    const canonical = briefV3?.documentType === "brief-v3" ? BriefV3DocumentSchema.parse(briefV3) : undefined;
    const effectiveBrief = canonical ? canonicalBriefToPlannerBrief(canonical.brief, brief, canonical.approval) : brief;
    const admitted = this.admitPlanningCandidate({
      plannerInput: {
        projectId,
        projectVersion,
        approvedBrief: effectiveBrief,
        ...(canonical ? { canonicalBrief: canonical.brief } : {}),
        approvedBriefChecksum: canonical?.briefChecksum ?? checksumPersistedDocument(effectiveBrief),
        originalPromptReference: "reconcile-persisted-planning",
        clarificationEvidenceReferences: [],
        currentWorkflowState: "AWAITING_DESIGN_SELECTION",
        existingDecisions: [],
        suppliedFiles: [],
        allowedSkills: [],
        idempotencyKey,
        expectedRowVersion: 1,
      },
      canonicalBrief: canonical?.brief,
      candidate: status.package,
      current: status.package,
    });
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
      ...admitted,
      blockers,
      updatedAt: now(),
    });
    if (!validatePlanningAdmission(corrected).ready)
      throw new PlannerError(
        "PLANNING_PACKAGE_INVALID",
        "Reconciled planning package failed deterministic admission.",
      );
    await this.persistPackage(corrected, idempotencyKey, {
      rowVersion: storedPlanning.rowVersion,
      checksum: storedPlanning.checksum,
    });
    this.packages.set(this.packageKey(projectId, projectVersion), corrected);
    return corrected;
  }
  async validatePlanningPackage(projectId: string, projectVersion: number) {
    const status = await this.getPlanningStatus(projectId, projectVersion);
    const packageValue = PlanningPackageSchema.parse(status.package);
    const context = await this.planningAcceptanceContext(projectId, projectVersion);
    const readiness = evaluatePlanningAcceptanceReadiness({ planningPackage: packageValue, context });
    const admissionBlockers: string[] = [];
    const briefV3 = await this.documents.get(projectId, projectVersion, "brief-v3");
    if (briefV3?.documentType === "brief-v3") {
      try {
        const canonical = BriefV3DocumentSchema.parse(briefV3);
        admissionBlockers.push(
          ...admitPlanningRefresh({
            candidate: packageValue,
            current: packageValue,
            canonicalBrief: canonical.brief,
            projectId,
            projectVersion,
            approvedBriefChecksum: canonical.briefChecksum,
            timestamp: packageValue.updatedAt,
          }).blockers,
        );
      } catch (error) {
        if (error instanceof PlanningAdmissionError)
          admissionBlockers.push(error.message);
        else throw error;
      }
    }
    return {
      ready: readiness.readyForAcceptance && admissionBlockers.length === 0,
      blockers: [...new Set([...admissionBlockers, ...readiness.blockingItems.map((item) => item.reason)])],
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
      if (brief.documentType === "brief-v3") {
        try {
          const canonical = BriefV3DocumentSchema.parse(brief);
          const admission = admitPlanningRefresh({
            candidate: packageValue,
            current: packageValue,
            canonicalBrief: canonical.brief,
            projectId: input.projectId,
            projectVersion: input.projectVersion,
            approvedBriefChecksum: canonical.briefChecksum,
            timestamp: packageValue.updatedAt,
          });
          if (admission.blockers.length > 0)
            throw new PlannerError(
              "ARCHITECTURE_BLOCKED",
              `Planning refresh admission failed: ${admission.blockers.slice(0, 10).join(", ")}.`,
            );
        } catch (error) {
          if (error instanceof PlanningAdmissionError)
            throw new PlannerError(
              "ARCHITECTURE_BLOCKED",
              `Planning refresh admission failed: ${error.message}.`,
              error,
            );
          throw error;
        }
      }
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
      currentPlanningPackage: suppliedCurrentPlanningPackage,
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
    const currentCanonical = await this.validateCurrentCanonicalBrief(parsed);
    const brief = this.validateBrief(parsed, currentCanonical);
    const current = await this.projects.getWithVersion(input.projectId);
    if (!current || current.project.workflowState !== "ARCHITECTURE_REVIEW")
      throw new PlannerError(
        "PLANNER_WORKFLOW_STATE_INVALID",
        "Planner correction is only available during architecture review.",
      );
    const persistedCurrent = await this.documents.getWithMetadata(
      input.projectId,
      input.projectVersion,
      "planning-package",
    );
    if (!persistedCurrent || persistedCurrent.document.documentType !== "planning-package")
      throw new PlannerError(
        "PLANNING_NOT_ACCEPTED",
        "Planner correction requires the current persisted PlanningPackage.",
      );
    const currentPlanningPackage = PlanningPackageSchema.parse(persistedCurrent.document);
    if (planningDocumentChecksum(currentPlanningPackage) !== planningDocumentChecksum(suppliedCurrentPlanningPackage))
      throw new PlannerError(
        "PLANNING_STALE",
        "The supplied correction PlanningPackage is not the persisted current package.",
      );
    if (
      currentPlanningChecksum &&
      ![planningDocumentChecksum(currentPlanningPackage), planningSemanticChecksum(currentPlanningPackage)].includes(currentPlanningChecksum)
    )
      throw new PlannerError(
        "PLANNING_STALE",
        "The correction PlanningPackage is stale.",
      );
    let corrected: PlanningPackage;
    const clientOnlyFinding = (finding: ArchitectureReviewResult["findings"][number]) =>
      finding.findingId === "architecture-review-local-form-submission-decision"
      || (finding.category === "CONTRADICTORY_DECISION" && finding.evidenceRefs.includes("planning:forms") && /form|submission|frontend|client|local|pending/i.test(`${finding.summary} ${finding.recommendedAction}`));
    const canResolveClientOnlyDeterministically = isClientOnlyFormBrief(brief)
      && currentPlanningPackage.forms.forms.some((form) => form.submissionMechanism === "pending-decision")
      && review.findings.length > 0
      && review.findings.every(clientOnlyFinding)
      && currentPlanningPackage.architecture.serverActions.length === 0
      && currentPlanningPackage.architecture.routeHandlers.length === 0
      && currentPlanningPackage.dataModel.entities.length === 0
      && !currentPlanningPackage.supabase.postgres
      && currentPlanningPackage.email.decision === "not-required";
    const noBackendFinding = (finding: ArchitectureReviewResult["findings"][number]) => finding.findingId === "architecture-backend-priority-conflict" || finding.findingId === "architecture-no-backend-capability-conflict";
    const canResolveNoBackendDeterministically = isNoBackendBrief(brief)
      && currentPlanningPackage.architecture.backendPriority.length > 0
      && review.findings.length > 0
      && review.findings.every(noBackendFinding)
      && currentPlanningPackage.architecture.serverActions.length === 0
      && currentPlanningPackage.architecture.routeHandlers.length === 0
      && currentPlanningPackage.architecture.supabaseDatabaseRequirements.length === 0
      && currentPlanningPackage.architecture.schemaPlan.length === 0
      && currentPlanningPackage.architecture.rlsRequirements.length === 0
      && currentPlanningPackage.dataModel.entities.length === 0
      && !currentPlanningPackage.supabase.postgres
      && !currentPlanningPackage.supabase.auth
      && !currentPlanningPackage.supabase.storage
      && !currentPlanningPackage.supabase.realtime
      && !currentPlanningPackage.supabase.edgeFunctions
      && currentPlanningPackage.authentication.decision === "none"
      && !currentPlanningPackage.authentication.required
      && currentPlanningPackage.storage.decision === "not-required"
      && currentPlanningPackage.email.decision === "not-required"
      && currentPlanningPackage.administration.decision === "no-admin";
    if (canResolveNoBackendDeterministically) {
      corrected = PlanningPackageSchema.parse({
        ...currentPlanningPackage,
        architecture: { ...currentPlanningPackage.architecture, backendPriority: [] },
      });
    } else if (canResolveClientOnlyDeterministically) {
      corrected = PlanningPackageSchema.parse({
        ...currentPlanningPackage,
        forms: {
          ...currentPlanningPackage.forms,
          forms: currentPlanningPackage.forms.forms.map((form) => form.submissionMechanism === "pending-decision" ? { ...form, submissionMechanism: "client-only" } : form),
        },
      });
    } else {
      const skillSelection = this.resolveSkills
        ? await this.resolveSkills(parsed)
        : undefined;
      try {
        corrected = PlanningPackageSchema.parse(
          await this.provider.plan({
            ...parsed,
            approvedBrief: brief,
            ...(currentCanonical ? { canonicalBrief: currentCanonical.brief } : {}),
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
    const admitted = this.admitPlanningCandidate({
      plannerInput: parsed,
      canonicalBrief: currentCanonical?.brief,
      candidate: next,
      current: currentPlanningPackage,
      authorizedDomains: (() => {
        const domains = new Set<PlanningRefreshDomain>(["traceability"]);
        for (const finding of review.findings) {
          if (["REQUIREMENT_TRACEABILITY", "SOURCE_OF_TRUTH"].includes(finding.category)) domains.add("traceability");
          if (["DOMAIN_MODEL", "IDENTITY_MODEL", "DATA_ARCHITECTURE"].includes(finding.category)) { domains.add("data-model"); domains.add("backend"); domains.add("database-decision"); }
          if (finding.category === "AUTH_ARCHITECTURE") { domains.add("authentication"); domains.add("security"); }
          if (finding.category === "STORAGE_ARCHITECTURE") { domains.add("storage"); domains.add("security"); }
          if (["API_BOUNDARY", "SERVER_CLIENT_BOUNDARY"].includes(finding.category)) { domains.add("architecture"); domains.add("backend"); domains.add("forms"); }
          if (finding.category === "DEPENDENCY_ARCHITECTURE") { domains.add("dependencies"); domains.add("architecture"); }
          if (finding.category === "SECURITY_ARCHITECTURE") { domains.add("security"); domains.add("authentication"); domains.add("backend"); domains.add("storage"); }
          if (["IMPLEMENTABILITY", "UNNECESSARY_COMPLEXITY", "MISSING_DECISION", "CONTRADICTORY_DECISION"].includes(finding.category)) domains.add("architecture");
        }
        return [...domains];
      })(),
    });
    const admittedNext = PlanningPackageSchema.parse({
      ...admitted,
      updatedAt: next.updatedAt,
    });
    if (!validatePlanningAdmission(admittedNext).ready)
      throw new PlannerError(
        "PLANNING_PACKAGE_INVALID",
        "Planner correction failed deterministic admission.",
      );
    const correctionIssues = validatePlanningPackageAgainstBrief(brief, admittedNext);
    if (correctionIssues.length > 0)
      throw new PlannerError(
        "PLANNING_PACKAGE_INVALID",
        `Planner correction violated approved form behavior: ${correctionIssues.join(", ")}.`,
      );
    const transition = await this.persistPackage(admittedNext, input.idempotencyKey, {
      rowVersion: persistedCurrent.rowVersion,
      checksum: persistedCurrent.checksum,
    }, {
      rowVersion: current.rowVersion,
      workflowState: "ARCHITECTURE_REVIEW",
    }, {
      targetState: "AWAITING_DESIGN_SELECTION",
      actor: "planner-architect",
      reason: `Architecture findings corrected in bounded cycle ${cycle + 1}. Planning Acceptance must run again.`,
      idempotencyKey: `${input.idempotencyKey}:planning-correction`,
    });
    this.packages.set(key, admittedNext);
    this.architectureCorrectionCycles.set(key, cycle + 1);
    return {
      package: admittedNext,
      planningChecksum: planningDocumentChecksum(admittedNext),
      projectState: "AWAITING_DESIGN_SELECTION" as const,
      rowVersion: transition!.rowVersion,
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
    currentPlanning?: { rowVersion: number; checksum: string } | null,
    currentProject?: { rowVersion: number; workflowState: "AWAITING_DESIGN_SELECTION" | "ARCHITECTURE_REVIEW" },
    workflowTransition?: { targetState: "AWAITING_DESIGN_SELECTION"; actor: string; reason: string; idempotencyKey: string },
  ) {
    const transition = await this.dependencies.database.transaction(async (tx) => {
      if (currentProject) {
        const project = await tx.getProject(packageValue.projectId);
        if (!project || project.current_version !== packageValue.projectVersion || project.row_version !== currentProject.rowVersion || project.workflow_state !== currentProject.workflowState)
          throw new PersistenceError("PERSISTENCE_CONFLICT", "The Planning currentness token is stale.");
      }
      const documents: Array<{
        document:
          | PlanningPackage
          | PlanningPackage["architecture"]
          | PlanningPackage["content"]
          | PlanningPackage["assets"];
        documentType: string;
      }> = [
        { document: packageValue, documentType: "package" },
        { document: packageValue.architecture, documentType: "architecture" },
        { document: packageValue.content, documentType: "content" },
        { document: packageValue.assets, documentType: "assets" },
      ];
      for (const item of documents) {
        try {
          const itemKey = `planning-${item.documentType}-${packageValue.projectId}-${packageValue.projectVersion}-${idempotencyKey}`;
          if (item.documentType === "package") {
            await saveDocumentCASInTransaction(
              tx,
              item.document,
              currentPlanning?.rowVersion ?? null,
              currentPlanning?.checksum ?? null,
            );
          } else {
            await saveDocumentInTransaction(tx, item.document, itemKey);
          }
        } catch (error) {
          if (error instanceof PersistenceError)
            throw new PersistenceError(
              error.code,
              `Planner persistence failed while saving ${item.documentType}.`,
              { documentType: item.documentType },
              error,
            );
          throw error;
        }
      }
      if (workflowTransition) {
        if (!currentProject)
          throw new PersistenceError("PERSISTENCE_CONFLICT", "A workflow transition requires a project currentness token.");
        return transitionWorkflowInTransaction(tx, {
          projectId: packageValue.projectId,
          projectVersion: packageValue.projectVersion,
          expectedState: currentProject.workflowState,
          expectedRowVersion: currentProject.rowVersion,
          targetState: workflowTransition.targetState,
          actor: workflowTransition.actor,
          reason: workflowTransition.reason,
          idempotencyKey: workflowTransition.idempotencyKey,
        });
      }
      return undefined;
    });
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
    return transition;
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
      const briefRow = await tx.getDocument(projectId, projectVersion, "brief-v3");
      if (briefRow) {
        try {
          const brief = BriefV3DocumentSchema.parse(mapRowToDocument(briefRow));
          const admission = admitPlanningRefresh({
            candidate: packageValue,
            current: packageValue,
            canonicalBrief: brief.brief,
            projectId,
            projectVersion,
            approvedBriefChecksum: brief.briefChecksum,
            timestamp: packageValue.updatedAt,
          });
          if (admission.blockers.length > 0)
            throw new PlannerError(
              "PLANNING_NOT_ACCEPTED",
              `Planning Acceptance is not current: ${admission.blockers.slice(0, 8).join(", ")}.`,
            );
        } catch (error) {
          if (error instanceof PlannerError) throw error;
          if (error instanceof PlanningAdmissionError)
            throw new PlannerError("PLANNING_NOT_ACCEPTED", `Planning Acceptance is not current: ${error.message}.`, error);
          throw error;
        }
      }
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
