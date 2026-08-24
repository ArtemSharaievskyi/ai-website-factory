import { randomUUID } from "node:crypto";
import { z } from "zod";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import {
  DocumentRepository,
  ProjectRepository,
} from "@/persistence/database/repositories";
import type { PersistenceDatabase } from "@/persistence/database/types";
import {
  CodeIntegrationReviewHistorySchema,
  CodeIntegrationReviewProviderOutputSchema,
  CodeIntegrationReviewRecordSchema,
  CodeIntegrationReviewResultSchema,
  type CodeIntegrationReviewProviderOutput,
  type CodeIntegrationReviewResult,
  type ReviewEvidenceProvenance,
} from "@/domain/review/schema";
import { codeIntegrationReviewerAgentDefinition } from "@/agents/catalog";
import { CodeIntegrationReviewError } from "./errors";
import {
  CODE_INTEGRATION_REVIEW_POLICY_VERSION,
  CodeIntegrationReviewInputSchema,
  type CodeIntegrationReviewInput,
} from "./contracts";
import {
  deterministicCodeIntegrationReview,
  DeterministicCodeIntegrationReviewProvider,
} from "./deterministic";
import type { CodeIntegrationReviewProvider } from "./ports";
import type { AgentSkillSelection } from "@/skills/runtime/resolver";
import { createReviewEvidenceCatalog, evidenceCatalogChecksum, providerEvidenceCatalog, resolveProviderReviewEvidence } from "../evidence";
const now = () => new Date().toISOString();

