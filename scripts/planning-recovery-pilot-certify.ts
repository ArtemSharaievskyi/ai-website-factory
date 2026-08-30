import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const required = ["DATABASE_URL", "PLANNING_RECOVERY_PILOT_PROJECT_ID"] as const;
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error(`PLANNING_RECOVERY_LIVE_PILOT_CONFIGURATION_REQUIRED:${missing.join(",")}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [resolve(process.cwd(), "node_modules/vitest/vitest.mjs"), "run", "src/agents/planner/recovery-pilot-shape.test.ts"], {
  stdio: "inherit",
  env: { ...process.env, PLANNING_RECOVERY_REQUIRE_LIVE_PILOT: "true" },
});
if (result.error) console.error("PLANNING_RECOVERY_LIVE_PILOT_EXECUTION_FAILED");
process.exit(result.status ?? 1);
