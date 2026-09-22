import type { BriefChangeSet } from "@/domain/requirements/v3/changeset";
import type { CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import type { ProjectMemorySyncPort } from "@/persistence/database/sync";
import type { ContextPriority } from "@/runtime/context/contracts";

export type BriefV3AssetBinding = {
  target: "ASSET_COMPANY_LOGO";
  assetId: string;
  sha256: string;
};
export type BriefV3SupportingContext = { sourceRef: string; content: string; selectionReason: string; priority: ContextPriority };
export type BriefV3ProviderInput = { revisionInstruction: string; currentCanonicalV3: CanonicalBriefV3; supportingContext?: readonly BriefV3SupportingContext[]; newRequirementHandles?: readonly string[] };
export type BriefV3RevisionProvider = { proposeChanges(input: BriefV3ProviderInput): Promise<BriefChangeSet> };
export type BriefV3ProjectionPort = ProjectMemorySyncPort;
