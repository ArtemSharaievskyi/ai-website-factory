import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";
import { CODEBASE_MEMORY_RELEASE_VERSION, readCodebaseMemoryConfig } from "@/integrations/codebase-memory/config";
import { assertSafeRelativePath } from "@/integrations/codebase-memory/policy";
import { readDirectory } from "@/runtime/filesystem/directory";

describe("Codebase Memory build boundary", () => {
  it("excludes only the legacy Factory runtime-tool tree from server traces", () => {
    expect(nextConfig.outputFileTracingExcludes).toEqual({ "/*": [".factory/tools/**"] });
    expect(nextConfig.outputFileTracingExcludes?.["/*"]).not.toContain("src/**");
  });

  it("keeps a legacy .factory/tools installation as an explicit compatibility path", async () => {
    const root = await fsRoot();
    try {
      const executable = path.join(root, ".factory", "tools", "codebase-memory-mcp", CODEBASE_MEMORY_RELEASE_VERSION, "codebase-memory-mcp.exe");
      await mkdir(path.dirname(executable), { recursive: true });
      await writeFile(executable, "synthetic legacy executable marker");
      const config = readCodebaseMemoryConfig({ CODEBASE_MEMORY_ENABLED: "true", CODEBASE_MEMORY_EXECUTABLE: executable });
      expect(config).toMatchObject({ enabled: true, executable });
      expect(config.runtimeRoot).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves a versioned external executable through a Windows path with spaces", async () => {
    const root = await fsRoot();
    try {
      const executable = path.join(root, CODEBASE_MEMORY_RELEASE_VERSION, "codebase-memory-mcp.exe");
      await mkdir(path.dirname(executable), { recursive: true });
      await writeFile(executable, "synthetic executable marker");
      const config = readCodebaseMemoryConfig({ CODEBASE_MEMORY_ENABLED: "true", CODEBASE_MEMORY_RUNTIME_ROOT: root });
      expect(config).toMatchObject({ enabled: true, executable, runtimeRoot: root });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns a typed server-only configuration error for client runtime settings", () => {
    expect(() => readCodebaseMemoryConfig({ NEXT_PUBLIC_CODEBASE_MEMORY_RUNTIME_ROOT: "C:\\outside" })).toThrow(/server-only/);
  });

  it("rejects source-like files that try to escape the authorized runtime boundary", () => {
    expect(() => assertSafeRelativePath(".factory/tools/codebase-memory-mcp/v0.11.0/malicious.ts")).toThrow(/outside the indexed application source/);
    expect(() => assertSafeRelativePath("../malicious.ts")).toThrow(/outside the indexed application source/);
  });

  it("keeps build-time source discovery on the opendir boundary", async () => {
    const productionFiles = [
      "src/skills/registry/registry.ts",
      "src/runtime/workspace/manager.ts",
      "src/integrations/codebase-memory/policy.ts",
      "src/agents/implementation/policy.ts",
    ];
    for (const file of productionFiles) {
      const source = await readFile(file, "utf8");
      expect(source).not.toMatch(/\breaddir(?:Sync)?\s*\(/);
      expect(source).toContain("readDirectory");
    }
    const directorySource = await readFile("src/runtime/filesystem/directory.ts", "utf8");
    expect(directorySource).toContain("opendir(/* turbopackIgnore: true */ directory)");
    expect(directorySource).toContain("opendirSync(/* turbopackIgnore: true */ directory)");
    const registrySource = await readFile("src/skills/registry/registry.ts", "utf8");
    expect(registrySource).toContain("readDirectory(/* turbopackIgnore: true */ current)");
    expect(registrySource).toContain("path.join(/* turbopackIgnore: true */ current, entry.name)");
    expect(registrySource).toContain("readFile(/* turbopackIgnore: true */ full)");
    expect(registrySource).toContain("readFile(/* turbopackIgnore: true */ sourceFile)");
    expect(registrySource).toContain("readFile(/* turbopackIgnore: true */ approvedPath");
    const workspaceSource = await readFile("src/runtime/workspace/manager.ts", "utf8");
    expect(workspaceSource).toContain("readDirectory(/* turbopackIgnore: true */ root)");
    expect(workspaceSource).toContain("readDirectory(/* turbopackIgnore: true */ source)");
    expect(workspaceSource).toContain("path.join(/* turbopackIgnore: true */ source, entry.name)");
  });

  it("still enumerates an explicitly supplied synthetic skill source", async () => {
    const root = await fsRoot();
    try {
      await mkdir(path.join(root, "references"), { recursive: true });
      await writeFile(path.join(root, "SKILL.md"), "# Synthetic skill\n");
      await writeFile(path.join(root, "references", "bounded.md"), "bounded");
      const entries = await readDirectory(root);
      expect(entries.map((entry) => entry.name).sort()).toEqual(["SKILL.md", "references"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps runtime-configured roots out of Turbopack module tracing", async () => {
    const source = await readFile("src/runtime/workbench/production.ts", "utf8");
    expect(source).toMatch(/path\.resolve\(\/\* turbopackIgnore: true \*\/ env\.GENERATED_PROJECTS_ROOT/);
    expect(source).toMatch(/path\.resolve\(\/\* turbopackIgnore: true \*\/ env\.FACTORY_ASSET_ROOT/);
  });
});

let sequence = 0;
async function fsRoot() {
  sequence += 1;
  return mkdtemp(path.join(os.tmpdir(), `Factory Runtime Root With Spaces-${process.pid}-${sequence}-`));
}
