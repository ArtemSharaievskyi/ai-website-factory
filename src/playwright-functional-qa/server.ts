import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildRuntimeEnvironment } from "../runtime-validation/policy";
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

export class NodeLocalTestServer implements LocalServerLauncher {
  private readonly processes = new Map<number, ChildProcess>();
  async start(input: { workspacePath: string; port: number; signal?: AbortSignal }): Promise<LocalServerHandle> {
    if (input.signal?.aborted) throw new FunctionalQaError("QA_CANCELLED", "QA was cancelled before server start.");
    let packageJson: { scripts?: Record<string, unknown> };
    try { packageJson = JSON.parse(await readFile(path.join(input.workspacePath, "package.json"), "utf8")) as typeof packageJson; } catch (error) { throw new FunctionalQaError("QA_SERVER_START_FAILED", "The generated package manifest could not be read.", error); }
    assertSafeTestServerScript(packageJson.scripts?.["start:test"]);
    const executable = process.platform === "win32" ? "npm.cmd" : "npm";
    const env = buildRuntimeEnvironment({ projectId: "00000000-0000-0000-0000-000000000000", projectVersion: 1, workspacePath: input.workspacePath, generatedProjectsRoot: path.dirname(input.workspacePath), mutable: true });
    env.HOSTNAME = "127.0.0.1"; env.HOST = "127.0.0.1"; env.PORT = String(input.port); Object.assign(env, { NODE_ENV: "production" });
    const command = buildLocalTestServerCommand(input.port); const child = spawn(executable, command.args, { cwd: input.workspacePath, env, shell: process.platform === "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const pid = child.pid;
    if (!pid) throw new FunctionalQaError("QA_SERVER_START_FAILED", "The local test server did not produce a process id.");
    const handle = { pid, port: input.port, baseUrl: `http://127.0.0.1:${input.port}` };
    this.processes.set(pid, child);
    child.once("error", () => this.processes.delete(pid)); child.once("exit", () => this.processes.delete(pid));
    input.signal?.addEventListener("abort", () => { void this.stop(handle); }, { once: true });
    return handle;
  }
  async stop(handle: LocalServerHandle) { const child = this.processes.get(handle.pid); if (!child) { await terminateProcessTree(handle.pid); return; } await terminateProcessTree(handle.pid); child.kill(); await new Promise<void>((resolve) => { const timer = setTimeout(resolve, 5000); child.once("exit", () => { clearTimeout(timer); resolve(); }); }); if (await this.isRunning(handle)) throw new FunctionalQaError("QA_SERVER_STOP_FAILED", "The local test server did not stop."); }
  async isRunning(handle: LocalServerHandle) { const child = this.processes.get(handle.pid); return Boolean(child && child.exitCode === null && !child.killed); }
}

export async function waitForLocalReadinessWithMetadata(baseUrl: string, port: number, route = "/", timeoutMs = 30000, signal?: AbortSignal) {
  const deadline = Date.now() + timeoutMs; let lastError: unknown; let attempts = 0;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new FunctionalQaError("QA_CANCELLED", "QA was cancelled while waiting for the local server.");
    attempts += 1; try { const response = await fetch(`${baseUrl}${route}`, { signal }); if (response.status < 500) return { status: response.status, attempts }; } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new FunctionalQaError("QA_SERVER_READY_TIMEOUT", "The local test server did not become ready in time.", lastError);
}
export async function waitForLocalReadiness(baseUrl: string, port: number, route = "/", timeoutMs = 30000, signal?: AbortSignal) { return (await waitForLocalReadinessWithMetadata(baseUrl, port, route, timeoutMs, signal)).status; }
