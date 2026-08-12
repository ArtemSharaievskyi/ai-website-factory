import { z } from "zod";
import { loadFactoryCliEnv } from "./cli-env";

loadFactoryCliEnv();

async function main() {
  if (process.env.ALLOW_REAL_AI_SMOKE !== "true" || !process.env.OPENAI_API_KEY) { console.log(JSON.stringify({ status: "not-run", releaseEligible: false, reason: "Explicit AI smoke opt-in and OPENAI_API_KEY are required.", evidence: "incomplete" })); process.exitCode = 1; return; }
  const { createProductionProviderBundle } = await import("../src/integrations/openai/production");
  const bundle = createProductionProviderBundle();
  const result = await bundle.ai.request({ role: "smoke", promptVersion: "smoke.v1", system: "Return a tiny valid object.", user: "Synthetic provider health check.", schemaName: "ai-smoke", schema: z.object({ ok: z.literal(true) }).strict(), idempotencyKey: `smoke-${Date.now()}` });
  console.log(JSON.stringify({ status: "passed", releaseEligible: false, provider: result.usage.provider, model: result.usage.model, requestId: result.requestId, usage: result.usage, releaseEvidence: "executed-provider-request" }));
}
void main();
