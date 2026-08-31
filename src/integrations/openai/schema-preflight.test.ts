import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createPlanningRecoveryProviderWireSchema, PlanningRecoveryProviderSchemaDefinitions } from "./adapters";
import { buildProductionResponseFormat } from "./client";
import { assertStructuredOutputPreflight, inspectStructuredOutputSchema, StructuredOutputPreflightError } from "./schema-preflight";

function objectSchema(properties: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false, ...overrides };
}

describe("OpenAI Structured Outputs schema preflight", () => {
  it("passes the compact 118-requirement recovery contract and exposes reusable definitions", () => {
    const manifest = { requirements: Array.from({ length: 118 }, (_, index) => ({ requirementHandle: `planning-requirement:R${String(index).padStart(3, "0")}` })) };
    const schema = createPlanningRecoveryProviderWireSchema(manifest as never);
    const responseFormat = buildProductionResponseFormat(schema, "planning-recovery-package", { schemaDefinitions: PlanningRecoveryProviderSchemaDefinitions }) as unknown as { json_schema: { schema: unknown; strict: boolean } };
    const result = inspectStructuredOutputSchema(responseFormat.json_schema);
    expect(result.issues).toEqual([]);
    expect(responseFormat.json_schema.strict).toBe(true);
    expect(result.metrics.serializedBytes).toBeLessThan(60_000);
    expect(result.metrics.maximumNestingDepth).toBe(9);
    expect(result.metrics.totalObjectProperties).toBe(583);
    expect(result.metrics.totalEnumValues).toBe(128);
    expect(result.metrics.definitionCount).toBe(3);
    expect(result.metrics.referenceCount).toBe(120);
    expect(result.metrics.unsupportedKeywords).toEqual([]);
  });

  it.each([
    ["unsupported keyword", objectSchema({ value: { type: "string" } }, { allOf: [] }), "UNSUPPORTED_KEYWORD"],
    ["missing required property", { type: "object", properties: { value: { type: "string" } }, required: [], additionalProperties: false }, "OBJECT_REQUIRED_MISMATCH"],
    ["additional properties enabled", { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: true }, "OBJECT_ADDITIONAL_PROPERTIES_INVALID"],
    ["oversized enum", objectSchema({ value: { type: "string", enum: Array.from({ length: 1001 }, (_, index) => `value-${index}`) } }), "ENUM_VALUE_BUDGET_EXCEEDED"],
  ] as const)("rejects the %s fixture deterministically", (_name, schema, code) => {
    const result = inspectStructuredOutputSchema({ schema, strict: true });
    expect(result.issues.some((issue) => issue.code === code)).toBe(true);
    expect(() => assertStructuredOutputPreflight({ schema, strict: true })).toThrow(StructuredOutputPreflightError);
  });

  it("rejects a schema deeper than the provider nesting limit", () => {
    let schema: Record<string, unknown> = { type: "string" };
    for (let index = 0; index < 10; index += 1) schema = objectSchema({ [`level${index}`]: schema });
    const result = inspectStructuredOutputSchema({ schema, strict: true });
    expect(result.issues.some((issue) => issue.code === "MAX_NESTING_DEPTH_EXCEEDED")).toBe(true);
  });

  it("uses the same preflight for a normal strict provider contract", () => {
    const schema = z.object({ ok: z.boolean(), summary: z.string() }).strict();
    expect(() => buildProductionResponseFormat(schema, "synthetic-output")).not.toThrow();
  });
});
