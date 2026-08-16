import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyBaselineFailures, fingerprintFailure } from "../../../scripts/codex/baseline-failures";
import { checkArchitectureFiles, parseArchitectureConfig, resolveImportTarget } from "../../../scripts/codex/check-architecture";

const config = parseArchitectureConfig({
  version: 1,
  sourceRoots: ["src"],
  rules: [
    { id: "DOMAIN_PROVIDER", sourcePrefixes: ["src/domain/"], forbiddenTargetPrefixes: ["src/integrations/openai/"], message: "domain provider boundary" },
    { id: "UI_PERSISTENCE", sourcePrefixes: ["src/app/"], forbiddenTargetPrefixes: ["src/persistence/"], message: "ui persistence boundary" },
    { id: "UI_OPENAI", sourcePrefixes: ["src/app/"], forbiddenTargetPrefixes: ["src/integrations/openai/"], message: "ui provider boundary" },
  ],
});
const aliases = { "@/*": ["./src/*"] };

async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-architecture-test-"));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }
  return root;
}

async function inspect(root: string) {
  return checkArchitectureFiles(root, [path.join(root, "src", "app", "page.tsx"), path.join(root, "src", "domain", "model.ts")], config, aliases);
}

describe("Codex architecture guard", () => {
  it("rejects manually declared baseline failures", () => {
    expect(() => parseArchitectureConfig({ version: 1, sourceRoots: ["src"], knownFailures: ["ARCHITECTURE_X"], rules: [] })).toThrow("CODEX_ARCHITECTURE_BASELINE_CONFIG_FORBIDDEN");
  });

  it("allows a same-layer import and resolves a nested index module", async () => {
    const root = await fixture({
      "src/app/page.tsx": 'import "./component";',
      "src/app/component.ts": "export const component = true;",
      "src/domain/model.ts": 'import "./types";',
      "src/domain/types/index.ts": "export type Model = string;",
    });
    try {
      expect(await resolveImportTarget(root, path.join(root, "src", "domain", "model.ts"), "./types", aliases)).toBe("src/domain/types/index.ts");
      expect(await inspect(root)).toEqual([]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("blocks domain to OpenAI provider imports", async () => {
    const root = await fixture({
      "src/app/page.tsx": "export default function Page() { return null; }",
      "src/domain/model.ts": 'import "@/integrations/openai/client";',
      "src/integrations/openai/client.ts": "export const client = true;",
    });
    try { await expect(inspect(root)).resolves.toEqual([expect.objectContaining({ ruleId: "DOMAIN_PROVIDER", code: "ARCHITECTURE_DOMAIN_PROVIDER", targetFile: "src/integrations/openai/client.ts" })]); }
    finally { await rm(root, { recursive: true, force: true }); }
  });

  it("blocks UI to persistence and UI to OpenAI imports", async () => {
    const root = await fixture({
      "src/app/page.tsx": 'import "@/persistence/repo"; import "@/integrations/openai/client";',
      "src/domain/model.ts": "export const model = true;",
      "src/persistence/repo.ts": "export const repo = true;",
      "src/integrations/openai/client.ts": "export const client = true;",
    });
    try {
      const violations = await inspect(root);
      expect(violations.map((violation) => violation.ruleId)).toEqual(["UI_PERSISTENCE", "UI_OPENAI"]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("understands relative, alias, Windows, TSX, and module-resolution paths", async () => {
    const root = await fixture({
      "src/app/page.tsx": 'import "..\\\\shared"; import "@/domain/model";',
      "src/shared/index.ts": "export const shared = true;",
      "src/domain/model.ts": "export const model = true;",
    });
    try {
      expect(await resolveImportTarget(root, path.join(root, "src", "app", "page.tsx"), "..\\\\shared", aliases)).toBe("src/shared/index.ts");
      expect(await resolveImportTarget(root, path.join(root, "src", "app", "page.tsx"), "@/domain/model", aliases)).toBe("src/domain/model.ts");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("produces useful rule, source, target, and stable fingerprint output", async () => {
    const root = await fixture({
      "src/app/page.tsx": 'import "@/persistence/repo";',
      "src/domain/model.ts": "export const model = true;",
      "src/persistence/repo.ts": "export const repo = true;",
    });
    try {
      const [violation] = await inspect(root);
      expect(violation).toMatchObject({ ruleId: "UI_PERSISTENCE", sourceFile: "src/app/page.tsx", importSpecifier: "@/persistence/repo", targetFile: "src/persistence/repo.ts", code: "ARCHITECTURE_UI_PERSISTENCE" });
      expect(violation?.fingerprint).toBe(fingerprintFailure("architecture", violation?.key ?? "", "ARCHITECTURE_UI_PERSISTENCE", "UI_PERSISTENCE"));
      const baseline = violation ? [violation] : [];
      expect(classifyBaselineFailures(baseline, baseline, ["docs/task.md"]).baselineFailures).toHaveLength(1);
      expect(classifyBaselineFailures(baseline, baseline, ["src/app/page.tsx"]).blocking[0]?.reason).toBe("TOUCHED_BASELINE_FAILURE");
      expect(classifyBaselineFailures([], baseline, ["docs/task.md"]).blocking[0]?.reason).toBe("NEW_FAILURE");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
