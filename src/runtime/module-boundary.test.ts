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
    const manifest = document.candidate.exactFileManifest;
    const actual = await Promise.all(manifest.map(async (entry) => {
      const content = await readFile(path.resolve(__dirname, "../../", entry.relativePath));
      return {
        relativePath: entry.relativePath,
        checksum: createHash("sha256").update(content).digest("hex"),
        byteLength: content.byteLength,
        lineCount: content.toString("utf8").split(/\r?\n/).length,
      };
    }));
    expect(actual).toEqual(manifest);
    expect(createHash("sha256").update(JSON.stringify(manifest)).digest("hex")).toBe(document.candidate.candidateChecksum);
    expect(document.candidate.candidateChecksum).toBe("758b623b29bf8d61a2f224571869e3522453fb6eff3b7de16ef618059c41b3c6");
  });
});
