import { z } from "zod";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { DocumentRepository } from "@/persistence/database/repositories";
import type { PersistenceDatabase } from "@/persistence/database/types";
import { mapRowToDocument } from "@/persistence/database/mapping";
import {
  ArchitectureReviewProviderOutputSchema,
  ArchitectureReviewRecordSchema,
  ArchitectureReviewResultSchema,
  type ArchitectureReviewProviderOutput,
  type ArchitectureReviewResult,
  type ReviewEvidenceProvenance,
} from "@/domain/review/schema";
import { PlanningPackageSchema } from "@/agents/planner/contracts";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import { canonicalBriefToPlannerBrief } from "@/agents/planner/brief-context";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { evaluatePlanningAcceptanceReadiness, validatePlanningStructure } from "@/agents/planner/deterministic";
import { architectureReviewerAgentDefinition } from "@/agents/catalog";
import { ArchitectureReviewError, rethrowWrappedArchitectureReviewError } from "./errors";
import {
  ARCHITECTURE_REVIEW_POLICY_VERSION,
  ArchitectureReviewInputSchema,
  type ArchitectureReviewInput,
} from "./contracts";
import { canonicalArchitectureEvidence } from "./deterministic";
import { DeterministicArchitectureReviewProvider } from "./deterministic";
import type { ArchitectureReviewProvider } from "./ports";
import type { ReviewerSkillSelection } from "@/skills/runtime/resolver";
import { readCanonicalReviewContext, type CanonicalReviewContext } from "./currentness";
import {
  createReviewEvidenceCatalog,
  evidenceCatalogChecksum,
  providerEvidenceCatalog,
  resolveProviderReviewEvidence,
  type ProviderReviewEvidenceCatalog,
} from "../evidence";

export type ArchitectureReviewServiceDependencies = {
  provider?: ArchitectureReviewProvider;
  policyVersion?: () => string;
  resolveSkills?: (
    input: ArchitectureReviewInput,
  ) => Promise<ReviewerSkillSelection>;
};

export type ArchitectureReviewProposal = {
  result: ArchitectureReviewResult;
  inputHash: string;
  promptVersion: string;
  skillContextChecksum: string;
  versionRowVersion: number;
  planningRowVersion: number;
  architectureChecksum: string;
  phase7cChecksum: string;
  policyVersion: string;
  evidenceCatalogId?: string;
  evidenceCatalogChecksum?: string;
  evidenceProvenance?: ReviewEvidenceProvenance[];
};

export class ArchitectureReviewService {
  private readonly documents: DocumentRepository;
  private readonly provider: ArchitectureReviewProvider;
  private readonly idempotency = new Map<
    string,
    { inputHash: string; proposal: ArchitectureReviewProposal }
  >();
  private readonly correctionCycles = new Map<string, number>();
  private readonly resolveSkills?: ArchitectureReviewServiceDependencies["resolveSkills"];
  private readonly policyVersion: () => string;

