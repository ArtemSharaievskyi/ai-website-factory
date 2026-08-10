import { randomUUID } from "node:crypto";
import { z } from "zod";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import {
  DocumentRepository,
  ProjectRepository,
} from "@/persistence/database/repositories";
import type { PersistenceDatabase } from "@/persistence/database/types";
import {
  ArchitectureReviewHistorySchema,
  ArchitectureReviewProviderOutputSchema,
  ArchitectureReviewRecordSchema,
  ArchitectureReviewResultSchema,
  type ArchitectureReviewResult,
} from "@/domain/review/schema";
import { PlanningPackageSchema } from "@/agents/planner/contracts";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { validatePlanningStructure } from "@/agents/planner/deterministic";
import { architectureReviewerAgentDefinition } from "@/agents/catalog";
import { ArchitectureReviewError } from "./errors";
import {
  ARCHITECTURE_REVIEW_POLICY_VERSION,
  ArchitectureReviewInputSchema,
  type ArchitectureReviewInput,
} from "./contracts";
import { canonicalArchitectureEvidence } from "./deterministic";
import { DeterministicArchitectureReviewProvider } from "./deterministic";
import type { ArchitectureReviewProvider } from "./ports";
import type { ReviewerSkillSelection } from "@/skills/runtime/resolver";

const now = () => new Date().toISOString();
const exactFindingKey = (
  finding: ArchitectureReviewResult["findings"][number],
) => JSON.stringify(finding);

export type ArchitectureReviewServiceDependencies = {
  provider?: ArchitectureReviewProvider;
  resolveSkills?: (
    input: ArchitectureReviewInput,
  ) => Promise<ReviewerSkillSelection>;
};

export class ArchitectureReviewService {
  private readonly documents: DocumentRepository;
  private readonly projects: ProjectRepository;
  private readonly provider: ArchitectureReviewProvider;
  private readonly idempotency = new Map<
    string,
    { inputHash: string; result: ArchitectureReviewResult }
  >();
  private readonly correctionCycles = new Map<string, number>();
  private readonly resolveSkills?: ArchitectureReviewServiceDependencies["resolveSkills"];
  constructor(
    private readonly database: PersistenceDatabase,
    dependencies: ArchitectureReviewServiceDependencies = {},
  ) {
    this.documents = new DocumentRepository(database);
    this.projects = new ProjectRepository(database);
    this.provider =
      dependencies.provider ?? new DeterministicArchitectureReviewProvider();
    this.resolveSkills = dependencies.resolveSkills;
  }
  getAgentDefinition() {
    return architectureReviewerAgentDefinition;
  }
  getCorrectionCycle(projectId: string, projectVersion: number) {
    return this.correctionCycles.get(`${projectId}:${projectVersion}`) ?? 0;
  }
  assertCorrectionAvailable(projectId: string, projectVersion: number) {
    if (this.getCorrectionCycle(projectId, projectVersion) >= 2)
      throw new ArchitectureReviewError(
        "ARCHITECTURE_REVIEW_EXHAUSTED",
        "The maximum architecture review correction cycles has been reached.",
      );
  }
  recordCorrectionCycle(projectId: string, projectVersion: number) {
    this.assertCorrectionAvailable(projectId, projectVersion);
    const key = `${projectId}:${projectVersion}`;
    this.correctionCycles.set(key, (this.correctionCycles.get(key) ?? 0) + 1);
  }

