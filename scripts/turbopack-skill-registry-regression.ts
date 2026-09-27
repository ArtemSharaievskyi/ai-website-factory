import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SkillRegistry } from "../src/skills/registry/registry";

const execFileAsync = promisify(execFile);
const root = process.cwd();

class RegressionFailure extends Error {
  constructor(readonly stage: string, readonly code: string) {
    super(stage + ":" + code);
  }
}

async function assertNoReparsePoints(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new RegressionFailure("SETUP", "REPARSE_POINT_PRESENT");
    if (entry.isDirectory()) await assertNoReparsePoints(target);
  }
}

async function runBuild(fixture: string, expected: "pass" | "traversal-failure") {
  await rm(path.join(fixture, ".next"), { recursive: true, force: true });
  try {
    await execFileAsync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm.cmd run build"], {
      cwd: fixture,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (expected === "traversal-failure")
      throw new RegressionFailure("COMPILER", "NEGATIVE_CONTROL_DID_NOT_FAIL");
    return { status: "PASS" as const };
  } catch (error) {
    const output = ((error as { stdout?: string }).stdout ?? "") + "\n" + ((error as { stderr?: string }).stderr ?? "");
    if (expected === "pass") {
      throw new RegressionFailure("COMPILER", "REPAIRED_BUILD_FAILED");
    }
    const reference = output.match(/(?:DirAssetReference|FileSourceReference)/)?.[0];
    if (!reference || !/raw_read_dir/.test(output))
      throw new RegressionFailure("COMPILER", "NEGATIVE_CONTROL_NOT_TRAVERSAL");
    return { status: "TRAVERSAL_REPRODUCED" as const, reference };
  }
}

async function runRuntimeCompatibility(registryRoot: string, sourceRoot: string) {
  const skillMarkdown = [
    "# Synthetic Runtime Skill",
    "Bounded fixture-only compatibility check.",
    "",
    "## Purpose",
    "- Verify registry enumeration and approved loading.",
    "",
    "## Steps",
    "- Read the approved synthetic file.",
    "- Report bounded results.",
    "",
  ].join("\n");
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(path.join(sourceRoot, "SKILL.md"), skillMarkdown, "utf8");
  await writeFile(path.join(sourceRoot, "LICENSE"), "MIT\n", "utf8");
  const registry = new SkillRegistry(registryRoot);
  const staged = await registry.stageLocalImport(sourceRoot, { license: "MIT", skillId: "synthetic-runtime-compat" });
  if (!staged.definition.manifest.files.some((file) => file.relativePath === "SKILL.md"))
    throw new RegressionFailure("RUNTIME", "ENUMERATION_FAILED");
  await registry.createApproval(staged.definition.id, {
    id: "synthetic-runtime-compat-approval",
    reviewedBy: "fixture-reviewer",
    reviewedAt: new Date().toISOString(),
    decision: "approved",
    approvedVersion: staged.definition.version,
    approvedCommit: "a".repeat(40),
    allowedRoles: ["implementation"],
    allowedTaskTypes: ["implement-frontend"],
    allowedTools: ["workspace-write"],
    deniedTools: [],
    allowedCommandPatterns: [],
    deniedCommandPatterns: [],
    notes: "Synthetic fixture approval.",
  });
  await registry.promoteApproved(staged.definition.id);
  const loaded = await registry.load({
    skillId: staged.definition.id,
    role: "implementation",
    taskType: "implement-frontend",
    requestedTools: ["workspace-write"],
    contextBudgetBytes: 100_000,
  });
  if (!loaded.skillMarkdown.includes("Verify registry enumeration") || loaded.citation.sourceChecksum !== staged.definition.sourceChecksum)
    throw new RegressionFailure("RUNTIME", "APPROVED_LOAD_CHECKSUM_FAILED");

  const outside = path.join(path.dirname(sourceRoot), "outside.txt");
  await writeFile(outside, "synthetic outside fixture\n", "utf8");
  let symlinkSupported = true;
  try {
    await symlink(outside, path.join(sourceRoot, "escape.txt"));
  } catch {
    symlinkSupported = false;
  }
  if (!symlinkSupported)
    return { enumeration: "PASS", approvedLoad: "PASS", manifestChecksum: "PASS", symlinkContainment: "UNSUPPORTED" } as const;
  try {
    await registry.stageLocalImport(sourceRoot, { license: "MIT", skillId: "synthetic-symlink" });
    throw new RegressionFailure("RUNTIME", "SYMLINK_ESCAPE_ACCEPTED");
  } catch (error) {
    if ((error as { code?: string }).code !== "SKILL_SOURCE_INVALID") throw error;
  }
  return { enumeration: "PASS", approvedLoad: "PASS", manifestChecksum: "PASS", symlinkContainment: "PASS" } as const;
}

async function setDenied(directory: string, identity: string) {
  await execFileAsync("icacls.exe", [directory, "/deny", identity + ":(OI)(CI)(RX)"], { windowsHide: true });
}

async function clearDenied(directory: string, identity: string) {
  await execFileAsync("icacls.exe", [directory, "/remove:d", identity], { windowsHide: true });
}

