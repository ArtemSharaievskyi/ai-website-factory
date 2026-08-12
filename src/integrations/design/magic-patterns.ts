import { createHash } from "node:crypto";
import { z } from "zod";
import { MagicPatternsArtifactSchema, type DesignHttpResponse, type DesignHttpTransport, type MagicPatternsArtifact } from "./contracts";

export const MAGIC_PATTERNS_API_ORIGIN = "https://api.magicpatterns.com" as const;
const MAX_RESPONSE_BYTES = 200_000;
const timeout = (signal: AbortSignal | undefined, ms: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); } };
};
const checksum = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const statusFor = (status: number) => status === 401 || status === 403 ? "AUTH_INVALID" as const : status === 429 ? "RATE_LIMITED" as const : status >= 500 ? "UNAVAILABLE" as const : status >= 400 ? "API_ERROR" as const : "AVAILABLE" as const;
const parseJson = (body: string) => { try { return JSON.parse(body) as unknown; } catch { throw new Error("MAGIC_PATTERNS_RESPONSE_INVALID"); } };
const responseEnvelope = z.object({ id: z.string().min(1), editorUrl: z.string().url().optional(), previewUrl: z.string().url().optional(), sourceFiles: z.array(z.object({ name: z.string().min(1) }).passthrough()).optional() }).passthrough();

export type MagicPatternsCredentialProvider = () => string | undefined;
export const readMagicPatternsCredential: MagicPatternsCredentialProvider = () => process.env.MAGIC_PATTERNS_API_KEY?.trim() || undefined;
const defaultTransport: DesignHttpTransport = async (url, input) => {
  const response = await fetch(url, { method: input.method, redirect: "manual", signal: input.signal, headers: input.headers, ...(input.body ? { body: input.body } : {}) });
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) throw new Error("MAGIC_PATTERNS_RESPONSE_TOO_LARGE");
  return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body };
};

export class MagicPatternsAdapter {
  private readonly cache = new Map<string, MagicPatternsArtifact>();
  constructor(private readonly options: { credentialProvider?: MagicPatternsCredentialProvider; transport?: DesignHttpTransport; timeoutMs?: number; maxRetries?: number } = {}) {}
  private credential() { return this.options.credentialProvider?.() ?? readMagicPatternsCredential(); }
  private async request(pathname: "/api/v3/health" | "/api/v3/designs", method: "GET" | "POST", body: unknown, signal?: AbortSignal): Promise<DesignHttpResponse> {
    const credential = this.credential();
    if (!credential) throw new Error("MAGIC_PATTERNS_CREDENTIAL_REQUIRED");
    const target = new URL(pathname, MAGIC_PATTERNS_API_ORIGIN);
    const transport = this.options.transport ?? defaultTransport;
    const maxRetries = this.options.maxRetries ?? 2;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const scoped = timeout(signal, this.options.timeoutMs ?? 20_000);
      try {
        const response = await transport(target.toString(), { method, signal: scoped.signal, headers: { accept: "application/json", "content-type": "application/json", "x-mp-api-key": credential }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        if (response.status === 429 || response.status >= 500) { if (attempt < maxRetries) continue; }
        return response;
      } finally { scoped.dispose(); }
    }
    throw new Error("MAGIC_PATTERNS_UNAVAILABLE");
  }
  async health(signal?: AbortSignal) {
    try { const response = await this.request("/api/v3/health", "GET", undefined, signal); return { status: statusFor(response.status), httpStatus: response.status }; }
    catch (error) { return { status: error instanceof Error && error.message === "MAGIC_PATTERNS_CREDENTIAL_REQUIRED" ? "AUTH_REQUIRED" as const : "UNAVAILABLE" as const }; }
  }
  async createMinimalArtifact(input: { prompt: string; idempotencyKey: string; signal?: AbortSignal }): Promise<MagicPatternsArtifact> {
    const cached = this.cache.get(input.idempotencyKey); if (cached) return cached;
    const response = await this.request("/api/v3/designs", "POST", { prompt: input.prompt, mode: "fast" }, input.signal);
    if (response.status < 200 || response.status >= 300) throw new Error(`MAGIC_PATTERNS_${statusFor(response.status)}`);
    const raw = responseEnvelope.parse(parseJson(response.body));
    const result = MagicPatternsArtifactSchema.parse({ artifactId: raw.id, ...(raw.editorUrl ? { editorUrl: raw.editorUrl } : {}), ...(raw.previewUrl ? { previewUrl: raw.previewUrl } : {}), sourceFileNames: raw.sourceFiles?.map((file) => file.name).slice(0, 100) ?? [], responseChecksum: checksum({ id: raw.id, sourceFiles: raw.sourceFiles?.map((file) => file.name) ?? [] }), createdAt: new Date().toISOString() });
    this.cache.set(input.idempotencyKey, result);
    return result;
  }
}
