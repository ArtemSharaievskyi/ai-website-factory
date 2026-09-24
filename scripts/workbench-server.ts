import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvConfig } from "@next/env";
import { RuntimeBuildProvenanceSchema, WORKBENCH_RUNTIME_CONTRACT_VERSION } from "../src/runtime/workbench/observability";
import { assertBuiltWorkbenchWorkspace, assertSupportedWorkbenchWorkspace } from "../src/runtime/workbench/launch-contract";
import { SOURCE_WORKSPACE_ROOT_ENV } from "../src/runtime/source-head";

const root = assertSupportedWorkbenchWorkspace();
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const standaloneServer = path.join(root, ".next", "standalone", "server.js");

function git(args: string[]) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
}

function sourceFingerprint() {
  const files = git(["ls-files", "-co", "--exclude-standard", "--", "src", "scripts", "config", "next.config.ts", "package.json", "package-lock.json", "tsconfig.json"])
    .split(/\r?\n/).filter(Boolean).sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.replaceAll("\\", "/"), "utf8");
    hash.update("\0", "utf8");
    hash.update(readFileSync(path.join(root, file)));
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

function launchProvenance(environmentClass: "DEVELOPMENT" | "PRODUCTION") {
  const dirty = git(["status", "--porcelain", "--untracked-files=all"]).length > 0;
  return {
    schemaVersion: 1 as const,
    contractVersion: WORKBENCH_RUNTIME_CONTRACT_VERSION,
    sourceCommitSha: git(["rev-parse", "HEAD"]),
    sourceFingerprint: sourceFingerprint(),
    buildId: null,
    buildCreatedAt: null,
    sourceDirty: dirty,
    environmentClass,
    availability: "PARTIAL" as const,
  };
}

function runNext(command: "dev" | "build" | "start", args: string[], environment: NodeJS.ProcessEnv): Promise<number> {
  const child = spawn(process.execPath, [nextBin, command, ...args], { cwd: root, env: environment, stdio: "inherit", windowsHide: false });
  return new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    child.on("error", (error) => { console.error(`WORKBENCH_SERVER_LAUNCH_FAILED:${error.name}`); resolve(1); });
  });
}

function runStandalone(args: string[], environment: NodeJS.ProcessEnv): Promise<number> {
  const childEnvironment = { ...environment };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const [name, inlineValue] = argument.split("=", 2);
    const value = inlineValue ?? args[++index];
    if (name === "--hostname" || name === "-H") childEnvironment.HOSTNAME = value;
    else if (name === "--port" || name === "-p") childEnvironment.PORT = value;
    else if (name === "--keepAliveTimeout") childEnvironment.KEEP_ALIVE_TIMEOUT = value;
    else throw new Error(`WORKBENCH_SERVER_ARGUMENT_UNSUPPORTED:${argument}`);
    if (!value) throw new Error(`WORKBENCH_SERVER_ARGUMENT_VALUE_MISSING:${argument}`);
  }
  const child = spawn(process.execPath, [standaloneServer], { cwd: root, env: childEnvironment, stdio: "inherit", windowsHide: false });
  return new Promise((resolve) => {
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    child.on("error", (error) => { console.error(`WORKBENCH_SERVER_LAUNCH_FAILED:${error.name}`); resolve(1); });
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "build") {
    const buildId = `factory-${randomUUID()}`;
    const launch = launchProvenance("PRODUCTION");
    const exitCode = await runNext("build", args, { ...process.env, FACTORY_BUILD_ID: buildId, FACTORY_RUNTIME_ENVIRONMENT: "PRODUCTION" });
    if (exitCode !== 0) { process.exitCode = exitCode; return; }
    const finish = () => {
      const builtSourceFingerprint = sourceFingerprint();
      if (builtSourceFingerprint !== launch.sourceFingerprint) throw new Error("WORKBENCH_BUILD_SOURCE_CHANGED");
      const actualBuildId = readFileSync(path.join(root, ".next", "BUILD_ID"), "utf8").trim() || buildId;
      const provenance = RuntimeBuildProvenanceSchema.parse({ ...launch, buildId: actualBuildId, buildCreatedAt: new Date().toISOString() });
      writeFileSync(path.join(root, ".next", "workbench-runtime-provenance.json"), JSON.stringify(provenance), "utf8");
    };
    finish();
    return;
  }
  if (command === "start") {
    assertBuiltWorkbenchWorkspace(root);
    loadEnvConfig(root, false);
    const build = RuntimeBuildProvenanceSchema.parse(JSON.parse(readFileSync(path.join(root, ".next", "workbench-runtime-provenance.json"), "utf8")));
    const processStartedAt = new Date().toISOString();
    process.exitCode = await runStandalone(args, {
      ...process.env,
      FACTORY_RUNTIME_ENVIRONMENT: "PRODUCTION",
      [SOURCE_WORKSPACE_ROOT_ENV]: root,
      FACTORY_SERVER_GENERATION: randomUUID(),
      FACTORY_SERVER_STARTED_AT: processStartedAt,
      FACTORY_RUNTIME_PROVENANCE: JSON.stringify(build),
    });
    return;
  }
  if (command === "dev") {
    const launch = launchProvenance("DEVELOPMENT");
    process.exitCode = await runNext("dev", args, {
      ...process.env,
      FACTORY_RUNTIME_ENVIRONMENT: "DEVELOPMENT",
      [SOURCE_WORKSPACE_ROOT_ENV]: root,
      FACTORY_SERVER_GENERATION: randomUUID(),
      FACTORY_SERVER_STARTED_AT: new Date().toISOString(),
      FACTORY_RUNTIME_PROVENANCE: JSON.stringify(launch),
    });
    return;
  }
  console.error("Usage: npm run dev|build|start [-- next arguments]");
  process.exit(2);
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) main().catch((error) => { console.error(error instanceof Error ? error.message : "WORKBENCH_SERVER_LAUNCH_FAILED"); process.exitCode = 1; });
