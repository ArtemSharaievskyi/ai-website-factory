import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { pathToFileURL } from "node:url";
import { CODEX_ROOT } from "./config";
import { fingerprintFailure, type GuardFailure } from "./baseline-failures";

export type ArchitectureRule = {
  id: string;
  sourcePrefixes: string[];
  excludedSourcePrefixes: string[];
  forbiddenTargetPrefixes: string[];
  forbiddenModuleSpecifiers: string[];
  message: string;
};
export type ArchitectureConfig = { version: 1; sourceRoots: string[]; rules: ArchitectureRule[] };
export type ArchitectureViolation = GuardFailure & { ruleId: string; sourceFile: string; importSpecifier: string; targetFile?: string; message: string };
export type ArchitectureCheckResult = { passed: boolean; violations: ArchitectureViolation[] };
export type TsconfigPathMap = Record<string, string[]>;

const normalize = (value: string) => value.replaceAll("\\", "/").replace(/^\.\//, "");
const prefixes = (value: unknown, code: string) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error(code);
  return value.map((item) => normalize(item));
};
const object = (value: unknown, code: string) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
};

function matchesPrefix(file: string, prefix: string) {
  const normalizedFile = normalize(file).toLowerCase();
  const normalizedPrefix = normalize(prefix).toLowerCase().replace(/\/$/, "");
  return normalizedFile === normalizedPrefix || normalizedFile.startsWith(normalizedPrefix + "/");
}

export function parseArchitectureConfig(value: unknown): ArchitectureConfig {
  const root = object(value, "CODEX_ARCHITECTURE_CONFIG_INVALID");
  if (root.version !== 1) throw new Error("CODEX_ARCHITECTURE_CONFIG_VERSION_UNSUPPORTED");
  if (root.knownFailures !== undefined || root.baselineFailures !== undefined) throw new Error("CODEX_ARCHITECTURE_BASELINE_CONFIG_FORBIDDEN");
  const sourceRoots = prefixes(root.sourceRoots, "CODEX_ARCHITECTURE_ROOTS_INVALID");
  if (!Array.isArray(root.rules)) throw new Error("CODEX_ARCHITECTURE_RULES_INVALID");
  const rules = root.rules.map((item) => {
    const rule = object(item, "CODEX_ARCHITECTURE_RULE_INVALID");
    if (typeof rule.id !== "string" || !rule.id.trim() || typeof rule.message !== "string" || !rule.message.trim()) throw new Error("CODEX_ARCHITECTURE_RULE_METADATA_INVALID");
    return {
      id: rule.id,
      sourcePrefixes: prefixes(rule.sourcePrefixes, "CODEX_ARCHITECTURE_SOURCE_PREFIXES_INVALID"),
      excludedSourcePrefixes: rule.excludedSourcePrefixes === undefined ? [] : prefixes(rule.excludedSourcePrefixes, "CODEX_ARCHITECTURE_EXCLUDED_PREFIXES_INVALID"),
      forbiddenTargetPrefixes: rule.forbiddenTargetPrefixes === undefined ? [] : prefixes(rule.forbiddenTargetPrefixes, "CODEX_ARCHITECTURE_TARGET_PREFIXES_INVALID"),
      forbiddenModuleSpecifiers: rule.forbiddenModuleSpecifiers === undefined ? [] : prefixes(rule.forbiddenModuleSpecifiers, "CODEX_ARCHITECTURE_MODULES_INVALID"),
      message: rule.message,
    };
  });
  return { version: 1, sourceRoots, rules };
}

export async function loadArchitectureConfig(root = CODEX_ROOT) {
  try { return parseArchitectureConfig(JSON.parse(await readFile(path.join(root, "config", "codex", "architecture.json"), "utf8"))); }
  catch (error) { throw new Error("CODEX_ARCHITECTURE_CONFIG_READ_FAILED", { cause: error }); }
}

async function readTsconfigPaths(root: string): Promise<TsconfigPathMap> {
  try {
    const raw = JSON.parse(await readFile(path.join(root, "tsconfig.json"), "utf8")) as { compilerOptions?: { paths?: unknown } };
    const paths = raw.compilerOptions?.paths;
    if (!paths || typeof paths !== "object" || Array.isArray(paths)) return {};
    return Object.fromEntries(Object.entries(paths).filter(([, targets]) => Array.isArray(targets) && targets.every((target) => typeof target === "string")) as [string, string[]][]);
  } catch { return {}; }
}

function candidatePaths(base: string) {
  return path.extname(base) ? [base] : [base, base + ".ts", base + ".tsx", base + ".mts", path.join(base, "index.ts"), path.join(base, "index.tsx"), path.join(base, "index.mts")];
}