  async review(
    rawInput: ArchitectureReviewInput,
    signal?: AbortSignal,
  ): Promise<ArchitectureReviewResult> {
    const input = this.parseAndPrecheck(rawInput);
    const project = await this.projects.getWithVersion(input.projectId);
    if (
      !project ||
      project.project.currentVersion !== input.projectVersion ||
      project.project.workflowState !== "ARCHITECTURE_REVIEW"
    )
      throw new ArchitectureReviewError(
        "ARCHITECTURE_REVIEW_WORKFLOW_INVALID",
        "Architecture review is only available in the ARCHITECTURE_REVIEW workflow stage.",
      );
    const skillSelection = this.resolveSkills
      ? await this.resolveSkills(input)
      : { contexts: [], identityChecksum: "none", selectedSkillIds: [], selectedSkillChecksums: [] };
    const inputHash = checksumPersistedDocument({
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      approvedBriefChecksum: input.approvedBriefChecksum,
      acceptedPlanningChecksum: input.acceptedPlanningChecksum,
      skillContextChecksum: skillSelection.identityChecksum,
      policyVersion: ARCHITECTURE_REVIEW_POLICY_VERSION,
      promptVersion: this.provider.promptVersion,
    });
    const prior = this.idempotency.get(input.idempotencyKey);
    if (prior) {
      if (prior.inputHash !== inputHash)
        throw new ArchitectureReviewError(
          "ARCHITECTURE_REVIEW_IDEMPOTENCY_CONFLICT",
          "Architecture review idempotency key was reused with different canonical inputs.",
        );
      return prior.result;
    }
    try {
      const providerResult = await this.provider.review(
        input,
        signal,
      skillSelection.contexts,
      skillSelection.identityChecksum,
      );
      const result = this.normalizeResult(providerResult, input);
      const record = ArchitectureReviewRecordSchema.parse({
        schemaVersion: 1,
        documentType: "architecture-review",
        projectId: input.projectId,
        projectVersion: input.projectVersion,
        createdAt: now(),
        updatedAt: now(),
        reviewId: randomUUID(),
        reviewerAgentId: architectureReviewerAgentDefinition.agentId,
        reviewerVersion: architectureReviewerAgentDefinition.version,
        capability: "review.architecture",
        policyVersion: ARCHITECTURE_REVIEW_POLICY_VERSION,
        promptVersion: this.provider.promptVersion,
        approvedBriefChecksum: input.approvedBriefChecksum,
        acceptedPlanningChecksum: input.acceptedPlanningChecksum,
        resultChecksum: checksumPersistedDocument(result),
        result,
      });
      const priorRecord = await this.documents.get(
        input.projectId,
        input.projectVersion,
        "architecture-review",
      );
      const priorHistory = await this.documents.get(
        input.projectId,
        input.projectVersion,
        "architecture-review-history",
      );
      const historicalRecords = [
        ...(priorHistory?.documentType === "architecture-review-history"
          ? priorHistory.records
          : []),
        ...(priorRecord?.documentType === "architecture-review"
          ? [ArchitectureReviewRecordSchema.parse(priorRecord)]
          : []),
        record,
      ];
      await this.documents.save(
        ArchitectureReviewHistorySchema.parse({
          schemaVersion: 1,
          documentType: "architecture-review-history",
          projectId: input.projectId,
          projectVersion: input.projectVersion,
          createdAt: historicalRecords[0]!.createdAt,
          updatedAt: now(),
          records: historicalRecords,
        }),
        `architecture-review-history:${input.idempotencyKey}`,
      );
      await this.documents.save(
        record,
        `architecture-review:${input.idempotencyKey}`,
      );
      this.idempotency.set(input.idempotencyKey, { inputHash, result });
      return result;
    } catch (error) {
      if (error instanceof ArchitectureReviewError) throw error;
      if (error instanceof z.ZodError)
        throw new ArchitectureReviewError(
          "ARCHITECTURE_REVIEW_OUTPUT_INVALID",
          "Architecture review output did not match the strict contract.",
          error,
        );
      throw new ArchitectureReviewError(
        "ARCHITECTURE_REVIEW_PROVIDER_FAILED",
        "Architecture review provider failed safely.",
        error,
      );
    }
  }

  async getCurrentReview(
    projectId: string,
    projectVersion: number,
    approvedBriefChecksum: string,
    acceptedPlanningChecksum: string,
  ) {
    const document = await this.documents.get(
      projectId,
      projectVersion,
      "architecture-review",
    );
    if (!document || document.documentType !== "architecture-review")
      return null;
    const record = ArchitectureReviewRecordSchema.parse(document);
    return record.approvedBriefChecksum === approvedBriefChecksum &&
      record.acceptedPlanningChecksum === acceptedPlanningChecksum &&
      record.result.verdict === "APPROVED"
      ? record
      : null;
  }

