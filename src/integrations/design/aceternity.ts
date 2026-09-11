import { createHash } from "node:crypto";
import { AceternityComponentCandidateSchema, AceternityDiscoverySchema, type AceternityComponentCandidate, type AceternityDiscovery } from "@/domain/design/resources";
import type { DesignHttpTransport } from "./contracts";

export const ACETERNITY_REGISTRY_ORIGIN = "https://ui.aceternity.com" as const;
export const ACETERNITY_REGISTRY_NAMESPACE = "@aceternity" as const;
export const ACETERNITY_LICENSE_URL = "https://ui.aceternity.com/licence" as const;
const MAX_RESPONSE_BYTES = 250_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type RegistryItem = { name?: unknown; type?: unknown; title?: unknown; description?: unknown; dependencies?: unknown; registryDependencies?: unknown; premium?: unknown; pro?: unknown; tier?: unknown };
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 30) : [];
const componentKind = (item: RegistryItem): AceternityComponentCandidate["kind"] => /template/i.test(`${item.name ?? ""} ${item.title ?? ""}`) ? "TEMPLATE" : item.type === "registry:block" ? "BLOCK" : "COMPONENT";
const tier = (item: RegistryItem): "FREE" | "PREMIUM" | "UNKNOWN" => item.premium === true || item.pro === true || item.tier === "premium" ? "PREMIUM" : item.premium === false || item.pro === false || item.tier === "free" ? "FREE" : "UNKNOWN";

const defaultTransport: DesignHttpTransport = async (url, input) => {
  const response = await fetch(url, { method: input.method, redirect: "manual", signal: input.signal, headers: input.headers });
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) throw new Error("ACETERNITY_RESPONSE_TOO_LARGE");
  return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body };
};

function parseItem(body: string, componentName: string, sourceReference: string, retrievedAt: string, sourceChecksum: string) {
  let item: RegistryItem;
  try { item = JSON.parse(body) as RegistryItem; } catch (error) { throw new Error("ACETERNITY_REGISTRY_RESPONSE_INVALID", { cause: error }); }
  const actualName = typeof item.name === "string" && namePattern.test(item.name) ? item.name : componentName;
  const resourceTier = tier(item);
  return AceternityComponentCandidateSchema.parse({
    source: "ACETERNITY_UI",
    registryNamespace: ACETERNITY_REGISTRY_NAMESPACE,
    componentName: actualName,
    kind: componentKind(item),
    description: typeof item.description === "string" && item.description.trim() ? item.description.slice(0, 600) : `Inspect the Aceternity ${actualName} primitive as an adaptation candidate.`,
    sourceReference,
    sourceChecksum,
    retrievedAt,
    liveEvidence: true,
    writeAuthority: "NONE",
    dependencies: strings(item.dependencies),
    registryDependencies: strings(item.registryDependencies),
    motionCharacteristics: "Treat registry motion as untrusted source behavior; normalize timing, easing, and reduced-motion fallback to the selected Design contract.",
    clientJsCost: strings(item.dependencies).some((dependency) => /motion|framer|three|shader/i.test(dependency)) ? "MINIMAL_CLIENT_ISLAND" : "NONE",
    entitlement: {
      source: "Aceternity UI",
      resourceIdentifier: actualName,
      tier: resourceTier,
      entitlementVerified: resourceTier === "FREE",
      usageScope: "Generated client end product only; source redistribution remains separately reviewed.",
      ...(resourceTier === "FREE" ? { verificationEvidence: "The official registry metadata identifies this resource as free." } : {}),
    },
    licenseReference: ACETERNITY_LICENSE_URL,
    disposition: "INSPECTED_NOT_SELECTED",
    decisionReason: "Read-only registry inspection; Design and task authority must approve adaptation and installation separately.",
  });
}

export class AceternityAdapter {
  private readonly cache = new Map<string, AceternityComponentCandidate>();
  constructor(private readonly options: { transport?: DesignHttpTransport; timeoutMs?: number } = {}) {}

  async inspectComponent(input: { componentName: string; directionId: string; signal?: AbortSignal }): Promise<AceternityComponentCandidate> {
    if (!namePattern.test(input.componentName)) throw new Error("ACETERNITY_COMPONENT_NAME_INVALID");
    const cacheKey = `${input.directionId}:${input.componentName}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const target = `${ACETERNITY_REGISTRY_ORIGIN}/registry/${input.componentName}.json`;
    const transport = this.options.transport ?? defaultTransport;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const onAbort = () => controller.abort();
    input.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await transport(target, { method: "GET", signal: controller.signal, headers: { accept: "application/json" } });
      if (response.status < 200 || response.status >= 300) throw new Error(`ACETERNITY_HTTP_${response.status}`);
      if (Buffer.byteLength(response.body, "utf8") > MAX_RESPONSE_BYTES) throw new Error("ACETERNITY_RESPONSE_TOO_LARGE");
      const result = parseItem(response.body, input.componentName, target, new Date().toISOString(), sha(response.body));
      this.cache.set(cacheKey, result);
      return result;
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
    }
  }

  async searchComponents(input: { componentNames: string[]; directionId: string; signal?: AbortSignal }): Promise<AceternityDiscovery> {
    const names = [...new Set(input.componentNames)].slice(0, 6);
    if (!names.length) throw new Error("ACETERNITY_COMPONENT_QUERY_REQUIRED");
    const candidates: AceternityComponentCandidate[] = [];
    for (const componentName of names) candidates.push(await this.inspectComponent({ componentName, directionId: input.directionId, signal: input.signal }));
    const sourceReference = `${ACETERNITY_REGISTRY_ORIGIN}/registry/${names[0]}.json`;
    const sourceChecksum = sha(JSON.stringify(candidates.map((candidate) => candidate.sourceChecksum)));
    return AceternityDiscoverySchema.parse({ source: "ACETERNITY_UI", registryNamespace: ACETERNITY_REGISTRY_NAMESPACE, query: names.join(","), sourceReference, sourceChecksum, retrievedAt: new Date().toISOString(), liveEvidence: true, writeAuthority: "NONE", candidates });
  }
}
