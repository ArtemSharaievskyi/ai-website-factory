import { readFile } from "node:fs/promises";
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
});
