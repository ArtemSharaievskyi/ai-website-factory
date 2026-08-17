import type { BriefChangeSet } from "@/domain/requirements/v3/changeset";
import { OpenAiBriefV3RevisionProvider, type BriefV3ProviderEvidence } from "./provider";

/** The bounded provider adapter used by live acceptance and its deterministic seam. */
export class BriefV3EvidenceProvider {
  calls = 0;
  evidence?: BriefV3ProviderEvidence;

  constructor(private readonly provider: OpenAiBriefV3RevisionProvider) {}

  async proposeChanges(input: Parameters<OpenAiBriefV3RevisionProvider["proposeChanges"]>[0]): Promise<BriefChangeSet> {
    this.calls += 1;
    if (this.calls !== 1) throw new Error("LIVE_PROVIDER_CALL_COUNT_EXCEEDED");
    const providerInput = { revisionInstruction: input.revisionInstruction, currentCanonicalV3: input.currentCanonicalV3, supportingContext: input.supportingContext };
    const result = await this.provider.proposeChangesWithEvidence(providerInput);
    this.evidence = result;
    return result.changeSet;
  }
}
