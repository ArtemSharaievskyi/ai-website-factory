import { createHash } from "node:crypto";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import type { BriefChangeSet } from "@/domain/requirements/v3/changeset";
import type { ProviderDiagnostic, ProviderUsage } from "../openai/usage";
import { OpenAiStructuredClient } from "../openai/client";
import { mapProviderBriefChangeSet } from "./mapper";
import { ProviderBriefChangeSetSchema, type ProviderBriefChangeSet } from "./changeset";
import { buildBriefV3RevisionPrompt, BRIEF_V3_PROVIDER_PROMPT_VERSION, BRIEF_V3_PROVIDER_SCHEMA_NAME, type BriefV3RevisionProviderInput } from "./prompt";

export type { BriefV3RevisionProviderInput } from "./prompt";

export type BriefV3ProviderEvidence = {
  providerChangeSet: ProviderBriefChangeSet;
  changeSet: BriefChangeSet;
  requestId: string;
  usage: ProviderUsage;
  diagnostic?: ProviderDiagnostic;
};

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** Isolated V3 provider port. It is not connected to the production V2 revision workflow. */
export class OpenAiBriefV3RevisionProvider {
  constructor(private readonly ai: OpenAiStructuredClient) {}

  async proposeChanges(input: BriefV3RevisionProviderInput): Promise<BriefChangeSet> {
    const result = await this.requestTransport(input);
    return mapProviderBriefChangeSet(result.value);
  }

  async proposeChangesWithEvidence(input: BriefV3RevisionProviderInput): Promise<BriefV3ProviderEvidence> {
    const result = await this.requestTransport(input);
    const providerChangeSet = ProviderBriefChangeSetSchema.parse(result.value);
    return { providerChangeSet, changeSet: mapProviderBriefChangeSet(providerChangeSet), requestId: result.requestId, usage: result.usage, ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}) };
  }

  private async requestTransport(input: BriefV3RevisionProviderInput) {
    const prompt = buildBriefV3RevisionPrompt(input);
    return this.ai.request({
      ...prompt,
      role: "lead",
      promptVersion: BRIEF_V3_PROVIDER_PROMPT_VERSION,
      schema: ProviderBriefChangeSetSchema,
      schemaName: BRIEF_V3_PROVIDER_SCHEMA_NAME,
      idempotencyKey: `lead-brief-v3-revision:${digest(JSON.stringify({ instruction: input.revisionInstruction, briefChecksum: canonicalBriefChecksum(input.currentCanonicalV3), newRequirementHandles: input.newRequirementHandles ?? [] }))}`,
    });
  }
}
