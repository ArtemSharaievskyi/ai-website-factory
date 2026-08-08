import path from "node:path";
import { RuntimeDiagnosticReferenceSchema, type RuntimeDiagnosticReference } from "./contracts";

export type BuildDiagnosticInput = { workspacePath: string; stdout: string; stderr: string; outputTruncated?: boolean };
const forbidden = ["node_modules", ".next", ".git", ".factory"];
const secret = /(sk-[A-Za-z0-9]{12,}|AKIA[A-Z0-9]{12,}|(?:DATABASE_URL|API_KEY|TOKEN|SECRET)\s*[:=]\s*[^\s,;]+|Bearer\s+[^\s,;]+)/gi;
const clean = (value: string) => value.replace(secret, "[REDACTED]").replace(/\s+/g, " ").trim().slice(0, 500);
const safeRoute = (value: string) => /^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/.test(value) ? value : undefined;

function relativeSource(raw: string, workspacePath: string) {
  const normalized = raw.replaceAll("\\", "/").replace(/^['"`]|['"`]$/g, "");
  const absolute = /^[A-Za-z]:\//.test(normalized) ? path.resolve(normalized) : path.resolve(workspacePath, normalized.replace(/^\.\//, ""));
  const relative = path.relative(path.resolve(workspacePath), absolute).replaceAll("\\", "/");
  if (!relative || relative.startsWith("../") || relative.includes("/../") || relative.includes("*") || forbidden.some((item) => relative === item || relative.startsWith(`${item}/`))) return undefined;
  if (!/^(?:src|tests|public|supabase|package\.json|next\.config\.[^/]+|postcss\.config\.[^/]+|tsconfig\.json|eslint\.config\.[^/]+)(?:\/|$)/.test(relative)) return undefined;
  return relative;
}
function sourceFromLine(line: string, workspacePath: string) {
  const match = line.match(/(?:^|[\s("'`])((?:[A-Za-z]:[\\/]|\.\/|(?:src|tests|public|supabase|package\.json|next\.config\.|postcss\.config\.|tsconfig\.json|eslint\.config\.))[^\s()\]"'`]+?)(?::(\d+)(?::(\d+))?|\((\d+),(\d+)\))/);
  if (!match) { const bare = line.match(/(?:^|[\s("'`])((?:\.\/)?(?:src|tests|public|supabase)\/[^\s()\]"'`:]+)/); if (!bare) return undefined; const relativePath = relativeSource(bare[1]!, workspacePath); return relativePath ? { relativePath } : undefined; }
  const relativePath = relativeSource(match[1]!, workspacePath);
  if (!relativePath) return undefined;
  return { relativePath, line: Number(match[2] ?? match[4]), column: Number(match[3] ?? match[5]) };
}
function routeFromLine(line: string) { const match = line.match(/(?:page|route)\s+["'](\/[^"']*)["']|prerender(?:ing)?\s+(?:page\s+)?["'](\/[^"']*)["']/i); return safeRoute(match?.[1] ?? match?.[2] ?? ""); }

export function normalizeBuildDiagnostics(input: BuildDiagnosticInput): RuntimeDiagnosticReference[] {
  const lines = `${input.stdout}\n${input.stderr}`.split(/\r?\n/).slice(0, 3000);
  const output: RuntimeDiagnosticReference[] = []; const seen = new Set<string>();
  const add = (value: RuntimeDiagnosticReference) => { const parsed = RuntimeDiagnosticReferenceSchema.parse(value); const key = `${parsed.category ?? ""}:${parsed.relativePath}:${parsed.line ?? ""}:${parsed.column ?? ""}:${parsed.code ?? ""}`; if (!seen.has(key)) { seen.add(key); output.push(parsed); } };
  for (let index = 0; index < lines.length && output.length < 50; index++) {
    const line = lines[index]!; const context = [lines[index - 1] ?? "", line, lines[index + 1] ?? ""].join(" "); const source = sourceFromLine(line, input.workspacePath) ?? sourceFromLine(context, input.workspacePath); const route = routeFromLine(context);
    const missing = line.match(/Module not found:\s*Can't resolve\s+["']?([^"'\s]+)|Cannot find module\s+["']([^"']+)["']/i);
    const exportError = /(?:is not exported from|has no exported member|attempted import error)/i.test(line);
    const boundary = /server-only|client component|client-only|server component/i.test(line) && /import|cannot|you're importing/i.test(line);
    const css = /postcss|css syntax|sass|stylesheet/i.test(line) && Boolean(source);
    const config = /next\.config|postcss\.config|tsconfig|eslint\.config/i.test(line) && Boolean(source);
    const typeError = /TS\d{3,5}|Type error|TypeScript/i.test(line) && Boolean(source);
    if (missing) add({ category: "MODULE_NOT_FOUND", code: "MODULE_NOT_FOUND", relativePath: source?.relativePath ?? "package.json", ...(source?.line ? { line: source.line, column: source.column } : {}), module: clean(missing[1] ?? missing[2]), safeMessage: clean(line), ...(source ? {} : {}) });
    else if (exportError) add({ category: "IMPORT_EXPORT_MISMATCH", code: "IMPORT_EXPORT_MISMATCH", relativePath: source?.relativePath ?? "package.json", ...(source?.line ? { line: source.line, column: source.column } : {}), safeMessage: clean(line) });
    else if (boundary) add({ category: "SERVER_CLIENT_BOUNDARY", code: "SERVER_CLIENT_BOUNDARY", relativePath: source?.relativePath ?? "package.json", ...(source?.line ? { line: source.line, column: source.column } : {}), safeMessage: clean(line) });
    else if (typeError) add({ category: "TYPESCRIPT_BUILD_ERROR", code: line.match(/TS\d{3,5}/)?.[0], relativePath: source?.relativePath ?? "tsconfig.json", ...(source?.line ? { line: source.line, column: source.column } : {}), safeMessage: clean(line) });
    else if (css) add({ category: "CSS_POSTCSS_ERROR", code: "CSS_POSTCSS_ERROR", relativePath: source!.relativePath, ...(source!.line ? { line: source!.line, column: source!.column } : {}), safeMessage: clean(line) });
    else if (config) add({ category: "CONFIG_ERROR", code: "CONFIG_ERROR", relativePath: source?.relativePath ?? "next.config.js", ...(source?.line ? { line: source.line, column: source.column } : {}), safeMessage: clean(line) });
    else if (route && /error|failed|prerender|generate/i.test(line)) { const page = route === "/" ? "src/app/page.tsx" : `src/app${route}/page.tsx`; const relativePath = relativeSource(page, input.workspacePath); if (relativePath) add({ category: "ROUTE_PRERENDER_ERROR", code: "ROUTE_PRERENDER_ERROR", relativePath, route, safeMessage: clean(line) }); }
  }
  return output.slice(0, 50);
}
