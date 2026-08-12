import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { buildRuntimeEnvironment } from "@/runtime/validation/policy";
import { resolveNpmInvocation } from "@/runtime/validation/runner";
import { FunctionalQaError } from "./errors";
import { assertSafeTestServerScript } from "./policy";
import type { LocalServerHandle, LocalServerLauncher } from "./contracts";

export async function chooseLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const port = (server.address() as { port: number }).port; server.close(() => resolve(port)); }); });
}

export function buildLocalTestServerCommand(port: number) {
  return { script: "start:test", args: ["run", "start:test", "--", "--hostname", "127.0.0.1", "--port", String(port)], host: "127.0.0.1", port: String(port) };
}

type OwnedProcessRecord = { token: string; pid: number; child: ChildProcess; exited: boolean; exitCode?: number | null };
export type NodeLocalTestServerOptions = { platform?: NodeJS.Platform; gracefulWaitMs?: number; exitWaitMs?: number; terminateProcessTree?: (pid: number) => Promise<boolean>; sleep?: (milliseconds: number) => Promise<void> };

function terminateProcessTree(pid: number, platform: NodeJS.Platform) {
  if (platform !== "win32") return Promise.resolve(false);
  return new Promise<boolean>((resolve) => { execFile("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true }, (error) => resolve(!error)); });
}

function boundedOutput(value: string) { return value.replaceAll(/\s+/g, " ").trim().slice(-300); }

export class NodeLocalTestServer implements LocalServerLauncher {
  private readonly processes = new Map<string, OwnedProcessRecord>();
  private readonly platform: NodeJS.Platform;
  private readonly gracefulWaitMs: number;
  private readonly exitWaitMs: number;
  private readonly terminateTree: (pid: number) => Promise<boolean>;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: NodeLocalTestServerOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.gracefulWaitMs = options.gracefulWaitMs ?? 250;
    this.exitWaitMs = options.exitWaitMs ?? 5000;
    this.terminateTree = options.terminateProcessTree ?? ((pid) => terminateProcessTree(pid, this.platform));
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async start(input: { workspacePath: string; port: number; signal?: AbortSignal }): Promise<LocalServerHandle> {
    if (input.signal?.aborted) throw new FunctionalQaError("QA_CANCELLED", "QA was cancelled before server start.");
    let packageJson: { scripts?: Record<string, unknown> };
    try { packageJson = JSON.parse(await readFile(path.join(input.workspacePath, "package.json"), "utf8")) as typeof packageJson; } catch (error) { throw new FunctionalQaError("QA_SERVER_START_FAILED", "The generated package manifest could not be read.", error); }
    assertSafeTestServerScript(packageJson.scripts?.["start:test"]);
    try { await access(path.join(input.workspacePath, ".next", "BUILD_ID")); } catch (error) { throw new FunctionalQaError("QA_SERVER_BUILD_NOT_FOUND", "The validated QA workspace is missing the Next.js production build.", error); }
    const env = buildRuntimeEnvironment({ projectId: "00000000-0000-0000-0000-000000000000", projectVersion: 1, workspacePath: input.workspacePath, generatedProjectsRoot: path.dirname(input.workspacePath), mutable: true });
    env.HOSTNAME = "127.0.0.1"; env.HOST = "127.0.0.1"; env.PORT = String(input.port); Object.assign(env, { NODE_ENV: "production" });
    const invocation = await resolveNpmInvocation(env); if (!invocation) throw new FunctionalQaError("QA_SERVER_START_FAILED", "The approved npm executable could not be resolved.");
    const command = buildLocalTestServerCommand(input.port); const lifecycle = { workspacePath: input.workspacePath, commandIdentity: `npm ${command.args.join(" ")}`, executableIdentity: invocation.kind, hostname: command.host, cliPort: input.port, envPort: Number(env.PORT), readinessRoute: "/", startedAt: Date.now(), stdoutBytes: 0, stderrBytes: 0, stdoutSummary: undefined as string | undefined, stderrSummary: undefined as string | undefined, nextReadyTextObserved: false, readinessAttempts: 0, readinessSucceeded: false, exitCode: undefined as number | null | undefined };
    const child = spawn(invocation.executable, [...invocation.argsPrefix, ...command.args], { cwd: input.workspacePath, env, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const pid = child.pid;
    if (!pid) { child.kill(); throw new FunctionalQaError("QA_SERVER_START_FAILED", "The local test server did not produce a process id."); }
    const ownerToken = randomUUID();
    const record: OwnedProcessRecord = { token: ownerToken, pid, child, exited: false };
    this.processes.set(ownerToken, record);
    const handle: LocalServerHandle = { pid, port: input.port, baseUrl: `http://127.0.0.1:${input.port}`, ownerToken, lifecycle };
    child.stdout?.on("data", (chunk: Buffer) => { const value = chunk.toString("utf8"); lifecycle.stdoutBytes += Buffer.byteLength(value); lifecycle.stdoutSummary = boundedOutput(`${lifecycle.stdoutSummary ?? ""} ${value}`); if (/\bready\b|started server|local:/i.test(value)) lifecycle.nextReadyTextObserved = true; });
    child.stderr?.on("data", (chunk: Buffer) => { const value = chunk.toString("utf8"); lifecycle.stderrBytes += Buffer.byteLength(value); lifecycle.stderrSummary = boundedOutput(`${lifecycle.stderrSummary ?? ""} ${value}`); if (/\bready\b|started server|local:/i.test(value)) lifecycle.nextReadyTextObserved = true; });
    child.once("error", (error) => { lifecycle.stderrSummary = boundedOutput(`${lifecycle.stderrSummary ?? ""} ${error.message}`); lifecycle.exitCode = null; record.exited = true; record.exitCode = null; });
    child.once("exit", (code) => { lifecycle.exitCode = code; record.exited = true; record.exitCode = code; });
    input.signal?.addEventListener("abort", () => { void this.stop(handle).catch(() => undefined); }, { once: true });
    return handle;
  }

  async waitForReady(handle: LocalServerHandle, timeoutMs: number, signal?: AbortSignal) { try { const result = await waitForLocalReadinessWithMetadata(handle.baseUrl, handle.port, "/", timeoutMs, signal, { isAlive: () => this.isRunning(handle), onAttempt: (attempt) => { if (handle.lifecycle) handle.lifecycle.readinessAttempts = attempt; } }); if (handle.lifecycle) { handle.lifecycle.readinessElapsedMs = Date.now() - handle.lifecycle.startedAt; handle.lifecycle.readinessSucceeded = true; } return result.status; } finally { if (handle.lifecycle && handle.lifecycle.readinessElapsedMs === undefined) handle.lifecycle.readinessElapsedMs = Date.now() - handle.lifecycle.startedAt; } }

  async stop(handle: LocalServerHandle) {
    const record = handle.ownerToken ? this.processes.get(handle.ownerToken) : undefined;
    if (!record || record.pid !== handle.pid) throw new FunctionalQaError("QA_PROCESS_TERMINATION_FAILED", "The QA server handle is not owned by this host runtime.");
    if (record.exited) return;
    if (this.platform === "win32") {
      // npm.cmd launches the Next child and can exit as soon as its launcher
      // receives a signal. Terminate the validated process tree while the
      // owned root is still present so descendants cannot be orphaned.
      await this.terminateTree(record.pid);
      await this.waitForExit(record, this.exitWaitMs);
    } else {
      try { record.child.kill(); } catch { /* The exit verification below remains authoritative. */ }
      await this.waitForExit(record, this.gracefulWaitMs);
    }
    if (!record.exited) {
      if (this.platform !== "win32") await this.terminateTree(record.pid);
      try { record.child.kill(); } catch { /* Escalation is bounded and verified below. */ }
      await this.waitForExit(record, this.exitWaitMs);
    }
    if (!record.exited) throw new FunctionalQaError("QA_PROCESS_TERMINATION_FAILED", "The owned QA server process did not exit within the bounded shutdown window.");
  }

  async isRunning(handle: LocalServerHandle) {
    const record = handle.ownerToken ? this.processes.get(handle.ownerToken) : undefined;
    return Boolean(record && record.pid === handle.pid && !record.exited);
  }

  private async waitForExit(record: OwnedProcessRecord, timeoutMs: number) {
    if (record.exited) return true;
    await new Promise<void>((resolve) => { let settled = false; const finish = () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } }; const timer = setTimeout(finish, timeoutMs); record.child.once("exit", finish); });
    await this.sleep(0);
    return record.exited;
  }
}

export async function waitForLocalReadinessWithMetadata(baseUrl: string, port: number, route = "/", timeoutMs = 30000, signal?: AbortSignal, options: { isAlive?: () => Promise<boolean>; onAttempt?: (attempt: number) => void } = {}) {
  const deadline = Date.now() + timeoutMs; let lastError: unknown; let attempts = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new FunctionalQaError("QA_CANCELLED", "The local test server readiness probe was cancelled.");
    if (options.isAlive && !(await options.isAlive())) throw new FunctionalQaError("QA_SERVER_RUNTIME_FAILED", "The local test server exited before HTTP readiness.", lastError);
    attempts += 1; options.onAttempt?.(attempts); try { const response = await fetch(`${baseUrl}${route}`, { signal }); if (response.status < 500) return { status: response.status, attempts }; } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new FunctionalQaError("QA_SERVER_READY_TIMEOUT", "The local test server did not become ready in time.", lastError);
}

export async function waitForLocalReadiness(baseUrl: string, port: number, route = "/", timeoutMs = 30000, signal?: AbortSignal) { return (await waitForLocalReadinessWithMetadata(baseUrl, port, route, timeoutMs, signal)).status; }
