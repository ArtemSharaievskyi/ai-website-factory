import * as ts from "typescript";
import { createHash } from "node:crypto";
import { RelativePathSchema } from "@/domain/shared/schemas";
import type { ContextCandidate } from "./assembler";
import type { ContextItemKind } from "./contracts";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const byteLength = (value: string) => Buffer.byteLength(value, "utf8");
const normalize = (value: string) => value.replaceAll("\\", "/");
const sourceKind = (file: string) => file.toLowerCase().endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
const supported = (file: string) => /\.(?:ts|tsx)$/i.test(file);

export type SourceSkeleton = {
  relativePath: string;
  checksum: string;
  imports: string[];
  exports: string[];
  declarationNames: string[];
  functionSignatures: string[];
  componentSignatures: string[];
  interfaces: string[];
  types: string[];
  classes: string[];
  routeIdentity?: string;
  dependencyEdges: string[];
  lineCount: number;
};

const lineRange = (source: string, node: ts.Node) => {
  const start = source.slice(0, node.getStart()).split(/\r?\n/).length;
  const end = source.slice(0, node.getEnd()).split(/\r?\n/).length;
  return `${start}-${end}`;
};
const signature = (source: string, node: ts.Node) => source.slice(node.getStart(), node.getEnd()).replace(/\{[\s\S]*\}/, "{ … }").replace(/\s+/g, " ").trim();

export function createSourceSkeleton(relativePath: string, source: string): SourceSkeleton {
  const path = normalize(RelativePathSchema.parse(relativePath));
  if (!supported(path)) throw new Error("SOURCE_SKELETON_UNSUPPORTED_FILE");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, sourceKind(path));
  const imports: string[] = [];
  const exports: string[] = [];
  const declarationNames: string[] = [];
  const functionSignatures: string[] = [];
  const componentSignatures: string[] = [];
  const interfaces: string[] = [];
  const types: string[] = [];
  const classes: string[] = [];
  const dependencyEdges: string[] = [];
  const exported = (node: ts.Node) => ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false);
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) { imports.push(statement.moduleSpecifier.text); dependencyEdges.push(`imports:${statement.moduleSpecifier.text}`); continue; }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) { exports.push(statement.moduleSpecifier.text); dependencyEdges.push(`exports:${statement.moduleSpecifier.text}`); continue; }
    if (ts.isFunctionDeclaration(statement) && statement.name) { const item = `${statement.name.text}(${lineRange(source, statement)}): ${signature(source, statement)}`; declarationNames.push(statement.name.text); functionSignatures.push(item); if (/^[A-Z]/.test(statement.name.text)) componentSignatures.push(item); if (exported(statement)) exports.push(statement.name.text); continue; }
    if (ts.isClassDeclaration(statement) && statement.name) { declarationNames.push(statement.name.text); classes.push(`${statement.name.text}(${lineRange(source, statement)}): ${signature(source, statement)}`); if (exported(statement)) exports.push(statement.name.text); continue; }
    if (ts.isInterfaceDeclaration(statement)) { declarationNames.push(statement.name.text); interfaces.push(`${statement.name.text}(${lineRange(source, statement)}): ${signature(source, statement)}`); if (exported(statement)) exports.push(statement.name.text); continue; }
    if (ts.isTypeAliasDeclaration(statement)) { declarationNames.push(statement.name.text); types.push(`${statement.name.text}(${lineRange(source, statement)}): ${signature(source, statement)}`); if (exported(statement)) exports.push(statement.name.text); continue; }
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) { declarationNames.push(declaration.name.text); if (declaration.initializer && ts.isArrowFunction(declaration.initializer)) { const item = `${declaration.name.text}(${lineRange(source, declaration)}): ${signature(source, declaration)}`; functionSignatures.push(item); if (/^[A-Z]/.test(declaration.name.text)) componentSignatures.push(item); } if (exported(statement)) exports.push(declaration.name.text); }
  }
  const routeIdentity = path.match(/^src\/app(\/.*)?\/page\.tsx$/i)?.[1]?.replaceAll("/", "/") || (path === "src/app/page.tsx" ? "/" : undefined);
  return { relativePath: path, checksum: digest(source), imports: [...new Set(imports)].sort(), exports: [...new Set(exports)].sort(), declarationNames: [...new Set(declarationNames)].sort(), functionSignatures: functionSignatures.sort(), componentSignatures: componentSignatures.sort(), interfaces: interfaces.sort(), types: types.sort(), classes: classes.sort(), ...(routeIdentity ? { routeIdentity: routeIdentity || "/" } : {}), dependencyEdges: [...new Set(dependencyEdges)].sort(), lineCount: source.split(/\r?\n/).length };
}

