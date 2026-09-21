import fs from "node:fs";
import path from "node:path";

const LOCKFILE_NAMES = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock", "bun.lockb"] as const;

export class WorkbenchLaunchError extends Error {
  constructor(readonly code: "WORKBENCH_WORKSPACE_ROOT_INVALID" | "WORKBENCH_WORKSPACE_AMBIGUOUS" | "WORKBENCH_BUILD_PROVENANCE_MISSING", message: string) {
    super(`${code}: ${message}`);
    this.name = "WorkbenchLaunchError";
  }
}

function exists(filePath: string) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function realPath(filePath: string) {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

export function assertSupportedWorkbenchWorkspace(cwd = process.cwd()) {
  const root = realPath(cwd);
  const packagePath = path.join(root, "package.json");
  const lockPath = path.join(root, "package-lock.json");
  if (!exists(packagePath) || !exists(lockPath))
    throw new WorkbenchLaunchError("WORKBENCH_WORKSPACE_ROOT_INVALID", "The Workbench server must start from the npm package root containing package.json and package-lock.json.");
  for (const lockName of LOCKFILE_NAMES.filter((name) => name !== "package-lock.json")) {
    if (exists(path.join(root, lockName)))
      throw new WorkbenchLaunchError("WORKBENCH_WORKSPACE_AMBIGUOUS", `The Workbench package root contains an unsupported ${lockName}; remove the ambiguity before server start.`);
  }
  let parent = path.dirname(root);
  while (true) {
    if (LOCKFILE_NAMES.some((name) => exists(path.join(parent, name))))
      throw new WorkbenchLaunchError("WORKBENCH_WORKSPACE_AMBIGUOUS", "A parent directory contains a package lockfile, so Next.js could select a different workspace root. Start from a worktree outside that parent project or from the repository root.");
    const nextParent = path.dirname(parent);
    if (nextParent === parent) break;
    parent = nextParent;
  }
  return root;
}

export function assertBuiltWorkbenchWorkspace(cwd = process.cwd()) {
  const root = assertSupportedWorkbenchWorkspace(cwd);
  if (!exists(path.join(root, ".next", "BUILD_ID")) || !exists(path.join(root, ".next", "workbench-runtime-provenance.json")))
    throw new WorkbenchLaunchError("WORKBENCH_BUILD_PROVENANCE_MISSING", "The production server requires a build created by the supported Workbench build launcher.");
  return root;
}
