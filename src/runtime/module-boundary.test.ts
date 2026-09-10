import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFile(path.resolve(__dirname, file), "utf8");

describe("runtime module boundaries", () => {
  it("keeps the public runtime barrel client-safe", async () => {
    const index = await source("index.ts");
    expect(index).toContain("./deterministic-factory-runtime");
    expect(index).not.toContain("production-factory-runtime");
    expect(index).not.toContain("./server");
  });

  it("uses an explicit Node/server entrypoint for the standalone factory smoke", async () => {
    const server = await source("server.ts");
    const smoke = await readFile(path.resolve(__dirname, "../../scripts/factory-e2e-smoke.ts"), "utf8");
    expect(server).toContain("./production-factory-runtime-core");
    expect(server).not.toContain("server-only");
    expect(smoke).toContain("../src/runtime/server");
    expect(smoke).not.toContain("../src/runtime/production-factory-runtime");
  });

  it("retains server-only guards on Next server entrypoints", async () => {
    await expect(source("production-factory-runtime.ts")).resolves.toContain('import "server-only"');
    await expect(readFile(path.resolve(__dirname, "../integrations/openai/server.ts"), "utf8")).resolves.toContain('import "server-only"');
    await expect(readFile(path.resolve(__dirname, "../persistence/database/server.ts"), "utf8")).resolves.toContain('import "server-only"');
    await expect(readFile(path.resolve(__dirname, "workspace/server.ts"), "utf8")).resolves.toContain('import "server-only"');
    await expect(readFile(path.resolve(__dirname, "workbench/production.ts"), "utf8")).resolves.toContain('import "server-only"');
  });

  it("keeps compiler-backed helpers behind the production runtime boundary", async () => {
    const bridge = await readFile(path.resolve(__dirname, "context/bridge.ts"), "utf8");
    const production = await source("production-factory-runtime-core.ts");
    const execution = await readFile(path.resolve(__dirname, "../orchestration/execution/production-adapters.ts"), "utf8");
    const nextConfig = await readFile(path.resolve(__dirname, "../../next.config.ts"), "utf8");
    expect(bridge).toContain('import { selectRelevantFiles, sourceContextCandidates');
    const prompts = await readFile(path.resolve(__dirname, "../integrations/openai/prompts.ts"), "utf8");
    expect(prompts).not.toContain('from "@/runtime/context"');
    expect(production).toContain('import("@/agents/implementation/service")');
    expect(production).toContain("import type {\n  ImplementationAgentService,");
    expect(production).not.toContain("import {\n  ImplementationAgentService,");
    expect(execution).toContain('import type { ImplementationAgentService }');
    expect(nextConfig).toContain('transpilePackages: ["pg", "typescript"]');
  });

  it("keeps all standalone Trial Entry commands on the Node-safe composition", async () => {
    const scripts = await Promise.all(["factory-new.ts", "factory-respond.ts", "factory-status.ts"].map((file) => readFile(path.resolve(__dirname, "../../scripts", file), "utf8")));
    for (const script of scripts) {
      expect(script).toContain("@/runtime/trial-entry/node");
      expect(script).not.toContain("@/runtime/trial-entry/production");
    }
    const node = await source("trial-entry/node.ts");
    const production = await source("trial-entry/production.ts");
    const route = await readFile(path.resolve(__dirname, "../app/api/workbench/route.ts"), "utf8");
    expect(node).toContain("TrialEntryService");
    expect(node).not.toContain('import "server-only"');
    expect(production).toContain('import "server-only"');
    expect(route).toContain("getProductionWorkbench");
    expect(route).not.toContain("trial-entry/node");
  });

  it("keeps provider credentials out of the client implementation", async () => {
    const client = await readFile(path.resolve(__dirname, "../integrations/openai/client.ts"), "utf8");
    expect(client).not.toContain("process.env");
    expect(client).not.toContain("NEXT_PUBLIC_OPENAI_API_KEY");
  });

  it("uses the framework-neutral provider core for the standalone AI smoke", async () => {
    const smoke = await readFile(path.resolve(__dirname, "../../scripts/ai-smoke.ts"), "utf8");
    const production = await readFile(path.resolve(__dirname, "../integrations/openai/production.ts"), "utf8");
    const server = await readFile(path.resolve(__dirname, "../integrations/openai/server.ts"), "utf8");
    expect(smoke).toContain("../src/integrations/openai/production");
    expect(smoke).not.toContain("../src/integrations/openai/server");
    expect(smoke).not.toMatch(/new OpenAI|zodResponseFormat|chat\.completions\.parse/);
    expect(production).not.toContain('import "server-only"');
    expect(production).toContain("OpenAiStructuredClient");
    expect(server).toContain('import "server-only"');
    expect(server).toContain('export { createProductionProviderBundle } from "./production"');
  });

  it("keeps the frozen Workbench candidate unchanged across the provider smoke repair", async () => {
    const document = JSON.parse(await readFile(path.resolve(__dirname, "../../docs/admin/workbench/web-workbench-candidate-2026-08-12.json"), "utf8")) as {
      candidate: { candidateChecksum: string; exactFileManifest: Array<{ relativePath: string; checksum: string; byteLength: number; lineCount: number }> };
    };
    const allowlistedHistoricalChanges = new Set([
      "package.json",
      "scripts/workbench-playwright-smoke.ts",
      "src/app/api/workbench/route.ts",
      "src/app/globals.css",
      "src/components/workbench.tsx",
      "src/persistence/database/postgres.ts",
      "src/persistence/database/fake.ts",
      "src/persistence/database/repositories.ts",
      "src/persistence/database/types.ts",
      "src/runtime/production-factory-runtime-core.ts",
      "src/runtime/trial-entry/service.ts",
      "src/runtime/trial-entry/production.ts",
      "src/runtime/workbench/application.ts",
      "src/runtime/workbench/contracts.ts",
      "src/runtime/workbench/production.ts",
      "src/runtime/workbench/workbench.test.ts",
    ]);
    const manifest = document.candidate.exactFileManifest;
    const unchangedManifest = manifest.filter((entry) => !allowlistedHistoricalChanges.has(entry.relativePath));
    const actual = await Promise.all(unchangedManifest.map(async (entry) => {
      const content = await readFile(path.resolve(__dirname, "../../", entry.relativePath));
      return {
        relativePath: entry.relativePath,
        checksum: createHash("sha256").update(content).digest("hex"),
        byteLength: content.byteLength,
        lineCount: content.toString("utf8").split(/\r?\n/).length,
      };
    }));
    expect(actual).toEqual(unchangedManifest);
    expect(createHash("sha256").update(JSON.stringify(manifest)).digest("hex")).toBe(document.candidate.candidateChecksum);
    expect(document.candidate.candidateChecksum).toBe("304f6abaabe0d653f3c5859d5b5b393c5fca1cc46bca855ba0f080c67fca10c3");
  });
});
