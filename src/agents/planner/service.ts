import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DecisionRecordSchema } from "@/domain/workflow/decision";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import {
  appendDecisionInTransaction,
  DecisionRepository,
  DocumentRepository,
  ProjectRepository,
  PlanningRefreshDiagnosticsRepository,
  saveDocumentCASInTransaction,
  saveDocumentInTransaction,
  transitionWorkflowInTransaction,
} from "@/persistence/database/repositories";
import { mapRowToDocument, type DocumentRow } from "@/persistence/database/mapping";
import type { PersistenceDatabase, PersistenceTransaction } from "@/persistence/database/types";
import { PlannerError, type PlannerErrorCode } from "./errors";
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
import { CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY } from "./semantic-checksum";
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
import { isPlaceholderImageApprovalBlocker, PlannerReferenceBindingError } from "../../integrations/openai/adapters";
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
import {
  admitPlanningRefresh,
  PlanningAdmissionError,
  projectPlanningAcceptanceCoverageFromRecoveryAccounting,
  type PlanningAcceptanceCoverageProjection,
  type PlanningRefreshDomain,
} from "./refresh-admission";
import {
  createCanonicalPlanningRouteManifest,
  createPlanningOwnedRequirementManifest,
  createPlanningTargetCatalog,
} from "./recovery-manifests";
import {
  PlanningRecoveryPlanSchema,
  PlanningRecoveryProviderResultSchema,
} from "./recovery";
import {
  applyPlanningChangeSet,
  createPlanningAuthorizationDelta,
  computePlanningBriefDeltaFromHistory,
  PlanningChangeSetProviderOutputSchema,
  providerChangeSetToHostChangeSet,
  type PlanningBriefDelta,
} from "./changeset";
import { type PlanningRefreshDiagnosticAttempt } from "./refresh-diagnostics";
import type { TransitionContext } from "@/domain/workflow/engine";
import { canonicalRequirementEntries } from "@/domain/requirements/v3/identity";
import { assertPlannerReferenceTableCurrent, createPlannerReferenceTable, PlannerReferenceTableError } from "./reference-table";
import { isAiProviderError } from "@/integrations/openai/errors";
import type { ProviderDiagnostic, ProviderInvocationLedgerHandle, ProviderInvocationLedgerPort, ProviderTerminationParseStatus } from "@/integrations/openai/usage";
import {
  admitPlanningCoverage,
  admitPlanningDecomposition,
  assembleStagedPlanningCandidate,
  assertAdmissibleCoverageTargetCounts,
  assertAdmissibleCoverageTargetTableCurrent,
  createAdmissibleCoverageTargetTable,
  assertDecompositionCoverageRepresentability,
  finalizePlanningElementGraph,
  StagedPlanningAdmissionError,
  stagedPlanningAdmissionDiagnostics,
  stagedPlanningMinimumDiagnostics,
  stagedPlanningCoverageDiagnostics,
  stagedPlanningRepresentabilityDiagnostics,
  stagedPlanningGraphCycleDiagnostics,
  stagedPlanningAdmissionEvidence,
} from "./staged-admission";
import { PLANNER_COVERAGE_CONTRACT_VERSION, PLANNING_COVERAGE_PROVIDER_SCHEMA_NAME, PLANNER_DECOMPOSITION_PROVIDER_SCHEMA_NAME, type PlannerDecompositionProviderInput } from "./staged-contracts";
import { createDecompositionMinimumContract } from "./decomposition-minimum";
import { deriveCoverageRepresentabilityPlan } from "./coverage-representability";
import {
  StagedPlanningOperationTelemetry,
  type StagedPlanningFailureClass,
  type StagedPlanningStage,
} from "./staged-failures";
import {
  PlanningFinalAdmissionError,
  planningFinalCoverageDiagnostics,
  planningFinalAdmissionDiagnostics,
  planningFinalAdmissionDiagnosticsFromError,
  type PlanningStagedCoverageBinding,
} from "./final-admission-diagnostics";

const now = () => new Date().toISOString();

export function plannerAuthorityFor(brief: z.infer<typeof BriefV3DocumentSchema>["brief"]) {
  const routeManifest = createCanonicalPlanningRouteManifest(brief);
  const planningManifest = createPlanningOwnedRequirementManifest(brief);
  const requiredIds = new Set(planningManifest.requirements.map((entry) => entry.requirementId));
  const requirementLedger = canonicalRequirementEntries(brief).map((entry) => ({ requirementId: entry.id, statement: entry.statement, category: entry.category, planningCoverageType: requiredIds.has(entry.id) ? "REQUIRED_PLANNING_COVERAGE" as const : "NON_PLANNING_OWNED" as const }));
  const requirementIds = requirementLedger.map((entry) => entry.requirementId).sort();
  return {
    routePolicy: routeManifest.routePolicy,
    allowedRoutes: routeManifest.routes.map((route) => ({ routeId: route.routeId, pageId: route.pageId, path: route.path, purpose: route.pagePurpose })),
    requirementLedger,
    allowedCanonicalRequirementIds: requirementIds,
    requiredCanonicalRequirementIds: [...requiredIds].sort(),
  };
}

function architectureReviewDomains(review: ArchitectureReviewResult): PlanningRefreshDomain[] {
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
  return [...domains].sort();
}

function boundedFailureCode(value: unknown): string | undefined {
  const text = value instanceof Error ? value.message : typeof value === "string" ? value : undefined;
  if (!text) return undefined;
  const code = text.split(":", 1)[0];
  return /^(?:BRIEF|PLANNING|PLANNER|PROJECT|PERSISTENCE)_[A-Z0-9_]+$/.test(code) ? code : undefined;
}

function nestedProviderDiagnostic(error: unknown, depth = 0): ProviderDiagnostic | undefined {
  if (depth > 5 || !error || typeof error !== "object") return undefined;
  if (isAiProviderError(error)) return error.diagnostic;
  return "cause" in error ? nestedProviderDiagnostic(error.cause, depth + 1) : undefined;
}

function nestedZodError(error: unknown, depth = 0): z.ZodError | undefined {
  if (depth > 5 || !error || typeof error !== "object") return undefined;
  if (error instanceof z.ZodError) return error;
  return "cause" in error ? nestedZodError(error.cause, depth + 1) : undefined;
}

function stagedProviderParseStage(error: unknown, providerStage: "DECOMPOSITION" | "COVERAGE"): StagedPlanningStage {
  const diagnostic = nestedProviderDiagnostic(error);
  const parsed = error instanceof z.ZodError || diagnostic?.stage === "structured_parse" || diagnostic?.stage === "domain_validation" || diagnostic?.outputStage === "STRUCTURED_OUTPUT_PARSE_FAILED" || diagnostic?.outputStage === "TRANSPORT_SCHEMA_VALIDATION_FAILED";
  return parsed ? `${providerStage}_PARSE` : `${providerStage}_PROVIDER`;
}

function safeStagedReasonCode(error: unknown, depth = 0): string | undefined {
  if (depth > 6 || !error || typeof error !== "object") return undefined;
  const value = error as Record<string, unknown>;
  if (typeof value.reasonCode === "string" && /^PLANNING_[A-Z0-9_]+$/.test(value.reasonCode)) return value.reasonCode;
  if (isAiProviderError(error)) return error.code;
  if ("cause" in value) {
    const nested = safeStagedReasonCode(value.cause, depth + 1);
    if (nested) return nested;
  }
  if (typeof value.code === "string" && /^PLANNING_(?:DECOMPOSITION|GRAPH|COVERAGE|ROUTE|TRACEABILITY|REQUIREMENT)/.test(value.code)) return value.code;
  return undefined;
}

function safeStagedToken(error: unknown, depth = 0): string | undefined {
  if (depth > 6 || !error || typeof error !== "object") return undefined;
  const value = error as Record<string, unknown>;
  const token = [value.safeToken, value.reference, value.fieldPath, value.reasonCode].find((candidate) => typeof candidate === "string" && /(?:^|[^A-Z0-9])(?:REQ|PE|PAGE|ROUTE)_\d{3,}(?:$|[^A-Z0-9])/.test(candidate as string));
  if (typeof token === "string") return token.match(/(?:REQ|PE|PAGE|ROUTE)_\d{3,}/)?.[0];
  if ("cause" in value) return safeStagedToken(value.cause, depth + 1);
  return undefined;
}

function nestedFailureCode(error: unknown, depth = 0): string | undefined {
  if (depth > 6 || !error || typeof error !== "object") return undefined;
  const value = error as Record<string, unknown>;
  if (typeof value.code === "string" && value.code !== "PLANNING_PACKAGE_INVALID") return value.code;
  return "cause" in value ? nestedFailureCode(value.cause, depth + 1) : undefined;
}