async function main() {
  if (process.platform !== "win32") {
    console.log("TURBOPACK_SKILL_REGISTRY_REGRESSION: UNSUPPORTED_PLATFORM");
    return;
  }
  if (process.env.TURBOPACK_SKILL_REGISTRY_REGRESSION !== "1") {
    console.log("TURBOPACK_SKILL_REGISTRY_REGRESSION: SKIPPED (set TURBOPACK_SKILL_REGISTRY_REGRESSION=1)");
    return;
  }

  const fixture = await mkdtemp(path.join(os.tmpdir(), "factory-turbopack-skill-registry-"));
  const deniedRoot = path.join(fixture, "runtime-data", "safe");
  let identity = "";
  let denied = false;
  try {
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { dependencies: Record<string, string> };
    await mkdir(path.join(fixture, "src", "app", "api", "probe"), { recursive: true });
    await mkdir(path.join(fixture, "src", "skills"), { recursive: true });
    await mkdir(path.join(fixture, "src", "runtime", "filesystem"), { recursive: true });
    await mkdir(deniedRoot, { recursive: true });
    await writeFile(path.join(fixture, "package.json"), JSON.stringify({
      private: true,
      scripts: { build: "next build" },
      dependencies: {
        next: packageJson.dependencies.next,
        react: packageJson.dependencies.react,
        "react-dom": packageJson.dependencies["react-dom"],
      },
      devDependencies: { typescript: "^5" },
    }, null, 2) + "\n", "utf8");
    await writeFile(path.join(fixture, "next.config.ts"), "export default { turbopack: { root: process.cwd() } };\n", "utf8");
    await writeFile(path.join(fixture, "next-env.d.ts"), "/// <reference types=\"next\" />\n/// <reference types=\"next/image-types/global\" />\n\n// NOTE: This file should not be edited\n", "utf8");
    await writeFile(path.join(fixture, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        target: "ES2017",
        lib: ["dom", "dom.iterable", "esnext"],
        allowJs: false,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: "esnext",
        moduleResolution: "bundler",
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: "react-jsx",
        paths: { "@/*": ["./src/*"] },
      },
      include: ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
    }, null, 2) + "\n", "utf8");
    await writeFile(path.join(fixture, "src", "app", "api", "probe", "route.ts"), [
      "import path from \"node:path\";",
      "import { SkillRegistry } from \"@/skills/registry/registry\";",
      "",
      "export function GET() {",
      "  const registry = new SkillRegistry(path.join(/* turbopackIgnore: true */ process.cwd(), \"runtime-data\", \"safe\"));",
      "  return Response.json({ root: registry.root });",
      "}",
      "",
    ].join("\n"), "utf8");
    await writeFile(path.join(deniedRoot, "target.txt"), "synthetic target\n", "utf8");
    await cp(path.join(root, "node_modules"), path.join(fixture, "node_modules"), { recursive: true, dereference: true });
    await cp(path.join(root, "src", "skills", "registry"), path.join(fixture, "src", "skills", "registry"), { recursive: true });
    await cp(path.join(root, "src", "runtime", "filesystem", "directory.ts"), path.join(fixture, "src", "runtime", "filesystem", "directory.ts"));
    await assertNoReparsePoints(fixture);

    const candidatePath = path.join(root, "src", "skills", "registry", "registry.ts");
    const candidate = await readFile(candidatePath, "utf8");
    const baseline = execFileSync("git", ["show", "HEAD:src/skills/registry/registry.ts"], { cwd: root, encoding: "utf8", windowsHide: true });
    await writeFile(path.join(fixture, "src", "skills", "registry", "registry.ts"), candidate, "utf8");
    const readable = await runBuild(fixture, "pass");
    identity = execFileSync("whoami", [], { encoding: "utf8", windowsHide: true }).trim();
    await setDenied(deniedRoot, identity);
    denied = true;
    await writeFile(path.join(fixture, "src", "skills", "registry", "registry.ts"), baseline, "utf8");
    const negative = await runBuild(fixture, "traversal-failure");
    await writeFile(path.join(fixture, "src", "skills", "registry", "registry.ts"), candidate, "utf8");
    const repaired = await runBuild(fixture, "pass");
    await clearDenied(deniedRoot, identity);
    denied = false;
    const runtime = await runRuntimeCompatibility(path.join(fixture, "runtime-data", "registry"), path.join(fixture, "runtime-data", "source"));
    console.log(JSON.stringify({
      status: runtime.symlinkContainment === "PASS" ? "PASS" : "UNSUPPORTED_SYMLINK_SETUP",
      readableBuild: readable.status,
      negativeControl: negative.status,
      repairedBuild: repaired.status,
      runtime,
      externalProviderCalls: 0,
      databaseAccess: false,
    }));
  } catch (error) {
    if (error instanceof RegressionFailure) {
      console.error("TURBOPACK_SKILL_REGISTRY_REGRESSION_FAILED:" + error.stage + ":" + error.code);
    } else {
      console.error("TURBOPACK_SKILL_REGISTRY_REGRESSION_FAILED:SETUP:UNEXPECTED_ERROR");
    }
    process.exitCode = 1;
  } finally {
    if (denied && identity) {
      try { await clearDenied(deniedRoot, identity); } catch { /* fixture cleanup remains bounded */ }
    }
    await rm(fixture, { recursive: true, force: true });
  }
}

main().catch(() => {
  console.error("TURBOPACK_SKILL_REGISTRY_REGRESSION_FAILED:SETUP:UNHANDLED_ERROR");
  process.exitCode = 1;
});
