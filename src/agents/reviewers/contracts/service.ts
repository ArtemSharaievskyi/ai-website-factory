import { randomUUID } from "node:crypto";
import { z } from "zod";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import {
  DocumentRepository,
  ProjectRepository,
  saveDocumentInTransaction,
} from "@/persistence/database/repositories";
import {
  ContractAuditHistorySchema,
  ContractAuditProviderOutputSchema,
  ContractAuditRecordSchema,
  ContractAuditResultSchema,
  type ContractAuditProviderOutput,
  type ContractAuditResult,
  type ReviewEvidenceProvenance,
} from "@/domain/review/schema";
import { contractAuditorAgentDefinition } from "@/agents/catalog";
import { ContractAuditError } from "./errors";
import {
  CONTRACT_AUDIT_POLICY_VERSION,
  ContractAuditInputSchema,
  assertProjectIdentity,
  type ContractAuditInput,
} from "./contracts";
import {
  deterministicContractAudit,
  DeterministicContractAuditProvider,
} from "./deterministic";
import type { ContractAuditProvider } from "./ports";
import type { ReviewerSkillSelection } from "@/skills/runtime/resolver";
import {
  createReviewEvidenceCatalog,
  evidenceCatalogChecksum,
  providerEvidenceCatalog,
  resolveProviderReviewEvidence,
} from "../evidence";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { Buffer } from "node:buffer";

const now = () => new Date().toISOString();
const findingKey = (value: unknown) => JSON.stringify(value);
const briefEvidenceRefs = (brief: unknown) => {
  const refs: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.sourceRefs)) refs.push(...record.sourceRefs.filter((ref): ref is string => typeof ref === "string"));
    if (typeof record.id === "string" && /^REQUIREMENT:v3-[a-f0-9]{64}$/i.test(record.id)) refs.push(record.id);
    Object.values(record).forEach(visit);
  };
  visit(brief);
  return refs;
};
export type ContractAuditExecutionEvidence = {
  requestFingerprint?: string;
  requestBytes?: number;
  providerBoundary: "NOT_STARTED" | "STARTED" | "RESPONSE_RECEIVED";
  providerCallsTotal: number;
  responseReceived: boolean;
  parsed: boolean;
  persisted: boolean;
};
export function canonicalContractEvidence(input: ContractAuditInput) {
  return new Set([
    "requirements",
    "planning-package",
    "architecture-review",
    "selected-design",
    "task-graph",
    "test-strategy",
    "executor-catalog",
    "briefChecksum",
    "planningChecksum",
    "architectureReviewChecksum",
    "designChecksum",
    "taskGraphChecksum",
    "task-graph.sourceDocumentChecksums",
    "data-model-plan",
    "supabase-plan",
    "requirements.authenticationDecision",
    "authentication-plan",
    input.selectedDesign.selectedDirectionId,
    ...briefEvidenceRefs(input.approvedBrief),
    ...input.acceptedPlanningPackage.sitemap.routes.flatMap((route) => [
      `route:${route.id}`,
      `planning:${route.id}`,
      route.id,
    ]),
    ...input.acceptedPlanningPackage.pages.pages.flatMap((page) => [
      `page:${page.id}`,
      `planning:${page.id}`,
      `route:${page.routeId}`,
      page.id,
      page.routeId,
    ]),
    ...input.acceptedPlanningPackage.forms.forms.flatMap((form) => [
      `form:${form.id}`,
      `planning:${form.id}`,
      form.id,
      ...form.fields.flatMap((field) =>
        "fieldId" in field ? [`field:${field.fieldId}`, field.fieldId] : [],
      ),
    ]),
    ...input.acceptedPlanningPackage.dataModel.entities.map(
      (entity) => `entity:${entity.id}`,
    ),
    ...input.taskGraph.tasks.flatMap((task) => [
      `task:${task.id}`,
      ...task.fileScopes.map((scope) => `scope:${scope}`),
      ...(task.requirementReferences ?? []),
      ...(task.planningReferences ?? []),
      ...(task.selectedDesignReferences ?? []),
    ]),
    ...input.executorCatalog.flatMap((executor) => [
      `executor:${executor.executorId}`,
      ...executor.capabilities.map((capability) => `capability:${capability}`),
    ]),
    ...((input.currentAssetReferences ?? []).flatMap((asset) => [
      `asset:${asset.assetId}`,
      `asset:${asset.safeDisplayName}`,
      `asset-category:${asset.category}`,
    ])),
  ]);
}

