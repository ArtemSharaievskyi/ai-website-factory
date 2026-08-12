import * as ts from "typescript";
import { createHash } from "node:crypto";
import path from "node:path";
import type { AgentTask } from "@/domain/tasks/schema";
import { decideDependency, type DependencyAuthorityContext } from "@/dependencies/authority";
import { isWithinTaskScope } from "./scope";
import {
  AST_PATCH_MAX_PAYLOAD_BYTES,
  AstPatchOperationSchema,
  type AstPatchExecutionEvidence,
  type AstPatchOperation,
  type AstSelector,
  type AstStructuralContextEntry,
} from "@/domain/implementation/ast-patching";

export type AstPatchFailureCode =
  | "AST_PATCH_UNSUPPORTED_FILE"
  | "AST_PATCH_FILE_STALE"
  | "AST_SOURCE_PARSE_FAILED"
  | "AST_SELECTOR_INVALID"
  | "AST_TARGET_NOT_FOUND"
  | "AST_TARGET_AMBIGUOUS"
  | "AST_PATCH_PAYLOAD_INVALID"
  | "AST_PATCH_PAYLOAD_TOO_LARGE"
  | "AST_PATCH_RESULT_PARSE_FAILED"
  | "AST_PATCH_OPERATION_CONFLICT"
  | "AST_PATCH_SCOPE_VIOLATION"
  | "AST_PATCH_UNAPPROVED_DEPENDENCY"
  | "AST_PATCH_UNAUTHORIZED_CAPABILITY"
  | "AST_PATCH_TASK_CONTRACT_STALE"
  | "AST_PATCH_RESTRICTED_PATH"
  | "AST_PATCH_ROLLBACK_FAILED";

export class AstPatchFailure extends Error {
  constructor(readonly code: AstPatchFailureCode, message: string, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "AstPatchFailure";
  }
}

type SourceFile = ts.SourceFile;
type LocatedTarget = { node: ts.Node; targetKey: string };

const sourceKind = (relativePath: string) => {
  const normalized = relativePath.replaceAll("\\", "/").toLowerCase();
  if (normalized.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (normalized.endsWith(".ts")) return ts.ScriptKind.TS;
  throw new AstPatchFailure("AST_PATCH_UNSUPPORTED_FILE", "AST patches are limited to existing TypeScript source files.");
};

const lineEnding = (source: string) => source.includes("\r\n") ? "\r\n" : "\n";
const normalizeLineEndings = (value: string, ending: string) => value.replace(/\r\n|\r|\n/g, ending);
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const bytes = (value: string) => Buffer.byteLength(value, "utf8");
const hasSecretLikeText = (value: string) => /(sk-[A-Za-z0-9]{12,}|AKIA[A-Z0-9]{12,}|BEGIN .*PRIVATE KEY|DATABASE_URL\s*[:=]|password\s*[:=])/i.test(value);

function parseSource(relativePath: string, source: string, failureCode: AstPatchFailureCode = "AST_SOURCE_PARSE_FAILED"): SourceFile {
  const file = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, sourceKind(relativePath));
  const diagnostics = ts.transpileModule(source, { fileName: relativePath, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022 } }).diagnostics ?? [];
  if (diagnostics.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
    throw new AstPatchFailure(failureCode, failureCode === "AST_PATCH_RESULT_PARSE_FAILED" ? "The AST patch result could not be parsed." : "The current TypeScript source could not be parsed.", { relativePath });
  }
  return file;
}

