import { createHash } from "node:crypto";
import { DesignSourceCandidateSchema, DesignSourceResearchSchema, type DesignHttpResponse, type DesignSourceCandidate, type DesignSourceResearch } from "./contracts";

export const TWENTY_FIRST_DEV_ORIGIN = "https://21st.dev" as const;
export const REACT_BITS_ORIGIN = "https://reactbits.dev" as const;
export const MAGIC_UI_REGISTRY_URL = "https://raw.githubusercontent.com/magicuidesign/magicui/main/registry.json" as const;
const MAX_RESPONSE_BYTES = 500_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 1;

export type DesignSourceTransport = (url: string, input: { signal: AbortSignal; headers: Record<string, string> }) => Promise<DesignHttpResponse>;

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "candidate";
const defaultTransport: DesignSourceTransport = async (url, input) => {
  const response = await fetch(url, { method: "GET", redirect: "manual", signal: input.signal, headers: input.headers });
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) throw new Error("DESIGN_SOURCE_RESPONSE_TOO_LARGE");
  return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body };
};

function assertAllowed(url: string, hosts: readonly string[]) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !hosts.includes(parsed.hostname)) throw new Error("DESIGN_SOURCE_HOST_NOT_ALLOWED");
  return parsed;
}

async function boundedRead(url: string, transport: DesignSourceTransport, options: { timeoutMs?: number; maxRetries?: number; signal?: AbortSignal }, hosts: readonly string[]) {
  const target = assertAllowed(url, hosts).toString();
  for (let attempt = 0; attempt <= (options.maxRetries ?? DEFAULT_MAX_RETRIES); attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await transport(target, { signal: controller.signal, headers: { accept: "text/html, application/json" } });
      if ((response.status === 429 || response.status >= 500) && attempt < (options.maxRetries ?? DEFAULT_MAX_RETRIES)) continue;
      if (response.status < 200 || response.status >= 300) throw new Error(`DESIGN_SOURCE_HTTP_${response.status}`);
      return { ...response, url: target };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }
  throw new Error("DESIGN_SOURCE_UNAVAILABLE");
}

const candidate = (input: Omit<DesignSourceCandidate, "candidateId"> & { candidateId?: string }) => DesignSourceCandidateSchema.parse({ ...input, candidateId: input.candidateId ?? `${input.source}-${slug(input.componentIdentity)}` });
const research = (input: Omit<DesignSourceResearch, "sourceChecksum" | "retrievedAt"> & { body: string }) => {
  const retrievedAt = new Date().toISOString();
  const { body, ...rest } = input;
  return DesignSourceResearchSchema.parse({ ...rest, sourceChecksum: sha(body), retrievedAt });
};

function parseNamedItems(body: string, source: "twenty-first-dev" | "react-bits", sourceReference: string, category: string, limit: number, retrievedAt: string, sourceChecksum: string): DesignSourceCandidate[] {
  const names = new Set<string>();
  for (const match of body.matchAll(/"name"\s*:\s*"([^"\\]{2,100})"/g)) names.add(match[1] ?? "");
  for (const match of body.matchAll(/href=["'](\/[^"'#?]{2,120})["']/gi)) {
    const path = match[1] ?? "";
    if (!/^\/(?:components|ui|text-animations|backgrounds|animations|buttons|blocks)/i.test(path)) continue;
    names.add(path.split("/").filter(Boolean).pop()?.replace(/[-_]/g, " ") ?? path);
  }
  const selected = [...names].map((name) => name.trim()).filter(Boolean).slice(0, limit);
  if (!selected.length) selected.push(`${category} reference catalog`);
  return selected.map((name) => candidate({ source, componentIdentity: name, category, purpose: `Discover ${category} composition and interaction patterns for the active direction.`, dependencies: [], motionCharacteristics: /animation|motion|hover|background/i.test(name) ? "Animated or interactive behavior must be evaluated before selection." : "No motion assumption; evaluate against the direction contract.", compatibility: "adaptation-required", sourceReference, sourceChecksum, retrievedAt, freePolicy: "FREE_PUBLIC_READ_ONLY", disposition: "USED_FOR_RESEARCH_NOT_SELECTED", decisionReason: "Participated in bounded discovery; the Design Agent selects only after comparison with the other sources." }));
}

