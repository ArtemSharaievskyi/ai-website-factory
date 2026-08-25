import { BriefV3DocumentSchema } from "@/persistence/database/brief-revision-v3-contracts";
import { mapRowToDocument, type DocumentRow } from "@/persistence/database/mapping";
import type { PersistenceTransaction } from "@/persistence/database/types";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { PlanningPackageSchema } from "@/agents/planner/contracts";
import { planningSemanticChecksum } from "@/agents/planner/deterministic";
import { RequirementSpecificationSchema } from "@/domain/requirements/schema";
import type { ArchitectureReviewInput } from "./contracts";
import { ArchitectureReviewError } from "./errors";

export type CanonicalReviewContext = {
  project: NonNullable<Awaited<ReturnType<PersistenceTransaction["getProject"]>>>;
  version: NonNullable<Awaited<ReturnType<PersistenceTransaction["getVersion"]>>>;
  planningRowVersion: number;
  architectureChecksum: string;
  phase7cChecksum: string;
  reviewRow: DocumentRow | null;
  historyRow: DocumentRow | null;
};

export async function readCanonicalReviewContext(
  tx: PersistenceTransaction,
  input: ArchitectureReviewInput,
): Promise<CanonicalReviewContext> {
  const project = await tx.getProject(input.projectId);
  const version = await tx.getVersion(input.projectId, input.projectVersion);
  if (!project || !version || version.immutable)
    throw new ArchitectureReviewError(
      "ARCHITECTURE_REVIEW_STALE",
      "The current Architecture Review project version is unavailable or immutable.",
    );

  const v3BriefRow = await tx.getDocument(input.projectId, input.projectVersion, "brief-v3");
  const legacyBriefRow = await tx.getDocument(input.projectId, input.projectVersion, "requirements");
  if (v3BriefRow) {
    const brief = BriefV3DocumentSchema.parse(mapRowToDocument(v3BriefRow));
    if (
      !brief.approval?.approved ||
      brief.approval.approvedCanonicalChecksum !== brief.briefChecksum ||
      input.approvedBriefChecksum !== brief.briefChecksum ||
      (input.canonicalBrief && canonicalBriefChecksum(input.canonicalBrief) !== brief.briefChecksum)
    )
      throw new ArchitectureReviewError(
        "ARCHITECTURE_REVIEW_STALE",
        "The approved Brief is stale at Architecture Review commit.",
      );
  } else if (legacyBriefRow) {
    const brief = RequirementSpecificationSchema.parse(mapRowToDocument(legacyBriefRow));
    if (
      !brief.approval.approved ||
      brief.briefStatus !== "approved" ||
      (input.approvedBriefChecksum !== legacyBriefRow.checksum &&
        input.approvedBriefChecksum !== brief.approval.approvedRequirementsChecksum)
    )
      throw new ArchitectureReviewError(
        "ARCHITECTURE_REVIEW_STALE",
        "The approved Brief is stale at Architecture Review commit.",
      );
  } else {
    throw new ArchitectureReviewError(
      "ARCHITECTURE_REVIEW_STALE",
      "The approved Brief is missing at Architecture Review commit.",
    );
  }

  const planningRow = await tx.getDocument(input.projectId, input.projectVersion, "planning-package");
  const expectedPlanningDocumentChecksum = input.acceptedPlanningChecksum;
  if (!planningRow || planningRow.checksum !== expectedPlanningDocumentChecksum)
    throw new ArchitectureReviewError(
      "ARCHITECTURE_REVIEW_STALE",
      "The accepted PlanningPackage is stale at Architecture Review commit.",
    );
  const planning = PlanningPackageSchema.parse(mapRowToDocument(planningRow));
  const currentPlanningSemanticChecksum = planningSemanticChecksum(planning);
  if (
    checksumPersistedDocument(input.acceptedPlanningPackage) !== planningRow.checksum ||
    !planning.accepted ||
    !planning.architecture.acceptance.accepted
  )
    throw new ArchitectureReviewError(
      "ARCHITECTURE_REVIEW_STALE",
      "The accepted PlanningPackage is not the current canonical package.",
    );

  const architectureRow = await tx.getDocument(input.projectId, input.projectVersion, "architecture");
  if (!architectureRow)
    throw new ArchitectureReviewError(
      "ARCHITECTURE_REVIEW_STALE",
      "The current Architecture document is missing.",
    );
  const architecture = mapRowToDocument(architectureRow);
  if (
    architecture.documentType !== "architecture" ||
    !architecture.acceptance.accepted ||
    architectureRow.checksum !== checksumPersistedDocument(architecture) ||
    checksumPersistedDocument(input.acceptedPlanningPackage.architecture) !== architectureRow.checksum
  )
    throw new ArchitectureReviewError(
      "ARCHITECTURE_REVIEW_STALE",
      "The Architecture document is stale at Architecture Review commit.",
    );

  const phase7cRow = await tx.getDocument(input.projectId, input.projectVersion, "phase-7c-contract-package");
  if (!phase7cRow)
    throw new ArchitectureReviewError(
      "ARCHITECTURE_REVIEW_STALE",
      "The current Phase 7C contract package is missing.",
    );
  const phase7c = mapRowToDocument(phase7cRow);
  if (phase7c.documentType !== "phase-7c-contract-package")
    throw new ArchitectureReviewError(
      "ARCHITECTURE_REVIEW_STALE",
      "The current Phase 7C contract package is stale at Architecture Review commit.",
    );
  const phase7cPlanningSemanticChecksum = phase7c.planningChecksum;
  if (
    phase7c.approvedBriefChecksum !== input.approvedBriefChecksum ||
    phase7cPlanningSemanticChecksum !== currentPlanningSemanticChecksum ||
    phase7c.currentness.derivedFromChecksum !== currentPlanningSemanticChecksum ||
    phase7c.architectureChecksum !== architectureRow.checksum ||
    phase7c.currentness.status !== "CURRENT" ||
    phase7cRow.checksum !== checksumPersistedDocument(phase7c)
  )
    throw new ArchitectureReviewError(
      "ARCHITECTURE_REVIEW_STALE",
      "The Phase 7C contract package is stale at Architecture Review commit.",
    );

  return {
    project,
    version,
    planningRowVersion: planningRow.rowVersion,
    architectureChecksum: architectureRow.checksum,
    phase7cChecksum: phase7cRow.checksum,
    reviewRow: await tx.getDocument(input.projectId, input.projectVersion, "architecture-review"),
    historyRow: await tx.getDocument(input.projectId, input.projectVersion, "architecture-review-history"),
  };
}
