/**
 * Deterministic structural serialization. Callers normalize domain values
 * before serializing them; this module never assigns semantic meaning.
 */
export function stableSerialize(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
}

/** Locale-independent ordering for canonical arrays and target IDs. */
export const compareStrings = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
