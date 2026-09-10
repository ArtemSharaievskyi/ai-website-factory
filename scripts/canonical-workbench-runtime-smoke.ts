import { access } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const argument = (name: string) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

async function main() {
  const projectId = argument("--project");
  const port = Number(argument("--port") ?? "3100");
  if (!projectId || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("CANONICAL_WORKBENCH_SMOKE_ARGUMENTS_INVALID");
  }

  const serverPath = path.resolve(process.cwd(), ".next/standalone/server.js");
  await access(serverPath);

  let stderr = "";
  const server = spawn(process.execPath, [serverPath], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1" },
    shell: false,
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe"],
  });
  server.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  const stop = async () => {
    if (!server.killed && server.exitCode === null) server.kill();
    await Promise.race([
      new Promise<void>((resolve) => server.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
    ]);
  };

  const request = async (input: string, init?: RequestInit) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        return await fetch(`http://127.0.0.1:${port}${input}`, {
          ...init,
          signal: AbortSignal.timeout(1_000),
        });
      } catch {
        if (server.exitCode !== null) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    throw new Error(`CANONICAL_WORKBENCH_SERVER_UNAVAILABLE:${stderr.slice(-500)}`);
  };

  try {
    const health = await request("/api/health");
    if (health.status !== 200) throw new Error(`CANONICAL_WORKBENCH_HEALTH_FAILED:${health.status}`);

    const status = await request("/api/workbench", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "status", projectId }),
    });
    const payload = await status.json() as { ok?: boolean; data?: { project?: { workflowState?: string } }; code?: string };
    if (status.status !== 200 || payload.ok !== true) throw new Error(`CANONICAL_WORKBENCH_STATUS_FAILED:${status.status}:${payload.code ?? "UNKNOWN"}`);
    if (payload.data?.project?.workflowState !== "AWAITING_PLANNING_GENERATION") throw new Error("CANONICAL_WORKBENCH_STATUS_UNEXPECTED_WORKFLOW");

    console.log(`CANONICAL_WORKBENCH_RUNTIME_PASS health=${health.status} status=${status.status} workflow=${payload.data.project.workflowState}`);
  } finally {
    await stop();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "CANONICAL_WORKBENCH_SMOKE_FAILED");
  process.exitCode = 1;
});
