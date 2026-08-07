import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { runRealFactoryE2EPreflight } from "./real-factory-e2e/preflight";

async function project() { return mkdtemp(path.join(os.tmpdir(), "factory-cli-env-")); }
function runLoader(root: string, values: Record<string, string | undefined> = {}) { const env = { ...process.env, ...values, TEST_ROOT: root }; const result = spawnSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "-e", "import { loadFactoryCliEnv } from './scripts/cli-env.ts'; loadFactoryCliEnv(process.env.TEST_ROOT); process.stdout.write(process.env.ALLOW_REAL_FACTORY_E2E ?? '')"], { cwd: path.resolve(__dirname, ".."), env, encoding: "utf8" }); return { output: result.stdout, error: result.stderr }; }

describe("standalone CLI environment bootstrap", () => {
  it("leaves opt-in absent without an env file", async () => { const root = await project(); try { const result = runLoader(root, { ALLOW_REAL_FACTORY_E2E: undefined }); expect(result.output).toBe(""); } finally { await rm(root, { recursive: true, force: true }); } });
  it("loads the project-root .env opt-in", async () => { const root = await project(); try { await writeFile(path.join(root, ".env"), ["ALLOW_REAL_FACTORY_E2E", "true"].join("=")); expect(runLoader(root, { ALLOW_REAL_FACTORY_E2E: undefined }).output).toBe("true"); } finally { await rm(root, { recursive: true, force: true }); } });
  it("preserves an explicitly supplied process value over .env and .env.local", async () => { const root = await project(); try { await writeFile(path.join(root, ".env"), ["ALLOW_REAL_FACTORY_E2E", "true"].join("=")); await writeFile(path.join(root, ".env.local"), ["ALLOW_REAL_FACTORY_E2E", "true"].join("=")); expect(runLoader(root, { ALLOW_REAL_FACTORY_E2E: "false", NODE_ENV: "development" }).output).toBe("false"); } finally { await rm(root, { recursive: true, force: true }); } });
  it("does not print malformed environment contents or secrets", async () => { const root = await project(); const secret = "do-not-print-this-secret"; try { await writeFile(path.join(root, ".env"), `MALFORMED=\"unterminated\nSECRET_VALUE=${secret}\n`); const result = runLoader(root, { ALLOW_REAL_FACTORY_E2E: undefined }); expect(`${result.output}${result.error}`).not.toContain(secret); } finally { await rm(root, { recursive: true, force: true }); } });
  it("keeps automated verification at preflight and does not launch E2E", async () => { const result = await runRealFactoryE2EPreflight({ ALLOW_REAL_FACTORY_E2E: "false" }, { npmAvailable: false, chromiumAvailable: false }); expect(result.status).toBe("pending"); expect(result.optIn).toBe(false); });
  it("does not hardcode the opt-in", async () => { const source = await readFile(path.resolve(__dirname, "../scripts/factory-e2e-smoke.ts"), "utf8"); expect(source).not.toMatch(/ALLOW_REAL_FACTORY_E2E\s*=\s*true/); });
});
