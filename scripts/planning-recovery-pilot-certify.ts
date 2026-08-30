import { spawnSync } from "node:child_process";

const required = ["DATABASE_URL", "PLANNING_RECOVERY_PILOT_PROJECT_ID"] as const;
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error(`PLANNING_RECOVERY_LIVE_PILOT_CONFIGURATION_REQUIRED:${missing.join(",")}`);
  process.exit(1);
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npm, ["run", "test", "--", "src/agents/planner/recovery-pilot-shape.test.ts"], {
  stdio: "inherit",
  env: { ...process.env, PLANNING_RECOVERY_REQUIRE_LIVE_PILOT: "true" },
});
process.exit(result.status ?? 1);
