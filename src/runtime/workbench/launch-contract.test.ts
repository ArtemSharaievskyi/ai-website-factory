import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkbenchLaunchError, assertBuiltWorkbenchWorkspace, assertSupportedWorkbenchWorkspace } from "./launch-contract";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function npmWorkspace(parent?: string) {
  const directory = fs.mkdtempSync(path.join(parent ?? os.tmpdir(), "workbench-launch-"));
  temporaryDirectories.push(directory);
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name: "synthetic-workbench" }));
  fs.writeFileSync(path.join(directory, "package-lock.json"), JSON.stringify({ lockfileVersion: 3 }));
  return directory;
}

describe("Workbench launcher boundary", () => {
  it("accepts the npm package root and rejects nested workspaces with an ancestor lockfile", () => {
    const root = npmWorkspace();
    expect(assertSupportedWorkbenchWorkspace(root)).toBe(fs.realpathSync.native(root));

    const parent = npmWorkspace();
    const nested = path.join(parent, "nested");
    fs.mkdirSync(nested);
    fs.writeFileSync(path.join(nested, "package.json"), JSON.stringify({ name: "nested-workbench" }));
    fs.writeFileSync(path.join(nested, "package-lock.json"), JSON.stringify({ lockfileVersion: 3 }));
    expect(() => assertSupportedWorkbenchWorkspace(nested)).toThrowError(WorkbenchLaunchError);
    expect(() => assertSupportedWorkbenchWorkspace(nested)).toThrow(/WORKBENCH_WORKSPACE_AMBIGUOUS/);
  });

  it("requires launcher-owned build provenance for production start", () => {
    const root = npmWorkspace();
    expect(() => assertBuiltWorkbenchWorkspace(root)).toThrow(/WORKBENCH_BUILD_PROVENANCE_MISSING/);
  });

  it("requires the emitted standalone runtime for production start", () => {
    const root = npmWorkspace();
    fs.mkdirSync(path.join(root, ".next"), { recursive: true });
    fs.writeFileSync(path.join(root, ".next", "BUILD_ID"), "synthetic-build");
    fs.writeFileSync(path.join(root, ".next", "workbench-runtime-provenance.json"), "{}");
    expect(() => assertBuiltWorkbenchWorkspace(root)).toThrow(/WORKBENCH_STANDALONE_RUNTIME_MISSING/);
  });
});
