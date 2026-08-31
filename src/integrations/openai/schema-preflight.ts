import { Buffer } from "node:buffer";

/**
 * Local compatibility policy for OpenAI Structured Outputs.
 *
 * The limits and supported subset are taken from the current provider guide:
 * https://developers.openai.com/api/docs/guides/structured-outputs
 * Keep this policy versioned so a provider policy change is an explicit code
 * change and not an accidental production request failure.
 */
export const OPENAI_STRUCTURED_OUTPUT_PREFLIGHT_POLICY = {
  version: "openai-structured-outputs-2026-08",
  maxObjectProperties: 5000,
  maxNestingDepth: 10,
  maxTotalStringCharacters: 120000,
  maxTotalEnumValues: 1000,
  maxStringEnumValues: 250,
  maxStringEnumCharacters: 15000,
  supportedTypes: ["string", "number", "integer", "boolean", "object", "array", "null"],
  supportedFormats: ["date-time", "time", "date", "duration", "email", "hostname", "ipv4", "ipv6", "uuid"],
  supportedKeywords: [
    "$schema",
    "$defs",
    "$ref",
    "additionalProperties",
    "const",
    "definitions",
    "description",
    "enum",
    "exclusiveMaximum",
    "exclusiveMinimum",
    "format",
    "items",
    "maxItems",
    "maxLength",
    "maximum",
    "minItems",
    "minLength",
    "minimum",
    "multipleOf",
    "anyOf",
    "pattern",
    "properties",
    "required",
    "title",
    "type",
  ],
} as const;

type JsonSchemaObject = Record<string, unknown>;
type PreflightIssueCode =
  | "INVALID_SCHEMA"
  | "ROOT_NOT_OBJECT"
  | "ROOT_ANYOF_UNSUPPORTED"
  | "UNSUPPORTED_KEYWORD"
  | "UNSUPPORTED_FORMAT"
  | "INVALID_TYPE"
  | "OBJECT_PROPERTIES_INVALID"
  | "OBJECT_REQUIRED_INVALID"
  | "OBJECT_REQUIRED_MISMATCH"
  | "OBJECT_ADDITIONAL_PROPERTIES_INVALID"
  | "MAX_NESTING_DEPTH_EXCEEDED"
  | "OBJECT_PROPERTY_BUDGET_EXCEEDED"
  | "ENUM_VALUE_BUDGET_EXCEEDED"
  | "ENUM_STRING_BUDGET_EXCEEDED"
  | "SCHEMA_STRING_BUDGET_EXCEEDED"
  | "STRICT_RESPONSE_FORMAT_REQUIRED";

export type StructuredOutputPreflightIssue = {
  code: PreflightIssueCode;
  path: string;
  keyword?: string;
  detail: string;
};

export type StructuredOutputSchemaMetrics = {
  serializedBytes: number;
  rootType: string | null;
  maximumNestingDepth: number;
  totalObjectProperties: number;
  largestObjectPropertyCount: number;
  totalRequiredEntries: number;
  totalEnumValues: number;
  largestEnumValueCount: number;
  largestEnumPath?: string;
  largestStringEnumValueCount: number;
  largestStringEnumCharacters: number;
  totalStringCharacters: {
    propertyNames: number;
    definitionNames: number;
    enumValues: number;
    constValues: number;
    total: number;
  };
  referenceCount: number;
  definitionCount: number;
  defsCount: number;
  nodeCounts: {
    object: number;
    array: number;
    enum: number;
    anyOf: number;
    ref: number;
  };
  unsupportedKeywords: Array<{ keyword: string; path: string }>;
};

export type StructuredOutputPreflightResult = {
  metrics: StructuredOutputSchemaMetrics;
  issues: StructuredOutputPreflightIssue[];
};

export class StructuredOutputPreflightError extends Error {
  constructor(readonly issue: StructuredOutputPreflightIssue, readonly metrics: StructuredOutputSchemaMetrics) {
    super(`Structured output schema preflight failed at ${issue.path}: ${issue.detail}`);
    this.name = "StructuredOutputPreflightError";
  }
}

const SUPPORTED_KEYWORDS = new Set<string>(OPENAI_STRUCTURED_OUTPUT_PREFLIGHT_POLICY.supportedKeywords);
const SUPPORTED_TYPES = new Set<string>(OPENAI_STRUCTURED_OUTPUT_PREFLIGHT_POLICY.supportedTypes);
const SUPPORTED_FORMATS = new Set<string>(OPENAI_STRUCTURED_OUTPUT_PREFLIGHT_POLICY.supportedFormats);

function isObject(value: unknown): value is JsonSchemaObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pathForProperty(path: string, property: string) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(property) ? `${path}.${property}` : `${path}[${JSON.stringify(property)}]`;
}

