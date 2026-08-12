import { createHash } from "node:crypto";
import { FontpairNormalizedPairSchema, type DesignHttpTransport, type FontpairNormalizedPair } from "./contracts";

export const FONTPAIR_ORIGIN = "https://fontpair.co" as const;
const MAX_RESPONSE_BYTES = 300_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 1;

const checksum = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const normalize = (value: string) => value.replace(/\+/g, " ").replace(/\s+/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").trim().replace(/[.,;:]+$/, "");
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);

function stripMarkup(body: string) {
  return body.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

function extractPairs(body: string, sourceUrl: string, sourceChecksum: string, useCase: string) {
  const text = stripMarkup(body);
  const pairs: Array<{ displayFamily: string; bodyFamily: string }> = [];
  const explicitPattern = /Headline\s+([A-Za-z][A-Za-z0-9 .&'_-]{1,100})\s+Body\s+([A-Za-z][A-Za-z0-9 .&'_-]{1,100})/gi;
  for (const match of text.matchAll(explicitPattern)) {
    const displayFamily = normalize(match[1] ?? "");
    const bodyFamily = normalize(match[2] ?? "");
    if (displayFamily && bodyFamily && displayFamily.toLowerCase() !== bodyFamily.toLowerCase()) pairs.push({ displayFamily, bodyFamily });
  }

  const families = [...body.matchAll(/family=([^&"'\s>]+)/gi)].map((match) => normalize(decodeURIComponent((match[1] ?? "").split(":", 1)[0]))).filter(Boolean);
  const uniqueFamilies = [...new Set(families)].filter((family) => !/^Geist Mono$/i.test(family));
  const displayFamilies = uniqueFamilies.filter((family) => /serif|slab|display|playfair|baskerville|caveat|young/i.test(family));
  const bodyFamilies = uniqueFamilies.filter((family) => !displayFamilies.includes(family));
  for (const displayFamily of displayFamilies.slice(0, 6)) {
    for (const bodyFamily of bodyFamilies.slice(0, 6)) {
      if (displayFamily.toLowerCase() !== bodyFamily.toLowerCase()) pairs.push({ displayFamily, bodyFamily });
    }
  }
  const deduped = [...new Map(pairs.map((pair) => [`${pair.displayFamily.toLowerCase()}::${pair.bodyFamily.toLowerCase()}`, pair])).values()];
  return deduped.slice(0, 24).map((pair, index) => FontpairNormalizedPairSchema.parse({
    pairingId: `fontpair-${slug(pair.displayFamily)}-${slug(pair.bodyFamily)}-${index + 1}`,
    displayFamily: pair.displayFamily,
    bodyFamily: pair.bodyFamily,
    sourceTypes: ["google-fonts" as const],
    styleUseCase: useCase,
    sourceUrl,
    sourceChecksum,
    normalizedChecksum: checksum(JSON.stringify(pair)),
  }));
}

const defaultTransport: DesignHttpTransport = async (url, input) => {
  const response = await fetch(url, { method: input.method, redirect: "manual", signal: input.signal, headers: input.headers });
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) throw new Error("FONTPAIR_RESPONSE_TOO_LARGE");
  return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body };
};

export class FontpairAdapter {
  private readonly cache = new Map<string, FontpairNormalizedPair[]>();
  constructor(private readonly options: { transport?: DesignHttpTransport; timeoutMs?: number; maxRetries?: number } = {}) {}

  private async retrieve(input: { idempotencyKey: string; signal?: AbortSignal }) {
    const cached = this.cache.get(input.idempotencyKey);
    if (cached) return cached;
    const target = new URL("/", FONTPAIR_ORIGIN).toString();
    const transport = this.options.transport ?? defaultTransport;
    const retries = this.options.maxRetries ?? DEFAULT_MAX_RETRIES;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const onAbort = () => controller.abort();
      input.signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const response = await transport(target, { method: "GET", signal: controller.signal, headers: { accept: "text/html" } });
        if (Buffer.byteLength(response.body, "utf8") > MAX_RESPONSE_BYTES) throw new Error("FONTPAIR_RESPONSE_TOO_LARGE");
        const contentType = Object.entries(response.headers).find(([key]) => key.toLowerCase() === "content-type")?.[1];
        if (contentType && !/text\/html(?:\s*;|$)/i.test(contentType)) throw new Error("FONTPAIR_CONTENT_TYPE_INVALID");
        if (response.status === 429 || response.status >= 500) {
          if (attempt < retries) continue;
        }
        if (response.status < 200 || response.status >= 300) throw new Error(`FONTPAIR_HTTP_${response.status}`);
        const pairs = extractPairs(response.body, target, checksum(response.body), "general-purpose");
        if (!pairs.length) throw new Error("FONTPAIR_PAIR_NOT_FOUND");
        this.cache.set(input.idempotencyKey, pairs);
        return pairs;
      } catch (error) {
        if (attempt >= retries || (error instanceof Error && /^FONTPAIR_(HTTP_|PAIR_NOT_FOUND|CONTENT_TYPE_INVALID|RESPONSE_TOO_LARGE)/.test(error.message))) throw error;
      } finally {
        clearTimeout(timer);
        input.signal?.removeEventListener("abort", onAbort);
      }
    }
    throw new Error("FONTPAIR_SOURCE_UNAVAILABLE");
  }

  async listPairings(input: { idempotencyKey: string; useCase?: string; signal?: AbortSignal }) {
    const pairs = await this.retrieve(input);
    if (!input.useCase) return pairs;
    return pairs.map((pair) => ({ ...pair, styleUseCase: input.useCase ?? pair.styleUseCase, normalizedChecksum: checksum(JSON.stringify({ ...pair, styleUseCase: input.useCase ?? pair.styleUseCase })) }));
  }

  async searchPairings(input: { idempotencyKey: string; displayFamily?: string; bodyFamily?: string; useCase?: string; signal?: AbortSignal }) {
    const pairs = await this.listPairings(input);
    return pairs.filter((pair) => (!input.displayFamily || pair.displayFamily.toLowerCase().includes(input.displayFamily.toLowerCase())) && (!input.bodyFamily || pair.bodyFamily.toLowerCase().includes(input.bodyFamily.toLowerCase())));
  }

  async getFontPairing(input: { idempotencyKey: string; pairingId: string; signal?: AbortSignal }) {
    const pair = (await this.listPairings(input)).find((candidate) => candidate.pairingId === input.pairingId);
    if (!pair) throw new Error("FONTPAIR_PAIR_NOT_FOUND");
    return pair;
  }

  async getFontMetadata(input: { idempotencyKey: string; family: string; signal?: AbortSignal }) {
    const pairs = await this.listPairings(input);
    const matches = pairs.filter((pair) => pair.displayFamily.toLowerCase() === input.family.toLowerCase() || pair.bodyFamily.toLowerCase() === input.family.toLowerCase());
    if (!matches.length) throw new Error("FONTPAIR_FONT_NOT_FOUND");
    return { family: input.family, sourceTypes: matches[0]?.sourceTypes ?? [], pairingIds: matches.map((pair) => pair.pairingId), sourceUrl: matches[0]?.sourceUrl ?? new URL("/", FONTPAIR_ORIGIN).toString() };
  }

  async getUseCasePairings(input: { idempotencyKey: string; useCase: string; signal?: AbortSignal }) {
    return this.listPairings(input);
  }

  async recommendPair(input: { idempotencyKey: string; displayFamily?: string; bodyFamily?: string; useCase?: string; candidateIndex?: number; signal?: AbortSignal }): Promise<FontpairNormalizedPair> {
    const pairs = await this.searchPairings(input);
    const pair = pairs[input.candidateIndex ?? 0] ?? pairs[0];
    if (!pair) throw new Error("FONTPAIR_PAIR_NOT_FOUND");
    return pair;
  }
}