function selectedDesignProviderReferences(input: ContractAuditInput, evidenceRefs: Iterable<string>) {
  const selectedDirectionRefs = new Set([
    input.selectedDesign.selectedDirectionId,
    ...input.taskGraph.tasks.flatMap((task) => task.selectedDesignReferences ?? []),
  ]);
  const opaqueReference = checksumPersistedDocument({
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    directionSetId: input.selectedDesign.directionSetId,
    selectedDirectionId: input.selectedDesign.selectedDirectionId,
    selectedDirectionChecksum: input.selectedDesign.selectedDirectionChecksum,
    selectedDesignChecksum: input.designChecksum,
  });
  return [...evidenceRefs].reduce<Record<string, string>>((mapping, reference) => {
    if (selectedDirectionRefs.has(reference)) mapping[reference] = `selected-design-evidence:${opaqueReference.slice(0, 32)}`;
    return mapping;
  }, {});
}

export class ContractAuditService {
  private readonly documents: DocumentRepository;
  private readonly projects: ProjectRepository;
  private readonly provider: ContractAuditProvider;
  private readonly resolveSkills?: (
    input: ContractAuditInput,
  ) => Promise<ReviewerSkillSelection>;
  private readonly idempotency = new Map<
    string,
    { inputHash: string; result: ContractAuditResult }
  >();
  private readonly regenerationCycles = new Map<string, number>();
  constructor(
    private readonly database: import("@/persistence/database/types").PersistenceDatabase,
    dependencies: {
      provider?: ContractAuditProvider;
      resolveSkills?: (
        input: ContractAuditInput,
      ) => Promise<ReviewerSkillSelection>;
    } = {},
  ) {
    this.documents = new DocumentRepository(database);
    this.projects = new ProjectRepository(database);
    this.provider =
      dependencies.provider ?? new DeterministicContractAuditProvider();
    this.resolveSkills = dependencies.resolveSkills;
  }
  getAgentDefinition() {
    return contractAuditorAgentDefinition;
  }
  getTaskGraphRegenerationCount(projectId: string, projectVersion: number) {
    return this.regenerationCycles.get(`${projectId}:${projectVersion}`) ?? 0;
  }
  recordTaskGraphRegeneration(projectId: string, projectVersion: number) {
    const key = `${projectId}:${projectVersion}`;
    const count = this.getTaskGraphRegenerationCount(projectId, projectVersion);
    if (count >= 1)
      throw new ContractAuditError(
        "CONTRACT_AUDIT_TASKGRAPH_REGENERATION_EXHAUSTED",
        "Only one TaskGraph regeneration is allowed for a Contract Audit cycle.",
      );
    this.regenerationCycles.set(key, count + 1);
  }

