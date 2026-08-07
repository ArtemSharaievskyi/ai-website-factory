import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { probeNpmAvailability, resolveNpmExecutable, resolveNpmInvocation } from "./runner";

async function npmPathFixture() { const root = await mkdtemp(path.join(os.tmpdir(), "factory-npm-resolution-")); const cli = path.join(root, "node_modules", "npm", "bin"); await mkdir(cli, { recursive: true }); await writeFile(path.join(root, "npm.cmd"), "@echo off\n"); await writeFile(path.join(cli, "npm-cli.js"), ""); return root; }
describe("canonical npm executable resolution", () => {
  it("uses npm.cmd on Windows and resolves a direct Node invocation", async () => { const root = await npmPathFixture(); try { const invocation = await resolveNpmInvocation({ Path: root } as unknown as NodeJS.ProcessEnv, "win32"); expect(resolveNpmExecutable("win32")).toBe("npm.cmd"); expect(invocation).toMatchObject({ kind: "npm.cmd", argsPrefix: [path.join(root, "node_modules", "npm", "bin", "npm-cli.js")] }); } finally { await rm(root, { recursive: true, force: true }); } });
  it("handles Git Bash style Windows PATH entries", async () => { const root = await npmPathFixture(); try { const drivePath = `/${root[0].toLowerCase()}${root.slice(2).replaceAll("\\", "/")}`; expect((await resolveNpmInvocation({ Path: drivePath, MSYSTEM: "MINGW64" } as unknown as NodeJS.ProcessEnv, "win32"))?.kind).toBe("npm.cmd"); } finally { await rm(root, { recursive: true, force: true }); } });
  it("searches Windows PATH entries in order", async () => { const root = await npmPathFixture(); try { expect((await resolveNpmInvocation({ Path: `${path.join(root, "missing")};${root}` } as unknown as NodeJS.ProcessEnv, "win32"))?.kind).toBe("npm.cmd"); } finally { await rm(root, { recursive: true, force: true }); } });
  it("reports npm unavailable without accepting an arbitrary executable", async () => { expect(await resolveNpmInvocation({ Path: "C:\\missing" } as unknown as NodeJS.ProcessEnv, "win32")).toBeUndefined(); expect((await probeNpmAvailability({ PATH: "C:\\missing" } as unknown as NodeJS.ProcessEnv)).available).toBe(false); });
  it("uses shell:false for the approved probe and never accepts a caller executable", async () => { const source = await (await import("node:fs/promises")).readFile(path.resolve(__dirname, "runner.ts"), "utf8"); expect(source).toContain("shell: false"); expect(source).not.toContain("shell: true"); expect(source).not.toMatch(/request\.executable\s*\+|env\.[A-Z_]+\s*\|\|\s*request\.executable/); });
});
