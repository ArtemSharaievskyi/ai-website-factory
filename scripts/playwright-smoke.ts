import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadFactoryCliEnv } from "./cli-env";
import { chooseLoopbackPort, NodeLocalTestServer, PlaywrightBrowserRunner, waitForLocalReadiness } from "../src/runtime/qa";

loadFactoryCliEnv();

async function main() {
  if (process.env.ALLOW_PLAYWRIGHT_SMOKE !== "true") { console.error("REAL_PLAYWRIGHT_SMOKE_PENDING: set ALLOW_PLAYWRIGHT_SMOKE=true to run the opt-in local Playwright smoke test."); process.exitCode = 1; return; }
  const root = await mkdtemp(path.join(os.tmpdir(), "playwright-functional-smoke-")); const workspace = path.join(root, "fixture"); await mkdir(workspace, { recursive: true });
  await writeFile(path.join(workspace, "package.json"), JSON.stringify({ name: "playwright-functional-smoke", version: "1.0.0", scripts: { "start:test": "node server.js" } }));
  await writeFile(path.join(workspace, "server.js"), `const http = require("node:http"); const portIndex = process.argv.indexOf("--port"); const port = Number(process.argv[portIndex + 1]); http.createServer((req, res) => { if (req.url === "/success") { res.writeHead(200, { "content-type": "text/html" }); res.end("<main id=\\"success\\">Submitted</main>"); return; } res.writeHead(200, { "content-type": "text/html" }); res.end("<main><h1 id=\\"title\\">Local QA Fixture</h1><form action=\\"/success\\"><input id=\\"name\\" name=\\"name\\"><button type=\\"submit\\">Submit</button></form></main>"); }).listen(port, "127.0.0.1");`);
  const server = new NodeLocalTestServer(); const browser = new PlaywrightBrowserRunner(); let handle: Awaited<ReturnType<NodeLocalTestServer["start"]>> | undefined;
  try { handle = await server.start({ workspacePath: workspace, port: await chooseLoopbackPort() }); await waitForLocalReadiness(handle.baseUrl, handle.port); await browser.launch({ baseUrl: handle.baseUrl, port: handle.port }); await browser.navigate("/", 10000); await browser.assertVisible("#title", 5000); await browser.fill("#name", "Synthetic QA", 5000); await browser.submit("form", 5000); await browser.assertUrl("/success"); await browser.assertVisible("#success", 5000); const errors = await browser.readConsoleErrors(); console.log(JSON.stringify({ status: errors.length ? "failed" : "passed", route: "/success", browserErrors: errors.length })); if (errors.length) process.exitCode = 1; }
  catch (error) { console.error(`REAL_PLAYWRIGHT_SMOKE_FAILED: ${error instanceof Error ? error.message : "safe failure"}`); process.exitCode = 1; }
  finally { await browser.close().catch(() => undefined); if (handle) await server.stop(handle).catch(() => undefined); await rm(root, { recursive: true, force: true }); }
}
void main();
