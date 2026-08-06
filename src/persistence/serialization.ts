import { createHash } from "node:crypto";

export function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stableValue(entry)]));
  return value;
}

export function serializePersistedDocument(value: unknown): string { return `${JSON.stringify(stableValue(value), null, 2)}\n`; }
export function checksumPersistedDocument(value: unknown): string { return createHash("sha256").update(serializePersistedDocument(value), "utf8").digest("hex"); }