export function canonicalCodeIntegrationEvidence(input: CodeIntegrationReviewInput) {
  return new Set([
    "brief",
    "planning-package",
    "architecture-review",
    "selected-design",
    "contract-audit",
    "task-graph",
    "source",
    ...input.staticValidation.evidenceRefs,
    ...input.sourceManifest.map((file) => `source:${file.relativePath}`),
    ...input.implementationTasks.map((task) => task.taskId),
    ...input.taskGraph.tasks.map((task) => task.id),
  ]);
}
export class CodeIntegrationReviewService {
  private readonly documents: DocumentRepository;
  private readonly projects: ProjectRepository;
  private readonly provider: CodeIntegrationReviewProvider;
  private readonly idempotency = new Map<
    string,
    { inputHash: string; result: CodeIntegrationReviewResult }
  >();
  private readonly correctionCycles = new Map<string, number>();
  private readonly resolveSkills?: (input: CodeIntegrationReviewInput) => Promise<AgentSkillSelection>;
  constructor(
    private readonly database: PersistenceDatabase,
    dependencies: { provider?: CodeIntegrationReviewProvider; resolveSkills?: (input: CodeIntegrationReviewInput) => Promise<AgentSkillSelection> } = {},
  ) {
    this.documents = new DocumentRepository(database);
    this.projects = new ProjectRepository(database);
    this.provider =
      dependencies.provider ?? new DeterministicCodeIntegrationReviewProvider();
    this.resolveSkills = dependencies.resolveSkills;
  }
  getAgentDefinition() {
    return codeIntegrationReviewerAgentDefinition;
  }
  getCorrectionCycle(projectId: string, projectVersion: number) {
    return this.correctionCycles.get(`${projectId}:${projectVersion}`) ?? 0;
  }
  recordCorrectionCycle(projectId: string, projectVersion: number) {
    const key = `${projectId}:${projectVersion}`;
    const count = this.getCorrectionCycle(projectId, projectVersion);
    if (count >= 2)
      throw new CodeIntegrationReviewError(
        "CODE_REVIEW_CORRECTION_EXHAUSTED",
        "The maximum code review correction cycles have been reached.",
      );
    this.correctionCycles.set(key, count + 1);
  }
  async review(
    rawInput: CodeIntegrationReviewInput,
    signal?: AbortSignal,
  ): Promise<CodeIntegrationReviewResult> {
    let input: CodeIntegrationReviewInput;
    try {
      input = CodeIntegrationReviewInputSchema.parse(rawInput);
    } catch (error) {
      throw new CodeIntegrationReviewError(
        "CODE_REVIEW_INPUT_INVALID",
        "Code review input failed strict validation.",
        error,
      );
    }
    const project = await this.projects.getWithVersion(input.projectId);
    if (!project || project.project.currentVersion !== input.projectVersion)
      throw new CodeIntegrationReviewError(
        "CODE_REVIEW_WORKFLOW_INVALID",
        "Code review requires the current project version.",
      );
    if (
      input.staticValidation.lint !== "PASSED" ||
      input.staticValidation.typecheck !== "PASSED" ||
      input.staticValidation.structural !== "PASSED"
    )
      throw new CodeIntegrationReviewError(
        "CODE_REVIEW_PREREQUISITE_FAILED",
        "Lint, typecheck, and structural validation must pass before AI review.",
      );
    const evidenceCatalog = createReviewEvidenceCatalog({
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      evidenceRefs: canonicalCodeIntegrationEvidence(input),
      requestContext: input,
    });
    const providerInput = { ...input, evidenceCatalog: providerEvidenceCatalog(evidenceCatalog) };
    if (input.approvedContractAudit.result.verdict !== "APPROVED")
      throw new CodeIntegrationReviewError(
        "CODE_REVIEW_BLOCKED",
        "A current approved Contract Audit is required.",
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
      contractAuditChecksum: input.contractAuditChecksum,
      taskGraphChecksum: input.taskGraphChecksum,
      sourceChecksum: input.sourceChecksum,
      evidenceCatalogChecksum: evidenceCatalogChecksum(evidenceCatalog),
      policyVersion: CODE_INTEGRATION_REVIEW_POLICY_VERSION,
      promptVersion: this.provider.promptVersion,
      skillContextChecksum: skillSelection.identityChecksum,
    });
    const prior = this.idempotency.get(input.idempotencyKey);
    if (prior) {
      if (prior.inputHash !== inputHash)
        throw new CodeIntegrationReviewError(
          "CODE_REVIEW_IDEMPOTENCY_CONFLICT",
          "Idempotency key was reused with different source or canonical inputs.",
        );
      return prior.result;
    }
    try {
      const deterministic = deterministicCodeIntegrationReview(providerInput);
      const providerResult =
        deterministic.verdict === "APPROVED"
          ? await this.provider.review(providerInput, signal, skillSelection.contexts, skillSelection.identityChecksum)
          : deterministic;
      const normalized = this.normalize(providerResult, input, evidenceCatalog);
      const result = normalized.result;
      const record = CodeIntegrationReviewRecordSchema.parse({
        schemaVersion: 1,
        documentType: "code-integration-review",
        projectId: input.projectId,
        projectVersion: input.projectVersion,
        createdAt: now(),
        updatedAt: now(),
        reviewId: randomUUID(),
        reviewerAgentId: codeIntegrationReviewerAgentDefinition.agentId,
        reviewerVersion: codeIntegrationReviewerAgentDefinition.version,
        capability: "review.integration",
        policyVersion: CODE_INTEGRATION_REVIEW_POLICY_VERSION,
        promptVersion: this.provider.promptVersion,
        briefChecksum: input.briefChecksum,
        planningChecksum: input.planningChecksum,
        architectureReviewChecksum: input.architectureReviewChecksum,
        designChecksum: input.designChecksum,
        contractAuditChecksum: input.contractAuditChecksum,
        taskGraphChecksum: input.taskGraphChecksum,
        sourceChecksum: input.sourceChecksum,
        evidenceCatalogId: evidenceCatalog.catalogId,
        evidenceCatalogChecksum: evidenceCatalogChecksum(evidenceCatalog),
        evidenceProvenance: normalized.provenance,
        resultChecksum: checksumPersistedDocument(result),
        result,
      });
      const priorRecord = await this.documents.get(
        input.projectId,
        input.projectVersion,
        "code-integration-review",
      );
      const priorHistory = await this.documents.get(
        input.projectId,
        input.projectVersion,
        "code-integration-review-history",
      );
      const records = [
        ...(priorHistory?.documentType === "code-integration-review-history"
          ? priorHistory.records
          : []),
        ...(priorRecord?.documentType === "code-integration-review"
          ? [CodeIntegrationReviewRecordSchema.parse(priorRecord)]
          : []),
        record,
      ];
      await this.documents.save(
        CodeIntegrationReviewHistorySchema.parse({
          schemaVersion: 1,
          documentType: "code-integration-review-history",
          projectId: input.projectId,
          projectVersion: input.projectVersion,
          createdAt: records[0]!.createdAt,
          updatedAt: now(),
          records,
        }),
        `code-integration-review-history:${input.idempotencyKey}`,
      );
      await this.documents.save(
        record,
        `code-integration-review:${input.idempotencyKey}`,
      );
      this.idempotency.set(input.idempotencyKey, { inputHash, result });
      return result;
    } catch (error) {
      if (error instanceof CodeIntegrationReviewError) throw error;
      if (error instanceof z.ZodError)
        throw new CodeIntegrationReviewError(
          "CODE_REVIEW_OUTPUT_INVALID",
          "Code review output failed strict validation.",
          error,
        );
      throw new CodeIntegrationReviewError(
        "CODE_REVIEW_PROVIDER_FAILED",
        "Code review provider failed safely.",
        error,
      );
    }
  }
  async getCurrentReview(
    projectId: string,
    projectVersion: number,
    sourceChecksum: string,
    contractAuditChecksum: string,
  ) {
    const document = await this.documents.get(
      projectId,
      projectVersion,
      "code-integration-review",
    );
    if (!document || document.documentType !== "code-integration-review")
      return null;
    const record = CodeIntegrationReviewRecordSchema.parse(document);
    return record.sourceChecksum === sourceChecksum &&
      record.contractAuditChecksum === contractAuditChecksum &&
      record.result.verdict === "APPROVED"
      ? record
      : null;
  }
  private normalize(
    raw: CodeIntegrationReviewProviderOutput,
    input: CodeIntegrationReviewInput,
    evidenceCatalog: ReturnType<typeof createReviewEvidenceCatalog>,
  ): { result: CodeIntegrationReviewResult; provenance: ReviewEvidenceProvenance[] } {
    const parsed = CodeIntegrationReviewProviderOutputSchema.parse(raw);
    let resolved: ReturnType<typeof resolveProviderReviewEvidence<typeof parsed.findings[number]>>;
    try {
      resolved = resolveProviderReviewEvidence<typeof parsed.findings[number]>(evidenceCatalog, parsed);
    } catch (error) {
      throw new CodeIntegrationReviewError(
        "CODE_REVIEW_OUTPUT_INVALID",
        "Code / Integration Review output referenced evidence outside the host-issued catalog.",
        error,
      );
    }
    const findings = parsed.findings.map((item, index) => {
      const resolvedItem = resolved.findings[index]!;
      if (
        (item.severity === "ERROR" || item.severity === "CRITICAL") &&
        item.correctionTarget === "IMPLEMENTATION_TASK" &&
        item.ownerTaskId &&
        !input.implementationTasks.some(
          (task) => task.taskId === item.ownerTaskId,
        )
      )
        throw new CodeIntegrationReviewError(
          "CODE_REVIEW_OUTPUT_INVALID",
          "Finding owner task is not current implementation ownership.",
        );
      return resolvedItem;
    });
    const result = CodeIntegrationReviewResultSchema.parse({
      ...parsed,
      reviewedArtifactRefs: resolved.reviewedArtifactRefs,
      findings,
      policyVersion: CODE_INTEGRATION_REVIEW_POLICY_VERSION,
    });
    if (
      result.verdict === "APPROVED" &&
      findings.some(
        (item) => item.severity === "ERROR" || item.severity === "CRITICAL",
      )
    )
      return { result: CodeIntegrationReviewResultSchema.parse({ ...result, verdict: "CHANGES_REQUIRED" }), provenance: resolved.provenance };
    return { result, provenance: resolved.provenance };
  }
}