  constructor(
    private readonly database: PersistenceDatabase,
    dependencies: ArchitectureReviewServiceDependencies = {},
  ) {
    this.documents = new DocumentRepository(database);
    this.provider = dependencies.provider ?? new DeterministicArchitectureReviewProvider();
    this.resolveSkills = dependencies.resolveSkills;
    this.policyVersion = dependencies.policyVersion ?? (() => ARCHITECTURE_REVIEW_POLICY_VERSION);
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

  async reviewProposal(
    rawInput: ArchitectureReviewInput,
    signal?: AbortSignal,
  ): Promise<ArchitectureReviewProposal> {
    const input = this.parseAndPrecheck(rawInput);
    const evidenceCatalog = createReviewEvidenceCatalog({
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      evidenceRefs: canonicalArchitectureEvidence(input),
      requestContext: input,
    });
    const providerInput = { ...input, evidenceCatalog: providerEvidenceCatalog(evidenceCatalog) };
    const policyVersion = this.policyVersion();
    const skillSelection = this.resolveSkills
      ? await this.resolveSkills(input)
      : { contexts: [], identityChecksum: "none", selectedSkillIds: [], selectedSkillChecksums: [] };
    const inputHash = checksumPersistedDocument({
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      approvedBriefChecksum: input.approvedBriefChecksum,
      acceptedPlanningChecksum: input.acceptedPlanningChecksum,
      factoryArchitecturePolicy: input.factoryArchitecturePolicy,
      relevantProjectConstraints: input.relevantProjectConstraints,
      evidenceCatalogChecksum: evidenceCatalogChecksum(evidenceCatalog),
      skillContextChecksum: skillSelection.identityChecksum,
      policyVersion,
      promptVersion: this.provider.promptVersion,
    });
    let canonical: CanonicalReviewContext;
    try {
      canonical = await this.database.transaction((tx) =>
        readCanonicalReviewContext(tx, input),
      );
    } catch (error) {
      rethrowWrappedArchitectureReviewError(error);
    }
    const prior = this.idempotency.get(input.idempotencyKey);
    if (prior) {
      if (prior.inputHash !== inputHash)
        throw new ArchitectureReviewError(
          "ARCHITECTURE_REVIEW_IDEMPOTENCY_CONFLICT",
          "Architecture review idempotency key was reused with different canonical inputs.",
        );
      return prior.proposal;
    }
    const replay = this.replayResult(canonical, input, inputHash);
    if (replay) {
      const proposal = {
        result: replay,
        inputHash,
        promptVersion: this.provider.promptVersion,
        skillContextChecksum: skillSelection.identityChecksum,
        versionRowVersion: canonical.version.rowVersion,
        planningRowVersion: canonical.planningRowVersion,
        architectureChecksum: canonical.architectureChecksum,
        phase7cChecksum: canonical.phase7cChecksum,
        policyVersion: replay.policyVersion,
        evidenceCatalogId: evidenceCatalog.catalogId,
        evidenceCatalogChecksum: evidenceCatalogChecksum(evidenceCatalog),
      } satisfies ArchitectureReviewProposal;
      this.idempotency.set(input.idempotencyKey, { inputHash, proposal });
      return proposal;
    }
    if (
      !canonical.project ||
      canonical.project.current_version !== input.projectVersion ||
      canonical.project.workflow_state !== "ARCHITECTURE_REVIEW"
    )
      throw new ArchitectureReviewError(
        "ARCHITECTURE_REVIEW_WORKFLOW_INVALID",
        "Architecture review is only available in the ARCHITECTURE_REVIEW workflow stage.",
      );
    try {
      const providerResult = await this.provider.review(
        providerInput,
        signal,
        skillSelection.contexts,
        skillSelection.identityChecksum,
      );
      const normalized = this.normalizeResult(providerResult, input, policyVersion, evidenceCatalog);
      const proposal = {
        result: normalized.result,
        inputHash,
        promptVersion: this.provider.promptVersion,
        skillContextChecksum: skillSelection.identityChecksum,
        versionRowVersion: canonical.version.rowVersion,
        planningRowVersion: canonical.planningRowVersion,
        architectureChecksum: canonical.architectureChecksum,
        phase7cChecksum: canonical.phase7cChecksum,
        policyVersion,
        evidenceCatalogId: evidenceCatalog.catalogId,
        evidenceCatalogChecksum: evidenceCatalogChecksum(evidenceCatalog),
        evidenceProvenance: normalized.provenance,
      } satisfies ArchitectureReviewProposal;
      this.idempotency.set(input.idempotencyKey, { inputHash, proposal });
      return proposal;
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

  async review(
    rawInput: ArchitectureReviewInput,
    signal?: AbortSignal,
  ): Promise<ArchitectureReviewResult> {
    return (await this.reviewProposal(rawInput, signal)).result;
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

  private replayResult(
    canonical: CanonicalReviewContext,
    input: ArchitectureReviewInput,
    inputHash: string,
  ) {
    if (!canonical.reviewRow) return null;
    const record = ArchitectureReviewRecordSchema.parse(
      mapRowToDocument(canonical.reviewRow),
    );
    if (
      record.projectId !== input.projectId ||
      record.projectVersion !== input.projectVersion ||
      record.reviewInputChecksum !== inputHash ||
      record.approvedBriefChecksum !== input.approvedBriefChecksum ||
      record.acceptedPlanningChecksum !== input.acceptedPlanningChecksum ||
      record.architectureChecksum !== canonical.architectureChecksum ||
      record.phase7cChecksum !== canonical.phase7cChecksum
    )
      return null;
    return record.result;
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
      const brief = input.canonicalBrief
        ? canonicalBriefToPlannerBrief(input.canonicalBrief, RequirementSpecificationSchema.parse(input.approvedBrief))
        : RequirementSpecificationSchema.parse(input.approvedBrief);
      const planning = PlanningPackageSchema.parse(input.acceptedPlanningPackage);
      if (
        Buffer.byteLength(JSON.stringify(input), "utf8") >
          architectureReviewerAgentDefinition.contextPolicy.maxBytes ||
        input.relevantProjectConstraints.length >
          architectureReviewerAgentDefinition.contextPolicy.maxItems
      )
        throw new Error("Architecture review context exceeds its bounded policy.");
      if (
        brief.projectId !== input.projectId ||
        planning.projectId !== input.projectId ||
        brief.projectVersion !== input.projectVersion ||
        planning.projectVersion !== input.projectVersion
      )
        throw new Error("Canonical artifacts belong to a different project version.");
      if (!brief.approval.approved || brief.briefStatus !== "approved")
        throw new Error("The approved Brief is not approved.");
      if (
        input.approvedBriefChecksum !== checksumPersistedDocument(brief) &&
        input.approvedBriefChecksum !== brief.approval.approvedRequirementsChecksum
      )
        throw new Error("The Brief checksum is stale.");
      if (!planning.accepted || !planning.architecture.acceptance.accepted)
        throw new Error("The PlanningPackage is not accepted.");
      if (
        input.acceptedPlanningChecksum !== checksumPersistedDocument(planning) &&
        input.acceptedPlanningChecksum !== planning.acceptance.checksum
      )
        throw new Error("The PlanningPackage checksum is stale.");
      const canonicalContext = input.canonicalBrief && canonicalBriefChecksum(input.canonicalBrief) === input.approvedBriefChecksum
        ? { legalPlaceholderPolicy: input.canonicalBrief.legal.placeholderPolicy, canonicalBrief: input.canonicalBrief }
        : undefined;
      if (
        !evaluatePlanningAcceptanceReadiness({ planningPackage: planning, context: canonicalContext }).readyForAcceptance ||
        brief.unresolvedItems.some((item) => item.blocking)
      )
        throw new Error("Blocking canonical architecture items remain unresolved.");
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
    raw: ArchitectureReviewProviderOutput,
    input: ArchitectureReviewInput,
    policyVersion: string,
    evidenceCatalog: ProviderReviewEvidenceCatalog,
  ): { result: ArchitectureReviewResult; provenance: ReviewEvidenceProvenance[] } {
    let parsed: ArchitectureReviewProviderOutput;
    try {
      parsed = ArchitectureReviewProviderOutputSchema.parse(raw);
    } catch (error) {
      throw new ArchitectureReviewError(
        "ARCHITECTURE_REVIEW_OUTPUT_INVALID",
        "Architecture review output failed schema validation.",
        error,
      );
    }
    let resolved: ReturnType<typeof resolveProviderReviewEvidence<typeof parsed.findings[number]>>;
    try {
      resolved = resolveProviderReviewEvidence<typeof parsed.findings[number]>(evidenceCatalog, parsed);
    } catch (error) {
      throw new ArchitectureReviewError(
        "ARCHITECTURE_REVIEW_OUTPUT_INVALID",
        "Architecture Review output referenced evidence outside the host-issued catalog.",
        error,
      );
    }
    const deduped: ArchitectureReviewResult["findings"] = [];
    const seenExact = new Set<string>();
    const seenIds = new Set<string>();
    for (const [index, item] of parsed.findings.entries()) {
      const resolvedItem = resolved.findings[index]!;
      const exact = JSON.stringify(resolvedItem);
      if (seenIds.has(item.findingId)) {
        if (!seenExact.has(exact))
          throw new ArchitectureReviewError(
            "ARCHITECTURE_REVIEW_OUTPUT_INVALID",
            `Finding ID is reused with different content: ${item.findingId}.`,
          );
        continue;
      }
      seenIds.add(item.findingId);
      seenExact.add(exact);
      deduped.push(resolvedItem);
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
    return {
      result: ArchitectureReviewResultSchema.parse({
        ...parsed,
        reviewedArtifactRefs: resolved.reviewedArtifactRefs,
        findings: deduped,
        policyVersion,
      }),
      provenance: resolved.provenance,
    };
  }
}
