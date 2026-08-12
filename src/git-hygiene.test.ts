import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
function ignored(relativePath: string) {
  try { execFileSync("git", ["check-ignore", "--quiet", "--no-index", "--", relativePath], { cwd: root, stdio: "ignore" }); return true; } catch { return false; }
}

describe("Factory Git hygiene", () => {
  it("ignores nested disposable outputs and the temporary QA prefix", () => {
    expect(ignored(".qa-foundation-example/project/.next/BUILD_ID")).toBe(true);
    expect(ignored(".qa-foundation-example/project/node_modules/pkg/index.js")).toBe(true);
    expect(ignored(".factory-generated/_smoke/example/v1/.next/server/app.js")).toBe(true);
    expect(ignored("tmp/project/coverage/coverage-final.json")).toBe(true);
    expect(ignored("tmp/project/dist/index.js")).toBe(true);
  });
  it("keeps canonical Factory source and configuration visible", () => {
    for (const file of ["src/example.ts", "docs/example.md", "scripts/example.ts", "supabase/migrations/example.sql", "package.json", "package-lock.json", ".env.example"]) expect(ignored(file)).toBe(false);
  });
  it("documents temporary workspace ownership without hiding Project Memory semantics", () => {
    const gitignore = readFileSync(path.join(root, ".gitignore"), "utf8");
    expect(gitignore).toContain("/.qa-foundation-*/");
    expect(gitignore).toContain("/.factory-generated*/");
    expect(gitignore).toContain("**/.next/");
    expect(gitignore).not.toContain("**/.factory/");
  });
  it("keeps QA fixture cleanup in a finally block", () => {
    const source = readFileSync(path.join(root, "src/runtime/qa/server.test.ts"), "utf8");
    expect(source).toContain("finally");
    expect(source).toContain("QaWorkspaceLifecycle");
    expect(source).toContain("qa.cleanup");
    expect(source).not.toContain("rm(root, { recursive: true, force: true })");
  });
});
