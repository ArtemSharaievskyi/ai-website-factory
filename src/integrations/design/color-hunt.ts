import { createHash } from "node:crypto";
import { ColorHuntPaletteSchema, ColorHuntResearchSchema, type ColorHuntResearch } from "@/domain/design/resources";
import type { DesignHttpTransport } from "./contracts";

export const COLOR_HUNT_ORIGIN = "https://colorhunt.co" as const;
const MAX_RESPONSE_BYTES = 400_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const ALLOWED_CHARACTERISTICS = new Set(["warm", "cool", "nature", "earth", "coffee", "pastel", "vintage", "retro", "dark", "light", "spring", "summer", "autumn", "winter", "neon", "wedding", "food", "space", "monochromatic", "gradient"]);
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const slug = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
const hexes = (value: string) => [...value.matchAll(/#[0-9a-f]{3,6}\b/gi)].map((match) => match[0]!.toLowerCase()).filter((value, index, values) => values.indexOf(value) === index);

const defaultTransport: DesignHttpTransport = async (url, input) => {
  const response = await fetch(url, { method: input.method, redirect: "manual", signal: input.signal, headers: input.headers });
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) throw new Error("COLOR_HUNT_RESPONSE_TOO_LARGE");
  return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body };
};

function extractPalettes(body: string, characteristics: readonly string[], sourceChecksum: string, sourceReference: string) {
  const found: Array<{ id: string; colors: string[] }> = [];
  try {
    const parsed = JSON.parse(body) as unknown;
    const values: unknown[] = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray((parsed as { palettes?: unknown }).palettes) ? (parsed as { palettes: unknown[] }).palettes : [];
    for (const value of values) {
      if (!value || typeof value !== "object") continue;
      const item = value as { id?: unknown; palette?: unknown; colors?: unknown; code?: unknown };
      const colors = Array.isArray(item.colors) ? item.colors.filter((color): color is string => typeof color === "string").flatMap(hexes) : typeof item.palette === "string" ? hexes(item.palette) : typeof item.code === "string" ? hexes(item.code) : [];
      if (colors.length >= 3) found.push({ id: String(item.id ?? `palette-${found.length + 1}`), colors: colors.slice(0, 8) });
    }
  } catch {
    // Color Hunt pages are HTML; JSON is accepted for deterministic API-shaped fixtures.
  }
  for (const match of body.matchAll(/(?:data-(?:colors|palette)|palette)=["']([^"']+)["']/gi)) {
    const colors = hexes(match[1] ?? "");
    if (colors.length >= 3) found.push({ id: `palette-${found.length + 1}`, colors: colors.slice(0, 8) });
  }
  const allColors = hexes(body);
  if (!found.length && allColors.length >= 3) for (let index = 0; index + 3 < allColors.length && found.length < 6; index += 4) found.push({ id: `palette-${index / 4 + 1}`, colors: allColors.slice(index, index + 4) });
  const deduped = new Map<string, { id: string; colors: string[] }>();
  for (const item of found) deduped.set(item.colors.join("-"), item);
  const palettes = [...deduped.values()].slice(0, 20).map((item) => ColorHuntPaletteSchema.parse({ paletteId: slug(item.id) || "palette", colors: item.colors, characteristics, sourceReference, sourceChecksum, retrievedAt: new Date().toISOString(), liveEvidence: true, writeAuthority: "NONE", inspirationOnly: true }));
  if (!palettes.length) throw new Error("COLOR_HUNT_PALETTES_NOT_FOUND");
  return palettes;
}

export class ColorHuntAdapter {
  private readonly cache = new Map<string, ColorHuntResearch>();
  constructor(private readonly options: { transport?: DesignHttpTransport; timeoutMs?: number } = {}) {}

  async searchPalettes(input: { idempotencyKey: string; characteristics?: string[]; signal?: AbortSignal }): Promise<ColorHuntResearch> {
    const characteristics = [...new Set((input.characteristics ?? []).map(slug).filter((value) => ALLOWED_CHARACTERISTICS.has(value)))].slice(0, 8);
    const cacheKey = `${input.idempotencyKey}:${characteristics.join(",")}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const path = characteristics.length ? `/palettes/${characteristics[0]}` : "/";
    const target = `${COLOR_HUNT_ORIGIN}${path}`;
    const transport = this.options.transport ?? defaultTransport;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    input.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await transport(target, { method: "GET", signal: controller.signal, headers: { accept: "text/html, application/json" } });
      if (response.status < 200 || response.status >= 300) throw new Error(`COLOR_HUNT_HTTP_${response.status}`);
      const sourceChecksum = sha(response.body);
      const result = ColorHuntResearchSchema.parse({ source: "COLOR_HUNT", query: characteristics, sourceReference: target, sourceChecksum, retrievedAt: new Date().toISOString(), liveEvidence: true, writeAuthority: "NONE", candidates: extractPalettes(response.body, characteristics, sourceChecksum, target), inspirationOnly: true });
      this.cache.set(cacheKey, result);
      return result;
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
    }
  }
}
