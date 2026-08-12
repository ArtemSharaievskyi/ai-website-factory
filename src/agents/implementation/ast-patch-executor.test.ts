import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { applyAstPatch, AstPatchFailure, summarizeTypeScriptSource } from "./ast-patch-executor";
import { AstPatchOperationSchema, type AstPatchOperation } from "@/domain/implementation/ast-patching";

const sha = (value: string) => createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
const task = { id: randomUUID(), projectId: randomUUID(), projectVersion: 1, role: "implementation", taskType: "implement-page", title: "Page", objective: "Patch page", inputs: [], expectedOutputs: [], allowedSkills: [], allowedTools: ["controlled-edit"], requiredCapabilities: ["edit.ast-patch"], fileScopes: ["src/**"], dependencies: [], status: "running", attempt: 1, maxAttempts: 3, createdAt: "2026-01-01T00:00:00.000Z" };
const context = { task: task as never, taskScopes: ["src/**"] };
const base = (source: string, patch: Record<string, unknown>, result: string) => AstPatchOperationSchema.parse({ ...patch, operationId: randomUUID(), expectedFileChecksum: sha(source), expectedResultChecksum: sha(result) });

describe("controlled AST patch executor", () => {
  it("locates one named function structurally and replaces only its body", () => {
    const source = `// preserve\nexport function greet(name: string) {\n  return "hello " + name;\n}\n`;
    const result = `// preserve\nexport function greet(name: string) {\n  return "hi " + name;\n}\n`;
    const operation = base(source, { type: "ast-patch", operationVersion: "1.0.0", relativePath: "src/page.ts", encoding: "utf-8", taskId: task.id, projectId: task.projectId, projectVersion: 1, taskContractId: randomUUID(), taskContractChecksum: "a".repeat(64), taskGraphChecksum: "b".repeat(64), reason: "Update greeting", requirementReferences: ["req:1"], planningReferences: ["plan:1"], selectedDesignReferences: [], selector: { selectorKind: "function", name: "greet", exported: true }, patchKind: "REPLACE_NODE_BODY", payload: { body: `{\n  return "hi " + name;\n}` }, resultValidation: { parseRequired: true, validationVersion: "1" } }, result);
    expect(applyAstPatch(operation, source, context).source).toBe(result);
  });

  it("preserves CRLF line endings and rejects a stale file checksum", () => {
    const source = "export function value() {\r\n  return 1;\r\n}\r\n";
    const result = "export function value() {\r\n  return 2;\r\n}\r\n";
    const operation = base(source, { type: "ast-patch", operationVersion: "1.0.0", relativePath: "src/value.ts", encoding: "utf-8", taskId: task.id, projectId: task.projectId, projectVersion: 1, taskContractId: randomUUID(), taskContractChecksum: "a".repeat(64), taskGraphChecksum: "b".repeat(64), reason: "Update value", requirementReferences: ["req:1"], planningReferences: ["plan:1"], selectedDesignReferences: [], selector: { selectorKind: "function", name: "value" }, patchKind: "REPLACE_NODE_BODY", payload: { body: "{\n  return 2;\n}" }, resultValidation: { parseRequired: true, validationVersion: "1" } }, result);
    expect(applyAstPatch(operation, source, context).source).toBe(result);
    expect(() => applyAstPatch({ ...operation, expectedFileChecksum: sha("changed") }, source, context)).toThrowError(expect.objectContaining({ code: "AST_PATCH_FILE_STALE" }));
  });

  it("fails closed for missing and ambiguous selectors", () => {
    const missingSource = "export function one() { return 1; }\n";
    const missing = base(missingSource, { type: "ast-patch", operationVersion: "1.0.0", relativePath: "src/page.ts", encoding: "utf-8", taskId: task.id, projectId: task.projectId, projectVersion: 1, taskContractId: randomUUID(), taskContractChecksum: "a".repeat(64), taskGraphChecksum: "b".repeat(64), reason: "Missing target", requirementReferences: [], planningReferences: [], selectedDesignReferences: [], selector: { selectorKind: "function", name: "missing" }, patchKind: "REPLACE_NODE_BODY", payload: { body: "{ return 2; }" }, resultValidation: { parseRequired: true, validationVersion: "1" } }, missingSource);
    expect(() => applyAstPatch(missing, missingSource, context)).toThrowError(expect.objectContaining({ code: "AST_TARGET_NOT_FOUND" }));
    const ambiguousSource = "function duplicate() { return 1; }\nfunction duplicate() { return 2; }\n";
    const ambiguous = base(ambiguousSource, { type: "ast-patch", operationVersion: "1.0.0", relativePath: "src/page.ts", encoding: "utf-8", taskId: task.id, projectId: task.projectId, projectVersion: 1, taskContractId: randomUUID(), taskContractChecksum: "a".repeat(64), taskGraphChecksum: "b".repeat(64), reason: "Ambiguous target", requirementReferences: [], planningReferences: [], selectedDesignReferences: [], selector: { selectorKind: "function", name: "duplicate" }, patchKind: "REPLACE_NODE_BODY", payload: { body: "{ return 3; }" }, resultValidation: { parseRequired: true, validationVersion: "1" } }, ambiguousSource);
    expect(() => applyAstPatch(ambiguous, ambiguousSource, context)).toThrowError(expect.objectContaining({ code: "AST_TARGET_AMBIGUOUS" }));
  });

  it("adds, removes, and idempotently recognizes named imports", () => {
    const source = `import { Button } from "react";\nexport const Page = () => <Button />;\n`;
    const result = `import { Button, Link } from "react";\nexport const Page = () => <Button />;\n`;
    const operation = base(source, { type: "ast-patch", operationVersion: "1.0.0", relativePath: "src/page.tsx", encoding: "utf-8", taskId: task.id, projectId: task.projectId, projectVersion: 1, taskContractId: randomUUID(), taskContractChecksum: "a".repeat(64), taskGraphChecksum: "b".repeat(64), reason: "Add approved import", requirementReferences: [], planningReferences: [], selectedDesignReferences: [], selector: { selectorKind: "import-declaration", moduleSpecifier: "react" }, patchKind: "ADD_NAMED_IMPORT", payload: { moduleSpecifier: "react", importedName: "Link", typeOnly: false }, resultValidation: { parseRequired: true, validationVersion: "1" } }, result);
    expect(applyAstPatch(operation, source, context).source).toBe(result);
    const idempotentSource = result;
    const idempotent = base(idempotentSource, { ...operation, operationId: undefined, expectedFileChecksum: undefined, expectedResultChecksum: undefined } as unknown as Record<string, unknown>, idempotentSource) as AstPatchOperation;
    expect(applyAstPatch(idempotent, idempotentSource, context).evidence.result).toBe("IDEMPOTENT_NOOP");
    const removeSource = `import { Button, Link } from "react";\n`;
    const removeResult = `import { Button } from "react";\n`;
    const remove = base(removeSource, { type: "ast-patch", operationVersion: "1.0.0", relativePath: "src/page.ts", encoding: "utf-8", taskId: task.id, projectId: task.projectId, projectVersion: 1, taskContractId: randomUUID(), taskContractChecksum: "a".repeat(64), taskGraphChecksum: "b".repeat(64), reason: "Remove import", requirementReferences: [], planningReferences: [], selectedDesignReferences: [], selector: { selectorKind: "import-specifier", moduleSpecifier: "react", importedName: "Link" }, patchKind: "REMOVE_IMPORT_SPECIFIER", payload: {}, resultValidation: { parseRequired: true, validationVersion: "1" } }, removeResult);
    expect(applyAstPatch(remove, removeSource, context).source).toBe(removeResult);
  });

  it("adds an object property, inserts a statement, and bounds payloads/files", () => {
    const source = "const config = { enabled: true };\n";
    const result = "const config = { enabled: true,\n  debug: false\n};\n";
    const operation = base(source, { type: "ast-patch", operationVersion: "1.0.0", relativePath: "src/config.ts", encoding: "utf-8", taskId: task.id, projectId: task.projectId, projectVersion: 1, taskContractId: randomUUID(), taskContractChecksum: "a".repeat(64), taskGraphChecksum: "b".repeat(64), reason: "Add debug flag", requirementReferences: [], planningReferences: [], selectedDesignReferences: [], selector: { selectorKind: "variable", name: "config" }, patchKind: "ADD_OBJECT_PROPERTY", payload: { propertyName: "debug", value: "false" }, resultValidation: { parseRequired: true, validationVersion: "1" } }, result);
    expect(applyAstPatch(operation, source, context).source).toBe(result);
    const insertSource = "const first = true;\n";
    const insertResult = "const first = true;\nconst second = false;\n";
    const insert = base(insertSource, { type: "ast-patch", operationVersion: "1.0.0", relativePath: "src/config.ts", encoding: "utf-8", taskId: task.id, projectId: task.projectId, projectVersion: 1, taskContractId: randomUUID(), taskContractChecksum: "a".repeat(64), taskGraphChecksum: "b".repeat(64), reason: "Insert statement", requirementReferences: [], planningReferences: [], selectedDesignReferences: [], selector: { selectorKind: "variable", name: "first" }, patchKind: "INSERT_AFTER_NODE", payload: { source: "const second = false;" }, resultValidation: { parseRequired: true, validationVersion: "1" } }, insertResult);
    expect(applyAstPatch(insert, insertSource, context).source).toBe(insertResult);
    expect(() => applyAstPatch({ ...operation, relativePath: "src/config.js" } as AstPatchOperation, source, context)).toThrowError(expect.objectContaining({ code: "AST_PATCH_UNSUPPORTED_FILE" }));
    expect(() => applyAstPatch({ ...operation, payload: { propertyName: "debug", value: "x".repeat(33_000) } } as AstPatchOperation, source, context)).toThrowError(AstPatchFailure);
  });

  it("enforces dependency authority and local import scope before editing", () => {
    const source = `import { Button } from "react";\n`;
    const operation = base(source, { type: "ast-patch", operationVersion: "1.0.0", relativePath: "src/page.ts", encoding: "utf-8", taskId: task.id, projectId: task.projectId, projectVersion: 1, taskContractId: randomUUID(), taskContractChecksum: "a".repeat(64), taskGraphChecksum: "b".repeat(64), reason: "Unapproved package", requirementReferences: [], planningReferences: [], selectedDesignReferences: [], selector: { selectorKind: "import-declaration", moduleSpecifier: "some-unapproved-package" }, patchKind: "ADD_NAMED_IMPORT", payload: { moduleSpecifier: "some-unapproved-package", importedName: "Widget", typeOnly: false }, resultValidation: { parseRequired: true, validationVersion: "1" } }, source);
    expect(() => applyAstPatch(operation, source, context)).toThrowError(expect.objectContaining({ code: "AST_PATCH_UNAPPROVED_DEPENDENCY" }));
    const local = base(source, { ...operation, selector: { selectorKind: "import-declaration", moduleSpecifier: "./outside" }, payload: { moduleSpecifier: "./outside", importedName: "Widget", typeOnly: false } }, source);
    expect(() => applyAstPatch(local, source, { task: task as never, taskScopes: ["src/owned/**"] })).toThrowError(expect.objectContaining({ code: "AST_PATCH_SCOPE_VIOLATION" }));
  });

  it("rejects malformed current source and invalid snippet payloads", () => {
    const source = "export function broken( {\n";
    const operation = base(source, { type: "ast-patch", operationVersion: "1.0.0", relativePath: "src/broken.ts", encoding: "utf-8", taskId: task.id, projectId: task.projectId, projectVersion: 1, taskContractId: randomUUID(), taskContractChecksum: "a".repeat(64), taskGraphChecksum: "b".repeat(64), reason: "Parse", requirementReferences: [], planningReferences: [], selectedDesignReferences: [], selector: { selectorKind: "function", name: "broken" }, patchKind: "REPLACE_NODE_BODY", payload: { body: "{ return ; }" }, resultValidation: { parseRequired: true, validationVersion: "1" } }, source);
    expect(() => applyAstPatch(operation, source, context)).toThrowError(expect.objectContaining({ code: "AST_SOURCE_PARSE_FAILED" }));
    const validSource = "export function okay() { return 1; }\n";
    const invalid = base(validSource, { ...operation, relativePath: "src/okay.ts", selector: { selectorKind: "function", name: "okay" }, payload: { body: "{ return ; }" } }, validSource);
    expect(() => applyAstPatch(invalid, validSource, context)).toThrowError(expect.objectContaining({ code: "AST_PATCH_RESULT_PARSE_FAILED" }));
  });

  it("returns bounded structural context without exposing the source", () => {
    const summary = summarizeTypeScriptSource("src/page.tsx", "export function Page() { return null; }\nconst value = 1;\n");
    expect(summary).toMatchObject({ relativePath: "src/page.tsx", declarations: [{ kind: "function", name: "Page", exported: true }, { kind: "variable", name: "value", exported: false }] });
    expect(summary).not.toHaveProperty("content");
  });
});
