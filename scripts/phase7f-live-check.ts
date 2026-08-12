import { FontpairAdapter } from "@/integrations/design/fontpair";
import { MagicPatternsAdapter, readMagicPatternsCredential } from "@/integrations/design/magic-patterns";
import { inspectApprovedDesignSkills } from "@/integrations/design/skill-evidence";

const blocked = new Set<string>();
const block = (code: string) => { blocked.add(code); console.log(`BLOCKER: ${code}`); };

async function main() {
  const credential = readMagicPatternsCredential();
  if (!credential) {
    console.log("PHASE 7F: BLOCKED");
    console.log("BLOCKER:");
    console.log("MAGIC_PATTERNS_CREDENTIAL_REQUIRED");
    console.log("REQUIRED ENVIRONMENT VARIABLE:");
    console.log("MAGIC_PATTERNS_API_KEY");
    blocked.add("MAGIC_PATTERNS_CREDENTIAL_REQUIRED");
  } else {
    const magic = new MagicPatternsAdapter();
    const health = await magic.health();
    console.log(`MAGIC_PATTERNS_HEALTH: ${health.status}${health.httpStatus ? ` (${health.httpStatus})` : ""}`);
    if (health.status !== "AVAILABLE") block(`MAGIC_PATTERNS_${health.status}`);
    else {
      const artifact = await magic.createMinimalArtifact({ prompt: "Create one bounded professional design direction reference. Do not publish, deploy, sync Git, or write source files.", idempotencyKey: "phase7f-live-check" });
      console.log(`MAGIC_PATTERNS_ARTIFACT: ${artifact.artifactId} (${artifact.responseChecksum})`);
    }
  }

  try {
    const pair = await new FontpairAdapter().recommendPair({ idempotencyKey: "phase7f-live-check" });
    console.log(`FONTPAIR_LIVE: ${pair.displayFamily} + ${pair.bodyFamily} (${pair.sourceChecksum})`);
  } catch (error) {
    block(error instanceof Error && error.message.startsWith("FONTPAIR_") ? "FONTPAIR_SOURCE_INTEGRATION_UNRESOLVED" : "FONTPAIR_SOURCE_INTEGRATION_ERROR");
  }

  const skills = await inspectApprovedDesignSkills();
  const unavailable = skills.filter((skill) => skill.status !== "APPROVED_IMMUTABLE");
  console.log(`DESIGN_SKILLS_APPROVED: ${skills.length - unavailable.length}/${skills.length}`);
  if (unavailable.length) block("DESIGN_SKILL_NOT_AVAILABLE_THROUGH_APPROVED_SOURCE");
  if (blocked.size === 0) console.log("PHASE 7F LIVE CHECK: PASS");
  else process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "PHASE_7F_LIVE_CHECK_FAILED");
  process.exitCode = 1;
});
