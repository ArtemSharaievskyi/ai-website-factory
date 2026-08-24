import { randomUUID } from "node:crypto";
import { z } from "zod";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import {
  DocumentRepository,
  ProjectRepository,
} from "@/persistence/database/repositories";
import type { PersistenceDatabase } from "@/persistence/database/types";
import {
  SecurityReviewHistorySchema,
  SecurityReviewProviderOutputSchema,
  SecurityReviewRecordSchema,
  SecurityReviewResultSchema,
  type SecurityReviewProviderOutput,
  type SecurityReviewResult,
  type ReviewEvidenceProvenance,
} from "@/domain/review/schema";
import { securityReviewerAgentDefinition } from "@/agents/catalog";
import { SecurityReviewError } from "./errors";
import {
  SECURITY_REVIEW_POLICY_VERSION,
  SecurityReviewInputSchema,
  type SecurityReviewInput,
} from "./contracts";
import {
  classifySecuritySurface,
  deterministicSecurityReview,
  DeterministicSecurityReviewProvider,
} from "./deterministic";
import type { SecurityReviewProvider } from "./ports";
import type { ReviewerSkillSelection } from "@/skills/runtime/resolver";
import { createReviewEvidenceCatalog, evidenceCatalogChecksum, providerEvidenceCatalog, resolveProviderReviewEvidence } from "../evidence";
const now = () => new Date().toISOString();
const redact = (value: string) =>
  value.replace(
    /(sk-[A-Za-z0-9]{12,}|AKIA[A-Z0-9]{12,}|(?:SERVICE_ROLE|DATABASE_URL|API_KEY|SECRET|TOKEN)\s*[:=]\s*['\"]?)[A-Za-z0-9_./+=-]{8,}/gi,
    "$1[REDACTED]",
  );
export function sanitizeSecurityInput(
  input: SecurityReviewInput,
): SecurityReviewInput {
  return {
    ...input,
    sourceSlices: input.sourceSlices.map((slice) => ({
      ...slice,
      content: redact(slice.content),
    })),
  };
}
export function canonicalSecurityEvidence(input: SecurityReviewInput) {
  return new Set([
    "brief", "planning-package", "architecture-review", "selected-design", "contract-audit", "code-integration-review", "task-graph", "source",
    ...input.deterministicSecurityEvidence.evidenceRefs,
    ...input.unitTestEvidence.evidenceRefs,
    ...input.sourceManifest.map((file) => `source:${file.relativePath}`),
    ...input.taskGraph.tasks.map((task) => task.id),
    ...input.securitySensitiveArtifacts.map((artifact) => artifact.relativePath),
  ]);
}
export class SecurityReviewService {
  private readonly documents: DocumentRepository;
  private readonly projects: ProjectRepository;
  private readonly provider: SecurityReviewProvider;
  private readonly resolveSkills?: (
    input: SecurityReviewInput,
  ) => Promise<ReviewerSkillSelection>;
  private readonly idempotency = new Map<
    string,
    { inputHash: string; result: SecurityReviewResult }
  >();
  private readonly correctionCycles = new Map<string, number>();
  constructor(
    private readonly database: PersistenceDatabase,
    dependencies: {
      provider?: SecurityReviewProvider;
      resolveSkills?: (
        input: SecurityReviewInput,
      ) => Promise<ReviewerSkillSelection>;
    } = {},
  ) {
    this.documents = new DocumentRepository(database);
    this.projects = new ProjectRepository(database);
    this.provider =
      dependencies.provider ?? new DeterministicSecurityReviewProvider();
    this.resolveSkills = dependencies.resolveSkills;
  }
  getAgentDefinition() {
    return securityReviewerAgentDefinition;
  }
  getCorrectionCycle(projectId: string, projectVersion: number) {
    return this.correctionCycles.get(`${projectId}:${projectVersion}`) ?? 0;
  }
  recordCorrectionCycle(projectId: string, projectVersion: number) {
    const key = `${projectId}:${projectVersion}`;
    const count = this.getCorrectionCycle(projectId, projectVersion);
    if (count >= 2)
      throw new SecurityReviewError(
        "SECURITY_REVIEW_CORRECTION_EXHAUSTED",
        "The maximum security review correction cycles have been reached.",
      );
    this.correctionCycles.set(key, count + 1);
  }
  async review(
    rawInput: SecurityReviewInput,
    signal?: AbortSignal,
  ): Promise<SecurityReviewResult> {
    let input: SecurityReviewInput;
    try {
      input = SecurityReviewInputSchema.parse(rawInput);
    } catch (error) {
      throw new SecurityReviewError(
        "SECURITY_REVIEW_INPUT_INVALID",
        "Security review input failed strict validation.",
        error,
      );
    }
    const project = await this.projects.getWithVersion(input.projectId);
    if (!project || project.project.currentVersion !== input.projectVersion)
      throw new SecurityReviewError(
        "SECURITY_REVIEW_WORKFLOW_INVALID",
        "Security review requires the current project version.",
      );
    if (input.approvedCodeIntegrationReview.result.verdict !== "APPROVED")
      throw new SecurityReviewError(
        "SECURITY_REVIEW_PREREQUISITE_FAILED",
        "A current approved Code / Integration Review is required before Security Review.",
      );
    const surface = classifySecuritySurface(input);
    const evidenceCatalog = createReviewEvidenceCatalog({
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      evidenceRefs: canonicalSecurityEvidence(input),
      requestContext: input,
    });
    const providerInput = { ...input, evidenceCatalog: providerEvidenceCatalog(evidenceCatalog) };
    const deterministic = deterministicSecurityReview(providerInput);
    const semanticReviewSkipped =
      surface.length === 1 &&
      surface[0] === "NONE" &&
      deterministic.verdict === "APPROVED";
    const skillSelection = semanticReviewSkipped
      ? { contexts: [], identityChecksum: "none", selectedSkillIds: [], selectedSkillChecksums: [] }
      : this.resolveSkills
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
      codeIntegrationReviewChecksum: input.codeIntegrationReviewChecksum,
      taskGraphChecksum: input.taskGraphChecksum,
      sourceChecksum: input.sourceChecksum,
      securityEvidenceChecksum: input.deterministicSecurityEvidence.checksum,
      evidenceCatalogChecksum: evidenceCatalogChecksum(evidenceCatalog),
      surface,
      skillContextChecksum: skillSelection.identityChecksum,
      policyVersion: SECURITY_REVIEW_POLICY_VERSION,
      promptVersion: this.provider.promptVersion,
    });
    const prior = this.idempotency.get(input.idempotencyKey);
    if (prior) {
      if (prior.inputHash !== inputHash)
        throw new SecurityReviewError(
          "SECURITY_REVIEW_IDEMPOTENCY_CONFLICT",
          "Idempotency key was reused with different security inputs.",
        );
      return prior.result;
    }
    try {
      const safeInput = semanticReviewSkipped
        ? providerInput
        : { ...sanitizeSecurityInput(input), evidenceCatalog: providerEvidenceCatalog(evidenceCatalog) };
      const providerResult =
        deterministic.verdict === "APPROVED" && !semanticReviewSkipped
          ? await this.provider.review(
              safeInput,
              signal,
              skillSelection.contexts,
              skillSelection.identityChecksum,
            )
          : deterministic;
      const normalized = this.normalize(providerResult, input, evidenceCatalog);
      const result = normalized.result;
      const record = SecurityReviewRecordSchema.parse({
        schemaVersion: 1,
        documentType: "security-review",
        projectId: input.projectId,
        projectVersion: input.projectVersion,
        createdAt: now(),
        updatedAt: now(),
        reviewId: randomUUID(),
        reviewerAgentId: securityReviewerAgentDefinition.agentId,
        reviewerVersion: securityReviewerAgentDefinition.version,
        capability: "review.security",
        policyVersion: SECURITY_REVIEW_POLICY_VERSION,
        promptVersion: this.provider.promptVersion,
        securitySurface: surface,
        semanticReviewSkipped,
        briefChecksum: input.briefChecksum,
        planningChecksum: input.planningChecksum,
        architectureReviewChecksum: input.architectureReviewChecksum,
        designChecksum: input.designChecksum,
        contractAuditChecksum: input.contractAuditChecksum,
        taskGraphChecksum: input.taskGraphChecksum,
        codeIntegrationReviewChecksum: input.codeIntegrationReviewChecksum,
        sourceChecksum: input.sourceChecksum,
        securityEvidenceChecksum: input.deterministicSecurityEvidence.checksum,
        evidenceCatalogId: evidenceCatalog.catalogId,
        evidenceCatalogChecksum: evidenceCatalogChecksum(evidenceCatalog),
        evidenceProvenance: normalized.provenance,
        resultChecksum: checksumPersistedDocument(result),
        result,
      });
      const priorRecord = await this.documents.get(
        input.projectId,
        input.projectVersion,
        "security-review",
      );
      const priorHistory = await this.documents.get(
        input.projectId,
        input.projectVersion,
        "security-review-history",
      );
      const records = [
        ...(priorHistory?.documentType === "security-review-history"
          ? priorHistory.records
          : []),
        ...(priorRecord?.documentType === "security-review"
          ? [SecurityReviewRecordSchema.parse(priorRecord)]
          : []),
        record,
      ];
      await this.documents.save(
        SecurityReviewHistorySchema.parse({
          schemaVersion: 1,
          documentType: "security-review-history",
          projectId: input.projectId,
          projectVersion: input.projectVersion,
          createdAt: records[0]!.createdAt,
          updatedAt: now(),
          records,
        }),
        `security-review-history:${input.idempotencyKey}`,
      );
      await this.documents.save(
        record,
        `security-review:${input.idempotencyKey}`,
      );
      this.idempotency.set(input.idempotencyKey, { inputHash, result });
      return result;
    } catch (error) {
      if (error instanceof SecurityReviewError) throw error;
      if (error instanceof z.ZodError)
        throw new SecurityReviewError(
          "SECURITY_REVIEW_OUTPUT_INVALID",
          "Security review output failed strict validation.",
          error,
        );
      throw new SecurityReviewError(
        "SECURITY_REVIEW_PROVIDER_FAILED",
        "Security review provider failed safely.",
        error,
      );
    }
  }
  async getCurrentReview(
    projectId: string,
    projectVersion: number,
    sourceChecksum: string,
    codeIntegrationReviewChecksum: string,
  ) {
    const document = await this.documents.get(
      projectId,
      projectVersion,
      "security-review",
    );
    if (!document || document.documentType !== "security-review") return null;
    const record = SecurityReviewRecordSchema.parse(document);
    return record.sourceChecksum === sourceChecksum &&
      record.codeIntegrationReviewChecksum === codeIntegrationReviewChecksum &&
      record.result.verdict === "APPROVED"
      ? record
      : null;
  }
  private normalize(raw: SecurityReviewProviderOutput, input: SecurityReviewInput, evidenceCatalog: ReturnType<typeof createReviewEvidenceCatalog>): { result: SecurityReviewResult; provenance: ReviewEvidenceProvenance[] } {
    const parsed = SecurityReviewProviderOutputSchema.parse(raw);
    let resolved: ReturnType<typeof resolveProviderReviewEvidence<typeof parsed.findings[number]>>;
    try {
      resolved = resolveProviderReviewEvidence<typeof parsed.findings[number]>(evidenceCatalog, parsed);
    } catch (error) {
      throw new SecurityReviewError(
        "SECURITY_REVIEW_OUTPUT_INVALID",
        "Security Review output referenced evidence outside the host-issued catalog.",
        error,
      );
    }
    const findings = parsed.findings.map((item, index) => {
      const resolvedItem = resolved.findings[index]!;
      if (
        (item.severity === "ERROR" || item.severity === "CRITICAL") &&
        item.correctionTarget === "IMPLEMENTATION_TASK" &&
        item.ownerTaskId &&
        !input.taskGraph.tasks.some((task) => task.id === item.ownerTaskId)
      )
        throw new SecurityReviewError(
          "SECURITY_REVIEW_OUTPUT_INVALID",
          "Finding owner task is not current TaskGraph ownership.",
        );
      return resolvedItem;
    });
    const result = SecurityReviewResultSchema.parse({ ...parsed, reviewedArtifactRefs: resolved.reviewedArtifactRefs, findings, policyVersion: SECURITY_REVIEW_POLICY_VERSION });
    if (
      result.verdict === "APPROVED" &&
      findings.some(
        (item) => item.severity === "ERROR" || item.severity === "CRITICAL",
      )
    )
      return { result: SecurityReviewResultSchema.parse({ ...result, verdict: "CHANGES_REQUIRED" }), provenance: resolved.provenance };
    return { result, provenance: resolved.provenance };
  }
}