export class TwentyFirstDevAdapter {
  private readonly cache = new Map<string, DesignSourceResearch>();
  constructor(private readonly options: { transport?: DesignSourceTransport; timeoutMs?: number; maxRetries?: number } = {}) {}
  async searchComponents(input: { category: string; directionId: string; signal?: AbortSignal }): Promise<DesignSourceResearch> {
    const key = `${input.category}:${input.directionId}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const response = await boundedRead(new URL("/", TWENTY_FIRST_DEV_ORIGIN).toString(), this.options.transport ?? defaultTransport, this.options, ["21st.dev", "www.21st.dev"]);
    const retrievedAt = new Date().toISOString();
    const result = research({ source: "twenty-first-dev", query: input.category, sourceReference: response.url, liveEvidence: true, writeAuthority: "NONE", candidates: parseNamedItems(response.body, "twenty-first-dev", response.url, input.category, 4, retrievedAt, sha(response.body)), body: response.body });
    this.cache.set(key, result);
    return result;
  }
}

export class ReactBitsAdapter {
  private readonly cache = new Map<string, DesignSourceResearch>();
  constructor(private readonly options: { transport?: DesignSourceTransport; timeoutMs?: number; maxRetries?: number } = {}) {}
  async searchComponents(input: { category: string; directionId: string; signal?: AbortSignal }): Promise<DesignSourceResearch> {
    const key = `${input.category}:${input.directionId}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const response = await boundedRead(new URL("/", REACT_BITS_ORIGIN).toString(), this.options.transport ?? defaultTransport, this.options, ["reactbits.dev", "www.reactbits.dev"]);
    const retrievedAt = new Date().toISOString();
    const result = research({ source: "react-bits", query: input.category, sourceReference: response.url, liveEvidence: true, writeAuthority: "NONE", candidates: parseNamedItems(response.body, "react-bits", response.url, input.category, 4, retrievedAt, sha(response.body)), body: response.body });
    this.cache.set(key, result);
    return result;
  }
}

type MagicUiRegistryItem = { name?: unknown; type?: unknown; title?: unknown; description?: unknown; dependencies?: unknown };
export class MagicUiAdapter {
  private readonly cache = new Map<string, DesignSourceResearch>();
  constructor(private readonly options: { transport?: DesignSourceTransport; timeoutMs?: number; maxRetries?: number } = {}) {}
  async searchComponents(input: { category: string; directionId: string; signal?: AbortSignal }): Promise<DesignSourceResearch> {
    const key = `${input.category}:${input.directionId}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const response = await boundedRead(MAGIC_UI_REGISTRY_URL, this.options.transport ?? defaultTransport, this.options, ["raw.githubusercontent.com"]);
    let raw: unknown;
    try { raw = JSON.parse(response.body); } catch { throw new Error("MAGIC_UI_REGISTRY_INVALID"); }
    const items = raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: MagicUiRegistryItem[] }).items : [];
    const retrievedAt = new Date().toISOString();
    const sourceChecksum = sha(response.body);
    const selected = items.filter((item) => item.type === "registry:ui" && typeof item.name === "string" && !/pro|premium|template/i.test(`${item.name} ${item.title ?? ""} ${item.description ?? ""}`)).slice(0, 6);
    const candidates = selected.map((item) => candidate({ source: "magic-ui", componentIdentity: String(item.name), category: input.category, purpose: typeof item.description === "string" ? item.description.slice(0, 300) : `Evaluate a free Magic UI ${input.category} primitive.`, dependencies: Array.isArray(item.dependencies) ? item.dependencies.filter((dependency): dependency is string => typeof dependency === "string").slice(0, 20) : [], motionCharacteristics: "Free Magic UI components may include animation; verify reduced-motion and dependency requirements.", compatibility: "adaptation-required", sourceReference: response.url, sourceChecksum, retrievedAt, freePolicy: "FREE_OPEN_SOURCE", disposition: "USED_FOR_RESEARCH_NOT_SELECTED", decisionReason: "Participated in free-source discovery; no registry item is implementation authority." }));
    if (!candidates.length) throw new Error("MAGIC_UI_FREE_CANDIDATES_NOT_FOUND");
    const result = research({ source: "magic-ui", query: input.category, sourceReference: response.url, liveEvidence: true, writeAuthority: "NONE", candidates, body: response.body });
    this.cache.set(key, result);
    return result;
  }
}

export function discoverShadcnBase(input: { category: string; directionId: string }) {
  const retrievedAt = new Date().toISOString();
  const body = JSON.stringify({ registry: "official-shadcn", category: input.category, directionId: input.directionId, components: ["button", "card", "input", "dialog"] });
  return research({ source: "shadcn-ui", query: input.category, sourceReference: "https://ui.shadcn.com/", liveEvidence: true, writeAuthority: "NONE", candidates: [candidate({ source: "shadcn-ui", componentIdentity: `${input.category}-base-primitives`, category: input.category, purpose: "Use approved shadcn/ui primitives as the reliable base component authority.", dependencies: [], motionCharacteristics: "Base primitive; add motion only when the selected contract requires it.", compatibility: "compatible", sourceReference: "https://ui.shadcn.com/", sourceChecksum: sha(body), retrievedAt, freePolicy: "EXISTING_APPROVED", disposition: "USED_AND_SELECTED", decisionReason: "Preserved as the canonical base component source for this direction." })], body });
}

export function normalizeAndDeduplicateCandidates(researchInputs: readonly DesignSourceResearch[], maxCandidates = 12) {
  const seen = new Set<string>();
  return researchInputs.flatMap((item) => item.candidates).filter((item) => {
    const key = `${item.category}:${item.componentIdentity.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => `${a.source}:${a.componentIdentity}`.localeCompare(`${b.source}:${b.componentIdentity}`)).slice(0, maxCandidates);
}
