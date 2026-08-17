import { readFile } from "node:fs/promises";
import path from "node:path";
import { isControlledCheckId, type ControlledCheckId } from "./checks";

export const CODEX_ROOT = path.resolve(__dirname, "../..");
export const KNOWN_REGRESSION_IDS = [
  "PROVIDER_STRICT_OPTIONALITY",
  "HOST_OWNED_PROVIDER_FIELDS",
  "CANONICAL_REQUIREMENT_TRUNCATION",
  "FAILED_IDEMPOTENCY_POISONING",
  "SEQUENTIAL_CLARIFICATION_IDEMPOTENCY",
  "CLIENT_ASSET_AUTHORITY",
  "ASSET_PERSISTENCE_NULLABILITY",
  "LEGACY_REQUIREMENT_REACTIVATION",
  "V1_TO_V2_BRIEF_REVISION",
  "STRUCTURED_OUTPUT_SCHEMA_CONSTRUCTION",
] as const;
export type RegressionId = (typeof KNOWN_REGRESSION_IDS)[number];

export type CheckMapRule = {
  id: string;
  area: string;
  pathPrefixes: string[];
  checkIds: ControlledCheckId[];
  productionPathIds?: string[];
};
export type CheckMapConfig = { version: 1; defaultCheckIds: ControlledCheckId[]; rules: CheckMapRule[] };
export type RegressionRule = { id: RegressionId; pathPrefixes: string[]; checkIds: ControlledCheckId[]; executable: boolean };
export type RegressionConfig = { version: 1; regressions: RegressionRule[] };
export type ProviderContractMetadata = { id: string; schemaName: string; productionReference: string; triggerPathPrefixes: string[]; affectedPathPrefixes?: string[] };
export type ProviderContractConfig = { version: 1; contracts: ProviderContractMetadata[] };

const object = (value: unknown, code: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
};
const strings = (value: unknown, code: string) => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) throw new Error(code);
  return value as string[];
};
const checkIds = (value: unknown, code: string) => {
  const values = strings(value, code);
  for (const item of values) if (!isControlledCheckId(item)) throw new Error(`CODEX_CONFIG_UNKNOWN_CHECK:${item}`);
  return values as ControlledCheckId[];
};
const prefixList = (value: unknown, code: string) => strings(value, code).map((item) => item.replaceAll("\\", "/").replace(/^\.\//, ""));

export function parseCheckMap(value: unknown): CheckMapConfig {
  const root = object(value, "CODEX_CHECK_MAP_INVALID");
  if (root.version !== 1) throw new Error("CODEX_CHECK_MAP_VERSION_UNSUPPORTED");
  const rulesValue = root.rules;
  if (!Array.isArray(rulesValue)) throw new Error("CODEX_CHECK_MAP_RULES_INVALID");
  const rules = rulesValue.map((item) => {
    const rule = object(item, "CODEX_CHECK_MAP_RULE_INVALID");
    if (typeof rule.id !== "string" || typeof rule.area !== "string") throw new Error("CODEX_CHECK_MAP_RULE_ID_INVALID");
    return { id: rule.id, area: rule.area, pathPrefixes: prefixList(rule.pathPrefixes, "CODEX_CHECK_MAP_PREFIXES_INVALID"), checkIds: checkIds(rule.checkIds, "CODEX_CHECK_MAP_CHECKS_INVALID"), ...(rule.productionPathIds === undefined ? {} : { productionPathIds: strings(rule.productionPathIds, "CODEX_CHECK_MAP_PATH_IDS_INVALID") }) };
  });
  return { version: 1, defaultCheckIds: checkIds(root.defaultCheckIds, "CODEX_CHECK_MAP_DEFAULTS_INVALID"), rules };
}

export function parseRegressionMap(value: unknown): RegressionConfig {
  const root = object(value, "CODEX_REGRESSION_MAP_INVALID");
  if (root.version !== 1 || !Array.isArray(root.regressions)) throw new Error("CODEX_REGRESSION_MAP_VERSION_INVALID");
  const regressions = root.regressions.map((item) => {
    const regression = object(item, "CODEX_REGRESSION_RULE_INVALID");
    if (typeof regression.id !== "string" || !(KNOWN_REGRESSION_IDS as readonly string[]).includes(regression.id)) throw new Error(`CODEX_CONFIG_UNKNOWN_REGRESSION:${String(regression.id)}`);
    if (typeof regression.executable !== "boolean") throw new Error("CODEX_REGRESSION_EXECUTABLE_INVALID");
    return { id: regression.id as RegressionId, pathPrefixes: prefixList(regression.pathPrefixes, "CODEX_REGRESSION_PREFIXES_INVALID"), checkIds: checkIds(regression.checkIds, "CODEX_REGRESSION_CHECKS_INVALID"), executable: regression.executable };
  });
  return { version: 1, regressions };
}

export function parseProviderContractRegistry(value: unknown): ProviderContractConfig {
  const root = object(value, "CODEX_PROVIDER_REGISTRY_INVALID");
  if (root.version !== 1 || !Array.isArray(root.contracts)) throw new Error("CODEX_PROVIDER_REGISTRY_VERSION_INVALID");
  if (root.knownFailures !== undefined || root.baselineFailures !== undefined) throw new Error("CODEX_PROVIDER_BASELINE_CONFIG_FORBIDDEN");
  const contracts = root.contracts.map((item) => {
    const contract = object(item, "CODEX_PROVIDER_REGISTRY_ENTRY_INVALID");
    if ([contract.id, contract.schemaName, contract.productionReference].some((field) => typeof field !== "string" || !field.trim())) throw new Error("CODEX_PROVIDER_REGISTRY_METADATA_INVALID");
    return { id: contract.id as string, schemaName: contract.schemaName as string, productionReference: contract.productionReference as string, triggerPathPrefixes: prefixList(contract.triggerPathPrefixes, "CODEX_PROVIDER_REGISTRY_PREFIXES_INVALID"), ...(contract.affectedPathPrefixes === undefined ? {} : { affectedPathPrefixes: prefixList(contract.affectedPathPrefixes, "CODEX_PROVIDER_REGISTRY_AFFECTED_PREFIXES_INVALID") }) };
  });
  return { version: 1, contracts };
}

async function loadJson(filename: string) {
  try { return JSON.parse(await readFile(path.join(CODEX_ROOT, "config", "codex", filename), "utf8")) as unknown; } catch (error) { throw new Error(`CODEX_CONFIG_READ_FAILED:${filename}`, { cause: error }); }
}

export async function loadCheckMap() { return parseCheckMap(await loadJson("check-map.json")); }
export async function loadRegressionMap() { return parseRegressionMap(await loadJson("regressions.json")); }
export async function loadProviderContractRegistry() { return parseProviderContractRegistry(await loadJson("provider-contracts.json")); }