export async function resolveImportTarget(root: string, sourceFile: string, specifier: string, tsconfigPaths: TsconfigPathMap = {}) {
  let base: string | undefined;
  if (specifier.startsWith(".")) base = path.resolve(path.dirname(sourceFile), specifier);
  else {
    for (const [alias, targets] of Object.entries(tsconfigPaths)) {
      const aliasPrefix = alias.endsWith("/*") ? alias.slice(0, -2) : alias;
      if (specifier !== aliasPrefix && !specifier.startsWith(aliasPrefix + "/")) continue;
      const remainder = specifier.slice(aliasPrefix.length).replace(/^\//, "");
      const target = targets[0];
      if (target) base = path.resolve(root, target.replace(/\/\*$/, "").replace(/^\.\//, ""), remainder);
      break;
    }
  }
  if (!base) return undefined;
  for (const candidate of candidatePaths(base)) {
    try {
      if ((await stat(candidate)).isFile()) return normalize(path.relative(root, candidate));
    } catch { /* Resolution misses are external or incomplete imports. */ }
  }
  return undefined;
}

async function sourceFiles(root: string, sourceRoots: readonly string[]) {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile() && /\.(?:ts|tsx|mts)$/.test(entry.name)) files.push(full);
    }
  };
  for (const sourceRoot of sourceRoots) await visit(path.resolve(root, sourceRoot));
  return files.sort();
}

function importSpecifiers(file: string, content: string) {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const moduleSpecifier = node.moduleSpecifier;
      if (moduleSpecifier && ts.isStringLiteral(moduleSpecifier)) imports.push(moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...new Set(imports)];
}

export async function checkArchitectureFiles(root: string, files: readonly string[], config: ArchitectureConfig, tsconfigPaths: TsconfigPathMap = {}) {
  const violations: ArchitectureViolation[] = [];
  for (const absoluteFile of files) {
    const sourceFile = normalize(path.relative(root, absoluteFile));
    const applicableRules = config.rules.filter((rule) => rule.sourcePrefixes.some((prefix) => matchesPrefix(sourceFile, prefix)) && !rule.excludedSourcePrefixes.some((prefix) => matchesPrefix(sourceFile, prefix)));
    if (!applicableRules.length) continue;
    const imports = importSpecifiers(absoluteFile, await readFile(absoluteFile, "utf8"));
    for (const importSpecifier of imports) {
      const targetFile = await resolveImportTarget(root, absoluteFile, importSpecifier, tsconfigPaths);
      for (const rule of applicableRules) {
        const forbiddenTarget = Boolean(targetFile && rule.forbiddenTargetPrefixes.some((prefix) => matchesPrefix(targetFile, prefix)));
        const forbiddenModule = rule.forbiddenModuleSpecifiers.includes(importSpecifier);
        if (!forbiddenTarget && !forbiddenModule) continue;
        const key = sourceFile + "\0" + importSpecifier + "\0" + (targetFile ?? "module");
        const code = "ARCHITECTURE_" + rule.id;
        violations.push({
          guardId: "architecture",
          key,
          fingerprint: fingerprintFailure("architecture", key, code, rule.id),
          code,
          triggerPathPrefixes: [sourceFile, ...rule.sourcePrefixes],
          ruleId: rule.id,
          sourceFile,
          importSpecifier,
          ...(targetFile ? { targetFile } : {}),
          message: rule.message,
        });
      }
    }
  }
  return violations;
}

export async function runArchitectureCheck(root = CODEX_ROOT, options: { emit?: boolean } = {}): Promise<ArchitectureCheckResult> {
  const config = await loadArchitectureConfig(root);
  const files = await sourceFiles(root, config.sourceRoots);
  const violations = await checkArchitectureFiles(root, files, config, await readTsconfigPaths(root));
  const result = { passed: violations.length === 0, violations };
  if (options.emit !== false) {
    console.log("ARCHITECTURE BOUNDARIES");
    if (violations.length === 0) console.log("  PASS: no registered boundary violations");
    else for (const violation of violations) console.log("  " + violation.code + ": " + violation.sourceFile + " -> " + violation.importSpecifier + (violation.targetFile ? " (" + violation.targetFile + ")" : ""));
    console.log("ARCHITECTURE: " + (result.passed ? "PASS" : "FAIL"));
  }
  return result;
}

async function main() {
  const result = await runArchitectureCheck(CODEX_ROOT, { emit: true });
  if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "CODEX_ARCHITECTURE_CHECK_FAILED"); process.exitCode = 1; });