function selectorMatches(node: ts.Node, selector: AstSelector, sourceFile: SourceFile): boolean {
  const exported = (candidate: ts.Node) => ts.canHaveModifiers(candidate) && (ts.getModifiers(candidate)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false);
  const defaultExport = (candidate: ts.Node) => ts.canHaveModifiers(candidate) && (ts.getModifiers(candidate)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ?? false);
  switch (selector.selectorKind) {
    case "function":
      return ts.isFunctionDeclaration(node) && node.name?.text === selector.name && (selector.exported === undefined || exported(node)) && (selector.defaultExport === undefined || defaultExport(node));
    case "arrow-function":
      return ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === selector.name && Boolean(node.initializer && ts.isArrowFunction(node.initializer)) && (selector.exported === undefined || exported(node.parent.parent)) && (selector.defaultExport === undefined || defaultExport(node.parent.parent));
    case "variable":
      return ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === selector.name;
    case "object-property":
      return ts.isPropertyAssignment(node) && ts.isVariableDeclaration(node.parent.parent) && ts.isIdentifier(node.parent.parent.name) && node.parent.parent.name.text === selector.objectName && node.name.getText(sourceFile) === selector.propertyName;
    case "import-declaration":
      return ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === selector.moduleSpecifier && (selector.typeOnly === undefined || Boolean(node.importClause?.isTypeOnly) === selector.typeOnly);
    case "import-specifier":
      if (!ts.isImportSpecifier(node) || !ts.isNamedImports(node.parent)) return false;
      if (!ts.isImportClause(node.parent.parent) || !ts.isImportDeclaration(node.parent.parent.parent)) return false;
      const declaration = node.parent.parent.parent;
      return ts.isStringLiteral(declaration.moduleSpecifier) && declaration.moduleSpecifier.text === selector.moduleSpecifier && (node.propertyName?.text ?? node.name.text) === selector.importedName && node.name.text === (selector.localName ?? selector.importedName) && (selector.typeOnly === undefined || node.isTypeOnly === selector.typeOnly);
    case "class-method":
      return ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name) && node.name.text === selector.methodName && ts.isClassDeclaration(node.parent) && node.parent.name?.text === selector.className && (selector.exported === undefined || exported(node.parent)) && (selector.defaultExport === undefined || defaultExport(node.parent));
  }
}

function selectorSummary(selector: AstSelector) {
  return Object.entries(selector).map(([key, value]) => `${key}=${String(value)}`).join(";");
}

export function computeStructuralFingerprint(node: ts.Node, sourceFile: SourceFile, selector: AstSelector) {
  const normalizedText = node.getText(sourceFile).replace(/\s+/g, " ").trim();
  return hash(JSON.stringify({ selector, syntaxKind: ts.SyntaxKind[node.kind], normalizedText }));
}

function locate(sourceFile: SourceFile, selector: AstSelector, expectedTarget?: AstPatchOperation["expectedTarget"]): LocatedTarget[] {
  const matches: LocatedTarget[] = [];
  const visit = (node: ts.Node) => {
    if (selectorMatches(node, selector, sourceFile)) {
      const targetKey = `${ts.SyntaxKind[node.kind]}:${selectorSummary(selector)}`;
      if (expectedTarget && ts.SyntaxKind[node.kind] !== expectedTarget.nodeKind) return;
      if (expectedTarget?.structuralFingerprint && computeStructuralFingerprint(node, sourceFile, selector) !== expectedTarget.structuralFingerprint) return;
      matches.push({ node, targetKey });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return matches;
}

function oneTarget(sourceFile: SourceFile, operation: AstPatchOperation): LocatedTarget {
  const matches = locate(sourceFile, operation.selector, operation.expectedTarget);
  if (matches.length === 0) throw new AstPatchFailure("AST_TARGET_NOT_FOUND", "The structural AST selector did not match the current source.", { selector: selectorSummary(operation.selector) });
  if (matches.length > 1) throw new AstPatchFailure("AST_TARGET_AMBIGUOUS", "The structural AST selector matched more than one target.", { selector: selectorSummary(operation.selector), matchCount: matches.length });
  return matches[0];
}

function parseSnippet(source: string, kind: ts.ScriptKind = ts.ScriptKind.TS): ts.SourceFile {
  const file = ts.createSourceFile("__ast_patch_snippet.ts", source, ts.ScriptTarget.Latest, true, kind);
  const diagnostics = ts.transpileModule(source, { fileName: "__ast_patch_snippet.ts", reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2022 } }).diagnostics ?? [];
  if (diagnostics.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) || file.statements.length === 0) throw new AstPatchFailure("AST_PATCH_PAYLOAD_INVALID", "The AST patch payload is not valid TypeScript.");
  return file;
}

