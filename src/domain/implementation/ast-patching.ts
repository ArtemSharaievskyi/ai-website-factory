import { z } from "zod";

export const AST_PATCH_OPERATION_VERSION = "1.0.0" as const;
export const AST_PATCH_MAX_PAYLOAD_BYTES = 32_000 as const;
export const AST_PATCH_MAX_OPERATIONS = 8 as const;
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const UuidSchema = z.string().uuid();
const IdentifierSchema = z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/);
const RelativePathSchema = z.string().min(1).max(240);
const BoundedSourceSchema = z.string().min(1).max(AST_PATCH_MAX_PAYLOAD_BYTES);

export const AstSelectorSchema = z.discriminatedUnion("selectorKind", [
  z.object({ selectorKind: z.literal("function"), name: IdentifierSchema, exported: z.boolean().optional(), defaultExport: z.boolean().optional() }).strict(),
  z.object({ selectorKind: z.literal("arrow-function"), name: IdentifierSchema, exported: z.boolean().optional(), defaultExport: z.boolean().optional() }).strict(),
  z.object({ selectorKind: z.literal("variable"), name: IdentifierSchema }).strict(),
  z.object({ selectorKind: z.literal("object-property"), objectName: IdentifierSchema, propertyName: z.string().min(1).max(160) }).strict(),
  z.object({ selectorKind: z.literal("import-declaration"), moduleSpecifier: z.string().min(1).max(240), typeOnly: z.boolean().optional() }).strict(),
  z.object({ selectorKind: z.literal("import-specifier"), moduleSpecifier: z.string().min(1).max(240), importedName: IdentifierSchema, localName: IdentifierSchema.optional(), typeOnly: z.boolean().optional() }).strict(),
  z.object({ selectorKind: z.literal("class-method"), className: IdentifierSchema, methodName: IdentifierSchema, exported: z.boolean().optional(), defaultExport: z.boolean().optional() }).strict(),
]);
export type AstSelector = z.infer<typeof AstSelectorSchema>;

export const AstExpectedTargetSchema = z.object({
  nodeKind: z.string().min(1).max(80),
  structuralFingerprint: HashSchema.optional(),
}).strict();

const OperationReferenceSchema = z.object({
  type: z.literal("ast-patch"),
  operationId: UuidSchema,
  operationVersion: z.literal(AST_PATCH_OPERATION_VERSION),
  relativePath: RelativePathSchema,
  expectedFileChecksum: HashSchema,
  expectedResultChecksum: HashSchema,
  encoding: z.literal("utf-8"),
  taskId: UuidSchema,
  projectId: UuidSchema,
  projectVersion: z.number().int().positive(),
  taskContractId: UuidSchema,
  taskContractChecksum: HashSchema,
  taskGraphChecksum: HashSchema,
  artifactId: z.string().min(1).max(240).optional(),
  reason: z.string().min(1).max(500),
  requirementReferences: z.array(z.string().min(1)),
  planningReferences: z.array(z.string().min(1)),
  selectedDesignReferences: z.array(z.string().min(1)),
  selector: AstSelectorSchema,
  expectedTarget: AstExpectedTargetSchema.optional(),
  resultValidation: z.object({ parseRequired: z.literal(true), validationVersion: z.literal("1") }).strict(),
});

const ReplaceNodeBodySchema = OperationReferenceSchema.extend({
  patchKind: z.literal("REPLACE_NODE_BODY"),
  payload: z.object({ body: BoundedSourceSchema }).strict(),
});
const InsertNodeSchema = OperationReferenceSchema.extend({
  patchKind: z.union([z.literal("INSERT_BEFORE_NODE"), z.literal("INSERT_AFTER_NODE")]),
  payload: z.object({ source: BoundedSourceSchema }).strict(),
});
const AddNamedImportSchema = OperationReferenceSchema.extend({
  patchKind: z.literal("ADD_NAMED_IMPORT"),
  selector: z.discriminatedUnion("selectorKind", [
    z.object({ selectorKind: z.literal("import-declaration"), moduleSpecifier: z.string().min(1).max(240), typeOnly: z.boolean().optional() }).strict(),
  ]),
  payload: z.object({ moduleSpecifier: z.string().min(1).max(240), importedName: IdentifierSchema, localName: IdentifierSchema.optional(), typeOnly: z.boolean().default(false) }).strict(),
});
const RemoveImportSpecifierSchema = OperationReferenceSchema.extend({
  patchKind: z.literal("REMOVE_IMPORT_SPECIFIER"),
  selector: z.discriminatedUnion("selectorKind", [
    z.object({ selectorKind: z.literal("import-specifier"), moduleSpecifier: z.string().min(1).max(240), importedName: IdentifierSchema, localName: IdentifierSchema.optional(), typeOnly: z.boolean().optional() }).strict(),
  ]),
  payload: z.object({}).strict(),
});
const AddObjectPropertySchema = OperationReferenceSchema.extend({
  patchKind: z.literal("ADD_OBJECT_PROPERTY"),
  selector: z.discriminatedUnion("selectorKind", [
    z.object({ selectorKind: z.literal("variable"), name: IdentifierSchema }).strict(),
  ]),
  payload: z.object({ propertyName: z.string().min(1).max(160), value: BoundedSourceSchema }).strict(),
});

export const AstPatchOperationSchema = z.union([
  ReplaceNodeBodySchema,
  InsertNodeSchema,
  AddNamedImportSchema,
  RemoveImportSpecifierSchema,
  AddObjectPropertySchema,
]);
export type AstPatchOperation = z.infer<typeof AstPatchOperationSchema>;
export type AstPatchKind = AstPatchOperation["patchKind"];

export const AstPatchExecutionEvidenceSchema = z.object({
  operationId: UuidSchema,
  patchKind: z.string().min(1),
  relativePath: RelativePathSchema,
  preChecksum: HashSchema,
  postChecksum: HashSchema,
  selectorSummary: z.string().min(1).max(1_000),
  result: z.enum(["APPLIED", "IDEMPOTENT_NOOP"]),
  validationStatus: z.literal("COMPLETE_TS_PARSE_VALIDATED"),
}).strict();
export type AstPatchExecutionEvidence = z.infer<typeof AstPatchExecutionEvidenceSchema>;

export const AstStructuralContextEntrySchema = z.object({
  relativePath: RelativePathSchema,
  sha256: HashSchema,
  declarations: z.array(z.object({ kind: z.string().min(1).max(80), name: z.string().min(1).max(160), exported: z.boolean() }).strict()).max(40),
}).strict();
export type AstStructuralContextEntry = z.infer<typeof AstStructuralContextEntrySchema>;
