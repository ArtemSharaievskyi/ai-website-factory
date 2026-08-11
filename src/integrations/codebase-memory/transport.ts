import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { CodebaseMemoryError } from "./errors";

export type UpstreamTool = "index_repository" | "index_status" | "search_graph" | "trace_path" | "query_graph" | "get_code_snippet" | "get_architecture";
export const UPSTREAM_READ_ONLY_ALLOWLIST = new Set<UpstreamTool>(["index_repository", "index_status", "search_graph", "trace_path", "query_graph", "get_code_snippet", "get_architecture"]);
export const CODEBASE_MEMORY_RAW_LINE_MAX_BYTES = 200_000;
export const CODEBASE_MEMORY_STDERR_MAX_BYTES = 16_000;
export type UpstreamTransport = (tool: UpstreamTool, args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>;

const CHILD_ENVIRONMENT_KEYS = ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "COMSPEC"] as const;

export function buildCodebaseMemoryChildEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: source.NODE_ENV ?? "production" };
  for (const key of CHILD_ENVIRONMENT_KEYS) if (source[key] !== undefined) environment[key] = source[key];
  return environment;
}

type PendingCall = { resolve: (value: string) => void; reject: (error: unknown) => void };
type JsonRpcResponse = { id?: number; result?: unknown; error?: { message?: string } };

export class CodebaseMemoryProcessTransport {
  private process?: ChildProcessWithoutNullStreams;
  private buffer = Buffer.alloc(0);
  private pending = new Map<number, PendingCall>();
  private terminations = new Set<Promise<void>>();
  private nextId = 1;
  private stderrBytes = 0;

  constructor(private readonly executable: string, private readonly cwd: string, private readonly timeoutMs: number, private readonly environment: NodeJS.ProcessEnv = buildCodebaseMemoryChildEnvironment()) {}

  async call(tool: UpstreamTool, args: Record<string, unknown>, signal?: AbortSignal) {
    if (!UPSTREAM_READ_ONLY_ALLOWLIST.has(tool)) throw new CodebaseMemoryError("CODEBASE_MEMORY_OPERATION_NOT_ALLOWED", "The upstream operation is not on the read-only allowlist.");
    if (signal?.aborted) throw new CodebaseMemoryError("CODEBASE_MEMORY_CANCELLED", "Codebase Memory request was cancelled.");
    this.start();
    const id = this.nextId++;
    const promise = new Promise<string>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.process!.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: tool, arguments: args } })}\n`);
    const timer = setTimeout(() => {
      this.cancelPending(id, new CodebaseMemoryError("CODEBASE_MEMORY_TIMEOUT", "Codebase Memory request timed out."));
    }, this.timeoutMs);
    const abort = () => {
      clearTimeout(timer);
      this.cancelPending(id, new CodebaseMemoryError("CODEBASE_MEMORY_CANCELLED", "Codebase Memory request was cancelled."));
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      return await promise;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  private start() {
    if (this.process) return;
    const child = spawn(this.executable, [], { cwd: this.cwd, env: { ...this.environment }, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    this.process = child;
    this.stderrBytes = 0;
    child.stdout.on("data", (chunk: Buffer) => this.consumeStdout(child, chunk));
    child.stderr.on("data", (chunk: Buffer) => this.consumeStderr(chunk));
    child.on("exit", () => {
      if (this.process !== child) return;
      this.process = undefined;
      this.buffer = Buffer.alloc(0);
      this.stderrBytes = 0;
      const pending = [...this.pending.values()];
      this.pending.clear();
      for (const request of pending) request.reject(new CodebaseMemoryError("CODEBASE_MEMORY_UNAVAILABLE", "Codebase Memory process exited."));
    });
  }

  private consumeStderr(chunk: Buffer) {
    this.stderrBytes = Math.min(CODEBASE_MEMORY_STDERR_MAX_BYTES, this.stderrBytes + chunk.length);
  }

  private consumeStdout(child: ChildProcessWithoutNullStreams, chunk: Buffer) {
    let remaining = chunk;
    while (remaining.length) {
      const newline = remaining.indexOf(0x0a);
      const segment = newline >= 0 ? remaining.subarray(0, newline + 1) : remaining;
      if (this.buffer.length + segment.length > CODEBASE_MEMORY_RAW_LINE_MAX_BYTES) {
        this.failOverflow(child);
        return;
      }
      const line = Buffer.concat([this.buffer, segment]);
      this.buffer = newline >= 0 ? Buffer.alloc(0) : line;
      if (newline < 0) return;
      this.consumeLine(child, line.subarray(0, line.length - 1).toString("utf8"));
      if (this.process !== child) return;
      remaining = remaining.subarray(newline + 1);
    }
  }

  private consumeLine(child: ChildProcessWithoutNullStreams, raw: string) {
    try {
      const value = JSON.parse(raw) as JsonRpcResponse;
      if (value.id === undefined || !this.pending.has(value.id)) return;
      const pending = this.pending.get(value.id)!;
      this.pending.delete(value.id);
      if (value.error) {
        pending.reject(new CodebaseMemoryError("CODEBASE_MEMORY_UNAVAILABLE", value.error.message ?? "Upstream Codebase Memory error."));
        return;
      }
      const serialized = JSON.stringify(value.result);
      if (typeof serialized !== "string") {
        pending.reject(new CodebaseMemoryError("CODEBASE_MEMORY_UNAVAILABLE", "Codebase Memory returned no serialized result."));
        return;
      }
      pending.resolve(serialized);
    } catch {
      // Malformed response is bounded by the request timeout.
    }
  }

  private failOverflow(child: ChildProcessWithoutNullStreams) {
    if (this.process !== child) return;
    this.process = undefined;
    this.buffer = Buffer.alloc(0);
    this.stderrBytes = 0;
    const error = new CodebaseMemoryError("CODEBASE_MEMORY_UNAVAILABLE", "Upstream Codebase Memory response exceeded the bounded transport limit.");
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const request of pending) request.reject(error);
    void this.terminate(child);
  }

  async close() {
    const child = this.process;
    this.process = undefined;
    this.buffer = Buffer.alloc(0);
    this.stderrBytes = 0;
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const request of pending) request.reject(new CodebaseMemoryError("CODEBASE_MEMORY_CANCELLED", "Codebase Memory request was cancelled."));
    if (child) await this.terminate(child);
    await Promise.all([...this.terminations]);
  }

  private cancelPending(id: number, error: CodebaseMemoryError) {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    pending.reject(error);
    const child = this.process;
    if (child && this.pending.size === 0) {
      this.process = undefined;
      this.buffer = Buffer.alloc(0);
      this.stderrBytes = 0;
      void this.terminate(child);
    }
  }

  private terminate(child: ChildProcessWithoutNullStreams) {
    const completion = child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise<void>((resolve) => child.once("exit", () => resolve()));
    this.terminations.add(completion);
    void completion.then(() => this.terminations.delete(completion));
    try {
      child.kill();
    } catch {
      // Closing an already-exited child is safe and idempotent.
    }
    return completion;
  }
}

export function createProcessTransport(executable: string, cwd: string, timeoutMs: number, environment?: NodeJS.ProcessEnv): UpstreamTransport {
  const transport = new CodebaseMemoryProcessTransport(executable, cwd, timeoutMs, environment);
  return (tool, args, signal) => transport.call(tool, args, signal);
}