function validatePayload(value: string, maxBytes: number) {
  if (bytes(value) > Math.min(maxBytes, AST_PATCH_MAX_PAYLOAD_BYTES)) throw new AstPatchFailure("AST_PATCH_PAYLOAD_TOO_LARGE", "The AST patch payload exceeds the bounded byte limit.");
  if (hasSecretLikeText(value)) throw new AstPatchFailure("AST_PATCH_PAYLOAD_INVALID", "The AST patch payload contains secret-like text.");
}

function addTextAt(source: string, position: number, text: string) {
  return source.slice(0, position) + text + source.slice(position);
}

function sourceIndent(source: string, position: number) {
  const lineStart = source.lastIndexOf("\n", Math.max(0, position - 1)) + 1;
  return source.slice(lineStart, position).match(/^\s*/)?.[0] ?? "";
}

function findObjectLiteral(variable: ts.VariableDeclaration): ts.ObjectLiteralExpression {
  if (!variable.initializer || !ts.isObjectLiteralExpression(variable.initializer)) throw new AstPatchFailure("AST_SELECTOR_INVALID", "ADD_OBJECT_PROPERTY requires a variable initialized with an object literal.");
  return variable.initializer;
}

function importDeclarationForSpecifier(specifier: ts.ImportSpecifier) {
  const namedImports = specifier.parent;
  const importClause = namedImports.parent;
  const declaration = importClause.parent;
  return ts.isImportDeclaration(declaration) ? declaration : undefined;
}

function validateImportAuthority(operation: Extract<AstPatchOperation, { patchKind: "ADD_NAMED_IMPORT" }>, relativePath: string, taskScopes: readonly string[], dependencyContext: DependencyAuthorityContext) {
  const moduleSpecifier = operation.payload.moduleSpecifier;
  if (moduleSpecifier !== operation.selector.moduleSpecifier) throw new AstPatchFailure("AST_PATCH_OPERATION_CONFLICT", "Import payload and selector module specifier differ.");
  if (moduleSpecifier.startsWith(".") || moduleSpecifier.startsWith("@/")) {
    const sourceDirectory = path.posix.dirname(relativePath.replaceAll("\\", "/"));
    const resolved = moduleSpecifier.startsWith("@/") ? path.posix.normalize(`src/${moduleSpecifier.slice(2)}`) : path.posix.normalize(path.posix.join(sourceDirectory, moduleSpecifier));
    const localCandidate = resolved.replace(/\.(?:tsx?|jsx?)$/i, "");
    if (localCandidate.startsWith("../") || !taskScopes.some((scope) => isWithinTaskScope(scope, localCandidate)) && !taskScopes.some((scope) => isWithinTaskScope(scope, `${localCandidate}.ts`)) && !taskScopes.some((scope) => isWithinTaskScope(scope, `${localCandidate}.tsx`))) throw new AstPatchFailure("AST_PATCH_SCOPE_VIOLATION", "The AST import target is outside the authorized task scopes.");
    return;
  }
  const packageName = moduleSpecifier.startsWith("@") ? moduleSpecifier.split("/").slice(0, 2).join("/") : moduleSpecifier.split("/")[0];
  const decision = decideDependency({ operation: "ADD", packageName, dependencySection: "dependencies", context: dependencyContext });
  if (!decision.approved) throw new AstPatchFailure("AST_PATCH_UNAPPROVED_DEPENDENCY", "The AST import is not approved by the current dependency authority.", { packageName, decision: decision.code });
}

