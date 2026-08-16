import { applyBriefChangeSet } from "@/domain/requirements/v3/reducer";
import { cleanBriefV3 } from "@/domain/requirements/v3/fixtures";
import { validateCanonicalBriefV3 } from "@/domain/requirements/v3/invariants";
import { CanonicalBriefV3Schema } from "@/domain/requirements/v3/schema";
import { createProductionProviderBundle } from "@/integrations/openai/production";
import { OpenAiBriefV3RevisionProvider } from "@/integrations/openai-v3/provider";
import { BRIEF_V3_PROVIDER_SCHEMA_NAME } from "@/integrations/openai-v3/prompt";

const syntheticCurrent = CanonicalBriefV3Schema.parse({
  ...cleanBriefV3,
  decisions: {
    ...cleanBriefV3.decisions,
    form: {
      ...cleanBriefV3.decisions.form,
      mode: "REAL" as const,
      simulatedSuccessPolicy: "UNRESOLVED" as const,
      transmissionMode: "EMAIL" as const,
    },
  },
});

async function main() {
  if (process.env.BRIEF_V3_LIVE_ACCEPTANCE !== "1") {
    console.log("SYNTHETIC LIVE ACCEPTANCE: SKIPPED (set BRIEF_V3_LIVE_ACCEPTANCE=1 to opt in)");
    return;
  }
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL) {
    console.log("SYNTHETIC LIVE ACCEPTANCE: SKIPPED (provider credentials/model are not configured)");
    return;
  }
  const provider = createProductionProviderBundle({ env: process.env });
  const briefV3Revision = new OpenAiBriefV3RevisionProvider(provider.ai);
  const result = await briefV3Revision.proposeChangesWithEvidence({
    currentCanonicalV3: syntheticCurrent,
    revisionInstruction: "For the synthetic local atelier, make successful form behavior simulated after local validation, keep transmission and persistence disabled, and update the exact SEO title to Synthetic Atelier Contact.",
  });
  const next = applyBriefChangeSet(syntheticCurrent, result.changeSet);
  validateCanonicalBriefV3(next);
  console.log(JSON.stringify({
    requestAttempted: result.diagnostic?.requestAttempted === true,
    responseReceived: result.diagnostic?.responseReceived === true,
    schemaName: BRIEF_V3_PROVIDER_SCHEMA_NAME,
    model: provider.config.model,
    requestId: result.requestId,
    finishReason: result.diagnostic?.finishReason ?? null,
    operationCount: result.changeSet.changes.length,
    operationKinds: [...new Set(result.changeSet.changes.map((change) => change.operation))],
    targetIds: result.changeSet.changes.map((change) => change.target),
    transportParse: "PASS",
    canonicalChangeSetParse: "PASS",
    reducerResult: "PASS",
    invariantResult: "PASS",
  }, null, 2));
  console.log("SYNTHETIC LIVE ACCEPTANCE: PASS");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.name : "SYNTHETIC_LIVE_ACCEPTANCE_FAILED");
  process.exitCode = 1;
});
