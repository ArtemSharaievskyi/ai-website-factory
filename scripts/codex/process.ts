import { spawn } from "node:child_process";

export type SafeProcessResult = {
  code: number;
  stdout: string;
  stderr: string;
};

const collect = (stream: NodeJS.ReadableStream | null, limit = 256_000) => new Promise<string>((resolve) => {
  if (!stream) return resolve("");
  const chunks: Buffer[] = [];
  let bytes = 0;
  stream.on("data", (chunk: Buffer | string) => {
    if (bytes >= limit) return;
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
    const remaining = limit - bytes;
    chunks.push(value.subarray(0, remaining));
    bytes += Math.min(value.byteLength, remaining);
  });
  stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  stream.on("error", () => resolve(""));
});

export function executableForNpm() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export function executableForGit() {
  return "git";
}

export async function runSafeProcess(executable: string, args: readonly string[], cwd: string, timeoutMs = 120_000): Promise<SafeProcessResult> {
  return new Promise((resolve) => {
    let settled = false;
    // Windows exposes npm as a .cmd shim. This is a platform launch detail;
    // executable and arguments still come only from code-owned definitions.
    const commandShim = process.platform === "win32" && executable.toLowerCase().endsWith(".cmd");
    const child = spawn(executable, [...args], { cwd, env: process.env, shell: commandShim, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = collect(child.stdout);
    const stderr = collect(child.stderr);
    const timer = setTimeout(() => {
      child.kill();
    }, timeoutMs);
    const finish = async (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: await stdout, stderr: await stderr });
    };
    child.once("error", () => void finish(1));
    child.once("close", (code) => void finish(code));
  });
}

export async function runGit(root: string, args: readonly string[], timeoutMs = 30_000) {
  return runSafeProcess(executableForGit(), args, root, timeoutMs);
}

export async function runNpm(root: string, args: readonly string[], timeoutMs = 120_000) {
  return runSafeProcess(executableForNpm(), args, root, timeoutMs);
}