function applyReplaceBody(source: string, sourceFile: SourceFile, operation: Extract<AstPatchOperation, { patchKind: "REPLACE_NODE_BODY" }>, target: LocatedTarget) {
  const node = target.node;
  const body = operation.payload.body;
  validatePayload(body, AST_PATCH_MAX_PAYLOAD_BYTES);
  if (!(ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || (ts.isVariableDeclaration(node) && node.initializer && ts.isArrowFunction(node.initializer)))) throw new AstPatchFailure("AST_SELECTOR_INVALID", "REPLACE_NODE_BODY requires a function, class method, or arrow-function selector.");
  const functionLike = ts.isVariableDeclaration(node) ? node.initializer as ts.ArrowFunction : node;
  const isBlock = body.trimStart().startsWith("{") && body.trimEnd().endsWith("}");
  if (ts.isArrowFunction(functionLike) && !isBlock) {
    parseSnippet(`const __astPatch = () => (${body});`);
    return { source: source.slice(0, functionLike.body.getStart(sourceFile)) + normalizeLineEndings(body.trim(), lineEnding(source)) + source.slice(functionLike.body.getEnd()), targetKey: target.targetKey };
  }
  if (!isBlock) throw new AstPatchFailure("AST_PATCH_PAYLOAD_INVALID", "Function and class-method bodies must be a complete block.");
  parseSnippet(`function __astPatch() ${body}`);
  const currentBody = ts.isArrowFunction(functionLike) ? functionLike.body : (functionLike as ts.FunctionLikeDeclaration).body;
  if (!currentBody) throw new AstPatchFailure("AST_SELECTOR_INVALID", "The selected function does not have a replaceable body.");
  return { source: source.slice(0, currentBody.getStart(sourceFile)) + normalizeLineEndings(body.trim(), lineEnding(source)) + source.slice(currentBody.getEnd()), targetKey: target.targetKey };
}

function applyInsert(source: string, sourceFile: SourceFile, operation: Extract<AstPatchOperation, { patchKind: "INSERT_BEFORE_NODE" | "INSERT_AFTER_NODE" }>, target: LocatedTarget) {
  const snippet = operation.payload.source;
  validatePayload(snippet, AST_PATCH_MAX_PAYLOAD_BYTES);
  parseSnippet(snippet, sourceKind(operation.relativePath));
  const text = normalizeLineEndings(snippet.trim(), lineEnding(source)) + lineEnding(source);
  const insertionNode = ts.isVariableDeclaration(target.node) && ts.isVariableStatement(target.node.parent.parent) ? target.node.parent.parent : target.node;
  const position = operation.patchKind === "INSERT_BEFORE_NODE" ? insertionNode.getStart(sourceFile) : insertionNode.getEnd();
  return { source: operation.patchKind === "INSERT_BEFORE_NODE" ? addTextAt(source, position, text) : addTextAt(source, position, lineEnding(source) + text.trim()), targetKey: target.targetKey };
}

function applyAddImport(source: string, sourceFile: SourceFile, operation: Extract<AstPatchOperation, { patchKind: "ADD_NAMED_IMPORT" }>, target: LocatedTarget) {
  const declaration = target.node;
  if (!ts.isImportDeclaration(declaration) || !declaration.importClause || !declaration.importClause.namedBindings || !ts.isNamedImports(declaration.importClause.namedBindings)) throw new AstPatchFailure("AST_SELECTOR_INVALID", "ADD_NAMED_IMPORT requires a named import declaration.");
  if (operation.selector.typeOnly !== undefined && operation.selector.typeOnly !== operation.payload.typeOnly) throw new AstPatchFailure("AST_PATCH_OPERATION_CONFLICT", "Import selector and payload disagree about type-only binding.");
  const named = declaration.importClause.namedBindings;
  const localName = operation.payload.localName ?? operation.payload.importedName;
  const declarationTypeOnly = Boolean(declaration.importClause.isTypeOnly);
  const existing = named.elements.find((specifier) => (specifier.propertyName?.text ?? specifier.name.text) === operation.payload.importedName && specifier.name.text === localName && (specifier.isTypeOnly || declarationTypeOnly) === operation.payload.typeOnly);
  if (existing) return { source, targetKey: target.targetKey, idempotent: true };
  const conflicting = named.elements.find((specifier) => specifier.propertyName?.text === operation.payload.importedName || specifier.name.text === localName);
  if (conflicting) throw new AstPatchFailure("AST_PATCH_OPERATION_CONFLICT", "The named import already exists with a conflicting local or type-only binding.");
  const close = named.getEnd() - 1;
  const trailingWhitespace = source.slice(named.elements[named.elements.length - 1]?.getEnd() ?? named.getStart(sourceFile), close).match(/\s*$/)?.[0] ?? "";
  const insertion = `${named.elements.length ? ", " : ""}${operation.payload.typeOnly ? "type " : ""}${operation.payload.importedName}${localName === operation.payload.importedName ? "" : ` as ${localName}`}${trailingWhitespace}`;
  return { source: source.slice(0, close - trailingWhitespace.length) + insertion + source.slice(close), targetKey: target.targetKey };
}

