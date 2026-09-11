import { createHash } from "node:crypto";
import { GoogleFontResearchSchema, TypographyCandidateSchema, type GoogleFontResearch } from "@/domain/design/resources";
import type { DesignHttpTransport } from "./contracts";

export const GOOGLE_FONTS_METADATA_URL = "https://www.googleapis.com/webfonts/v1/webfonts" as const;
const MAX_RESPONSE_BYTES = 500_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

type GoogleFontItem = { family?: unknown; category?: unknown; subsets?: unknown; variants?: unknown; axes?: unknown; version?: unknown; lastModified?: unknown };
type GoogleFontsResponse = { items?: unknown };

const defaultTransport: DesignHttpTransport = async (url, input) => {
  const response = await fetch(url, { method: input.method, redirect: "manual", signal: input.signal, headers: input.headers });
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) throw new Error("GOOGLE_FONTS_RESPONSE_TOO_LARGE");
  return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body };
};

const asStrings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const asNumbers = (variants: string[]) => [...new Set(variants.map((variant) => variant.replace(/italic$/i, "")).map((variant) => variant === "regular" ? 400 : Number(variant)).filter((weight) => Number.isInteger(weight) && weight > 0 && weight <= 1_000))].sort((left, right) => left - right);
const personality = (item: GoogleFontItem) => {
  const category = typeof item.category === "string" ? item.category : "unknown";
  return category === "serif" ? "Editorial, literary, and contrast-led." : category === "display" ? "Expressive display character; use selectively." : category === "handwriting" ? "Informal expressive character; reserve for intentional accents." : category === "monospace" ? "Technical and tabular character; do not use as general body copy without Design approval." : "Neutral-to-humanist interface character; evaluate against the approved brand direction.";
};

function parseCandidates(body: string, query: string, languageCoverage: readonly string[], sourceChecksum: string) {
  let parsed: GoogleFontsResponse;
  try { parsed = JSON.parse(body) as GoogleFontsResponse; } catch (error) { throw new Error("GOOGLE_FONTS_RESPONSE_INVALID", { cause: error }); }
  if (!Array.isArray(parsed.items)) throw new Error("GOOGLE_FONTS_ITEMS_MISSING");
  const normalizedQuery = query.trim().toLowerCase();
  const candidates = parsed.items.filter((item): item is GoogleFontItem => Boolean(item && typeof item === "object" && typeof (item as GoogleFontItem).family === "string"))
    .map((item) => ({ item, family: String(item.family), subsets: asStrings(item.subsets), availableWeights: asNumbers(asStrings(item.variants)), axes: Array.isArray(item.axes) ? item.axes : [] }))
    .filter(({ family, subsets }) => (!normalizedQuery || family.toLowerCase().includes(normalizedQuery)) && (!languageCoverage.length || languageCoverage.every((language) => subsets.includes(language))))
    .slice(0, 20)
    .map(({ item, family, subsets, availableWeights, axes }) => TypographyCandidateSchema.parse({ family, category: typeof item.category === "string" ? item.category : "unknown", visualPersonality: personality(item), readabilityNotes: "Metadata identifies family and available variants; final readability remains a Design decision tested in context.", languageCoverage: subsets.length ? subsets : ["latin"], availableWeights: availableWeights.length ? availableWeights : [400], variableFont: axes.length > 0, performanceNotes: `Use next/font/google build-time self-hosting with only the approved weights and subsets${item.version ? ` (catalog version ${String(item.version)}).` : "."}`, sourceChecksum }));
  if (!candidates.length) throw new Error("GOOGLE_FONTS_CANDIDATES_NOT_FOUND");
  return candidates;
}

export class GoogleFontsAdapter {
  private readonly cache = new Map<string, GoogleFontResearch>();
  constructor(private readonly options: { apiKey?: string; transport?: DesignHttpTransport; timeoutMs?: number } = {}) {}

  async searchFonts(input: { idempotencyKey: string; query?: string; languageCoverage?: string[]; sort?: "alpha" | "date" | "popularity" | "style" | "trending"; signal?: AbortSignal }): Promise<GoogleFontResearch> {
    const cacheKey = `${input.idempotencyKey}:${input.query ?? ""}:${(input.languageCoverage ?? []).join(",")}:${input.sort ?? "alpha"}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const transport = this.options.transport ?? defaultTransport;
    if (!this.options.apiKey && !this.options.transport) throw new Error("GOOGLE_FONTS_API_KEY_REQUIRED");
    const url = new URL(GOOGLE_FONTS_METADATA_URL);
    url.searchParams.set("sort", input.sort ?? "alpha");
    if (this.options.apiKey) url.searchParams.set("key", this.options.apiKey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    input.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await transport(url.toString(), { method: "GET", signal: controller.signal, headers: { accept: "application/json" } });
      if (response.status < 200 || response.status >= 300) throw new Error(`GOOGLE_FONTS_HTTP_${response.status}`);
      if (Buffer.byteLength(response.body, "utf8") > MAX_RESPONSE_BYTES) throw new Error("GOOGLE_FONTS_RESPONSE_TOO_LARGE");
      const sourceChecksum = sha(response.body);
      const result = GoogleFontResearchSchema.parse({ source: "GOOGLE_FONTS", query: input.query ?? "", sourceReference: GOOGLE_FONTS_METADATA_URL, sourceChecksum, retrievedAt: new Date().toISOString(), liveEvidence: true, writeAuthority: "NONE", candidates: parseCandidates(response.body, input.query ?? "", input.languageCoverage ?? [], sourceChecksum) });
      this.cache.set(cacheKey, result);
      return result;
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
    }
  }
}