  private parseAndPrecheck(rawInput: ArchitectureReviewInput) {
    let input: ArchitectureReviewInput;
    try {
      input = ArchitectureReviewInputSchema.parse(rawInput);
    } catch (error) {
      throw new ArchitectureReviewError(
        "ARCHITECTURE_REVIEW_INPUT_INVALID",
        "Architecture review input did not match the strict contract.",
        error,
      );
    }
    try {
      const brief = RequirementSpecificationSchema.parse(input.approvedBrief);
      const planning = PlanningPackageSchema.parse(
        input.acceptedPlanningPackage,
      );
      if (
        Buffer.byteLength(JSON.stringify(input), "utf8") >
          architectureReviewerAgentDefinition.contextPolicy.maxBytes ||
        input.relevantProjectConstraints.length >
          architectureReviewerAgentDefinition.contextPolicy.maxItems
      )
        throw new Error(
          "Architecture review context exceeds its bounded policy.",
        );
      if (
        brief.projectId !== input.projectId ||
        planning.projectId !== input.projectId ||
        brief.projectVersion !== input.projectVersion ||
        planning.projectVersion !== input.projectVersion
      )
        throw new Error(
          "Canonical artifacts belong to a different project version.",
        );
      if (!brief.approval.approved || brief.briefStatus !== "approved")
        throw new Error("The approved Brief is not approved.");
      if (
        input.approvedBriefChecksum !== checksumPersistedDocument(brief) &&
        input.approvedBriefChecksum !==
          brief.approval.approvedRequirementsChecksum
      )
        throw new Error("The Brief checksum is stale.");
      if (!planning.accepted || !planning.architecture.acceptance.accepted)
        throw new Error("The PlanningPackage is not accepted.");
      if (
        input.acceptedPlanningChecksum !==
          checksumPersistedDocument(planning) &&
        input.acceptedPlanningChecksum !== planning.acceptance.checksum
      )
        throw new Error("The PlanningPackage checksum is stale.");
      if (
        planning.blockers.length ||
        brief.unresolvedItems.some((item) => item.blocking)
      )
        throw new Error(
          "Blocking canonical architecture items remain unresolved.",
        );
      if (validatePlanningStructure(planning).length)
        throw new Error("Planning structural validation failed.");
      if (
        input.factoryArchitecturePolicy.stack.length !== 15 ||
        input.factoryArchitecturePolicy.packageManager !== "npm"
      )
        throw new Error("The fixed Factory architecture policy is invalid.");
      return input;
    } catch (error) {
      throw new ArchitectureReviewError(
        "ARCHITECTURE_REVIEW_BLOCKED",
        error instanceof Error
          ? error.message
          : "Canonical architecture evidence is not reviewable.",
        error,
      );
    }
  }

  private normalizeResult(
    raw: ArchitectureReviewResult,
    input: ArchitectureReviewInput,
  ): ArchitectureReviewResult {
    let parsed: ArchitectureReviewResult;
    try {
      parsed = ArchitectureReviewProviderOutputSchema.parse(
        raw,
      ) as ArchitectureReviewResult;
    } catch (error) {
      throw new ArchitectureReviewError(
        "ARCHITECTURE_REVIEW_OUTPUT_INVALID",
        "Architecture review output failed schema validation.",
        error,
      );
    }
    if (parsed.policyVersion !== ARCHITECTURE_REVIEW_POLICY_VERSION)
      throw new ArchitectureReviewError(
        "ARCHITECTURE_REVIEW_OUTPUT_INVALID",
        "Architecture review policy version is stale.",
      );
    const evidence = canonicalArchitectureEvidence(input);
    for (const reference of parsed.reviewedArtifactRefs)
      if (!evidence.has(reference))
        throw new ArchitectureReviewError(
          "ARCHITECTURE_REVIEW_OUTPUT_INVALID",
          `Review references invented evidence: ${reference}.`,
        );
    const deduped = [];
    const seenExact = new Set<string>();
    const seenIds = new Set<string>();
    for (const item of parsed.findings) {
      if (seenIds.has(item.findingId)) {
        if (!seenExact.has(exactFindingKey(item)))
          throw new ArchitectureReviewError(
            "ARCHITECTURE_REVIEW_OUTPUT_INVALID",
            `Finding ID is reused with different content: ${item.findingId}.`,
          );
        continue;
      }
      for (const reference of [...item.evidenceRefs, ...item.affectedArtifacts])
        if (!evidence.has(reference))
          throw new ArchitectureReviewError(
            "ARCHITECTURE_REVIEW_OUTPUT_INVALID",
            `Finding references invented evidence: ${reference}.`,
          );
      seenIds.add(item.findingId);
      seenExact.add(exactFindingKey(item));
      deduped.push(item);
    }
    const blocking = deduped.some(
      (item) => item.severity === "ERROR" || item.severity === "CRITICAL",
    );
    if (parsed.verdict === "APPROVED" && blocking)
      parsed = { ...parsed, verdict: "CHANGES_REQUIRED" };
    if (parsed.verdict === "CHANGES_REQUIRED" && deduped.length === 0)
      throw new ArchitectureReviewError(
        "ARCHITECTURE_REVIEW_OUTPUT_INVALID",
        "CHANGES_REQUIRED requires findings.",
      );
    return ArchitectureReviewResultSchema.parse({
      ...parsed,
      findings: deduped,
    });
  }
}
