import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { buildRuntimeEnvironment } from "../runtime-validation/policy";
import { resolveNpmInvocation } from "../runtime-validation/runner";
import { FunctionalQaError } from "./errors";
import { assertSafeTestServerScript } from "./policy";
import type { LocalServerHandle, LocalServerLauncher } from "./contracts";

export async function chooseLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const port = (server.address() as { port: number }).port; server.close(() => resolve(port)); }); });
}

export function buildLocalTestServerCommand(port: number) {
  return { script: "start:test", args: ["run", "start:test", "--", "--hostname", "127.0.0.1", "--port", String(port)], host: "127.0.0.1", port: String(port) };
}

function terminateProcessTree(pid: number) {
  return new Promise<void>((resolve) => {
    if (process.platform !== "win32") { resolve(); return; }
    execFile("taskkill", ["/pid", String(pid), "/t", "/f"], () => resolve());
  });
}

function boundedOutput(value: string) { return value.replaceAll(/\s+/g, " ").trim().slice(-300); }

export class NodeLocalTestServer implements LocalServerLauncher {
  private readonly processes = new Map<number, ChildProcess>();
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
    if (!pid) throw new FunctionalQaError("QA_SERVER_START_FAILED", "The local test server did not produce a process id.");
    const handle: LocalServerHandle = { pid, port: input.port, baseUrl: `http://127.0.0.1:${input.port}`, lifecycle };
    this.processes.set(pid, child);
    child.stdout?.on("data", (chunk: Buffer) => { const value = chunk.toString("utf8"); lifecycle.stdoutBytes += Buffer.byteLength(value); lifecycle.stdoutSummary = boundedOutput(`${lifecycle.stdoutSummary ?? ""} ${value}`); if (/\bready\b|started server|local:/i.test(value)) lifecycle.nextReadyTextObserved = true; });
    child.stderr?.on("data", (chunk: Buffer) => { const value = chunk.toString("utf8"); lifecycle.stderrBytes += Buffer.byteLength(value); lifecycle.stderrSummary = boundedOutput(`${lifecycle.stderrSummary ?? ""} ${value}`); if (/\bready\b|started server|local:/i.test(value)) lifecycle.nextReadyTextObserved = true; });
    child.once("error", (error) => { lifecycle.stderrSummary = boundedOutput(`${lifecycle.stderrSummary ?? ""} ${error.message}`); lifecycle.exitCode = null; this.processes.delete(pid); }); child.once("exit", (code) => { lifecycle.exitCode = code; this.processes.delete(pid); });
    input.signal?.addEventListener("abort", () => { void this.stop(handle); }, { once: true });
    return handle;
  }
  async waitForReady(handle: LocalServerHandle, timeoutMs: number, signal?: AbortSignal) { try { const result = await waitForLocalReadinessWithMetadata(handle.baseUrl, handle.port, "/", timeoutMs, signal, { isAlive: () => this.isRunning(handle), onAttempt: (attempt) => { if (handle.lifecycle) handle.lifecycle.readinessAttempts = attempt; } }); if (handle.lifecycle) { handle.lifecycle.readinessElapsedMs = Date.now() - handle.lifecycle.startedAt; handle.lifecycle.readinessSucceeded = true; } return result.status; } finally { if (handle.lifecycle && handle.lifecycle.readinessElapsedMs === undefined) handle.lifecycle.readinessElapsedMs = Date.now() - handle.lifecycle.startedAt; } }
  async stop(handle: LocalServerHandle) { const child = this.processes.get(handle.pid); if (!child) { await terminateProcessTree(handle.pid); return; } await terminateProcessTree(handle.pid); child.kill(); await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 5000); child.once("exit", () => { clearTimeout(timer); resolve(); }); }); if (await this.isRunning(handle)) throw new FunctionalQaError("QA_SERVER_STOP_FAILED", "The local test server did not stop."); }
  async isRunning(handle: LocalServerHandle) { const child = this.processes.get(handle.pid); return Boolean(child && child.exitCode === null && !child.killed); }
}

export async function waitForLocalReadinessWithMetadata(baseUrl: string, port: number, route = "/", timeoutMs = 30000, signal?: AbortSignal, options: { isAlive?: () => Promise<boolean>; onAttempt?: (attempt: number) => void } = {}) {
  const deadline = Date.now() + timeoutMs; let lastError: unknown; let attempts = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new FunctionalQaError("QA_CANCELLED", "QA was cancelled while waiting for the local server.");
    if (options.isAlive && !(await options.isAlive())) throw new FunctionalQaError("QA_SERVER_RUNTIME_FAILED", "The local test server exited before HTTP readiness.", lastError);
    attempts += 1; options.onAttempt?.(attempts); try { const response = await fetch(`${baseUrl}${route}`, { signal }); if (response.status < 500) return { status: response.status, attempts }; } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new FunctionalQaError("QA_SERVER_READY_TIMEOUT", "The local test server did not become ready in time.", lastError);
}
export async function waitForLocalReadiness(baseUrl: string, port: number, route = "/", timeoutMs = 30000, signal?: AbortSignal) { return (await waitForLocalReadinessWithMetadata(baseUrl, port, route, timeoutMs, signal)).status; }
