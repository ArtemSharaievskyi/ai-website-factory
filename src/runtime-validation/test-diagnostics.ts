import path from "node:path";
import { RuntimeDiagnosticReferenceSchema, type RuntimeDiagnosticReference } from "./contracts";

export type TestDiagnosticInput = { workspacePath: string; stdout: string; stderr: string; outputTruncated?: boolean };
export type TestDefectClassification = { classification: "IMPLEMENTATION_DEFECT" | "TEST_DEFECT" | "NON_TARGETABLE"; candidateOwnership: RuntimeDiagnosticReference["candidateOwnership"] };
const forbidden = ["node_modules", ".next", ".git", ".factory"];
const secret = /(sk-[A-Za-z0-9]{12,}|AKIA[A-Z0-9]{12,}|(?:DATABASE_URL|API_KEY|TOKEN|SECRET)\s*[:=]\s*[^\s,;]+|Bearer\s+[^\s,;]+)/gi;
const clean = (value: string) => value.replace(secret, "[REDACTED]").replace(/\s+/g, " ").trim().slice(0, 500);
const isTestFile = (file: string) => /(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)tests?\//i.test(file);
function relative(raw: string, root: string) { const normalized = raw.replaceAll("\\", "/").replace(/^['"`]|['"`]$/g, ""); const absolute = /^[A-Za-z]:\//.test(normalized) ? path.resolve(normalized) : path.resolve(root, normalized.replace(/^\.\//, "")); const value = path.relative(path.resolve(root), absolute).replaceAll("\\", "/"); if (!value || value.startsWith("../") || value.includes("/../") || value.includes("*") || forbidden.some((item) => value === item || value.startsWith(`${item}/`))) return undefined; if (!/^(?:src|tests|public|supabase|vitest\.|test\/|package\.json|tsconfig\.json)/.test(value)) return undefined; return value; }
function frame(line: string, root: string) { const match = line.match(/(?:at\s+[^\s(]+\s*\()?((?:[A-Za-z]:[\\/]|\.\/|(?:src|tests|test)[\\/]|(?:vitest|tsconfig)\.)[^():\s]+):(\d+):(\d+)\)?/); if (!match) return undefined; const file = relative(match[1]!, root); return file ? { file, line: Number(match[2]), column: Number(match[3]) } : undefined; }
function testName(lines: string[]) { for (const line of lines) { const match = line.match(/(?:×|Ã—|FAIL\s+[^>]*>|Test failed:)\s*([^\r\n(]{2,240})/i); if (match) return clean(match[1]!); } return undefined; }

export function normalizeTestDiagnostics(input: TestDiagnosticInput): RuntimeDiagnosticReference[] {
  const lines = `${input.stdout}\n${input.stderr}`.split(/\r?\n/).slice(0, 3000); const result: RuntimeDiagnosticReference[] = []; const seen = new Set<string>();
  const add = (value: RuntimeDiagnosticReference) => { const diagnostic = RuntimeDiagnosticReferenceSchema.parse(value); const key = `${diagnostic.category ?? ""}:${diagnostic.testFile ?? ""}:${diagnostic.sourceFile ?? ""}:${diagnostic.testName ?? ""}:${diagnostic.line ?? ""}:${diagnostic.code ?? ""}`; if (!seen.has(key)) { seen.add(key); result.push(diagnostic); } };
  for (let index = 0; index < lines.length && result.length < 50; index++) {
    const line = lines[index]!; const context = [lines[index - 1] ?? "", line, lines[index + 1] ?? ""].join(" "); const frames = [line, ...lines.slice(Math.max(0, index - 2), index + 4)].map((value) => frame(value, input.workspacePath)).filter((value): value is NonNullable<ReturnType<typeof frame>> => Boolean(value)); const testFrames = frames.filter((value) => isTestFile(value.file)); const sourceFrames = frames.filter((value) => !isTestFile(value.file)); const testFrame = testFrames[0]; const sourceFrame = sourceFrames[0]; const name = testName([context, ...lines.slice(Math.max(0, index - 3), index)]);
    const missing = context.match(/(?:Cannot find module|Failed to resolve import|Module not found:\s*Can't resolve)\s+["']?([^"'\s]+)/i); const timeout = /(?:timed out|timeout exceeded|exceeded the timeout)/i.test(context); const boundary = /server-only|client-only|client component|server component/i.test(context); const config = /(?:vitest|test setup|setupFiles|tsconfig)/i.test(context) && Boolean(frames[0]); const assertion = /AssertionError|expected .* to (?:be|equal|match)|Received:/i.test(context);
    if (!missing && !timeout && !boundary && !config && !assertion && !sourceFrame && !testFrame) continue;
    const primary = sourceFrame?.file ?? testFrame?.file ?? frames[0]?.file; if (!primary) continue;
    add({ category: missing ? "MODULE_NOT_FOUND" : timeout ? "TEST_TIMEOUT" : boundary ? "SERVER_CLIENT_BOUNDARY" : config ? "TEST_CONFIGURATION" : assertion ? "ASSERTION_FAILURE" : "TEST_RUNTIME_FAILURE", code: missing ? "MODULE_NOT_FOUND" : undefined, relativePath: primary, ...(testFrame ? { testFile: testFrame.file } : {}), ...(sourceFrame ? { sourceFile: sourceFrame.file, classification: "IMPLEMENTATION_DEFECT" as const } : {}), ...(testFrames.length ? { testStack: testFrames.slice(0, 8) } : {}), ...(sourceFrames.length ? { sourceStack: sourceFrames.slice(0, 8) } : {}), ...(testFrame || sourceFrame ? { artifactReferences: [...new Set([testFrame?.file, sourceFrame?.file].filter((value): value is string => Boolean(value)))] } : {}), ...(name ? { testName: name } : {}), ...(missing ? { module: clean(missing[1]!) } : {}), ...(sourceFrame ? { line: sourceFrame.line, column: sourceFrame.column } : testFrame ? { line: testFrame.line, column: testFrame.column } : {}), safeMessage: clean(line || context) });
  }
  if (!result.length && /(?:^|\n)>\s*test\s*\n>\s*vitest\s+run(?:\s+--run)?\s*$/m.test(`${input.stdout}\n${input.stderr}`) && !/Test Files\s+\d+\s+passed/i.test(input.stdout)) add({ category: "TEST_SUITE_MISSING", relativePath: "tests", classification: "NON_TARGETABLE", safeMessage: "The approved Vitest command found no generated test files." });
  return result.slice(0, 50);
}

/** Classifies only contracts that can be demonstrated from approved context. */
export function classifyGeneratedTestDiagnostic(input: { diagnostic: RuntimeDiagnosticReference; testContent: string; approvedContractText: string; sourceContent?: string }): TestDefectClassification {
  const test = input.testContent; const approved = input.approvedContractText; const source = input.sourceContent ?? "";
  const route = test.match(/(?:href|toHaveURL|route|pathname)[^\n]{0,120}["'`]((?:\/)[a-z0-9/_-]*)["'`]/i)?.[1];
  const exactCopy = test.match(/(?:getByText|getByRole|toContain|toMatch|toHaveText|textContent)[^\n]{0,120}["'`]([^"'`\n]{12,})["'`]/i)?.[1];
  if (route && !approved.includes(route)) return { classification: "TEST_DEFECT", candidateOwnership: ["write-unit-tests"] };
  if (exactCopy && !approved.includes(exactCopy)) return { classification: "TEST_DEFECT", candidateOwnership: ["write-unit-tests"] };
  if (route && approved.includes(route) && (!source || !source.includes(route))) return { classification: "IMPLEMENTATION_DEFECT", candidateOwnership: ["implement-navigation", "implement-page"] };
  if (exactCopy && approved.includes(exactCopy) && (!source || !source.includes(exactCopy))) return { classification: "IMPLEMENTATION_DEFECT", candidateOwnership: ["implement-page", "integrate-content"] };
  return { classification: input.diagnostic.sourceFile ? "IMPLEMENTATION_DEFECT" : "NON_TARGETABLE", candidateOwnership: input.diagnostic.sourceFile ? ["implement-page"] : [] };
}
