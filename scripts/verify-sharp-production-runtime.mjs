import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
const serverRoot = path.join(standalone, ".next", "server");

function fail(message) {
  console.error(`SHARP_PRODUCTION_RUNTIME_VERIFY_FAILED:${message}`);
  process.exitCode = 1;
}

function filesUnder(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const name of readdirSync(directory)) {
    const file = path.join(directory, name);
    const stat = statSync(file);
    if (stat.isDirectory()) files.push(...filesUnder(file));
    else files.push(file);
  }
  return files;
}

if (!existsSync(path.join(standalone, "server.js"))) fail("STANDALONE_SERVER_MISSING");
if (!existsSync(path.join(standalone, "node_modules", "sharp"))) fail("SHARP_PACKAGE_MISSING");
if (!filesUnder(path.join(standalone, "node_modules", "@img")).some((file) => /sharp-[^\\/]+[\\/]lib[\\/].+\.node$/i.test(file))) fail("SHARP_NATIVE_BINDING_MISSING");

const serverFiles = filesUnder(serverRoot);
const hashedReferences = [];
let publicEmailTarget = false;
for (const file of serverFiles) {
  if (!/\.(?:js|cjs|mjs)$/.test(file)) continue;
  const text = readFileSync(file, "utf8");
  if (/sharp-[0-9a-f]{8,}/i.test(text)) hashedReferences.push(path.relative(root, file));
  if (text.includes("PUBLIC_CONTACT_EMAIL")) publicEmailTarget = true;
}
if (hashedReferences.length) fail(`HASHED_SHARP_REFERENCE:${hashedReferences.join(",")}`);
if (!publicEmailTarget) fail("PUBLIC_CONTACT_EMAIL_TARGET_MISSING");
if (existsSync(path.join(standalone, ".factory", "tools"))) fail("FACTORY_TOOLS_BUNDLED");
if (filesUnder(standalone).some((file) => /codebase-memory(?:-mcp)?(?:\.exe)?$/i.test(path.basename(file)))) fail("CODEBASE_MEMORY_EXECUTABLE_BUNDLED");

if (!process.exitCode) {
  console.log(JSON.stringify({
    standaloneServer: true,
    sharpPackage: true,
    sharpNativeBinding: true,
    hashedSharpReferences: 0,
    factoryToolsBundled: false,
    codebaseMemoryExecutableBundled: false,
    publicEmailTarget: true,
  }));
}