function applyRemoveImport(source: string, sourceFile: SourceFile, operation: Extract<AstPatchOperation, { patchKind: "REMOVE_IMPORT_SPECIFIER" }>, target: LocatedTarget) {
  if (!ts.isImportSpecifier(target.node)) throw new AstPatchFailure("AST_SELECTOR_INVALID", "REMOVE_IMPORT_SPECIFIER requires an import specifier target.");
  const declaration = importDeclarationForSpecifier(target.node);
  if (!declaration) throw new AstPatchFailure("AST_SELECTOR_INVALID", "The import specifier is not attached to an import declaration.");
  const named = target.node.parent;
  const index = named.elements.indexOf(target.node);
  const nextElement = named.elements[index + 1];
  const previousElement = named.elements[index - 1];
  const start = index === 0 ? target.node.getStart(sourceFile) : previousElement.getEnd();
  const end = nextElement ? nextElement.getStart(sourceFile) : target.node.getEnd();
  const next = source.slice(0, start) + source.slice(end);
  return { source: next, targetKey: target.targetKey };
}

function applyAddObjectProperty(source: string, sourceFile: SourceFile, operation: Extract<AstPatchOperation, { patchKind: "ADD_OBJECT_PROPERTY" }>, target: LocatedTarget) {
  if (!ts.isVariableDeclaration(target.node)) throw new AstPatchFailure("AST_SELECTOR_INVALID", "ADD_OBJECT_PROPERTY requires a variable selector.");
  const object = findObjectLiteral(target.node);
  validatePayload(operation.payload.value, AST_PATCH_MAX_PAYLOAD_BYTES);
  parseSnippet(`const __astPatchValue = (${operation.payload.value});`);
  const existing = object.properties.find((property) => ts.isPropertyAssignment(property) && property.name.getText(sourceFile) === operation.payload.propertyName);
  if (existing && ts.isPropertyAssignment(existing) && existing.initializer.getText(sourceFile).trim() === operation.payload.value.trim()) return { source, targetKey: target.targetKey, idempotent: true };
  if (existing) throw new AstPatchFailure("AST_PATCH_OPERATION_CONFLICT", "The object property already exists with a different value.");
  const ending = lineEnding(source);
  const baseIndent = sourceIndent(source, object.getStart(sourceFile));
  const indent = baseIndent + "  ";
  const hasProperties = object.properties.length > 0;
  if (!hasProperties) {
    const insertion = `${ending}${indent}${operation.payload.propertyName}: ${normalizeLineEndings(operation.payload.value.trim(), ending)}${ending}${baseIndent}`;
    return { source: addTextAt(source, object.getEnd() - 1, insertion), targetKey: target.targetKey };
  }
  const lastProperty = object.properties[object.properties.length - 1];
  const insertion = `,${ending}${indent}${operation.payload.propertyName}: ${normalizeLineEndings(operation.payload.value.trim(), ending)}${ending}${baseIndent}`;
  return { source: source.slice(0, lastProperty.getEnd()) + insertion + source.slice(object.getEnd() - 1), targetKey: target.targetKey };
}

export type AstPatchExecutionContext = {
  task: AgentTask;
  taskScopes: readonly string[];
  dependencyContext?: DependencyAuthorityContext;
  maxPayloadBytes?: number;
};

export type AstPatchExecutionResult = { source: string; targetKey: string; evidence: AstPatchExecutionEvidence };