function stagedFailureClass(stage: StagedPlanningStage, error: unknown): StagedPlanningFailureClass {
  if (stage === "PERSISTENCE" || stage === "LIFECYCLE_TRANSITION") return "RUNTIME_PERSISTENCE_FAILURE";
  if (error instanceof PlannerError && error.code === "PLANNING_STALE") return "STAGED_CURRENTNESS_FAILURE";
  if (stage === "DECOMPOSITION_PROVIDER" || stage === "COVERAGE_PROVIDER" || stage === "DECOMPOSITION_PARSE" || stage === "COVERAGE_PARSE") {
    const diagnostic = nestedProviderDiagnostic(error);
    const reasonCode = safeStagedReasonCode(error);
    if (nestedZodError(error) || reasonCode === "PLANNING_DECOMPOSITION_INVALID" && stage === "DECOMPOSITION_PARSE" || reasonCode === "PLANNING_COVERAGE_SCHEMA_INVALID" && stage === "COVERAGE_PARSE") return "PROVIDER_STRUCTURED_OUTPUT_FAILURE";
    if (diagnostic?.stage === "request_construction") return "PROVIDER_SCHEMA_ADHERENCE_FAILURE";
    if (diagnostic?.stage === "structured_parse" || diagnostic?.stage === "domain_validation" || diagnostic?.outputStage === "STRUCTURED_OUTPUT_PARSE_FAILED" || diagnostic?.outputStage === "TRANSPORT_SCHEMA_VALIDATION_FAILED") return "PROVIDER_STRUCTURED_OUTPUT_FAILURE";
    return "PROVIDER_TRANSPORT_FAILURE";
  }
  if (stage === "DECOMPOSITION_ADMISSION") return nestedFailureCode(error) === "PLANNING_DECOMPOSITION_ROUTE_UNKNOWN" ? "STAGED_REFERENTIAL_INTEGRITY_FAILURE" : "STAGED_DECOMPOSITION_FAILURE";
  if (stage === "DECOMPOSITION_REPRESENTABILITY") return "STAGED_COVERAGE_FAILURE";
  if (stage === "GRAPH_ASSEMBLY" || stage === "GRAPH_ADMISSION") return "STAGED_REFERENTIAL_INTEGRITY_FAILURE";
  if (stage === "COVERAGE_ADMISSION") {
    const code = nestedFailureCode(error);
    if (code === "PLANNING_TRACEABILITY_UNKNOWN_REFERENCE" || code === "PLANNING_ROUTE_POLICY_MISMATCH") return "STAGED_REFERENTIAL_INTEGRITY_FAILURE";
    return "STAGED_COVERAGE_FAILURE";
  }
  if (stage === "FINAL_ASSEMBLY") return "STAGED_FINAL_ASSEMBLY_FAILURE";
  if (stage === "FINAL_ADMISSION") return "STAGED_FINAL_ASSEMBLY_FAILURE";
  return "FACTORY_PROTOCOL_DEFECT";
}

function stagedOuterCode(stage: StagedPlanningStage, error: unknown): PlannerErrorCode {
  if (stage === "PERSISTENCE") return "PLANNING_PERSISTENCE_FAILED";
  if (stage === "LIFECYCLE_TRANSITION") return "PLANNING_LIFECYCLE_TRANSITION_FAILED";
  if (error instanceof PlannerError && error.code === "PLANNING_STALE") return "PLANNING_STALE";
  if (stage === "DECOMPOSITION_PROVIDER" || stage === "DECOMPOSITION_PARSE" || stage === "COVERAGE_PROVIDER" || stage === "COVERAGE_PARSE") return "PLANNER_PROVIDER_FAILED";
  return "PLANNING_PACKAGE_INVALID";
}

function refreshFailureCode(error: unknown): string {
  if (error instanceof PlanningAdmissionError) return error.code;
  if (error instanceof PersistenceError) return error.code;
  if (error instanceof PlannerError) {
    if (error.cause instanceof PlanningAdmissionError) return error.cause.reasonCode ?? error.cause.code;
    if (error.cause && typeof error.cause === "object" && "blockers" in error.cause && Array.isArray(error.cause.blockers)) {
      const blockerCode = error.cause.blockers.map(boundedFailureCode).find(Boolean);
      if (blockerCode) return blockerCode;
    }
    const nestedCode = boundedFailureCode(error.cause);
    return nestedCode ?? error.code;
  }
  return boundedFailureCode(error) ?? "PLANNING_REFRESH_FAILED";
}

