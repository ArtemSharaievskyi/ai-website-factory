import { randomUUID } from "node:crypto";
import { z } from "zod";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import {
  appendDecisionInTransaction,
  saveDocumentCASInTransaction,
  transitionWorkflowInTransaction,
  DecisionRepository,
} from "@/persistence/database/repositories";
import type { PersistenceDatabase } from "@/persistence/database/types";
import { mapRowToDocument } from "@/persistence/database/mapping";
import type { ProjectMemorySyncPort } from "@/persistence/database/sync";
import {
  ArchitectureReviewHistorySchema,
  ArchitectureReviewRecordSchema,
  ArchitectureReviewResultSchema,
  type ArchitectureReviewResult,
} from "@/domain/review/schema";
import { architectureReviewerAgentDefinition } from "@/agents/catalog";
import {
  ARCHITECTURE_REVIEW_POLICY_VERSION,
  ArchitectureReviewInputSchema,
  type ArchitectureReviewInput,
} from "@/agents/reviewers/architecture/contracts";
import { ArchitectureReviewError, rethrowWrappedArchitectureReviewError } from "@/agents/reviewers/architecture/errors";
import type { ArchitectureReviewProposal } from "@/agents/reviewers/architecture/service";
import { readCanonicalReviewContext, type CanonicalReviewContext } from "@/agents/reviewers/architecture/currentness";

const now = () => new Date().toISOString();

export type ArchitectureReviewFaultPoint =
  | "after-review-result-write"
  | "after-review-history-write"
  | "after-decision-write"
  | "before-workflow-transition";

export type ArchitectureReviewFaultInjector = {
  hit(point: ArchitectureReviewFaultPoint): void | Promise<void>;
};

export type ArchitectureReviewCanonicalCommitDependencies = {
  projection?: ProjectMemorySyncPort;
  faultInjector?: ArchitectureReviewFaultInjector;
  policyVersion?: () => string;
};

export type ArchitectureReviewCommitResult = {
  result: ArchitectureReviewResult;
  projectState: "ARCHITECTURE_REVIEW" | "AWAITING_DESIGN_SELECTION";
  rowVersion: number;
  projectionStatus: "SYNCED" | "UNAVAILABLE" | "REPLAYED";
};

export class ArchitectureReviewCanonicalCommitService {
  private readonly decisions: DecisionRepository;
  private readonly projection?: ProjectMemorySyncPort;
  private readonly faultInjector?: ArchitectureReviewFaultInjector;
  private readonly policyVersion: () => string;

  constructor(
    private readonly database: PersistenceDatabase,
    dependencies: ArchitectureReviewCanonicalCommitDependencies = {},
  ) {
    this.decisions = new DecisionRepository(database);
    this.projection = dependencies.projection;
    this.faultInjector = dependencies.faultInjector;
    this.policyVersion = dependencies.policyVersion ?? (() => ARCHITECTURE_REVIEW_POLICY_VERSION);
  }