  async audit(
    rawInput: ContractAuditInput,
    signal?: AbortSignal,
    execution?: ContractAuditExecutionEvidence,
  ): Promise<ContractAuditResult> {
    const input = this.parseInput(rawInput);
    const evidenceCatalog = createReviewEvidenceCatalog({
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      evidenceRefs: canonicalContractEvidence(input),
      requestContext: input,
      providerReferences: selectedDesignProviderReferences(input, canonicalContractEvidence(input)),
    });
    const providerInput = { ...input, evidenceCatalog: providerEvidenceCatalog(evidenceCatalog) };
    if (execution) {
      const serializedInput = JSON.stringify(providerInput);
      execution.requestFingerprint = checksumPersistedDocument(providerInput);
      execution.requestBytes = Buffer.byteLength(serializedInput, "utf8");
      execution.providerBoundary = "NOT_STARTED";
    }
    const project = await this.projects.getWithVersion(input.projectId);
    if (
      !project ||
      project.project.workflowState !== "CONTRACT_AUDIT" ||
      project.project.currentVersion !== input.projectVersion
    )
      throw new ContractAuditError(
        "CONTRACT_AUDIT_WORKFLOW_INVALID",
        "Contract Audit is only available in the CONTRACT_AUDIT workflow stage.",
      );
    const skillSelection = this.resolveSkills
      ? await this.resolveSkills(input)
      : { contexts: [], identityChecksum: "none", selectedSkillIds: [], selectedSkillChecksums: [] };
    const inputHash = checksumPersistedDocument({
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      briefChecksum: input.briefChecksum,
      planningChecksum: input.planningChecksum,
      architectureReviewChecksum: input.architectureReviewChecksum,
      designChecksum: input.designChecksum,
      taskGraphChecksum: input.taskGraphChecksum,
      evidenceCatalogChecksum: evidenceCatalogChecksum(evidenceCatalog),
      skillContextChecksum: skillSelection.identityChecksum,
      policyVersion: CONTRACT_AUDIT_POLICY_VERSION,
      promptVersion: this.provider.promptVersion,
    });
    const prior = this.idempotency.get(input.idempotencyKey);
    if (prior) {
      if (prior.inputHash !== inputHash)
        throw new ContractAuditError(
          "CONTRACT_AUDIT_IDEMPOTENCY_CONFLICT",
          "Contract Audit idempotency key was reused with different canonical inputs.",
        );
      return prior.result;
    }
    try {
      const deterministic = deterministicContractAudit(providerInput);
      let providerResult: ContractAuditProviderOutput;
      if (deterministic.verdict !== "APPROVED") {
        providerResult = deterministic;
      } else {
        if (execution) {
          execution.providerCallsTotal = 1;
          execution.providerBoundary = "STARTED";
        }
        try {
          providerResult = await this.provider.review(providerInput, signal, skillSelection.contexts, skillSelection.identityChecksum);
          if (execution) {
            execution.providerBoundary = "RESPONSE_RECEIVED";
            execution.responseReceived = true;
          }
        } catch (error) {
          throw error;
        }
      }
      const normalized = this.normalize(providerResult, input, evidenceCatalog);
      if (execution) execution.parsed = true;
      const result = normalized.result;
      const record = ContractAuditRecordSchema.parse({
        schemaVersion: 1,
        documentType: "contract-audit",
        projectId: input.projectId,
        projectVersion: input.projectVersion,
        createdAt: now(),
        updatedAt: now(),
        auditId: randomUUID(),
        auditorAgentId: contractAuditorAgentDefinition.agentId,
        auditorVersion: contractAuditorAgentDefinition.version,
        capability: "review.contracts",
        policyVersion: CONTRACT_AUDIT_POLICY_VERSION,
        promptVersion: this.provider.promptVersion,
        briefChecksum: input.briefChecksum,
        planningChecksum: input.planningChecksum,
        architectureReviewId: input.approvedArchitectureReview.reviewId,
        architectureReviewChecksum: input.architectureReviewChecksum,
        designChecksum: input.designChecksum,
        taskGraphChecksum: input.taskGraphChecksum,
        evidenceCatalogId: evidenceCatalog.catalogId,
        evidenceCatalogChecksum: evidenceCatalogChecksum(evidenceCatalog),
        evidenceProvenance: normalized.provenance,
        resultChecksum: checksumPersistedDocument(result),
        result,
      });
      const previous = await this.documents.get(
        input.projectId,
        input.projectVersion,
        "contract-audit",
      );
      const history = await this.documents.get(
        input.projectId,
        input.projectVersion,
        "contract-audit-history",
      );
      const records = [
        ...(history?.documentType === "contract-audit-history"
          ? history.records
          : []),
        ...(previous?.documentType === "contract-audit" ? [previous] : []),
        record,
      ];
      const historyDocument = ContractAuditHistorySchema.parse({
          schemaVersion: 1,
          documentType: "contract-audit-history",
          projectId: input.projectId,
          projectVersion: input.projectVersion,
          createdAt: records[0]!.createdAt,
          updatedAt: now(),
          records,
        });
      await this.database.transaction(async (tx) => {
        const current = await tx.getProject(input.projectId);
        if (!current || current.current_version !== input.projectVersion || current.workflow_state !== "CONTRACT_AUDIT" || current.row_version !== input.expectedRowVersion) throw new ContractAuditError("CONTRACT_AUDIT_STALE", "The Contract Audit inputs became stale before the canonical commit.");
        await saveDocumentInTransaction(tx, historyDocument, `contract-audit-history:${input.idempotencyKey}`);
        await saveDocumentInTransaction(tx, record, `contract-audit:${input.idempotencyKey}`);
      });
      if (execution) execution.persisted = true;
      this.idempotency.set(input.idempotencyKey, { inputHash, result });
      return result;
    } catch (error) {
      if (error instanceof ContractAuditError) throw error;
      if (error instanceof z.ZodError)
        throw new ContractAuditError(
          "CONTRACT_AUDIT_OUTPUT_INVALID",
          "Contract Audit output did not match the strict contract.",
          error,
        );
      throw new ContractAuditError(
        "CONTRACT_AUDIT_PROVIDER_FAILED",
        "Contract Audit provider failed safely.",
        error,
      );
    }
  }
  async getCurrentAudit(
    projectId: string,
    projectVersion: number,
    checksums: {
      brief: string;
      planning: string;
      architectureReview: string;
      design: string;
      taskGraph: string;
    },
  ) {
    const document = await this.documents.get(
      projectId,
      projectVersion,
      "contract-audit",
    );
    if (!document || document.documentType !== "contract-audit") return null;
    const record = ContractAuditRecordSchema.parse(document);
    return record.briefChecksum === checksums.brief &&
      record.planningChecksum === checksums.planning &&
      record.architectureReviewChecksum === checksums.architectureReview &&
      record.designChecksum === checksums.design &&
      record.taskGraphChecksum === checksums.taskGraph &&
      record.result.verdict === "APPROVED"
      ? record
      : null;
  }
  private parseInput(rawInput: ContractAuditInput) {
    let input: ContractAuditInput;
    try {
      input = ContractAuditInputSchema.parse(rawInput);
    } catch (error) {
      throw new ContractAuditError(
        "CONTRACT_AUDIT_INPUT_INVALID",
        "Contract Audit input did not match the strict contract.",
        error,
      );
    }
    try {
      const brief = input.approvedBrief;
      const planning = input.acceptedPlanningPackage;
      const review = input.approvedArchitectureReview;
      const graph = input.taskGraph;
      assertProjectIdentity(
        input,
        [
          { label: "approvedBrief", value: brief },
          { label: "acceptedPlanningPackage", value: planning },
          { label: "approvedArchitectureReview", value: review },
          { label: "selectedDesign", value: input.selectedDesign },
          { label: "taskGraph", value: graph },
        ],
      );
      if (!brief.approval.approved || brief.briefStatus !== "approved")
        throw new Error("The approved Brief is unavailable.");
      if (
        input.briefChecksum !== checksumPersistedDocument(brief) &&
        input.briefChecksum !== brief.approval.approvedRequirementsChecksum
      )
        throw new Error("The Brief checksum is stale.");
      if (input.canonicalBrief && canonicalBriefChecksum(input.canonicalBrief) !== input.briefChecksum)
        throw new Error("The CanonicalBriefV3 checksum is stale.");
      if (!planning.accepted || !planning.architecture.acceptance.accepted)
        throw new Error("The PlanningPackage is not accepted.");
      if (
        input.planningChecksum !== checksumPersistedDocument(planning) &&
        input.planningChecksum !== planning.acceptance.checksum
      )
        throw new Error("The PlanningPackage checksum is stale.");
      if (
        review.result.verdict !== "APPROVED" ||
        review.approvedBriefChecksum !== input.briefChecksum ||
        review.acceptedPlanningChecksum !== input.planningChecksum
      )
        throw new Error("The Architecture Review is not current and approved.");
      if (
        input.architectureReviewChecksum !== checksumPersistedDocument(review)
      )
        throw new Error("The Architecture Review checksum is stale.");
      if (
        input.designChecksum !==
          checksumPersistedDocument(input.selectedDesign) &&
        input.designChecksum !== input.selectedDesign.selectedDirectionChecksum
      )
        throw new Error("The selected Design checksum is stale.");
      if (
        input.taskGraphChecksum !==
          checksumPersistedDocument({ ...graph, graphChecksum: undefined }) ||
        graph.graphChecksum !== input.taskGraphChecksum
      )
        throw new Error("The TaskGraph checksum is stale.");
      if (
        graph.sourceDocumentChecksums?.brief !== input.briefChecksum ||
        graph.sourceDocumentChecksums?.planning !== input.planningChecksum ||
        graph.sourceDocumentChecksums?.design !== input.designChecksum
      )
        throw new Error(
          "The TaskGraph is not sourced from the supplied canonical artifacts.",
        );
      return input;
    } catch (error) {
      throw new ContractAuditError(
        "CONTRACT_AUDIT_BLOCKED",
        error instanceof Error
          ? error.message
          : "Canonical audit evidence is unavailable.",
        error,
      );
    }
  }
  private normalize(raw: ContractAuditProviderOutput, input: ContractAuditInput, evidenceCatalog: ReturnType<typeof createReviewEvidenceCatalog>): { result: ContractAuditResult; provenance: ReviewEvidenceProvenance[] } {
    let parsed;
    try {
      parsed = ContractAuditProviderOutputSchema.parse(raw);
    } catch (error) {
      throw new ContractAuditError(
        "CONTRACT_AUDIT_OUTPUT_INVALID",
        "Contract Audit output failed schema validation.",
        error,
      );
    }
    let resolved: ReturnType<typeof resolveProviderReviewEvidence<typeof parsed.findings[number]>>;
    try {
      resolved = resolveProviderReviewEvidence<typeof parsed.findings[number]>(evidenceCatalog, parsed);
    } catch (error) {
      throw new ContractAuditError(
        "CONTRACT_AUDIT_OUTPUT_INVALID",
        "Contract Audit output referenced evidence outside the host-issued catalog.",
        error,
      );
    }
    const findings = [];
    const ids = new Set<string>();
    const exact = new Set<string>();
    for (const [index, item] of parsed.findings.entries()) {
      const resolvedItem = resolved.findings[index]!;
      if (item.severity !== "INFO" && !item.correctionTarget)
        throw new ContractAuditError(
          "CONTRACT_AUDIT_OUTPUT_INVALID",
          `Actionable finding ${item.findingId} requires a correction target.`,
        );
      const key = findingKey(resolvedItem);
      if (ids.has(item.findingId)) {
        if (!exact.has(key))
          throw new ContractAuditError(
            "CONTRACT_AUDIT_OUTPUT_INVALID",
            `Finding ID is reused with different content: ${item.findingId}.`,
          );
        continue;
      }
      ids.add(item.findingId);
      exact.add(key);
      findings.push(resolvedItem);
    }
    const hasBlocking = findings.some(
      (item) => item.severity === "ERROR" || item.severity === "CRITICAL",
    );
    if (parsed.verdict === "APPROVED" && hasBlocking)
      parsed.verdict = "CHANGES_REQUIRED";
    if (parsed.verdict === "CHANGES_REQUIRED" && findings.length === 0)
      throw new ContractAuditError(
        "CONTRACT_AUDIT_OUTPUT_INVALID",
        "CHANGES_REQUIRED requires findings.",
      );
    return {
      result: ContractAuditResultSchema.parse({
        ...parsed,
        reviewedArtifactRefs: resolved.reviewedArtifactRefs,
        findings,
        policyVersion: CONTRACT_AUDIT_POLICY_VERSION,
      }),
      provenance: resolved.provenance,
    };
  }
}