function isCommitOutcomeAmbiguous(error: unknown, depth = 0): boolean {
  if (depth > 6 || !error || typeof error !== "object") return false;
  const value = error as { code?: unknown; cause?: unknown };
  return value.code === "PERSISTENCE_COMMIT_AMBIGUOUS" || isCommitOutcomeAmbiguous(value.cause, depth + 1);
}

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
  private readonly refreshDiagnostics;
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
    this.refreshDiagnostics = new PlanningRefreshDiagnosticsRepository(dependencies.database);
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
  private async recordRefreshFailure(input: {
    projectId: string;
    projectVersion: number;
    operationKey: string;
    stage: PlanningRefreshDiagnosticAttempt["stage"];
    error: unknown;
    basePlanningSemanticChecksum?: string;
    baseBriefChecksum?: string;
    targetBriefChecksum?: string;
    changedDomains?: readonly string[];
    operationKinds?: readonly string[];
  }) {
    const failureCode = refreshFailureCode(input.error);
    const status: PlanningRefreshDiagnosticAttempt["status"] = ["PLANNING_STALE", "PERSISTENCE_CONFLICT"].includes(failureCode) ? "REJECTED_STALE" : failureCode === "PLANNER_PROVIDER_FAILED" ? "FAILED" : "REJECTED_INVALID";
    try {
      await this.refreshDiagnostics.append({
        projectId: input.projectId,
        projectVersion: input.projectVersion,
        timestamp: now(),
        attempt: {
          id: randomUUID(),
          operationKey: input.operationKey,
          stage: input.stage,
          status,
          failureCode,
          ...(input.basePlanningSemanticChecksum ? { basePlanningSemanticChecksum: input.basePlanningSemanticChecksum } : {}),
          ...(input.baseBriefChecksum ? { baseBriefChecksum: input.baseBriefChecksum } : {}),
          ...(input.targetBriefChecksum ? { targetBriefChecksum: input.targetBriefChecksum } : {}),
          changedDomains: [...new Set(input.changedDomains ?? [])].slice(0, 32),
          operationKinds: [...new Set(input.operationKinds ?? [])].slice(0, 64),
          recordedAt: now(),
        },
      });
    } catch {
      // Forensic evidence is best effort and must never turn a safe rejection
      // into an unsafe retry or expose persistence details to the caller.
    }
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
    stagedCoverageBindings?: readonly PlanningStagedCoverageBinding[];
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
      if (error instanceof PlanningAdmissionError) {
        const diagnostics = planningFinalAdmissionDiagnosticsFromError({ error, boundary: "FINAL_ADMISSION", validator: "NORMALIZE_PLANNING_PACKAGE" });
        throw new PlannerError(
          "PLANNING_PACKAGE_INVALID",
          "Planner output failed deterministic refresh admission.",
          new PlanningFinalAdmissionError(diagnostics, [], "Planner output failed deterministic refresh admission.", error),
        );
      }
      throw error;
    }
    if (admission.blockers.length > 0) {
      const coverageBlocker = admission.blockers.some((blocker) => blocker.startsWith("PLANNING_REQUIREMENT_COVERAGE_MISSING:"));
      const coverage = coverageBlocker
        ? planningFinalCoverageDiagnostics({
          availability: admission.coverageDiagnostics.length ? "AVAILABLE" : "UNAVAILABLE",
          issues: admission.coverageDiagnostics.map((issue) => {
            const binding = input.stagedCoverageBindings?.find((candidate) => candidate.canonicalRequirementId === issue.canonicalRequirementId);
            if (!binding) return issue;
            return {
              ...issue,
              ...(issue.reason === "MISSING_REFERENCE"
                ? { kind: "INVALID_MAPPING" as const, referenceStatus: "INVALID" as const, explanation: "STAGED_MAPPING_NOT_BOUND" as const }
                : {}),
              stagedRequirementToken: binding.stagedRequirementToken,
              planningElementIds: binding.planningElementIds,
            };
          }),
          })
        : undefined;
      const diagnostics = planningFinalAdmissionDiagnostics({ boundary: "FINAL_ADMISSION", validator: "ADMIT_PLANNING_REFRESH", blockers: admission.blockers, ...(coverage ? { coverage } : {}) });
      throw new PlannerError(
        "PLANNING_PACKAGE_INVALID",
        "Planner output failed deterministic refresh admission.",
        new PlanningFinalAdmissionError(diagnostics, admission.blockers, "Planner output failed deterministic refresh admission.", admission),
      );
    }
    return admission.candidate;
  }
  private async runStagedPlanning(input: {
    plannerInput: PlannerAgentInput;
    brief: z.infer<typeof RequirementSpecificationSchema>;
    canonicalBrief?: z.infer<typeof BriefV3DocumentSchema>["brief"];
    plannerReferenceTable: NonNullable<PlannerAgentInput["plannerReferenceTable"]>;
    currentPlanning?: PlanningPackage;
    existingPlanning?: { rowVersion: number; checksum: string };
    skillSelection?: AgentSkillSelection;
    telemetry?: StagedPlanningOperationTelemetry;
    correlationId?: string;
    providerInvocationLedger?: ProviderInvocationLedgerPort;
    setStage?: (stage: "PREFLIGHT" | "DECOMPOSITION" | "GRAPH" | "COVERAGE" | "FINAL_ASSEMBLY") => void | Promise<void>;
  }) {
    if (!this.provider.decompose || !this.provider.assignCoverage)
      throw new PlannerError("PLANNING_PACKAGE_INVALID", "The staged Planner provider is incomplete.");
    if (input.providerInvocationLedger && !input.correlationId)
      throw new PlannerError("PLANNING_PACKAGE_INVALID", "Staged Planner provider identity is incomplete.");
    const table = input.plannerReferenceTable;
    await input.setStage?.("PREFLIGHT");
    input.telemetry?.enter("PREFLIGHT");
    const currentness = async () => {
      let currentBrief;
      try {
        currentBrief = await this.validateCurrentCanonicalBrief(input.plannerInput);
      } catch (error) {
        if (error instanceof PlannerError && error.code === "BRIEF_CHECKSUM_MISMATCH")
          throw new PlannerError("PLANNING_STALE", "The approved Brief changed between staged Planner phases.", error);
        throw error;
      }
      const project = await this.projects.getWithVersion(input.plannerInput.projectId);
      const planning = await this.documents.getWithMetadata(input.plannerInput.projectId, input.plannerInput.projectVersion, "planning-package");
      if (
        !project
        || project.project.currentVersion !== input.plannerInput.projectVersion
        || project.rowVersion !== input.plannerInput.expectedRowVersion
        || project.project.workflowState !== "AWAITING_PLANNING_GENERATION"
        || (currentBrief ? canonicalBriefChecksum(currentBrief.brief) : undefined) !== (input.canonicalBrief ? canonicalBriefChecksum(input.canonicalBrief) : undefined)
        || planning?.rowVersion !== input.existingPlanning?.rowVersion
        || planning?.checksum !== input.existingPlanning?.checksum
      ) throw new PlannerError("PLANNING_STALE", "The project or approved Brief changed between staged Planner phases.");
      try {
        assertPlannerReferenceTableCurrent(table, {
          projectId: input.plannerInput.projectId,
          projectVersion: input.plannerInput.projectVersion,
          approvedBriefChecksum: input.plannerInput.approvedBriefChecksum,
          idempotencyKey: input.plannerInput.idempotencyKey,
          expectedRowVersion: input.plannerInput.expectedRowVersion,
          canonicalBrief: currentBrief?.brief ?? input.canonicalBrief!,
        });
      } catch (error) {
        if (error instanceof PlannerReferenceTableError)
          throw new PlannerError("PLANNING_STALE", "The Planner reference table changed between staged Planner phases.", error);
        throw error;
      }
    };
    const decompositionInput: PlannerDecompositionProviderInput = {
      approvedBrief: input.brief,
      plannerReferenceTable: table,
      ...(input.canonicalBrief ? { canonicalBrief: input.canonicalBrief } : {}),
      minimumContract: createDecompositionMinimumContract({ brief: input.brief, canonicalBrief: input.canonicalBrief }),
      coverageRepresentabilityPlan: deriveCoverageRepresentabilityPlan(table),
    };
    const recordProviderDiagnostic = (diagnostic: ProviderDiagnostic, parseStatus: ProviderTerminationParseStatus) => {
      input.telemetry?.recordProviderDiagnostic(diagnostic, parseStatus);
      return input.providerInvocationLedger?.recordProviderDiagnostic?.(diagnostic, parseStatus);
    };
    let decompositionOutput;
    await input.setStage?.("DECOMPOSITION");
    input.telemetry?.enter("DECOMPOSITION_PROVIDER");
    const decompositionCall = input.telemetry?.beginProvider("decomposition", PLANNER_DECOMPOSITION_PROVIDER_SCHEMA_NAME);
    const decompositionInvocation: ProviderInvocationLedgerHandle | undefined = input.providerInvocationLedger
      ? await input.providerInvocationLedger.reserveInvocation({ stage: "decomposition", providerContract: PLANNER_DECOMPOSITION_PROVIDER_SCHEMA_NAME })
      : undefined;
    try {
      decompositionOutput = await this.provider.decompose(
        decompositionInput,
        input.skillSelection?.contexts,
        input.skillSelection?.identityChecksum,
        input.correlationId ? { operationId: input.plannerInput.idempotencyKey, correlationId: input.correlationId, stage: "decomposition", recordDiagnostic: recordProviderDiagnostic, ...(input.providerInvocationLedger ? { ledger: input.providerInvocationLedger } : {}), ...(decompositionInvocation ? { invocation: decompositionInvocation } : {}) } : undefined,
      );
      await decompositionInvocation?.responseReceived();
      await decompositionInvocation?.parsePassed();
      if (decompositionCall) input.telemetry?.providerSucceeded(decompositionCall);
      if (input.providerInvocationLedger) input.telemetry?.syncProviderAccounting(input.providerInvocationLedger.snapshot());
    } catch (error) {
      await decompositionInvocation?.failed().catch(() => undefined);
      if (decompositionCall) input.telemetry?.providerFailed(decompositionCall, error);
      if (input.providerInvocationLedger) input.telemetry?.syncProviderAccounting(input.providerInvocationLedger.snapshot());
      input.telemetry?.enter(stagedProviderParseStage(error, "DECOMPOSITION"));
      if (error instanceof PlannerError) throw error;
      throw new PlannerError("PLANNER_PROVIDER_FAILED", "The staged Planner decomposition provider failed.", error);
    }
    let elements;
    input.telemetry?.enter("DECOMPOSITION_PARSE");
    try {
      elements = admitPlanningDecomposition({ output: decompositionOutput, table, brief: input.brief, canonicalBrief: input.canonicalBrief, coverageRepresentabilityPlan: decompositionInput.coverageRepresentabilityPlan });
    } catch (error) {
      input.telemetry?.enter(error instanceof StagedPlanningAdmissionError && error.fieldPath === "decomposition" ? "DECOMPOSITION_PARSE" : "DECOMPOSITION_ADMISSION");
      if (error instanceof StagedPlanningAdmissionError)
        throw new PlannerError("PLANNING_PACKAGE_INVALID", "Staged Planner decomposition failed deterministic admission.", error);
      throw error;
    }
    input.telemetry?.enter("DECOMPOSITION_REPRESENTABILITY");
    try {
      assertDecompositionCoverageRepresentability({ table, elements, coverageRepresentabilityPlan: decompositionInput.coverageRepresentabilityPlan });
    } catch (error) {
      if (error instanceof StagedPlanningAdmissionError)
        throw new PlannerError("PLANNING_PACKAGE_INVALID", "Staged Planner decomposition cannot represent all mandatory Coverage obligations.", error);
      throw error;
    }
    input.telemetry?.semanticAdmissionPassed("decomposition");
    await decompositionInvocation?.admissionPassed();
    if (input.providerInvocationLedger) input.telemetry?.syncProviderAccounting(input.providerInvocationLedger.snapshot());
    input.telemetry?.enter("PE_ASSIGNMENT");
    await input.setStage?.("GRAPH");
    let graph;
    input.telemetry?.enter("GRAPH_ASSEMBLY");
    try {
      graph = finalizePlanningElementGraph(elements);
    } catch (error) {
      input.telemetry?.enter("GRAPH_ADMISSION");
      if (error instanceof StagedPlanningAdmissionError)
        throw new PlannerError("PLANNING_PACKAGE_INVALID", "Staged Planner element graph failed deterministic admission.", error);
      throw error;
    }
    input.telemetry?.enter("GRAPH_ADMISSION");
    const decompositionStageChecksum = checksumPersistedDocument({ elements, graph });
    await currentness();
    const coverageTargetTable = createAdmissibleCoverageTargetTable({
      table,
      elements,
      graph,
      binding: {
        projectId: input.plannerInput.projectId,
        projectVersion: input.plannerInput.projectVersion,
        expectedRowVersion: input.plannerInput.expectedRowVersion,
        approvedBriefChecksum: input.plannerInput.approvedBriefChecksum,
        referenceTableChecksum: table.referenceTableChecksum,
        planningElementsChecksum: checksumPersistedDocument(elements),
        graphChecksum: checksumPersistedDocument(graph),
        coverageOperationId: input.plannerInput.idempotencyKey,
        operationChecksum: table.operationChecksum,
        contractVersion: PLANNER_COVERAGE_CONTRACT_VERSION,
      },
    });
    input.telemetry?.enter("COVERAGE_ADMISSION");
    assertAdmissibleCoverageTargetCounts({ table, targetTable: coverageTargetTable });
    await currentness();
    assertAdmissibleCoverageTargetTableCurrent({
      targetTable: coverageTargetTable,
      table,
      elements,
      graph,
      binding: coverageTargetTable.binding,
    });
    let coverageOutput;
    await input.setStage?.("COVERAGE");
    input.telemetry?.enter("COVERAGE_PROVIDER");
    const coverageCall = input.telemetry?.beginProvider("coverage", PLANNING_COVERAGE_PROVIDER_SCHEMA_NAME);
    const coverageInvocation: ProviderInvocationLedgerHandle | undefined = input.providerInvocationLedger
      ? await input.providerInvocationLedger.reserveInvocation({ stage: "coverage", providerContract: PLANNING_COVERAGE_PROVIDER_SCHEMA_NAME })
      : undefined;
    try {
      coverageOutput = await this.provider.assignCoverage(
        { plannerReferenceTable: table, elements, graph, admissibleCoverageTargetsByRequirement: coverageTargetTable.admissibleCoverageTargetsByRequirement },
        input.skillSelection?.contexts,
        input.skillSelection?.identityChecksum,
        input.correlationId ? { operationId: input.plannerInput.idempotencyKey, correlationId: input.correlationId, stage: "coverage", recordDiagnostic: recordProviderDiagnostic, ...(input.providerInvocationLedger ? { ledger: input.providerInvocationLedger } : {}), ...(coverageInvocation ? { invocation: coverageInvocation } : {}) } : undefined,
      );
      await coverageInvocation?.responseReceived();
      await coverageInvocation?.parsePassed();
      if (coverageCall) input.telemetry?.providerSucceeded(coverageCall);
      if (input.providerInvocationLedger) input.telemetry?.syncProviderAccounting(input.providerInvocationLedger.snapshot());
    } catch (error) {
      await coverageInvocation?.failed().catch(() => undefined);
      if (coverageCall) input.telemetry?.providerFailed(coverageCall, error);
      if (input.providerInvocationLedger) input.telemetry?.syncProviderAccounting(input.providerInvocationLedger.snapshot());
      input.telemetry?.enter(stagedProviderParseStage(error, "COVERAGE"));
      if (error instanceof PlannerError) throw error;
      throw new PlannerError("PLANNER_PROVIDER_FAILED", "The staged Planner coverage provider failed.", error);
    }
    if (checksumPersistedDocument({ elements, graph }) !== decompositionStageChecksum)
      throw new PlannerError("PLANNING_STALE", "The admitted staged decomposition changed before coverage admission.");
    let coverage;
    input.telemetry?.enter("COVERAGE_PARSE");
    try {
      coverage = admitPlanningCoverage({ output: coverageOutput, table, elements, admissibleCoverageTargetsByRequirement: coverageTargetTable.admissibleCoverageTargetsByRequirement });
    } catch (error) {
      input.telemetry?.enter(error instanceof PlannerReferenceBindingError ? "COVERAGE_ADMISSION" : error instanceof StagedPlanningAdmissionError && error.reasonCode !== "PLANNING_COVERAGE_SCHEMA_INVALID" ? "COVERAGE_ADMISSION" : "COVERAGE_PARSE");
      if (error instanceof PlannerReferenceBindingError)
        throw new PlannerError(
          "PLANNING_PACKAGE_INVALID",
          `Staged Planner coverage failed deterministic admission: ${error.code}:${error.fieldPath}.`,
            new PlanningAdmissionError(error.code, error.fieldPath, error.reasonCode, error.safeToken, error.coverageDiagnostics),
        );
      if (error instanceof StagedPlanningAdmissionError)
        throw new PlannerError("PLANNING_PACKAGE_INVALID", "Staged Planner coverage failed deterministic admission.", error);
      throw error;
    }
    input.telemetry?.semanticAdmissionPassed("coverage");
    await coverageInvocation?.admissionPassed();
    if (input.providerInvocationLedger) input.telemetry?.syncProviderAccounting(input.providerInvocationLedger.snapshot());
    input.telemetry?.enter("COVERAGE_ADMISSION");
    await currentness();
    await input.setStage?.("FINAL_ASSEMBLY");
    input.telemetry?.enter("FINAL_ASSEMBLY");
    let parsedCandidate: PlanningPackage;
    try {
      const candidate = assembleStagedPlanningCandidate({
        plannerInput: input.plannerInput,
        brief: input.brief,
        ...(input.canonicalBrief ? { canonicalBrief: input.canonicalBrief } : {}),
        plannerReferenceTable: table,
        elements,
        graph,
        coverage,
        admissibleCoverageTargetsByRequirement: coverageTargetTable.admissibleCoverageTargetsByRequirement,
      });
      parsedCandidate = PlanningPackageSchema.parse(candidate);
    } catch (error) {
      const diagnostics = planningFinalAdmissionDiagnosticsFromError({ error, boundary: "FINAL_ASSEMBLY", validator: "ASSEMBLE_STAGED_PLANNING_CANDIDATE" });
      throw new PlannerError(
        "PLANNING_PACKAGE_INVALID",
        "Staged Planning final assembly failed deterministic admission.",
        new PlanningFinalAdmissionError(diagnostics, [], "Staged Planning final assembly failed deterministic admission.", error),
      );
    }
    input.telemetry?.enter("FINAL_ADMISSION");
    const stagedCoverageBindings: PlanningStagedCoverageBinding[] = (Object.entries(coverage.coverageByRequirement) as Array<[string, { planningElementIds: readonly string[] }]>).flatMap(([token, entry]) => {
      const requirement = table.requirements.find((candidate) => candidate.token === token);
      if (!requirement) return [];
      return [{ canonicalRequirementId: requirement.canonicalRequirementId, stagedRequirementToken: token, planningElementIds: [...entry.planningElementIds] }];
    });
    return { candidate: parsedCandidate, stagedCoverageBindings };
  }
  async planApprovedProject(rawInput: PlannerAgentInput, executionContext: { correlationId?: string; providerInvocationLedger?: ProviderInvocationLedgerPort; setStage?: (stage: "OPERATION_INITIALIZATION" | "PREFLIGHT" | "DECOMPOSITION" | "GRAPH" | "COVERAGE" | "FINAL_ASSEMBLY" | "PERSISTENCE" | "LIFECYCLE_TRANSITION") => void | Promise<void>; markMutationCommitted?: () => void | Promise<void> } = {}) {
    await executionContext.setStage?.("OPERATION_INITIALIZATION");
    const input = this.parseInput(rawInput);
    const legacyPlanningRefresh = input.currentWorkflowState === "AWAITING_DESIGN_SELECTION";
    if (input.currentWorkflowState !== "AWAITING_PLANNING_GENERATION" && !legacyPlanningRefresh)
      throw new PlannerError(
        "PLANNER_WORKFLOW_STATE_INVALID",
        "Planning starts only while the approved Brief is awaiting Planning generation.",
      );
    if (executionContext.providerInvocationLedger && (!this.provider.decompose || !this.provider.assignCoverage))
      throw new PlannerError("PLANNING_PACKAGE_INVALID", "Durable staged Planning requires both provider stages.");
    await executionContext.setStage?.("PREFLIGHT");
    const currentCanonical = await this.validateCurrentCanonicalBrief(input);
    const brief = this.validateBrief(input, currentCanonical);
    if (input.plannerReferenceTable && currentCanonical) {
      try {
        assertPlannerReferenceTableCurrent(input.plannerReferenceTable, {
          projectId: input.projectId,
          projectVersion: input.projectVersion,
          approvedBriefChecksum: input.approvedBriefChecksum,
          idempotencyKey: input.idempotencyKey,
          expectedRowVersion: input.expectedRowVersion,
          canonicalBrief: currentCanonical.brief,
        });
      } catch (error) {
        if (error instanceof PlannerReferenceTableError)
          throw new PlannerError("PLANNING_STALE", "The Planner reference table is not current for the approved Brief.", error);
        throw error;
      }
    }
    const project = await this.projects.getWithVersion(input.projectId);
    if (!project || project.project.currentVersion !== input.projectVersion)
      throw new PlannerError(
        "PROJECT_VERSION_MISMATCH",
        "The Planner project version does not match the approved Brief.",
      );
    if (project.project.workflowState !== "AWAITING_PLANNING_GENERATION" && !(legacyPlanningRefresh && project.project.workflowState === "AWAITING_DESIGN_SELECTION"))
      throw new PlannerError(
        "PLANNER_WORKFLOW_STATE_INVALID",
        "Planning starts only while the approved Brief is awaiting Planning generation.",
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
    // a trusted refresh baseline. It must never be silently reinterpreted as
    // an initial generation request or used as a refresh base.
    const currentPlanningPackage = persistedPlanningPackage;
    if (legacyPlanningRefresh && !persistedPlanningPackage)
      throw new PlannerError(
        "PLANNER_WORKFLOW_STATE_INVALID",
        "The former design-selection state cannot start Planning without a persisted Planning package.",
      );
    if (persistedPlanningPackage && currentCanonical) {
      try {
        if (/legacy(?:[-_ ]?v?1)/i.test(JSON.stringify(persistedPlanningPackage)))
          throw new PlanningAdmissionError("PLANNING_TRACEABILITY_LEGACY_REFERENCE", "persisted-planning-package");
        // The current Brief may legitimately contain additions that are the
        // reason for the refresh. Base validation therefore checks only the
        // persisted package shape and hostile legacy provenance here; target
        // Brief coverage and causal scope are checked after ChangeSet apply.
        const baseline = validatePlanningAdmission(persistedPlanningPackage);
        if (!baseline.ready) throw new PlanningAdmissionError("PLANNING_REFRESH_BASE_INVALID", baseline.blockers[0]);
      } catch (error) {
        const failure = error instanceof PlanningAdmissionError
          ? new PlannerError(
              "PLANNING_REFRESH_BASE_INVALID",
              "The persisted Planning package is not a safe refresh baseline.",
              error,
            )
          : error;
        await this.recordRefreshFailure({
          projectId: input.projectId,
          projectVersion: input.projectVersion,
          operationKey: input.idempotencyKey,
          stage: "BASE_VALIDATION",
          error: failure,
          basePlanningSemanticChecksum: planningSemanticChecksum(persistedPlanningPackage),
          baseBriefChecksum: persistedPlanningPackage.approvedBriefChecksum,
          targetBriefChecksum: input.approvedBriefChecksum,
        });
        throw failure;
      }
    }
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
    if (persistedPlanningPackage && existingPlanning && currentCanonical && currentPlanningPackage && persistedPlanningPackage.approvedBriefChecksum !== currentCanonical.briefChecksum)
      return this.refreshPlanningPackageInternal({ input, brief, currentCanonical: currentCanonical.brief, existingPlanning, currentPlanningPackage, skillSelection });
    if (persistedPlanningPackage && existingPlanning && currentCanonical && currentPlanningPackage && persistedPlanningPackage.approvedBriefChecksum === currentCanonical.briefChecksum) {
      try {
        const currentAdmission = admitPlanningRefresh({
          candidate: currentPlanningPackage,
          current: currentPlanningPackage,
          canonicalBrief: currentCanonical.brief,
          projectId: input.projectId,
          projectVersion: input.projectVersion,
          approvedBriefChecksum: currentCanonical.briefChecksum,
          timestamp: currentPlanningPackage.updatedAt,
        });
        if (currentAdmission.blockers.length > 0) throw new PlanningAdmissionError("PLANNING_REFRESH_BASE_INVALID", currentAdmission.blockers[0]);
      } catch (error) {
        if (error instanceof PlanningAdmissionError)
          throw new PlannerError("PLANNING_REFRESH_BASE_INVALID", "The persisted Planning package is not current against the approved Brief.", error);
        throw error;
      }
      this.inputKeys.set(input.idempotencyKey, requestHash);
      this.packages.set(this.packageKey(input.projectId, input.projectVersion), currentPlanningPackage);
      return currentPlanningPackage;
    }
    await this.skills.select({
      role: "planner-architect",
      taskType: "product-scope",
    });
    const currentBeforeProvider = await this.validateCurrentCanonicalBrief(input);
    const plannerReferenceTable = currentBeforeProvider
      ? createPlannerReferenceTable({
          projectId: input.projectId,
          projectVersion: input.projectVersion,
          approvedBriefChecksum: input.approvedBriefChecksum,
          idempotencyKey: input.idempotencyKey,
          expectedRowVersion: input.expectedRowVersion,
          canonicalBrief: currentBeforeProvider.brief,
        })
      : undefined;
    if (plannerReferenceTable && currentBeforeProvider)
      assertPlannerReferenceTableCurrent(plannerReferenceTable, {
        projectId: input.projectId,
        projectVersion: input.projectVersion,
        approvedBriefChecksum: input.approvedBriefChecksum,
        idempotencyKey: input.idempotencyKey,
        expectedRowVersion: input.expectedRowVersion,
        canonicalBrief: currentBeforeProvider.brief,
      });
    const stagedTelemetry = this.provider.decompose && this.provider.assignCoverage && plannerReferenceTable
      ? new StagedPlanningOperationTelemetry({
          operationId: input.idempotencyKey,
          operationChecksum: plannerReferenceTable.operationChecksum,
          correlationId: executionContext.correlationId ?? randomUUID(),
          projectId: input.projectId,
          briefChecksum: input.approvedBriefChecksum,
        })
      : undefined;
    stagedTelemetry?.enter("PREFLIGHT");
    const plannerInput = PlannerAgentInputSchema.parse({
      ...input,
      ...(currentCanonical ? { plannerAuthority: plannerAuthorityFor(currentCanonical.brief) } : {}),
      ...(plannerReferenceTable ? { plannerReferenceTable } : {}),
    });
    let planningPackage: PlanningPackage;
    let stagedCoverageBindings: PlanningStagedCoverageBinding[] | undefined;
    try {
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
      const currentAtSpend = await this.validateCurrentCanonicalBrief(input);
      if (plannerReferenceTable && currentAtSpend)
        assertPlannerReferenceTableCurrent(plannerReferenceTable, {
          projectId: input.projectId,
          projectVersion: input.projectVersion,
          approvedBriefChecksum: input.approvedBriefChecksum,
          idempotencyKey: input.idempotencyKey,
          expectedRowVersion: input.expectedRowVersion,
          canonicalBrief: currentAtSpend.brief,
        });
      if (this.provider.decompose && this.provider.assignCoverage) {
        if (!plannerReferenceTable || !currentCanonical)
          throw new PlannerError("PLANNING_PACKAGE_INVALID", "Staged Planning requires a current CanonicalBriefV3 reference table.");
        const stagedResult = await this.runStagedPlanning({
          plannerInput,
          brief,
          ...(currentCanonical ? { canonicalBrief: currentCanonical.brief } : {}),
          plannerReferenceTable: plannerReferenceTable!,
          currentPlanning: currentPlanningPackage,
          ...(existingPlanning ? { existingPlanning } : {}),
          skillSelection,
          telemetry: stagedTelemetry,
          ...(stagedTelemetry ? { correlationId: stagedTelemetry.correlationId } : {}),
          ...(executionContext.providerInvocationLedger ? { providerInvocationLedger: executionContext.providerInvocationLedger } : {}),
          ...(executionContext.setStage ? { setStage: executionContext.setStage } : {}),
        });
        planningPackage = stagedResult.candidate;
        stagedCoverageBindings = stagedResult.stagedCoverageBindings;
      } else {
        planningPackage = PlanningPackageSchema.parse({
          ...PlanningPackageSchema.parse(await this.provider.plan(
            { ...plannerInput, approvedBrief: brief, ...(currentCanonical ? { canonicalBrief: currentCanonical.brief } : {}), documentationExcerpts },
            skillSelection?.contexts,
            skillSelection?.identityChecksum,
          )),
          // The checksum policy is host-owned metadata; provider output cannot
          // select or downgrade the semantic checksum authority.
          semanticChecksumPolicyVersion: CURRENT_PLANNING_SEMANTIC_CHECKSUM_POLICY,
        });
      }
    } catch (error) {
      if (error instanceof PlannerError) throw error;
      if (error instanceof PlannerReferenceBindingError)
          throw new PlannerError(
            "PLANNING_PACKAGE_INVALID",
            `Planner output failed deterministic token admission: ${error.code}:${error.fieldPath}.`,
            new PlanningAdmissionError(error.code, error.fieldPath, error.reasonCode, error.safeToken),
          );
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
    stagedTelemetry?.enter("FINAL_ADMISSION");
    let currentAfterProvider: Awaited<ReturnType<PlannerArchitectService["validateCurrentCanonicalBrief"]>>;
    try {
      currentAfterProvider = await this.validateCurrentCanonicalBrief(input);
      const projectAfterProvider = await this.projects.getWithVersion(input.projectId);
      if (!projectAfterProvider || projectAfterProvider.rowVersion !== input.expectedRowVersion || projectAfterProvider.project.workflowState !== "AWAITING_PLANNING_GENERATION")
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
    } catch (error) {
      const diagnostics = planningFinalAdmissionDiagnosticsFromError({ error, boundary: "FINAL_ADMISSION", validator: "FINAL_CURRENTNESS" });
      const outerCode = error instanceof PlannerError ? error.code : "PLANNING_PACKAGE_INVALID";
      throw new PlannerError(outerCode, "Staged Planning final currentness validation failed.", new PlanningFinalAdmissionError(diagnostics, [], "Staged Planning final currentness validation failed.", error));
    }
    planningPackage = this.admitPlanningCandidate({
      plannerInput,
      canonicalBrief: currentAfterProvider?.brief,
      candidate: planningPackage,
      current: currentPlanningPackage,
      ...(stagedCoverageBindings ? { stagedCoverageBindings } : {}),
    });
    const admissionResult = validatePlanningAdmission(planningPackage);
    if (!admissionResult.ready) {
      const diagnostics = planningFinalAdmissionDiagnostics({ boundary: "FINAL_ADMISSION", validator: "VALIDATE_PLANNING_ADMISSION", blockers: admissionResult.blockers });
      throw new PlannerError(
        "PLANNING_PACKAGE_INVALID",
        "Planner output failed deterministic admission.",
        new PlanningFinalAdmissionError(diagnostics, admissionResult.blockers),
      );
    }
    const contractIssues = validatePlanningPackageAgainstBrief(brief, planningPackage);
    if (contractIssues.length > 0) {
      const diagnostics = planningFinalAdmissionDiagnostics({ boundary: "FINAL_ADMISSION", validator: "VALIDATE_PLANNING_PACKAGE_AGAINST_BRIEF", blockers: contractIssues });
      throw new PlannerError(
        "PLANNING_PACKAGE_INVALID",
        "Planner output violated the approved Planning contract.",
        new PlanningFinalAdmissionError(diagnostics, contractIssues),
      );
    }
    await executionContext.setStage?.("PERSISTENCE");
    stagedTelemetry?.enter("PERSISTENCE");
    await this.persistPackage(planningPackage, input.idempotencyKey, existingPlanning, {
      rowVersion: input.expectedRowVersion,
      workflowState: "AWAITING_PLANNING_GENERATION",
    }, {
      targetState: "AWAITING_PLANNING_APPROVAL",
      actor: "planner-architect",
      reason: "Planning candidate persisted; explicit user Planning approval is required.",
      idempotencyKey: `${input.idempotencyKey}:planning-approval`,
      context: { requirements: brief },
    }, stagedTelemetry, executionContext.markMutationCommitted);
    stagedTelemetry?.succeed();
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
    } catch (error) {
      if (stagedTelemetry) {
        const stage = stagedTelemetry.currentStage;
        throw stagedTelemetry.fail({
          stage,
          outerCode: stagedOuterCode(stage, error),
          failureClass: stagedFailureClass(stage, error),
          ...(stage === "FINAL_ASSEMBLY" || stage === "FINAL_ADMISSION" ? { boundary: stage } : {}),
          ...(safeStagedReasonCode(error) ? { reasonCode: safeStagedReasonCode(error) } : {}),
          ...(safeStagedToken(error) ? { safeToken: safeStagedToken(error) } : {}),
          ...(stagedPlanningAdmissionDiagnostics(error) ? { kindDomainDiagnostics: stagedPlanningAdmissionDiagnostics(error) } : {}),
          ...(stagedPlanningMinimumDiagnostics(error) ? { minimumDiagnostics: stagedPlanningMinimumDiagnostics(error) } : {}),
          ...(stagedPlanningCoverageDiagnostics(error) ? { coverageDiagnostics: stagedPlanningCoverageDiagnostics(error) } : {}),
          ...(stagedPlanningGraphCycleDiagnostics(error) ? { graphCycleDiagnostics: stagedPlanningGraphCycleDiagnostics(error) } : {}),
          ...(stagedPlanningRepresentabilityDiagnostics(error) ? { representabilityAnchorDiagnostics: stagedPlanningRepresentabilityDiagnostics(error) } : {}),
          ...(stagedPlanningAdmissionEvidence(error) ? { admissionEvidence: stagedPlanningAdmissionEvidence(error) } : {}),
          ...(stage === "FINAL_ASSEMBLY" || stage === "FINAL_ADMISSION" ? { finalAdmissionDiagnostics: planningFinalAdmissionDiagnosticsFromError({ error, boundary: stage, validator: stage === "FINAL_ASSEMBLY" ? "ASSEMBLE_STAGED_PLANNING_CANDIDATE" : "VALIDATE_PLANNING_ADMISSION" }) } : {}),
          message: "Staged Planning failed safely; the project was not changed.",
          cause: error,
        });
      }
      throw error;
    }
  }
  private async refreshPlanningPackageInternal(input: {
    input: PlannerAgentInput;
    brief: z.infer<typeof RequirementSpecificationSchema>;
    currentCanonical: z.infer<typeof BriefV3DocumentSchema>["brief"];
    existingPlanning: { rowVersion: number; checksum: string };
    currentPlanningPackage: PlanningPackage;
    skillSelection?: AgentSkillSelection;
  }) {
    if (!this.provider.proposeChangeSet) {
      const error = new PlannerError(
        "PLANNING_REFRESH_PROVIDER_UNAVAILABLE",
        "The configured Planner provider does not support bounded Planning refreshes.",
      );
      await this.recordRefreshFailure({ projectId: input.input.projectId, projectVersion: input.input.projectVersion, operationKey: input.input.idempotencyKey, stage: "PROVIDER", error, baseBriefChecksum: input.currentPlanningPackage.approvedBriefChecksum, targetBriefChecksum: input.input.approvedBriefChecksum });
      throw error;
    }
    let briefDelta: PlanningBriefDelta;
    try {
      const history = await this.dependencies.database.transaction((tx) => tx.listBriefRevisionHistory(input.input.projectId, input.input.projectVersion));
      briefDelta = computePlanningBriefDeltaFromHistory({
        baseBriefChecksum: input.currentPlanningPackage.approvedBriefChecksum,
        targetBrief: input.currentCanonical,
        history,
      });
    } catch (error) {
      const failure = new PlannerError(
        "PLANNING_REFRESH_BASE_BRIEF_UNAVAILABLE",
        "The approved Brief delta cannot be reconstructed from canonical provenance.",
        error,
      );
      await this.recordRefreshFailure({ projectId: input.input.projectId, projectVersion: input.input.projectVersion, operationKey: input.input.idempotencyKey, stage: "BASE_VALIDATION", error: failure, baseBriefChecksum: input.currentPlanningPackage.approvedBriefChecksum, targetBriefChecksum: input.input.approvedBriefChecksum });
      throw failure;
    }
    try {
      await this.validateCurrentCanonicalBrief(input.input);
    } catch (error) {
      await this.recordRefreshFailure({
        projectId: input.input.projectId,
        projectVersion: input.input.projectVersion,
        operationKey: input.input.idempotencyKey,
        stage: "CURRENTNESS",
        error,
        basePlanningSemanticChecksum: planningSemanticChecksum(input.currentPlanningPackage),
        baseBriefChecksum: input.currentPlanningPackage.approvedBriefChecksum,
        targetBriefChecksum: input.input.approvedBriefChecksum,
        changedDomains: briefDelta.authorizedDomains,
      });
      throw error;
    }
    let providerOutput: z.infer<typeof PlanningChangeSetProviderOutputSchema>;
    try {
      providerOutput = PlanningChangeSetProviderOutputSchema.parse(
        await this.provider.proposeChangeSet(
          {
            projectId: input.input.projectId,
            projectVersion: input.input.projectVersion,
            idempotencyKey: input.input.idempotencyKey,
            approvedBriefChecksum: input.input.approvedBriefChecksum,
            canonicalBrief: input.currentCanonical,
            currentPlanningPackage: input.currentPlanningPackage,
            briefDelta,
            authorizationScopeChecksum: briefDelta.authorizationScopeChecksum,
          },
          input.skillSelection?.contexts,
          input.skillSelection?.identityChecksum,
        ),
      );
    } catch (error) {
      if (error instanceof PlannerError) {
        await this.recordRefreshFailure({ projectId: input.input.projectId, projectVersion: input.input.projectVersion, operationKey: input.input.idempotencyKey, stage: "PROVIDER", error, baseBriefChecksum: input.currentPlanningPackage.approvedBriefChecksum, targetBriefChecksum: input.input.approvedBriefChecksum });
        throw error;
      }
      if (error instanceof z.ZodError)
        {
          const failure = new PlannerError(
            "PLANNING_PACKAGE_INVALID",
            "The Planning refresh provider returned an invalid ChangeSet.",
          error,
          );
          await this.recordRefreshFailure({ projectId: input.input.projectId, projectVersion: input.input.projectVersion, operationKey: input.input.idempotencyKey, stage: "PROVIDER", error: failure, baseBriefChecksum: input.currentPlanningPackage.approvedBriefChecksum, targetBriefChecksum: input.input.approvedBriefChecksum });
          throw failure;
        }
      const failure = new PlannerError("PLANNER_PROVIDER_FAILED", "The Planning refresh provider failed.", error);
      await this.recordRefreshFailure({ projectId: input.input.projectId, projectVersion: input.input.projectVersion, operationKey: input.input.idempotencyKey, stage: "PROVIDER", error: failure, baseBriefChecksum: input.currentPlanningPackage.approvedBriefChecksum, targetBriefChecksum: input.input.approvedBriefChecksum });
      throw failure;
    }
    let currentAfterProvider: z.infer<typeof BriefV3DocumentSchema> | undefined;
    try {
      currentAfterProvider = await this.validateCurrentCanonicalBrief(input.input);
      const projectAfterProvider = await this.projects.getWithVersion(input.input.projectId);
      if (!projectAfterProvider || projectAfterProvider.project.currentVersion !== input.input.projectVersion || projectAfterProvider.rowVersion !== input.input.expectedRowVersion || projectAfterProvider.project.workflowState !== "AWAITING_DESIGN_SELECTION")
        throw new PlannerError("PLANNING_STALE", "The project changed while the Planning refresh was running.");
      if (currentAfterProvider?.briefChecksum !== input.input.approvedBriefChecksum)
        throw new PlannerError("PLANNING_STALE", "The approved CanonicalBriefV3 changed while the Planning refresh was running.");
      const planningAfterProvider = await this.documents.getWithMetadata(input.input.projectId, input.input.projectVersion, "planning-package");
      if (planningAfterProvider?.rowVersion !== input.existingPlanning.rowVersion || planningAfterProvider?.checksum !== input.existingPlanning.checksum)
        throw new PlannerError("PLANNING_STALE", "The current PlanningPackage changed while the Planning refresh was running.");
    } catch (error) {
      await this.recordRefreshFailure({
        projectId: input.input.projectId,
        projectVersion: input.input.projectVersion,
        operationKey: input.input.idempotencyKey,
        stage: "CURRENTNESS",
        error,
        basePlanningSemanticChecksum: planningSemanticChecksum(input.currentPlanningPackage),
        baseBriefChecksum: input.currentPlanningPackage.approvedBriefChecksum,
        targetBriefChecksum: input.input.approvedBriefChecksum,
        changedDomains: [],
        operationKinds: providerOutput.changes.map((change) => change.kind),
      });
      throw error;
    }
    let candidate: PlanningPackage;
    try {
      const hostChangeSet = providerChangeSetToHostChangeSet({
        providerOutput,
        projectId: input.input.projectId,
        projectVersion: input.input.projectVersion,
        basePlanningSemanticChecksum: planningSemanticChecksum(input.currentPlanningPackage),
        baseBriefChecksum: input.currentPlanningPackage.approvedBriefChecksum,
        targetBriefChecksum: input.input.approvedBriefChecksum,
        authorizationScopeChecksum: briefDelta.authorizationScopeChecksum,
      });
      candidate = applyPlanningChangeSet({
        current: input.currentPlanningPackage,
        changeSet: hostChangeSet,
        briefDelta,
        canonicalBrief: input.currentCanonical,
        projectId: input.input.projectId,
        projectVersion: input.input.projectVersion,
        timestamp: now(),
      });
    } catch (error) {
      const failure = new PlannerError("PLANNING_PACKAGE_INVALID", "The Planning ChangeSet failed host validation or application.", error);
      await this.recordRefreshFailure({ projectId: input.input.projectId, projectVersion: input.input.projectVersion, operationKey: input.input.idempotencyKey, stage: "ADMISSION", error: failure, basePlanningSemanticChecksum: planningSemanticChecksum(input.currentPlanningPackage), baseBriefChecksum: input.currentPlanningPackage.approvedBriefChecksum, targetBriefChecksum: input.input.approvedBriefChecksum, changedDomains: briefDelta.authorizedDomains, operationKinds: providerOutput.changes.map((change) => change.kind) });
      throw failure;
    }
    try {
      candidate = this.admitPlanningCandidate({
        plannerInput: input.input,
        canonicalBrief: input.currentCanonical,
        candidate,
        current: input.currentPlanningPackage,
        authorizedDomains: briefDelta.authorizedDomains as PlanningRefreshDomain[],
      });
      if (!validatePlanningAdmission(candidate).ready)
        throw new PlannerError("PLANNING_PACKAGE_INVALID", "The applied Planning ChangeSet failed deterministic admission.");
      const contractIssues = validatePlanningPackageAgainstBrief(input.brief, candidate);
      if (contractIssues.length > 0)
        throw new PlannerError("PLANNING_PACKAGE_INVALID", `The applied Planning ChangeSet violated approved form behavior: ${contractIssues.join(", ")}.`);
    } catch (error) {
      await this.recordRefreshFailure({ projectId: input.input.projectId, projectVersion: input.input.projectVersion, operationKey: input.input.idempotencyKey, stage: "ADMISSION", error, basePlanningSemanticChecksum: planningSemanticChecksum(input.currentPlanningPackage), baseBriefChecksum: input.currentPlanningPackage.approvedBriefChecksum, targetBriefChecksum: input.input.approvedBriefChecksum, changedDomains: briefDelta.authorizedDomains, operationKinds: providerOutput.changes.map((change) => change.kind) });
      throw error;
    }
    try {
      await this.persistPackage(candidate, input.input.idempotencyKey, input.existingPlanning, {
        rowVersion: input.input.expectedRowVersion,
        workflowState: "AWAITING_DESIGN_SELECTION",
      });
    } catch (error) {
      await this.recordRefreshFailure({
        projectId: input.input.projectId,
        projectVersion: input.input.projectVersion,
        operationKey: input.input.idempotencyKey,
        stage: "PERSISTENCE",
        error,
        basePlanningSemanticChecksum: planningSemanticChecksum(input.currentPlanningPackage),
        baseBriefChecksum: input.currentPlanningPackage.approvedBriefChecksum,
        targetBriefChecksum: input.input.approvedBriefChecksum,
        changedDomains: briefDelta.authorizedDomains,
        operationKinds: providerOutput.changes.map((change) => change.kind),
      });
      throw error;
    }
    this.inputKeys.set(input.input.idempotencyKey, checksumPersistedDocument({
      projectId: input.input.projectId,
      projectVersion: input.input.projectVersion,
      approvedBriefChecksum: input.input.approvedBriefChecksum,
      skillContextChecksum: input.skillSelection?.identityChecksum ?? "none",
    }));
    this.packages.set(this.packageKey(input.input.projectId, input.input.projectVersion), candidate);
    return candidate;
  }
  async getPlanningStatus(projectId: string, projectVersion: number) {
    // Project Memory and the in-process cache are projections. Always rebuild
    // status from the persisted current document before exposing it.
    const storedPlanning = await this.documents.getWithMetadata(
      projectId,
      projectVersion,
      "planning-package",
    );
    const packageValue = storedPlanning?.document;
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
        const acceptanceCoverage = await this.dependencies.database.transaction((tx) =>
          this.planningAcceptanceCoverageInTransaction(tx, {
            packageRow: storedPlanning,
            packageValue,
            canonicalBrief: canonical.brief,
          }),
        );
        const admission = admitPlanningRefresh({
          candidate: packageValue,
          current: packageValue,
          canonicalBrief: canonical.brief,
          projectId,
          projectVersion,
          approvedBriefChecksum: canonical.briefChecksum,
          timestamp: packageValue.updatedAt,
          requirementCoverage: acceptanceCoverage?.projection?.coverage,
        });
        admissionBlockers.push(...(acceptanceCoverage?.blockers ?? []), ...admission.blockers);
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
        const storedPlanning = await this.documents.getWithMetadata(projectId, projectVersion, "planning-package");
        if (!storedPlanning || storedPlanning.document.documentType !== "planning-package")
          throw new PlannerError("PLANNING_NOT_ACCEPTED", "No planning package is available.");
        const acceptanceCoverage = await this.dependencies.database.transaction((tx) =>
          this.planningAcceptanceCoverageInTransaction(tx, {
            packageRow: storedPlanning,
            packageValue,
            canonicalBrief: canonical.brief,
          }),
        );
        admissionBlockers.push(
          ...(acceptanceCoverage?.blockers ?? []),
          ...admitPlanningRefresh({
            candidate: packageValue,
            current: packageValue,
            canonicalBrief: canonical.brief,
            projectId,
            projectVersion,
            approvedBriefChecksum: canonical.briefChecksum,
            timestamp: packageValue.updatedAt,
            requirementCoverage: acceptanceCoverage?.projection?.coverage,
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
      if (!current || current.current_version !== input.projectVersion || current.workflow_state !== "AWAITING_PLANNING_APPROVAL")
        throw new PlannerError(
          "PLANNER_WORKFLOW_STATE_INVALID",
          "Planning acceptance is only available while awaiting explicit Planning approval.",
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
          const acceptanceCoverage = await this.planningAcceptanceCoverageInTransaction(tx, {
            packageRow,
            packageValue,
            canonicalBrief: canonical.brief,
          });
          if (acceptanceCoverage?.blockers.length)
            throw new PlannerError(
              "ARCHITECTURE_BLOCKED",
              `Planning acceptance evidence reconciliation failed: ${acceptanceCoverage.blockers.slice(0, 10).join(", ")}.`,
            );
          const admission = admitPlanningRefresh({
            candidate: packageValue,
            current: packageValue,
            canonicalBrief: canonical.brief,
            projectId: input.projectId,
            projectVersion: input.projectVersion,
            approvedBriefChecksum: canonical.briefChecksum,
            timestamp: packageValue.updatedAt,
            requirementCoverage: acceptanceCoverage?.projection?.coverage,
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
        expectedState: "AWAITING_PLANNING_APPROVAL",
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
      currentWorkflowState: "ARCHITECTURE_REVIEW",
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
    const correctionCanonicalBrief = currentCanonical?.brief ?? parsed.canonicalBrief;
    if (!correctionCanonicalBrief)
      throw new PlannerError(
        "BRIEF_CHECKSUM_MISMATCH",
        "Planner correction requires the current approved CanonicalBriefV3.",
      );
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
    const correctionBriefDelta = createPlanningAuthorizationDelta({
      canonicalBrief: correctionCanonicalBrief,
      authorizedDomains: architectureReviewDomains(review),
    });
    const applyDeterministicCorrection = (change: z.input<typeof PlanningChangeSetProviderOutputSchema>["changes"][number]) => applyPlanningChangeSet({
      current: currentPlanningPackage,
      changeSet: providerChangeSetToHostChangeSet({
        providerOutput: PlanningChangeSetProviderOutputSchema.parse({ contractVersion: 1, changes: [change] }),
        projectId: input.projectId,
        projectVersion: input.projectVersion,
        basePlanningSemanticChecksum: planningSemanticChecksum(currentPlanningPackage),
        baseBriefChecksum: correctionBriefDelta.baseBriefChecksum,
        targetBriefChecksum: correctionBriefDelta.targetBriefChecksum,
        authorizationScopeChecksum: correctionBriefDelta.authorizationScopeChecksum,
      }),
      briefDelta: correctionBriefDelta,
      canonicalBrief: correctionCanonicalBrief,
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      timestamp: now(),
    });
    if (canResolveNoBackendDeterministically) {
      corrected = applyDeterministicCorrection({ kind: "set-architecture-field", field: "backendPriority", value: [], requirementReferences: ["PLANNING:DECISION:database"] });
    } else if (canResolveClientOnlyDeterministically) {
      const correctedForm = currentPlanningPackage.forms.forms.find((form) => form.submissionMechanism === "pending-decision");
      if (!correctedForm) throw new PlannerError("PLANNING_PACKAGE_INVALID", "The deterministic client-only correction has no pending form to correct.");
      corrected = applyDeterministicCorrection({ kind: "upsert-form", value: { ...correctedForm, submissionMechanism: "client-only", requirementReferences: ["PLANNING:DECISION:form-behavior"] } });
    } else {
      if (!this.provider.proposeChangeSet) {
        const error = new PlannerError(
          "PLANNING_REFRESH_PROVIDER_UNAVAILABLE",
          "The configured Planner provider does not support bounded Planning corrections.",
        );
        await this.recordRefreshFailure({
          projectId: input.projectId,
          projectVersion: input.projectVersion,
          operationKey: input.idempotencyKey,
          stage: "PROVIDER",
          error,
          basePlanningSemanticChecksum: planningSemanticChecksum(currentPlanningPackage),
          baseBriefChecksum: correctionBriefDelta.baseBriefChecksum,
          targetBriefChecksum: correctionBriefDelta.targetBriefChecksum,
          changedDomains: correctionBriefDelta.authorizedDomains,
        });
        throw error;
      }
      const skillSelection = this.resolveSkills
        ? await this.resolveSkills(parsed)
        : undefined;
      let providerOutput: z.infer<typeof PlanningChangeSetProviderOutputSchema>;
      try {
        providerOutput = PlanningChangeSetProviderOutputSchema.parse(
          await this.provider.proposeChangeSet(
            {
              projectId: parsed.projectId,
              projectVersion: parsed.projectVersion,
              idempotencyKey: parsed.idempotencyKey,
              approvedBriefChecksum: correctionBriefDelta.targetBriefChecksum,
              canonicalBrief: correctionCanonicalBrief,
              currentPlanningPackage,
              briefDelta: correctionBriefDelta,
              authorizationScopeChecksum: correctionBriefDelta.authorizationScopeChecksum,
              architectureReview: review,
              correctionOnly: true,
            },
            skillSelection?.contexts,
            skillSelection?.identityChecksum,
          ),
        );
      } catch (error) {
        if (error instanceof z.ZodError)
        {
          const failure = new PlannerError(
            "PLANNING_PACKAGE_INVALID",
            "Planner correction ChangeSet did not match the strict contract.",
            error,
          );
            await this.recordRefreshFailure({ projectId: input.projectId, projectVersion: input.projectVersion, operationKey: input.idempotencyKey, stage: "PROVIDER", error: failure, basePlanningSemanticChecksum: planningSemanticChecksum(currentPlanningPackage), baseBriefChecksum: correctionBriefDelta.baseBriefChecksum, targetBriefChecksum: correctionBriefDelta.targetBriefChecksum, changedDomains: correctionBriefDelta.authorizedDomains });
            throw failure;
          }
        const failure = new PlannerError("PLANNER_PROVIDER_FAILED", "Planner correction ChangeSet failed.", error);
        await this.recordRefreshFailure({ projectId: input.projectId, projectVersion: input.projectVersion, operationKey: input.idempotencyKey, stage: "PROVIDER", error: failure, basePlanningSemanticChecksum: planningSemanticChecksum(currentPlanningPackage), baseBriefChecksum: correctionBriefDelta.baseBriefChecksum, targetBriefChecksum: correctionBriefDelta.targetBriefChecksum, changedDomains: correctionBriefDelta.authorizedDomains });
        throw failure;
      }
      try {
        const currentAfterProvider = await this.validateCurrentCanonicalBrief(parsed);
        const projectAfterProvider = await this.projects.getWithVersion(input.projectId);
        if (!projectAfterProvider || projectAfterProvider.project.currentVersion !== input.projectVersion || projectAfterProvider.rowVersion !== current.rowVersion || projectAfterProvider.project.workflowState !== "ARCHITECTURE_REVIEW")
          throw new PlannerError("PLANNING_STALE", "The project changed while the Planning correction was running.");
        if (currentAfterProvider?.briefChecksum !== correctionBriefDelta.targetBriefChecksum)
          throw new PlannerError("PLANNING_STALE", "The approved CanonicalBriefV3 changed while the Planning correction was running.");
        const planningAfterProvider = await this.documents.getWithMetadata(input.projectId, input.projectVersion, "planning-package");
        if (planningAfterProvider?.rowVersion !== persistedCurrent.rowVersion || planningAfterProvider?.checksum !== persistedCurrent.checksum)
          throw new PlannerError("PLANNING_STALE", "The current PlanningPackage changed while the Planning correction was running.");
      } catch (error) {
        await this.recordRefreshFailure({ projectId: input.projectId, projectVersion: input.projectVersion, operationKey: input.idempotencyKey, stage: "CURRENTNESS", error, basePlanningSemanticChecksum: planningSemanticChecksum(currentPlanningPackage), baseBriefChecksum: correctionBriefDelta.baseBriefChecksum, targetBriefChecksum: correctionBriefDelta.targetBriefChecksum, changedDomains: correctionBriefDelta.authorizedDomains, operationKinds: providerOutput.changes.map((change) => change.kind) });
        throw error;
      }
      try {
        corrected = applyPlanningChangeSet({
          current: currentPlanningPackage,
          changeSet: providerChangeSetToHostChangeSet({
            providerOutput,
            projectId: input.projectId,
            projectVersion: input.projectVersion,
            basePlanningSemanticChecksum: planningSemanticChecksum(currentPlanningPackage),
            baseBriefChecksum: correctionBriefDelta.baseBriefChecksum,
            targetBriefChecksum: correctionBriefDelta.targetBriefChecksum,
            authorizationScopeChecksum: correctionBriefDelta.authorizationScopeChecksum,
          }),
          briefDelta: correctionBriefDelta,
          canonicalBrief: correctionCanonicalBrief,
          projectId: input.projectId,
          projectVersion: input.projectVersion,
          timestamp: now(),
        });
      } catch (error) {
        const failure = new PlannerError("PLANNING_PACKAGE_INVALID", "The Planning correction ChangeSet failed host validation or application.", error);
        await this.recordRefreshFailure({ projectId: input.projectId, projectVersion: input.projectVersion, operationKey: input.idempotencyKey, stage: "ADMISSION", error: failure, basePlanningSemanticChecksum: planningSemanticChecksum(currentPlanningPackage), baseBriefChecksum: correctionBriefDelta.baseBriefChecksum, targetBriefChecksum: correctionBriefDelta.targetBriefChecksum, changedDomains: correctionBriefDelta.authorizedDomains, operationKinds: providerOutput.changes.map((change) => change.kind) });
        throw failure;
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
      authorizedDomains: correctionBriefDelta.authorizedDomains as PlanningRefreshDomain[],
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
    let transition;
    try {
      transition = await this.persistPackage(admittedNext, input.idempotencyKey, {
        rowVersion: persistedCurrent.rowVersion,
        checksum: persistedCurrent.checksum,
      }, {
        rowVersion: current.rowVersion,
        workflowState: "ARCHITECTURE_REVIEW",
      }, {
        targetState: "AWAITING_PLANNING_APPROVAL",
        actor: "planner-architect",
        reason: `Architecture findings corrected in bounded cycle ${cycle + 1}. Explicit Planning approval must run again.`,
        idempotencyKey: `${input.idempotencyKey}:planning-correction`,
        context: { requirements: brief },
      });
    } catch (error) {
      await this.recordRefreshFailure({
        projectId: input.projectId,
        projectVersion: input.projectVersion,
        operationKey: input.idempotencyKey,
        stage: "PERSISTENCE",
        error,
        basePlanningSemanticChecksum: planningSemanticChecksum(currentPlanningPackage),
        baseBriefChecksum: correctionBriefDelta.baseBriefChecksum,
        targetBriefChecksum: correctionBriefDelta.targetBriefChecksum,
        changedDomains: correctionBriefDelta.authorizedDomains,
      });
      throw error;
    }
    this.packages.set(key, admittedNext);
    this.architectureCorrectionCycles.set(key, cycle + 1);
    return {
      package: admittedNext,
      planningChecksum: planningDocumentChecksum(admittedNext),
      projectState: "AWAITING_PLANNING_APPROVAL" as const,
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
    currentProject?: { rowVersion: number; workflowState: "AWAITING_PLANNING_GENERATION" | "AWAITING_PLANNING_APPROVAL" | "AWAITING_DESIGN_SELECTION" | "ARCHITECTURE_REVIEW" },
    workflowTransition?: { targetState: "AWAITING_PLANNING_APPROVAL" | "AWAITING_DESIGN_SELECTION"; actor: string; reason: string; idempotencyKey: string; context?: TransitionContext },
    operationTelemetry?: StagedPlanningOperationTelemetry,
    onMutationCommitted?: () => void | Promise<void>,
  ) {
    operationTelemetry?.enter("PERSISTENCE");
    let transition;
    try {
      transition = await this.dependencies.database.transaction(async (tx) => {
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
        operationTelemetry?.enter("LIFECYCLE_TRANSITION");
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
          context: workflowTransition.context,
          idempotencyKey: workflowTransition.idempotencyKey,
        });
      }
      return undefined;
      });
    } catch (error) {
      if (isCommitOutcomeAmbiguous(error)) {
        operationTelemetry?.markCanonicalPlanningPersisted();
        if (workflowTransition) operationTelemetry?.markLifecycleMutated();
        try { await onMutationCommitted?.(); } catch { /* preserve the original ambiguity */ }
      }
      throw error;
    }
    operationTelemetry?.markCanonicalPlanningPersisted();
    if (workflowTransition) operationTelemetry?.markLifecycleMutated();
    await onMutationCommitted?.();
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
          const acceptanceCoverage = await this.planningAcceptanceCoverageInTransaction(tx, {
            packageRow,
            packageValue,
            canonicalBrief: brief.brief,
          });
          if (acceptanceCoverage?.blockers.length)
            throw new PlannerError("PLANNING_NOT_ACCEPTED", "Planning Acceptance evidence is not current.");
          const admission = admitPlanningRefresh({
            candidate: packageValue,
            current: packageValue,
            canonicalBrief: brief.brief,
            projectId,
            projectVersion,
            approvedBriefChecksum: brief.briefChecksum,
            timestamp: packageValue.updatedAt,
            requirementCoverage: acceptanceCoverage?.projection?.coverage,
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

  private async planningAcceptanceCoverageInTransaction(
    tx: PersistenceTransaction,
    input: {
      packageRow: Pick<DocumentRow, "rowVersion" | "checksum">;
      packageValue: PlanningPackage;
      canonicalBrief: z.infer<typeof BriefV3DocumentSchema>["brief"];
    },
  ): Promise<{ projection?: PlanningAcceptanceCoverageProjection; blockers: string[] } | undefined> {
    const runs = await tx.listPlanningRecoveryRuns(input.packageValue.projectId, input.packageValue.projectVersion);
    const evidenceRows = await tx.listPlanningRecoveryEvidence(input.packageValue.projectId, input.packageValue.projectVersion);
    const acceptedBase = input.packageValue.accepted && input.packageValue.acceptance.checksum
      ? { rowVersion: input.packageRow.rowVersion - 1, checksum: input.packageValue.acceptance.checksum }
      : undefined;
    const matches = runs
      .filter((run) => run.state === "COMMITTED" || run.state === "COMMITTED_RECONCILED")
      .map((run) => ({
        run,
        evidence: evidenceRows.find((candidate) => {
          const currentPackage = candidate.nextPlanningRowVersion === input.packageRow.rowVersion && candidate.nextPlanningDocumentChecksum === input.packageRow.checksum;
          const acceptedBasePackage = acceptedBase && candidate.nextPlanningRowVersion === acceptedBase.rowVersion && candidate.nextPlanningDocumentChecksum === acceptedBase.checksum;
          return candidate.id === run.committedEvidenceId && candidate.operationKey === run.operationKey && (currentPackage || acceptedBasePackage);
        }),
      }))
      .filter((candidate): candidate is { run: (typeof runs)[number]; evidence: (typeof evidenceRows)[number] } => Boolean(candidate.evidence))
      .sort((left, right) => right.evidence.createdAt.localeCompare(left.evidence.createdAt) || right.run.runId.localeCompare(left.run.runId));
    const match = matches[0];
    if (!match) return undefined;

    try {
      const plan = PlanningRecoveryPlanSchema.parse(match.run.recoveryPlan);
      const planPayload = Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "planChecksum"));
      const routeManifest = createCanonicalPlanningRouteManifest(input.canonicalBrief);
      const requirementManifest = createPlanningOwnedRequirementManifest(input.canonicalBrief);
      const targetCatalog = createPlanningTargetCatalog(routeManifest);
      if (
        checksumPersistedDocument(planPayload) !== plan.planChecksum
        || match.run.recoveryPlanChecksum !== plan.planChecksum
        || plan.projectId !== input.packageValue.projectId
        || plan.projectVersion !== input.packageValue.projectVersion
        || plan.briefChecksum !== canonicalBriefChecksum(input.canonicalBrief)
        || plan.briefChecksum !== input.packageValue.approvedBriefChecksum
        || plan.sourceHead !== match.run.expectedSourceHead
        || plan.canonicalRouteManifest?.manifestChecksum !== routeManifest.manifestChecksum
        || plan.planningRequirementManifest?.manifestChecksum !== requirementManifest.manifestChecksum
        || plan.planningTargetCatalog?.catalogChecksum !== targetCatalog.catalogChecksum
        || (!input.packageValue.accepted && match.evidence.nextPlanningSemanticChecksum !== planningSemanticChecksum(input.packageValue))
      ) return { blockers: ["PLANNING_RECOVERY_ACCEPTANCE_EVIDENCE_INVALID"] };
      if (plan.reAdmission) {
        const sourceRun = runs.find((candidate) => candidate.runId === plan.reAdmission?.sourceProviderRunId);
        if (!sourceRun || sourceRun.providerResultChecksum !== plan.reAdmission.sourceProviderResultChecksum) return { blockers: ["PLANNING_RECOVERY_ACCEPTANCE_EVIDENCE_INVALID"] };
      }
      const providerResult = PlanningRecoveryProviderResultSchema.parse(match.run.providerResult);
      if (
        !match.run.providerResultChecksum
        || checksumPersistedDocument(providerResult) !== match.run.providerResultChecksum
        || providerResult.planningPackage.projectId !== input.packageValue.projectId
        || providerResult.planningPackage.projectVersion !== input.packageValue.projectVersion
      ) return { blockers: ["PLANNING_RECOVERY_ACCEPTANCE_EVIDENCE_INVALID"] };
      const projection = projectPlanningAcceptanceCoverageFromRecoveryAccounting({
        candidate: input.packageValue,
        canonicalBrief: input.canonicalBrief,
        semanticAccounting: providerResult.requirementAccounting,
        planningRequirementManifest: requirementManifest,
        routeManifest,
        targetCatalog,
      });
      return { projection, blockers: projection.blockers };
    } catch {
      return { blockers: ["PLANNING_RECOVERY_ACCEPTANCE_EVIDENCE_INVALID"] };
    }
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
    if (canonical?.documentType === "brief-v3") return { legalPlaceholderPolicy: canonical.brief.legal.placeholderPolicy, canonicalBrief: canonical.brief } as const;
    const legacy = await this.documents.get(projectId, projectVersion, "requirements");
    const policy = legacy?.documentType === "requirements" ? legacy.legalComplianceConstraints?.placeholderPolicy : undefined;
    return policy ? { legalPlaceholderPolicy: policy } as const : undefined;
  }

  private async planningAcceptanceContextInTransaction(tx: PersistenceTransaction, projectId: string, projectVersion: number) {
    const canonicalRow = await tx.getDocument(projectId, projectVersion, "brief-v3");
    const canonical = canonicalRow ? mapRowToDocument(canonicalRow) : null;
    if (canonical?.documentType === "brief-v3") return { legalPlaceholderPolicy: canonical.brief.legal.placeholderPolicy, canonicalBrief: canonical.brief } as const;
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