export function renderSourceSkeleton(skeleton: SourceSkeleton, options: { relevantSymbols?: readonly string[]; maxDeclarationNames?: number } = {}) {
  const relevant = options.relevantSymbols?.length ? new Set(options.relevantSymbols) : undefined;
  const keep = (value: string) => !relevant || [...relevant].some((symbol) => value.includes(symbol));
  const declarationNames = skeleton.declarationNames.filter((name) => !relevant || relevant.has(name)).slice(0, options.maxDeclarationNames ?? skeleton.declarationNames.length);
  const interfaces = skeleton.interfaces.filter(keep);
  const types = skeleton.types.filter(keep);
  const classes = skeleton.classes.filter(keep);
  const functionSignatures = skeleton.functionSignatures.filter(keep);
  const lines = [
    `// SOURCE SKELETON ${skeleton.relativePath} sha256=${skeleton.checksum}`,
    `// imports: ${skeleton.imports.join(", ") || "none"}`,
    `// exports: ${skeleton.exports.join(", ") || "none"}`,
    `// declarations: ${declarationNames.join(", ") || "none"}`,
    ...interfaces.map((value) => `interface ${value}`),
    ...types.map((value) => `type ${value}`),
    ...classes.map((value) => `class ${value}`),
    ...functionSignatures.map((value) => `function ${value}`),
    ...(skeleton.routeIdentity ? [`// route: ${skeleton.routeIdentity}`] : []),
    `// dependency edges: ${skeleton.dependencyEdges.join(", ") || "none"}`,
  ];
  return lines.join("\n");
}

export function selectSymbolSnippet(relativePath: string, source: string, symbols: readonly string[], contextLines = 2): { content: string; lineRange?: { start: number; end: number }; symbolIdentity?: string } | undefined {
  if (!supported(relativePath)) return undefined;
  const file = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, sourceKind(relativePath));
  const wanted = new Set(symbols.map((symbol) => symbol.replace(/[^A-Za-z0-9_$]/g, "").trim()).filter(Boolean));
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (found) return;
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) && node.name && wanted.has(node.name.text)) found = node;
    if (!found && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && wanted.has(node.name.text)) found = node;
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!found) return undefined;
  const startLine = source.slice(0, found.getStart()).split(/\r?\n/).length;
  const endLine = source.slice(0, found.getEnd()).split(/\r?\n/).length;
  const allLines = source.split(/\r?\n/);
  const start = Math.max(1, startLine - contextLines);
  const end = Math.min(allLines.length, endLine + contextLines);
  const symbolIdentity = ts.isVariableDeclaration(found) && ts.isIdentifier(found.name) ? found.name.text : (ts.isFunctionDeclaration(found) || ts.isClassDeclaration(found) || ts.isInterfaceDeclaration(found) || ts.isTypeAliasDeclaration(found)) && found.name ? found.name.text : undefined;
  return { content: allLines.slice(start - 1, end).join("\n"), lineRange: { start, end }, ...(symbolIdentity ? { symbolIdentity } : {}) };
}

export type SourceFileCandidate = { relativePath: string; content: string; sha256?: string; imports?: readonly string[]; dependencyPaths?: readonly string[]; taskOwned?: boolean; sourceKind?: ContextItemKind };
export type SelectedSourceFile = SourceFileCandidate & { sha256: string; selectionReason: string; priority: "HIGH" | "MEDIUM" | "LOW"; dependencyDepth: number };
export type FileSelectionResult = { selected: SelectedSourceFile[]; excluded: Array<{ relativePath: string; exclusionReason: string }>; candidateCount: number; selectedCount: number; maxDepth: number };

const matchesScope = (file: string, scope: string) => {
  const normalizedFile = normalize(file).toLowerCase();
  const normalized = normalize(scope).toLowerCase();
  if (!normalized.includes("*")) return normalizedFile === normalized;
  const regex = new RegExp(`^${normalized.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("**", "§§").replaceAll("*", "[^/]*").replaceAll("§§", ".*")}$`);
  return regex.test(normalizedFile);
};