export function applyAstPatch(operationInput: AstPatchOperation, source: string, context: AstPatchExecutionContext): AstPatchExecutionResult {
  let operation: AstPatchOperation;
  try { operation = AstPatchOperationSchema.parse(operationInput); } catch (error) { throw new AstPatchFailure("AST_PATCH_PAYLOAD_INVALID", "AST patch operation failed strict validation.", { issueCount: error instanceof Error ? 1 : 0 }); }
  const maxPayloadBytes = context.maxPayloadBytes ?? AST_PATCH_MAX_PAYLOAD_BYTES;
  if (bytes(source) === 0) throw new AstPatchFailure("AST_SOURCE_PARSE_FAILED", "The AST patch target is empty.");
  if (hash(Buffer.from(source, "utf8")) !== operation.expectedFileChecksum) throw new AstPatchFailure("AST_PATCH_FILE_STALE", "The AST patch source checksum is stale.");
  const sourceFile = parseSource(operation.relativePath, source);
  validatePayload(JSON.stringify(operation.payload), maxPayloadBytes);
  let target: LocatedTarget;
  if (operation.patchKind === "ADD_NAMED_IMPORT") {
    validateImportAuthority(operation, operation.relativePath, context.taskScopes, context.dependencyContext ?? {});
    const matches = locate(sourceFile, operation.selector, operation.expectedTarget);
    if (matches.length > 1) throw new AstPatchFailure("AST_TARGET_AMBIGUOUS", "The import selector matched more than one declaration.");
    if (matches.length === 0) throw new AstPatchFailure("AST_TARGET_NOT_FOUND", "ADD_NAMED_IMPORT requires one compatible existing named import declaration.");
    target = matches[0];
  } else target = oneTarget(sourceFile, operation);
  let result: { source: string; targetKey: string; idempotent?: boolean };
  switch (operation.patchKind) {
    case "REPLACE_NODE_BODY": result = applyReplaceBody(source, sourceFile, operation, target); break;
    case "INSERT_BEFORE_NODE":
    case "INSERT_AFTER_NODE": result = applyInsert(source, sourceFile, operation, target); break;
    case "ADD_NAMED_IMPORT": result = applyAddImport(source, sourceFile, operation, target); break;
    case "REMOVE_IMPORT_SPECIFIER": result = applyRemoveImport(source, sourceFile, operation, target); break;
    case "ADD_OBJECT_PROPERTY": result = applyAddObjectProperty(source, sourceFile, operation, target); break;
  }
  const nextFile = parseSource(operation.relativePath, result.source, "AST_PATCH_RESULT_PARSE_FAILED");
  const postChecksum = hash(Buffer.from(result.source, "utf8"));
  if (postChecksum !== operation.expectedResultChecksum) throw new AstPatchFailure("AST_PATCH_RESULT_PARSE_FAILED", "The AST patch result checksum does not match the approved result.", { actualChecksum: postChecksum });
  return {
    source: result.source,
    targetKey: result.targetKey,
    evidence: {
      operationId: operation.operationId,
      patchKind: operation.patchKind,
      relativePath: operation.relativePath.replaceAll("\\", "/"),
      preChecksum: hash(Buffer.from(source, "utf8")),
      postChecksum,
      selectorSummary: `${selectorSummary(operation.selector)};node=${ts.SyntaxKind[target.node.kind]};validatedStatements=${nextFile.statements.length}`,
      result: result.idempotent ? "IDEMPOTENT_NOOP" : "APPLIED",
      validationStatus: "COMPLETE_TS_PARSE_VALIDATED",
    },
  };
}

export function summarizeTypeScriptSource(relativePath: string, source: string): AstStructuralContextEntry {
  const file = parseSource(relativePath, source);
  const declarations: AstStructuralContextEntry["declarations"] = [];
  const exported = (node: ts.Node) => ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false);
  for (const statement of file.statements) {
    if (declarations.length >= 40) break;
    if (ts.isFunctionDeclaration(statement) && statement.name) declarations.push({ kind: "function", name: statement.name.text, exported: exported(statement) });
    else if (ts.isClassDeclaration(statement) && statement.name) declarations.push({ kind: "class", name: statement.name.text, exported: exported(statement) });
    else if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) declarations.push({ kind: declaration.initializer && ts.isArrowFunction(declaration.initializer) ? "arrow-function" : "variable", name: declaration.name.text, exported: exported(statement) });
  }
  return { relativePath: relativePath.replaceAll("\\", "/"), sha256: hash(Buffer.from(source, "utf8")), declarations: declarations.slice(0, 40) };
}
