import { FontpairAdapter } from "@/integrations/design/fontpair";
import { TwentyFirstDevAdapter, ReactBitsAdapter, MagicUiAdapter } from "@/integrations/design/component-sources";
import { inspectApprovedDesignSkills, validateDesignSkillCoverage } from "@/integrations/design/skill-evidence";

const blockers: string[] = [];
const block = (code: string) => { blockers.push(code); console.log(`BLOCKER: ${code}`); };

async function main() {
  console.log("PAID_DESIGN_GENERATOR: EXCLUDED_BY_USER / required=false / active=false / credentialRequired=false");

  try {
    const pairs = await new FontpairAdapter().listPairings({ idempotencyKey: "phase7f-reconciliation-live-fontpair" });
    console.log(`FONTPAIR_LIVE: PASS (${pairs.length} candidates; ${pairs[0]?.displayFamily} + ${pairs[0]?.bodyFamily})`);
  } catch (error) {
    block(error instanceof Error ? error.message : "FONTPAIR_SOURCE_INTEGRATION_UNRESOLVED");
  }
  for (const [name, adapter] of [["21ST_DEV", new TwentyFirstDevAdapter()], ["REACT_BITS", new ReactBitsAdapter()], ["MAGIC_UI", new MagicUiAdapter()]] as const) {
    try {
      const result = await adapter.searchComponents({ category: "design", directionId: "00000000-0000-4000-8000-000000000007" });
      console.log(`${name}_LIVE: PASS (${result.candidates.length} bounded candidates; writeAuthority=${result.writeAuthority})`);
    } catch (error) {
      block(`${name}_SOURCE_UNRESOLVED:${error instanceof Error ? error.message : "unknown"}`);
    }
  }
  const skills = await inspectApprovedDesignSkills();
  const coverage = validateDesignSkillCoverage(skills);
  console.log(`DESIGN_SKILLS_APPROVED: ${coverage.approvedSkillCount} (capability coverage ${coverage.valid ? "PASS" : "MISSING " + coverage.missing.join(",")})`);
  if (!coverage.valid) block("PHASE_7F_REQUIRED_DESIGN_CAPABILITY_SOURCE_MISSING");
  if (blockers.length === 0) console.log("PHASE 7F LIVE CHECK: PASS");
  else { console.log("PHASE 7F: BLOCKED"); process.exitCode = 1; }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "PHASE_7F_LIVE_CHECK_FAILED"); process.exitCode = 1; });