export function selectRelevantFiles(input: { files: readonly SourceFileCandidate[]; targetPath?: string; fileScopes: readonly string[]; requiredSourceRefs?: readonly string[]; maxFiles: number; maxDependencyDepth?: number }): FileSelectionResult {
  const maxDepth = input.maxDependencyDepth ?? 2;
  const files = input.files.map((file) => ({ ...file, relativePath: normalize(file.relativePath), sha256: file.sha256 ?? digest(file.content) }));
  const byPath = new Map(files.map((file) => [file.relativePath, file]));
  const target = input.targetPath ? normalize(input.targetPath) : files.find((file) => file.taskOwned)?.relativePath;
  const selected = new Map<string, SelectedSourceFile>();
  const queue: Array<{ path: string; depth: number }> = target && byPath.has(target) ? [{ path: target, depth: 0 }] : [];
  const required = (input.requiredSourceRefs ?? []).map(normalize);
  for (const file of files) if (!selected.has(file.relativePath) && (file.taskOwned || required.includes(file.relativePath))) queue.push({ path: file.relativePath, depth: 0 });
  while (queue.length) {
    const current = queue.shift()!;
    const file = byPath.get(current.path);
    if (!file || selected.has(file.relativePath) || current.depth > maxDepth) continue;
    const isTarget = file.relativePath === target;
    const isRequired = required.includes(file.relativePath) || Boolean(file.taskOwned);
    const priority = isTarget || isRequired ? "HIGH" : current.depth === 1 ? "MEDIUM" : "LOW";
    selected.set(file.relativePath, { ...file, selectionReason: isTarget ? "Exact task target file." : isRequired ? "Explicit task scope or canonical source reference." : `Bounded direct dependency at depth ${current.depth}.`, priority, dependencyDepth: current.depth });
    if (current.depth < maxDepth) for (const dependency of [...(file.dependencyPaths ?? []), ...(file.imports ?? [])].sort()) {
      const path = normalize(dependency);
      const resolved = byPath.has(path) ? path : byPath.has(`${path}.ts`) ? `${path}.ts` : byPath.has(`${path}.tsx`) ? `${path}.tsx` : undefined;
      if (resolved && input.fileScopes.some((scope) => matchesScope(resolved, scope))) queue.push({ path: resolved, depth: current.depth + 1 });
    }
  }
  if (!selected.size) for (const file of files.filter((candidate) => input.fileScopes.some((scope) => matchesScope(candidate.relativePath, scope))).slice(0, input.maxFiles)) selected.set(file.relativePath, { ...file, selectionReason: "First deterministic in-scope candidate; no exact target was supplied.", priority: "MEDIUM", dependencyDepth: 0 });
  const ranked = [...selected.values()].sort((left, right) => ({ HIGH: 3, MEDIUM: 2, LOW: 1 }[right.priority] - { HIGH: 3, MEDIUM: 2, LOW: 1 }[left.priority] || left.relativePath.localeCompare(right.relativePath))).slice(0, input.maxFiles);
  const selectedPaths = new Set(ranked.map((file) => file.relativePath));
  return { selected: ranked, excluded: files.filter((file) => !selectedPaths.has(file.relativePath)).map((file) => ({ relativePath: file.relativePath, exclusionReason: !input.fileScopes.some((scope) => matchesScope(file.relativePath, scope)) ? "Outside task file scope." : "Outside bounded relevance closure or max file count." })), candidateCount: files.length, selectedCount: ranked.length, maxDepth };
}

export function sourceContextCandidates(input: { file: SelectedSourceFile; symbols?: readonly string[]; fullFileThresholdBytes?: number }): ContextCandidate[] {
  const threshold = input.fullFileThresholdBytes ?? 12000;
  const file = input.file;
  if (byteLength(file.content) <= threshold || file.taskOwned) return [{ kind: input.file.sourceKind ?? "SOURCE_SNIPPET", sourceRef: `file:${file.relativePath}`, sourceChecksum: file.sha256, selectionReason: `${file.selectionReason} File is small or task-owned; full content is sufficient.`, priority: file.priority, required: file.priority === "HIGH", content: file.content }];
  if (supported(file.relativePath)) {
    const skeleton = createSourceSkeleton(file.relativePath, file.content);
    const snippet = selectSymbolSnippet(file.relativePath, file.content, input.symbols ?? skeleton.declarationNames.slice(0, 1));
    const candidates: ContextCandidate[] = [{ kind: "FILE_SKELETON", sourceRef: `skeleton:${file.relativePath}`, sourceChecksum: file.sha256, selectionReason: `${file.selectionReason} Large source is represented by a TypeScript compiler-derived skeleton narrowed to task-relevant symbols.`, priority: file.priority, required: file.priority === "HIGH", content: renderSourceSkeleton(skeleton, { relevantSymbols: input.symbols, maxDeclarationNames: 24 }) }];
    if (snippet) candidates.push({ kind: "SOURCE_SNIPPET", sourceRef: `snippet:${file.relativePath}:${snippet.symbolIdentity ?? "target"}`, sourceChecksum: file.sha256, selectionReason: "Target declaration plus small surrounding line context is sufficient for the narrow task.", priority: "HIGH", required: file.priority === "HIGH", content: snippet.content, ...(snippet.lineRange ? { lineRange: snippet.lineRange } : {}), ...(snippet.symbolIdentity ? { symbolIdentity: snippet.symbolIdentity } : {}) });
    return candidates;
  }
  const bounded = file.content.split(/\r?\n/).slice(0, 120).join("\n");
  return [{ kind: "SOURCE_SNIPPET", sourceRef: `snippet:${file.relativePath}:bounded`, sourceChecksum: file.sha256, selectionReason: `${file.selectionReason} Non-TypeScript source is bounded at a line boundary.`, priority: file.priority, required: file.priority === "HIGH", content: bounded }];
}
