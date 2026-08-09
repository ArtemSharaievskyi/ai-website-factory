import { access } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { readAiProviderConfig } from "@/integrations/openai/config";
import { OpenAiStructuredClient } from "@/integrations/openai/client";
import { readContext7Config } from "@/integrations/context7/config";
import { readShadcnRegistryConfig } from "@/integrations/shadcn/config";
import { probeNpmAvailability } from "@/runtime/validation/runner";
export type PreflightProbe = { npmAvailable?: boolean; npmDiagnostic?: { available: boolean; executableKind?: "npm" | "npm.cmd"; safeErrorCode?: string }; chromiumAvailable?: boolean; gitClean?: boolean; head?: string };
export type OpenAiPreflightDiagnostic = { configured: boolean; keyPresent: boolean; modelConfigured: boolean; clientConstructable: boolean; safeErrorCode?: string };
export type NpmPreflightDiagnostic = { available: boolean; executableKind?: "npm" | "npm.cmd"; safeErrorCode?: string };
export type RealFactoryE2EPreflight = { status: "pending" | "passed" | "blocked"; optIn: boolean; blockers: string[]; warnings: string[]; head?: string; diagnostics?: { openai: OpenAiPreflightDiagnostic; npm: NpmPreflightDiagnostic }; integrations: { provider: "configured" | "not-configured"; context7: "configured" | "not-needed" | "blocked"; shadcn: "configured" | "not-needed" | "blocked" } };
export async function runRealFactoryE2EPreflight(env: Record<string, string | undefined> = process.env, probe: PreflightProbe = {}): Promise<RealFactoryE2EPreflight> {
  if (env.ALLOW_REAL_FACTORY_E2E !== "true") return { status: "pending", optIn: false, blockers: ["REAL_FACTORY_E2E_OPT_IN_REQUIRED"], warnings: [], diagnostics: { openai: { configured: false, keyPresent: false, modelConfigured: false, clientConstructable: false }, npm: { available: false, safeErrorCode: "REAL_E2E_OPT_IN_REQUIRED" } }, integrations: { provider: "not-configured", context7: "not-needed", shadcn: "not-needed" } };
  const blockers: string[] = []; const warnings: string[] = []; const openai: OpenAiPreflightDiagnostic = { configured: false, keyPresent: Boolean(env.OPENAI_API_KEY), modelConfigured: Boolean(env.OPENAI_MODEL), clientConstructable: false }; let provider: "configured" | "not-configured" = "not-configured";
  if (!openai.keyPresent) { openai.safeErrorCode = "REAL_E2E_OPENAI_KEY_MISSING"; blockers.push("REAL_E2E_OPENAI_NOT_CONFIGURED"); } else if (!openai.modelConfigured) { openai.safeErrorCode = "REAL_E2E_OPENAI_MODEL_MISSING"; blockers.push("REAL_E2E_OPENAI_MODEL_MISSING"); } else { try { const config = readAiProviderConfig(env, true); new OpenAiStructuredClient(config); provider = "configured"; openai.configured = true; openai.clientConstructable = true; } catch { openai.safeErrorCode = "REAL_E2E_OPENAI_CONFIGURATION_INVALID"; blockers.push("REAL_E2E_OPENAI_NOT_CONFIGURED"); } }
  const npm = probe.npmDiagnostic ?? (probe.npmAvailable === undefined ? await probeNpmAvailability(env) : { available: probe.npmAvailable }); if (!npm.available) blockers.push("REAL_E2E_NPM_NOT_AVAILABLE");
  const chromiumAvailable = probe.chromiumAvailable ?? await browserAvailable(); if (!chromiumAvailable) blockers.push("REAL_E2E_PLAYWRIGHT_BROWSER_NOT_AVAILABLE"); if (probe.gitClean === false) blockers.push("REAL_E2E_WORKTREE_NOT_CLEAN");
  const integrations: RealFactoryE2EPreflight["integrations"] = { provider, context7: "not-needed", shadcn: "not-needed" }; try { if (readContext7Config(env).enabled) integrations.context7 = "blocked"; } catch { integrations.context7 = "blocked"; warnings.push("REAL_E2E_CONTEXT7_CONFIGURATION_INVALID"); } try { if (readShadcnRegistryConfig(env).enabled) integrations.shadcn = "blocked"; } catch { integrations.shadcn = "blocked"; warnings.push("REAL_E2E_SHADCN_CONFIGURATION_INVALID"); }
  return { status: blockers.length ? "blocked" : "passed", optIn: true, blockers, warnings, head: probe.head, diagnostics: { openai, npm }, integrations };
}
async function browserAvailable() { try { await access(chromium.executablePath()); return true; } catch { return false; } }
export function safeSmokeProjectReference(root: string, smokeId: string) { return path.join(path.resolve(root), "_smoke", `real-e2e-velofix-${smokeId}`); }
