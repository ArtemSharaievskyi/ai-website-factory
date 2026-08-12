import { createHash } from "node:crypto";
import { FontpairNormalizedPairSchema, type DesignHttpTransport, type FontpairNormalizedPair } from "./contracts";

export const FONTPAIR_ORIGIN = "https://fontpair.co" as const;
const MAX_RESPONSE_BYTES = 300_000;
const checksum = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const defaultTransport: DesignHttpTransport = async (url, input) => { const response = await fetch(url, { method: input.method, redirect: "manual", signal: input.signal, headers: input.headers }); const body = await response.text(); if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) throw new Error("FONTPAIR_RESPONSE_TOO_LARGE"); return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body }; };
const normalize = (value: string) => value.replace(/\s+/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").trim().replace(/[.,;:]+$/, "");
const extractPairs = (body: string) => {
  const text = body.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const pairs: Array<{ displayFamily: string; bodyFamily: string }> = [];
  const pattern = /Headline\s+([A-Za-z][A-Za-z0-9 .&'_-]{1,100})\s+Body\s+([A-Za-z][A-Za-z0-9 .&'_-]{1,100})/gi;
  for (const match of text.matchAll(pattern)) { const displayFamily = normalize(match[1] ?? ""); const bodyFamily = normalize(match[2] ?? ""); if (displayFamily && bodyFamily && displayFamily.toLowerCase() !== bodyFamily.toLowerCase()) pairs.push({ displayFamily, bodyFamily }); }
  return pairs;
};

export class FontpairAdapter {
  private readonly cache = new Map<string, FontpairNormalizedPair>();
  constructor(private readonly options: { transport?: DesignHttpTransport; timeoutMs?: number } = {}) {}
  async recommendPair(input: { idempotencyKey: string; displayFamily?: string; bodyFamily?: string; signal?: AbortSignal }): Promise<FontpairNormalizedPair> {
    const cached = this.cache.get(input.idempotencyKey); if (cached) return cached;
    const target = new URL("/", FONTPAIR_ORIGIN).toString();
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15_000); const onAbort = () => controller.abort(); input.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const transport = this.options.transport ?? defaultTransport; const response = await transport(target, { method: "GET", signal: controller.signal, headers: { accept: "text/html" } });
      if (response.status < 200 || response.status >= 300) throw new Error(`FONTPAIR_HTTP_${response.status}`);
      const pairs = extractPairs(response.body); const wanted = pairs.find((pair) => (!input.displayFamily || pair.displayFamily.toLowerCase() === input.displayFamily.toLowerCase()) && (!input.bodyFamily || pair.bodyFamily.toLowerCase() === input.bodyFamily.toLowerCase())); const pair = wanted ?? pairs[0]; if (!pair) throw new Error("FONTPAIR_PAIR_NOT_FOUND");
      const result = FontpairNormalizedPairSchema.parse({ ...pair, sourceUrl: target, sourceChecksum: checksum(response.body), normalizedChecksum: checksum(JSON.stringify(pair)) }); this.cache.set(input.idempotencyKey, result); return result;
    } finally { clearTimeout(timer); input.signal?.removeEventListener("abort", onAbort); }
  }
}