  async commit(
    rawInput: ArchitectureReviewInput,
    proposal: ArchitectureReviewProposal,
  ): Promise<ArchitectureReviewCommitResult> {
    const input = this.parseInput(rawInput);
    const result = ArchitectureReviewResultSchema.parse({
      ...proposal.result,
      policyVersion: proposal.policyVersion,
    });
    const inputHash = this.reviewInputIdentity(input, proposal);
    if (inputHash !== proposal.inputHash)
      throw new ArchitectureReviewError(
        "ARCHITECTURE_REVIEW_IDEMPOTENCY_CONFLICT",
        "The Architecture Review proposal is not bound to the supplied canonical inputs.",
      );
    if (proposal.promptVersion !== architectureReviewerAgentDefinition.promptVersion)
      throw new ArchitectureReviewError(
        "ARCHITECTURE_REVIEW_STALE",
        "The Architecture Review provider prompt identity is stale.",
      );

    const committed = await this.database.transaction(async (tx) => {
      const canonical = await readCanonicalReviewContext(tx, input);
      if (proposal.versionRowVersion !== canonical.version.rowVersion)
        throw new ArchitectureReviewError(
          "ARCHITECTURE_REVIEW_STALE",
          "The Architecture Review project-version row is stale.",
        );
      if (proposal.planningRowVersion !== canonical.planningRowVersion)
        throw new ArchitectureReviewError(
          "ARCHITECTURE_REVIEW_STALE",
          "The accepted PlanningPackage row is stale.",
        );
      if (proposal.policyVersion !== this.policyVersion())
        throw new ArchitectureReviewError(
          "ARCHITECTURE_REVIEW_STALE",
          "The Architecture Review policy changed after provider context was captured.",
        );
      const replay = this.replayResult(canonical, input, proposal.inputHash);
      if (replay) {
        if (JSON.stringify(replay) !== JSON.stringify(result))
          throw new ArchitectureReviewError(
            "ARCHITECTURE_REVIEW_IDEMPOTENCY_CONFLICT",
            "The Architecture Review idempotency identity already has a different result.",
          );
        if (!canonical.project)
          throw new ArchitectureReviewError(
            "ARCHITECTURE_REVIEW_WORKFLOW_INVALID",
            "The Architecture Review project was not found.",
          );
        return {
          result: replay,
          projectState: canonical.project.workflow_state === "AWAITING_DESIGN_SELECTION"
            ? ("AWAITING_DESIGN_SELECTION" as const)
            : ("ARCHITECTURE_REVIEW" as const),
          rowVersion: canonical.project.row_version,
          decision: null,
          replay: true as const,
        };
      }
      if (
        proposal.architectureChecksum !== canonical.architectureChecksum ||
        proposal.phase7cChecksum !== canonical.phase7cChecksum
      )
        throw new ArchitectureReviewError(
          "ARCHITECTURE_REVIEW_STALE",
          "A reviewed Architecture or Phase 7C artifact changed before commit.",
        );
      if (
        !canonical.project ||
        canonical.project.current_version !== input.projectVersion
      )
        throw new ArchitectureReviewError(
          "ARCHITECTURE_REVIEW_STALE",
          "The Architecture Review project version is stale.",
        );
      if (canonical.project.workflow_state !== "ARCHITECTURE_REVIEW")
        throw new ArchitectureReviewError(
          "ARCHITECTURE_REVIEW_WORKFLOW_INVALID",
          "Architecture review is only available in the ARCHITECTURE_REVIEW workflow stage.",
        );
      if (canonical.project.row_version !== input.expectedRowVersion)
        throw new ArchitectureReviewError(
          "ARCHITECTURE_REVIEW_STALE",
          "The Architecture Review workflow row version is stale.",
        );

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
        policyVersion: proposal.policyVersion,
        promptVersion: proposal.promptVersion,
        reviewInputChecksum: proposal.inputHash,
        approvedBriefChecksum: input.approvedBriefChecksum,
        acceptedPlanningChecksum: input.acceptedPlanningChecksum,
        architectureChecksum: canonical.architectureChecksum,
        phase7cChecksum: canonical.phase7cChecksum,
        resultChecksum: checksumPersistedDocument(result),
        result,
      });
      const priorRecord = canonical.reviewRow
        ? ArchitectureReviewRecordSchema.parse(mapRowToDocument(canonical.reviewRow))
        : null;
      const priorHistory = canonical.historyRow
        ? ArchitectureReviewHistorySchema.parse(mapRowToDocument(canonical.historyRow))
        : null;
      const recordsById = new Map<string, typeof record>(
        [...(priorHistory?.records ?? []), ...(priorRecord ? [priorRecord] : []), record].map(
          (candidate) => [candidate.reviewId, candidate],
        ),
      );
      const history = ArchitectureReviewHistorySchema.parse({
        schemaVersion: 1,
        documentType: "architecture-review-history",
        projectId: input.projectId,
        projectVersion: input.projectVersion,
        createdAt: [...recordsById.values()][0]!.createdAt,
        updatedAt: now(),
        records: [...recordsById.values()],
      });
      await saveDocumentCASInTransaction(
        tx,
        record,
        canonical.reviewRow?.rowVersion ?? null,
        canonical.reviewRow?.checksum ?? null,
      );
      await this.faultInjector?.hit("after-review-result-write");
      await saveDocumentCASInTransaction(
        tx,
        history,
        canonical.historyRow?.rowVersion ?? null,
        canonical.historyRow?.checksum ?? null,
      );
      await this.faultInjector?.hit("after-review-history-write");
      const decision = this.reviewDecision(record);
      await appendDecisionInTransaction(tx, input.projectId, input.projectVersion, decision);
      await this.faultInjector?.hit("after-decision-write");
      if (result.verdict !== "APPROVED")
        return {
          result,
          projectState: "ARCHITECTURE_REVIEW" as const,
          rowVersion: canonical.project.row_version,
          decision,
          replay: false as const,
        };
      await this.faultInjector?.hit("before-workflow-transition");
      const transition = await transitionWorkflowInTransaction(tx, {
        projectId: input.projectId,
        projectVersion: input.projectVersion,
        expectedState: "ARCHITECTURE_REVIEW",
        expectedRowVersion: input.expectedRowVersion,
        targetState: "AWAITING_DESIGN_SELECTION",
        actor: "architecture-reviewer",
        reason: "Architecture Review approved; Design is now eligible.",
        idempotencyKey: `${input.idempotencyKey}:approved`,
      });
      return {
        result,
        projectState: "AWAITING_DESIGN_SELECTION" as const,
        rowVersion: transition.rowVersion,
        decision,
        replay: false as const,
      };
    }).catch((error) => rethrowWrappedArchitectureReviewError(error));
    if (committed.replay)
      return {
        result: committed.result,
        projectState: committed.projectState,
        rowVersion: committed.rowVersion,
        projectionStatus: "REPLAYED",
      };
    if (!this.projection)
      return {
        result: committed.result,
        projectState: committed.projectState,
        rowVersion: committed.rowVersion,
        projectionStatus: "UNAVAILABLE",
      };
    try {
      await this.projection.appendDecision(
        input.projectId,
        input.projectVersion,
        committed.decision,
      );
    } catch (error) {
      throw new ArchitectureReviewError(
        "ARCHITECTURE_REVIEW_PROJECTION_FAILED",
        "Architecture Review committed, but its derived Project Memory decision projection failed.",
        error,
      );
    }
    return {
      result: committed.result,
      projectState: committed.projectState,
      rowVersion: committed.rowVersion,
      projectionStatus: "SYNCED",
    };
  }

  async reconcileArchitectureReviewProjection(projectId: string, projectVersion: number) {
    if (!this.projection)
      return { projectionStatus: "UNAVAILABLE" as const, decisionCount: 0 };
    const decisions = (await this.decisions.list(projectId, projectVersion)).filter(
      (decision) => decision.category === "architecture-review",
    );
    for (const decision of decisions)
      await this.projection.appendDecision(projectId, projectVersion, decision);
    return { projectionStatus: "SYNCED" as const, decisionCount: decisions.length };
  }

  private parseInput(rawInput: ArchitectureReviewInput) {
    try {
      return ArchitectureReviewInputSchema.parse(rawInput);
    } catch (error) {
      throw new ArchitectureReviewError(
        "ARCHITECTURE_REVIEW_INPUT_INVALID",
        "Architecture review input did not match the strict contract.",
        error,
      );
    }
  }

  private reviewInputIdentity(
    input: ArchitectureReviewInput,
    proposal: ArchitectureReviewProposal,
  ) {
    return checksumPersistedDocument({
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      approvedBriefChecksum: input.approvedBriefChecksum,
      acceptedPlanningChecksum: input.acceptedPlanningChecksum,
      factoryArchitecturePolicy: input.factoryArchitecturePolicy,
      relevantProjectConstraints: input.relevantProjectConstraints,
      skillContextChecksum: proposal.skillContextChecksum,
      policyVersion: proposal.policyVersion,
      promptVersion: proposal.promptVersion,
    });
  }

  private replayResult(
    canonical: CanonicalReviewContext,
    input: ArchitectureReviewInput,
    inputHash: string,
  ) {
    if (!canonical.reviewRow) return null;
    const record = ArchitectureReviewRecordSchema.parse(mapRowToDocument(canonical.reviewRow));
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

  private reviewDecision(record: z.infer<typeof ArchitectureReviewRecordSchema>) {
    const outcome = record.result.verdict === "APPROVED"
      ? "approved; Design is now eligible"
      : record.result.verdict === "CHANGES_REQUIRED"
        ? "requires bounded Planning correction"
        : "blocked pending canonical evidence repair";
    const findingSummary = record.result.findings
      .slice(0, 5)
      .map((finding) => finding.summary)
      .join(" ");
    return {
      id: randomUUID(),
      timestamp: record.updatedAt,
      actorType: "agent" as const,
      actorIdentifier: "architecture-reviewer",
      category: "architecture-review",
      decision: `Architecture Review ${record.reviewId} ${outcome}.`,
      rationale: record.result.blockedReason ??
        (findingSummary || "The typed Architecture Review result was committed by the host."),
      affectedDocuments: [
        "brief-v3.json",
        "planning-package.json",
        "architecture.json",
        "phase-7c-contract-package.json",
        "architecture-review.json",
        "architecture-review-history.json",
      ],
      requirementChange: false,
      userApprovalRequired: false,
      userApprovalStatus: "not-required" as const,
    };
  }
}