function safeJsonPath(path: string) {
  return path.replace(/[^A-Za-z0-9_$.[\]/:#-]/g, "_").slice(0, 240) || "$";
}

function stringLength(value: unknown) {
  return typeof value === "string" ? value.length : 0;
}

function pushIssue(issues: StructuredOutputPreflightIssue[], issue: StructuredOutputPreflightIssue) {
  if (issues.length < 20) issues.push({ ...issue, path: safeJsonPath(issue.path) });
}

export function inspectStructuredOutputSchema(input: { schema: unknown; strict?: unknown }): StructuredOutputPreflightResult {
  const schema = input.schema;
  const issues: StructuredOutputPreflightIssue[] = [];
  const metrics: StructuredOutputSchemaMetrics = {
    serializedBytes: 0,
    rootType: isObject(schema) && typeof schema.type === "string" ? schema.type : null,
    maximumNestingDepth: 0,
    totalObjectProperties: 0,
    largestObjectPropertyCount: 0,
    totalRequiredEntries: 0,
    totalEnumValues: 0,
    largestEnumValueCount: 0,
    largestStringEnumValueCount: 0,
    largestStringEnumCharacters: 0,
    totalStringCharacters: { propertyNames: 0, definitionNames: 0, enumValues: 0, constValues: 0, total: 0 },
    referenceCount: 0,
    definitionCount: 0,
    defsCount: 0,
    nodeCounts: { object: 0, array: 0, enum: 0, anyOf: 0, ref: 0 },
    unsupportedKeywords: [],
  };
  const serialized = (() => {
    try { return JSON.stringify(schema); } catch { return undefined; }
  })();
  if (serialized === undefined) {
    pushIssue(issues, { code: "INVALID_SCHEMA", path: "$", detail: "Schema must be JSON serializable." });
  } else {
    metrics.serializedBytes = Buffer.byteLength(serialized, "utf8");
  }
  if (!isObject(schema)) {
    pushIssue(issues, { code: "INVALID_SCHEMA", path: "$", detail: "Schema must be a JSON object." });
    return { metrics, issues };
  }
  if (schema.type !== "object") pushIssue(issues, { code: "ROOT_NOT_OBJECT", path: "$.type", detail: "The root schema must have type object." });
  if (schema.anyOf !== undefined) pushIssue(issues, { code: "ROOT_ANYOF_UNSUPPORTED", path: "$.anyOf", keyword: "anyOf", detail: "The root schema cannot be anyOf." });
  if (input.strict !== undefined && input.strict !== true) pushIssue(issues, { code: "STRICT_RESPONSE_FORMAT_REQUIRED", path: "$.strict", detail: "The provider response format must be strict=true." });

  const visited = new Set<unknown>();
  const visit = (value: unknown, path: string, depth: number, definitionContainer = false): void => {
    if (!isObject(value)) {
      if (!definitionContainer) pushIssue(issues, { code: "INVALID_SCHEMA", path, detail: "Schema nodes must be JSON objects." });
      return;
    }
    if (visited.has(value)) return;
    visited.add(value);
    metrics.maximumNestingDepth = Math.max(metrics.maximumNestingDepth, depth);
    if (depth > OPENAI_STRUCTURED_OUTPUT_PREFLIGHT_POLICY.maxNestingDepth) pushIssue(issues, { code: "MAX_NESTING_DEPTH_EXCEEDED", path, detail: `Schema nesting depth exceeds ${OPENAI_STRUCTURED_OUTPUT_PREFLIGHT_POLICY.maxNestingDepth}.` });

    for (const keyword of Object.keys(value)) {
      if (!SUPPORTED_KEYWORDS.has(keyword)) {
        metrics.unsupportedKeywords.push({ keyword, path: safeJsonPath(path) });
        pushIssue(issues, { code: "UNSUPPORTED_KEYWORD", path: `${path}.${keyword}`, keyword, detail: `Keyword ${keyword} is outside the provider strict-schema subset.` });
      }
    }

    if (typeof value.type === "string") {
      if (!SUPPORTED_TYPES.has(value.type)) pushIssue(issues, { code: "INVALID_TYPE", path: `${path}.type`, detail: `Type ${value.type} is not supported.` });
      if (value.type === "object") {
        metrics.nodeCounts.object += 1;
        if (!isObject(value.properties)) {
          pushIssue(issues, { code: "OBJECT_PROPERTIES_INVALID", path: `${path}.properties`, detail: "Object schemas must define properties as an object." });
        } else {
          const propertyNames = Object.keys(value.properties);
          metrics.totalObjectProperties += propertyNames.length;
          metrics.largestObjectPropertyCount = Math.max(metrics.largestObjectPropertyCount, propertyNames.length);
          for (const propertyName of propertyNames) {
            metrics.totalStringCharacters.propertyNames += propertyName.length;
            visit(value.properties[propertyName], pathForProperty(`${path}.properties`, propertyName), depth + 1);
          }
          if (!Array.isArray(value.required) || value.required.some((entry) => typeof entry !== "string")) {
            pushIssue(issues, { code: "OBJECT_REQUIRED_INVALID", path: `${path}.required`, detail: "Object schemas must define required as an array of property names." });
          } else {
            metrics.totalRequiredEntries += value.required.length;
            const expected = new Set(propertyNames);
            const actual = new Set(value.required);
            const mismatch = actual.size !== expected.size || [...expected].some((name) => !actual.has(name));
            if (mismatch) pushIssue(issues, { code: "OBJECT_REQUIRED_MISMATCH", path: `${path}.required`, detail: "Every object property must be required exactly once." });
          }
          if (value.additionalProperties !== false) pushIssue(issues, { code: "OBJECT_ADDITIONAL_PROPERTIES_INVALID", path: `${path}.additionalProperties`, detail: "Object schemas must set additionalProperties=false." });
        }
      }
      if (value.type === "array") {
        metrics.nodeCounts.array += 1;
        if (value.items !== undefined) visit(value.items, `${path}.items`, depth + 1);
      }
    }
    if (Array.isArray(value.enum)) {
      metrics.nodeCounts.enum += 1;
      metrics.totalEnumValues += value.enum.length;
      if (value.enum.length > metrics.largestEnumValueCount) {
        metrics.largestEnumValueCount = value.enum.length;
        metrics.largestEnumPath = safeJsonPath(path);
      }
      const enumCharacters = value.enum.reduce((total, entry) => total + stringLength(entry), 0);
      const allStrings = value.enum.every((entry) => typeof entry === "string");
      if (allStrings) {
        metrics.largestStringEnumValueCount = Math.max(metrics.largestStringEnumValueCount, value.enum.length);
        metrics.largestStringEnumCharacters = Math.max(metrics.largestStringEnumCharacters, enumCharacters);
        if (value.enum.length > OPENAI_STRUCTURED_OUTPUT_PREFLIGHT_POLICY.maxStringEnumValues || enumCharacters > OPENAI_STRUCTURED_OUTPUT_PREFLIGHT_POLICY.maxStringEnumCharacters) {
          pushIssue(issues, { code: "ENUM_STRING_BUDGET_EXCEEDED", path: `${path}.enum`, keyword: "enum", detail: "A single string enum exceeds the provider enum budget." });
        }
      }
      metrics.totalStringCharacters.enumValues += enumCharacters;
    }
    if (typeof value.const === "string") metrics.totalStringCharacters.constValues += value.const.length;
    if (typeof value.format === "string" && !SUPPORTED_FORMATS.has(value.format)) pushIssue(issues, { code: "UNSUPPORTED_FORMAT", path: `${path}.format`, keyword: "format", detail: `Format ${value.format} is not supported.` });
    if (typeof value.$ref === "string") {
      metrics.referenceCount += 1;
      metrics.nodeCounts.ref += 1;
    }
    if (Array.isArray(value.anyOf)) {
      metrics.nodeCounts.anyOf += 1;
      for (const [index, child] of value.anyOf.entries()) visit(child, `${path}.anyOf[${index}]`, depth + 1);
    }
    for (const containerName of ["definitions", "$defs"] as const) {
      const container = value[containerName];
      if (!isObject(container)) continue;
      if (containerName === "definitions") metrics.definitionCount += Object.keys(container).length;
      else metrics.defsCount += Object.keys(container).length;
      for (const [name, child] of Object.entries(container)) {
        metrics.totalStringCharacters.definitionNames += name.length;
        visit(child, `${path}.${containerName}.${name}`, depth + 1, true);
      }
    }
  };
  visit(schema, "$", 1);

  metrics.totalStringCharacters.total = metrics.totalStringCharacters.propertyNames + metrics.totalStringCharacters.definitionNames + metrics.totalStringCharacters.enumValues + metrics.totalStringCharacters.constValues;
  if (metrics.totalObjectProperties > OPENAI_STRUCTURED_OUTPUT_PREFLIGHT_POLICY.maxObjectProperties) pushIssue(issues, { code: "OBJECT_PROPERTY_BUDGET_EXCEEDED", path: "$", detail: `Schema contains more than ${OPENAI_STRUCTURED_OUTPUT_PREFLIGHT_POLICY.maxObjectProperties} object properties.` });
  if (metrics.totalEnumValues > OPENAI_STRUCTURED_OUTPUT_PREFLIGHT_POLICY.maxTotalEnumValues) pushIssue(issues, { code: "ENUM_VALUE_BUDGET_EXCEEDED", path: "$", detail: `Schema contains more than ${OPENAI_STRUCTURED_OUTPUT_PREFLIGHT_POLICY.maxTotalEnumValues} enum values.` });
  if (metrics.totalStringCharacters.total > OPENAI_STRUCTURED_OUTPUT_PREFLIGHT_POLICY.maxTotalStringCharacters) pushIssue(issues, { code: "SCHEMA_STRING_BUDGET_EXCEEDED", path: "$", detail: `Schema contains more than ${OPENAI_STRUCTURED_OUTPUT_PREFLIGHT_POLICY.maxTotalStringCharacters} counted string characters.` });
  return { metrics, issues };
}

export function assertStructuredOutputPreflight(input: { schema: unknown; strict?: unknown }): StructuredOutputSchemaMetrics {
  const result = inspectStructuredOutputSchema(input);
  if (result.issues.length > 0) throw new StructuredOutputPreflightError(result.issues[0]!, result.metrics);
  return result.metrics;
}
