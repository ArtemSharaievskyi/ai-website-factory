import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright";
import { readAiProviderConfig } from "../ai-provider/config";
import { readContext7Config } from "../context7/config";
import { readShadcnRegistryConfig } from "../shadcn-registry/config";

export type PreflightProbe = { npmAvailable?: boolean; chromiumAvailable?: boolean; gitClean?: boolean; head?: string };
export type RealFactoryE2EPreflight = { status: "pending" | "passed" | "blocked"; optIn: boolean; blockers: string[]; warnings: string[]; head?: string; integrations: { provider: "configured" | "not-configured"; context7: "configured" | "not-needed" | "blocked"; shadcn: "configured" | "not-needed" | "blocked" }; };

export async function runRealFactoryE2EPreflight(env: Record<string, string | undefined> = process.env, probe: PreflightProbe = {}) : Promise<RealFactoryE2EPreflight> {
  if (env.ALLOW_REAL_FACTORY_E2E !== "true") return { status: "pending", optIn: false, blockers: ["REAL_FACTORY_E2E_OPT_IN_REQUIRED"], warnings: [], integrations: { provider: "not-configured", context7: "not-needed", shadcn: "not-needed" } };
  const blockers: string[] = []; const warnings: string[] = [];
  let provider: "configured" | "not-configured" = "not-configured";
  try { readAiProviderConfig(env, true); provider = "configured"; } catch { blockers.push("REAL_E2E_OPENAI_NOT_CONFIGURED"); }
  const npmAvailable = probe.npmAvailable ?? await commandAvailable("npm"); if (!npmAvailable) blockers.push("REAL_E2E_NPM_NOT_AVAILABLE");
  const chromiumAvailable = probe.chromiumAvailable ?? await browserAvailable(); if (!chromiumAvailable) blockers.push("REAL_E2E_PLAYWRIGHT_BROWSER_NOT_AVAILABLE");
  if (probe.gitClean === false) blockers.push("REAL_E2E_WORKTREE_NOT_CLEAN");
  const integrations: RealFactoryE2EPreflight["integrations"] = { provider, context7: "not-needed", shadcn: "not-needed" };
  try { if (readContext7Config(env).enabled) integrations.context7 = "blocked"; } catch { integrations.context7 = "blocked"; warnings.push("REAL_E2E_CONTEXT7_CONFIGURATION_INVALID"); }
  try { if (readShadcnRegistryConfig(env).enabled) integrations.shadcn = "blocked"; } catch { integrations.shadcn = "blocked"; warnings.push("REAL_E2E_SHADCN_CONFIGURATION_INVALID"); }
  return { status: blockers.length ? "blocked" : "passed", optIn: true, blockers, warnings, head: probe.head, integrations };
}

async function commandAvailable(command: string) { try { const executable = process.platform === "win32" ? `${command}.cmd` : command; await new Promise<void>((resolve, reject) => { const child = spawn(executable, ["--version"], { stdio: "ignore", shell: false }); child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error("unavailable"))); }); return true; } catch { return false; } }
async function browserAvailable() { try { await access(chromium.executablePath()); return true; } catch { return false; } }
export function safeSmokeProjectReference(root: string, smokeId: string) { return path.join(path.resolve(root), "_smoke", `real-e2e-velofix-${smokeId}`); }
