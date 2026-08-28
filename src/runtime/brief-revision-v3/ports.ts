import type { BriefChangeSet } from "@/domain/requirements/v3/changeset";
import type { CanonicalBriefV3 } from "@/domain/requirements/v3/schema";
import type { ProjectMemorySyncPort } from "@/persistence/database/sync";

export type BriefV3SupportingContext = { sourceRef: string; content: string; selectionReason: string; priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" };
export type BriefV3ProviderInput = { revisionInstruction: string; currentCanonicalV3: CanonicalBriefV3; supportingContext?: readonly BriefV3SupportingContext[]; newRequirementHandles?: readonly string[] };
export type BriefV3RevisionProvider = { proposeChanges(input: BriefV3ProviderInput): Promise<BriefChangeSet> };
export type BriefV3ProjectionPort = ProjectMemorySyncPort;
