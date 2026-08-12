import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SkillRegistry } from "@/skills/registry/registry";
import { SkillError } from "@/skills/registry/errors";
import { SkillsShError } from "./errors";
import {
  DEFAULT_SKILLS_SH_SOURCE,
  SKILLS_SH_ORIGIN,
  SKILLS_SH_SOURCE_ID,
  SkillsShDetailResponseSchema,
  SkillsShAuditResponseSchema,
  SkillsShAuditResultSchema,
  SkillsShDescriptorSchema,
  SkillsShListResponseSchema,
  SkillsShSearchResponseSchema,
  SkillsShCandidateSchema,
  type SkillsShListResponse,
  type SkillsShSkillSummary,
  SkillsShSourceSchema,
  type SkillsShCandidate,
  type SkillsShDescriptor,
  type SkillsShHttpResponse,
  type SkillsShHttpTransport,
  type SkillsShSource,
} from "./contracts";

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("The operation was cancelled.", "AbortError"));
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
const pathSafe = (value: string) => {
  const normalized = value.replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    normalized.split("/").includes("..") ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").some((part) => !part || part === ".")
  )
    throw new SkillsShError(
      "SKILLS_SH_CONTENT_INVALID",
      "The external skill contains an unsafe file path.",
    );
  return normalized;
};
const sourceIdSafe = (value: string) => {
  if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+){1,3}$/.test(value))
    throw new SkillsShError(
      "SKILLS_SH_RESPONSE_INVALID",
      "The external skill identifier is invalid.",
    );
  return value;
};
const receivedType = (value: unknown) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
};
const schemaIssueDetails = (endpoint: string, error: unknown) => {
  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues))
    return {
      endpoint,
      path: "<root>",
      expected: "valid JSON object",
      received: "unknown",
    };
  const issue = (issues[0] ?? {}) as {
    code?: string;
    path?: PropertyKey[];
    expected?: unknown;
    input?: unknown;
    keys?: string[];
    message?: string;
  };
  const path = issue.path?.length
    ? issue.path.map((part) => String(part)).join(".")
    : "<root>";
  const expected =
    issue.code === "unrecognized_keys"
      ? "known fields only"
      : typeof issue.expected === "string"
        ? issue.expected
        : issue.code || "valid value";
  const received =
    issue.input !== undefined
      ? receivedType(issue.input)
      : issue.message?.match(/received ([A-Za-z]+)/i)?.[1]?.toLowerCase() ||
        (issue.code === "unrecognized_keys" ? "object" : "unknown");
  return {
    endpoint,
    path,
    expected,
    received,
  };
};
const contractError = (endpoint: string, error: unknown) =>
  new SkillsShError(
    "SKILLS_SH_API_CONTRACT_MISMATCH",
    "The skills.sh " + endpoint + " response failed strict schema validation.",
    schemaIssueDetails(endpoint, error),
  );
const normalizeSkillSummary = (item: SkillsShSkillSummary) => ({
  ...item,
  sourceId: SKILLS_SH_SOURCE_ID,
  canonicalSourceRef: item.url,
});
export function validateSkillsShUrl(
  raw: string,
  code:
    | "SKILLS_SH_UNSAFE_REDIRECT"
    | "SKILLS_SH_RESPONSE_INVALID" = "SKILLS_SH_RESPONSE_INVALID",
) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SkillsShError(code, "The skills.sh URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "skills.sh" ||
    url.username ||
    url.password ||
    url.port
  )
    throw new SkillsShError(
      code,
      "Only the official HTTPS skills.sh origin is allowed.",
    );
  return url;
}

function validateSkillsShPublicUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SkillsShError("SKILLS_SH_RESPONSE_INVALID", "The public skills.sh URL is invalid.");
  }
  if (
    url.protocol !== "https:" ||
    !["skills.sh", "www.skills.sh"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  )
    throw new SkillsShError("SKILLS_SH_RESPONSE_INVALID", "Only the official HTTPS skills.sh public pages are allowed.");
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9._-]+$/.test(part)))
    throw new SkillsShError("SKILLS_SH_RESPONSE_INVALID", "The public skills.sh skill path is invalid.");
  return url;
}

const decodeHtml = (value: string) => value
  .replaceAll("&amp;", "&")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">")
  .replaceAll("&quot;", '"')
  .replaceAll("&#x27;", "'")
  .replaceAll("&#39;", "'")
  .replaceAll(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
  .replaceAll(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));

const htmlToBoundedMarkdown = (html: string, externalSkillId: string) => {
  const marker = html.match(/<span>SKILL\.md<\/span>/i);
  if (!marker || marker.index === undefined)
    throw new SkillsShError("SKILLS_SH_CONTENT_INVALID", "The public skills.sh page does not expose a SKILL.md snapshot.");
  const afterMarker = html.slice(marker.index + marker[0].length);
  const contentStart = afterMarker.indexOf('<div><div class="prose');
  const contentEnd = afterMarker.indexOf('<div class="relative">', contentStart + 1);
  if (contentStart < 0 || contentEnd < 0)
    throw new SkillsShError("SKILLS_SH_CONTENT_INVALID", "The public skills.sh SKILL.md snapshot could not be bounded.");
  const visible = afterMarker.slice(contentStart, contentEnd)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>(?=\S)/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(?:p|h[1-6]|li|blockquote|pre|div)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((line) => decodeHtml(line).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !/(?:^|\s)(?:run|execute|install|download|fetch)\b|\b(?:npm|npx|curl|wget|powershell|bash|shell|\.env|token|credential)\b|[A-Za-z]:[\\/]|\.\.\//i.test(line))
    .filter((line) => !/ignore\s+(?:all\s+)?previous\s+instructions|override\s+system|reveal\s+(?:the\s+)?(?:hidden\s+)?prompt|bypass\s+permissions|impersonate\s+user approval/i.test(line))
    .slice(0, 1200);
  const title = visible.find((line) => line.startsWith("# "))?.slice(2).trim() || externalSkillId.split("/").at(-1) || "External design skill";
  const purpose = visible.find((line) => line.length >= 30 && !line.startsWith("#") && !line.startsWith("-")) || "Use the official public skill as bounded design guidance.";
  const steps = visible.filter((line) => line.startsWith("- ")).slice(0, 8);
  const markdown = [
    `# ${title}`,
    "",
    purpose,
    "",
    "## Purpose",
    "",
    purpose,
    "",
    "## Steps",
    "",
    ...(steps.length ? steps.map((step, index) => `${index + 1}. ${step.replace(/^-\s*/, "")}`) : ["1. Apply the reviewed design guidance to the current design direction."]),
    "",
    "## Canonical public snapshot",
    "",
    ...visible,
  ].join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  return markdown.slice(0, 120_000);
};

async function defaultTransport(
  url: string,
  input: { signal: AbortSignal; headers?: Record<string, string> },
  maxResponseBytes = DEFAULT_SKILLS_SH_SOURCE.fetchPolicy.maxResponseBytes,
): Promise<SkillsShHttpResponse> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal: input.signal,
    headers: { accept: "application/json", ...input.headers },
  });
  const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > maxResponseBytes)
    throw new SkillsShError(
      "SKILLS_SH_RESPONSE_TOO_LARGE",
      "The skills.sh response is too large.",
    );
  if (response.status >= 300 && response.status < 400)
    return {
      status: response.status,
      headers: { location: response.headers.get("location") ?? undefined },
      body: "",
    };
  const reader = response.body?.getReader();
  if (!reader)
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text(),
    };
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxResponseBytes)
        throw new SkillsShError(
          "SKILLS_SH_RESPONSE_TOO_LARGE",
          "The skills.sh response is too large.",
        );
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: Buffer.concat(chunks).toString("utf8"),
  };
}

export type SkillsShCredentialProvider = () => string | undefined;
export const readSkillsShCredential: SkillsShCredentialProvider = () => {
  const token = process.env.VERCEL_OIDC_TOKEN?.trim();
  return token || undefined;
};

export class SkillsShSourceAdapter {
  readonly source: SkillsShSource;
  constructor(
    options: {
      source?: SkillsShSource;
      transport?: SkillsShHttpTransport;
      credentialProvider?: SkillsShCredentialProvider;
      requireAuthentication?: boolean;
    } = {},
  ) {
    this.source = SkillsShSourceSchema.parse(options.source ?? DEFAULT_SKILLS_SH_SOURCE);
    this.credentialProvider = options.credentialProvider ?? readSkillsShCredential;
    this.requireAuthentication = options.requireAuthentication ?? !options.transport;
    this.transport = options.transport ?? ((url, input) => defaultTransport(url, input, this.source.fetchPolicy.maxResponseBytes));
  }
  private readonly transport: SkillsShHttpTransport;
  private readonly credentialProvider: SkillsShCredentialProvider;
  private readonly requireAuthentication: boolean;
  private urlFor(pathname: string) {
    const url = validateSkillsShUrl(`${SKILLS_SH_ORIGIN}${pathname}`);
    return url.toString();
  }
  private async request(
    url: string,
    signal?: AbortSignal,
    options: { allowedStatuses?: number[] } = {},
  ) {
    const target = validateSkillsShUrl(url);
    const external = signal ?? new AbortController().signal;
    if (external.aborted)
      throw new SkillsShError(
        "SKILLS_SH_SOURCE_UNAVAILABLE",
        "The skills.sh request was cancelled.",
      );
    const credential = this.requireAuthentication
      ? this.credentialProvider()?.trim()
      : undefined;
    if (this.requireAuthentication && !credential)
      throw new SkillsShError(
        "SKILLS_SH_AUTH_REQUIRED",
        "Official skills.sh API authentication is required for this administrative request.",
      );
    for (
      let attempt = 0;
      attempt <= this.source.fetchPolicy.maxRetries;
      attempt += 1
    ) {
      const timeout = new AbortController();
      let timedOut = false;
      const timer = setTimeout(
        () => {
          timedOut = true;
          timeout.abort();
        },
        this.source.fetchPolicy.timeoutMs,
      );
      const onAbort = () => timeout.abort();
      external.addEventListener("abort", onAbort, { once: true });
      try {
        const result = await this.transport(target.toString(), {
          signal: timeout.signal,
          headers: credential
            ? { Authorization: `Bearer ${credential}` }
            : undefined,
        });
        const contentType = Object.entries(result.headers).find(
          ([key]) => key.toLowerCase() === "content-type",
        )?.[1];
        if (contentType && !/application\/json(?:\s*;|$)/i.test(contentType))
          throw new SkillsShError(
            "SKILLS_SH_RESPONSE_INVALID",
            "The skills.sh response content type is not JSON.",
          );
        if (result.status >= 300 && result.status < 400)
          throw new SkillsShError(
            "SKILLS_SH_UNSAFE_REDIRECT",
            "Redirects are not permitted for skills.sh retrieval.",
          );
        if (options.allowedStatuses?.includes(result.status)) return result;
        if (result.status === 401)
          throw new SkillsShError(
            credential ? "SKILLS_SH_AUTH_INVALID" : "SKILLS_SH_AUTH_REQUIRED",
            credential
              ? "The supplied skills.sh API credential was rejected."
              : "Official skills.sh API authentication is required for this administrative request.",
          );
        if (result.status === 403)
          throw new SkillsShError(
            "SKILLS_SH_ACCESS_FORBIDDEN",
            "The skills.sh API denied this administrative request.",
          );
        if (result.status === 400 || result.status === 422)
          throw new SkillsShError(
            "SKILLS_SH_API_CONTRACT_MISMATCH",
            "The skills.sh API rejected the request parameters.",
          );
        if (result.status === 404)
          throw new SkillsShError(
            "SKILLS_SH_API_CONTRACT_MISMATCH",
            "The requested skills.sh API resource was not found.",
          );
        if (result.status === 429 || result.status >= 500) {
          if (attempt < this.source.fetchPolicy.maxRetries) {
            const retryAfter = this.header(result.headers, "retry-after");
            const retryMs = retryAfter
              ? Math.min(10_000, Math.max(25, Number(retryAfter) * 1000 || 25))
              : 25 * (attempt + 1);
            await sleep(retryMs, external);
            continue;
          }
          throw new SkillsShError(
            result.status === 429
              ? "SKILLS_SH_RATE_LIMITED"
              : "SKILLS_SH_SOURCE_UNAVAILABLE",
            result.status === 429
              ? "The skills.sh API rate limit was reached."
              : "The skills.sh source is temporarily unavailable.",
          );
        }
        if (result.status < 200 || result.status >= 300)
          throw new SkillsShError(
            "SKILLS_SH_API_CONTRACT_MISMATCH",
            "The skills.sh source could not be read.",
          );
        if (
          Buffer.byteLength(result.body, "utf8") >
          this.source.fetchPolicy.maxResponseBytes
        )
          throw new SkillsShError(
            "SKILLS_SH_RESPONSE_TOO_LARGE",
            "The skills.sh response is too large.",
          );
        return result;
      } catch (error) {
        if (error instanceof SkillsShError) throw error;
        if (external.aborted)
          throw new SkillsShError(
            "SKILLS_SH_SOURCE_UNAVAILABLE",
            "The skills.sh request was cancelled.",
          );
        if (timedOut) {
          if (attempt >= this.source.fetchPolicy.maxRetries)
            throw new SkillsShError(
              "SKILLS_SH_REQUEST_TIMEOUT",
              "The skills.sh request timed out.",
            );
          await sleep(25 * (attempt + 1), external);
          continue;
        }
        if (attempt >= this.source.fetchPolicy.maxRetries)
          throw new SkillsShError(
            "SKILLS_SH_NETWORK_FAILED",
            "The skills.sh source could not be reached.",
          );
        await sleep(25 * (attempt + 1), external);
      } finally {
        clearTimeout(timer);
        external.removeEventListener("abort", onAbort);
      }
    }
    throw new SkillsShError(
      "SKILLS_SH_SOURCE_UNAVAILABLE",
      "The skills.sh source could not be reached.",
    );
  }
  private async requestPublicPage(externalSkillId: string, signal?: AbortSignal) {
    const target = validateSkillsShPublicUrl(`https://www.skills.sh/${externalSkillId.split("/").map((part) => encodeURIComponent(part.toLowerCase())).join("/")}`);
    const external = signal ?? new AbortController().signal;
    if (external.aborted)
      throw new SkillsShError("SKILLS_SH_SOURCE_UNAVAILABLE", "The skills.sh request was cancelled.");
    for (let attempt = 0; attempt <= this.source.fetchPolicy.maxRetries; attempt += 1) {
      const timeout = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; timeout.abort(); }, this.source.fetchPolicy.timeoutMs);
      const onAbort = () => timeout.abort();
      external.addEventListener("abort", onAbort, { once: true });
      try {
        const result = await this.transport(target.toString(), { signal: timeout.signal, headers: { accept: "text/html" } });
        const contentType = Object.entries(result.headers).find(([key]) => key.toLowerCase() === "content-type")?.[1];
        if (contentType && !/text\/html(?:\s*;|$)/i.test(contentType))
          throw new SkillsShError("SKILLS_SH_RESPONSE_INVALID", "The public skills.sh response content type is not HTML.");
        if (result.status >= 300 && result.status < 400)
          throw new SkillsShError("SKILLS_SH_UNSAFE_REDIRECT", "Redirects are not permitted for public skills.sh retrieval.");
        if (result.status < 200 || result.status >= 300)
          throw new SkillsShError("SKILLS_SH_SOURCE_UNAVAILABLE", "The public skills.sh page could not be read.");
        if (Buffer.byteLength(result.body, "utf8") > this.source.fetchPolicy.maxResponseBytes)
          throw new SkillsShError("SKILLS_SH_RESPONSE_TOO_LARGE", "The public skills.sh response is too large.");
        return result;
      } catch (error) {
        if (error instanceof SkillsShError) throw error;
        if (external.aborted) throw new SkillsShError("SKILLS_SH_SOURCE_UNAVAILABLE", "The skills.sh request was cancelled.");
        if (timedOut && attempt >= this.source.fetchPolicy.maxRetries)
          throw new SkillsShError("SKILLS_SH_REQUEST_TIMEOUT", "The public skills.sh request timed out.");
        if (attempt >= this.source.fetchPolicy.maxRetries)
          throw new SkillsShError("SKILLS_SH_NETWORK_FAILED", "The public skills.sh page could not be reached.");
        await sleep(25 * (attempt + 1), external);
      } finally {
        clearTimeout(timer);
        external.removeEventListener("abort", onAbort);
      }
    }
    throw new SkillsShError("SKILLS_SH_SOURCE_UNAVAILABLE", "The public skills.sh page could not be reached.");
  }
  private header(headers: Record<string, string | undefined>, name: string) {
    return Object.entries(headers).find(
      ([key]) => key.toLowerCase() === name.toLowerCase(),
    )?.[1];
  }
  async listSkills(
    options: {
      view?: "all-time" | "trending" | "hot";
      page?: number;
      perPage?: number;
      signal?: AbortSignal;
    } = {},
  ) {
    const page = options.page ?? 0;
    const perPage = options.perPage ?? 10;
    if (!Number.isInteger(page) || page < 0)
      throw new SkillsShError(
        "SKILLS_SH_RESPONSE_INVALID",
        "The skills.sh page must be a non-negative integer.",
      );
    if (!Number.isInteger(perPage) || perPage < 1 || perPage > 500)
      throw new SkillsShError(
        "SKILLS_SH_RESPONSE_INVALID",
        "The skills.sh per_page value must be between 1 and 500.",
      );
    const params = new URLSearchParams({
      view: options.view ?? "all-time",
      page: String(page),
      per_page: String(perPage),
    });
    const response = await this.request(
      this.urlFor("/api/v1/skills?" + params.toString()),
      options.signal,
    );
    let parsed: SkillsShListResponse;
    try {
      parsed = SkillsShListResponseSchema.parse(JSON.parse(response.body));
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new SkillsShError(
          "SKILLS_SH_RESPONSE_INVALID",
          "The skills.sh list response is not valid JSON.",
          { endpoint: "list" },
        );
      throw contractError("list", error);
    }
    return { ...parsed, data: parsed.data.map(normalizeSkillSummary) };
  }
  async searchSkills(
    query: string,
    options: { limit?: number; owner?: string; signal?: AbortSignal } = {},
  ) {
    const q = query.trim();
    if (q.length < 2 || q.length > 200)
      throw new SkillsShError(
        "SKILLS_SH_RESPONSE_INVALID",
        "Skill search queries must contain 2-200 characters.",
      );
    const limit = Math.max(1, Math.min(200, options.limit ?? 10));
    const params = new URLSearchParams({ q, limit: String(limit) });
    if (options.owner) {
      if (!/^[A-Za-z0-9_.-]+$/.test(options.owner))
        throw new SkillsShError(
          "SKILLS_SH_RESPONSE_INVALID",
          "The skills.sh owner filter is invalid.",
        );
      params.set("owner", options.owner);
    }
    const response = await this.request(
      this.urlFor(`/api/v1/skills/search?${params.toString()}`),
      options.signal,
    );
    try {
      return SkillsShSearchResponseSchema.parse(JSON.parse(response.body)).data.map(normalizeSkillSummary);
    } catch (error) {
      if (error instanceof SkillsShError) throw error;
      if (error instanceof SyntaxError)
        throw new SkillsShError(
          "SKILLS_SH_RESPONSE_INVALID",
          "The skills.sh search response is not valid JSON.",
          { endpoint: "search" },
        );
      throw contractError("search", error);
    }
  }
  async getSkillDescriptor(
    externalSkillId: string,
    signal?: AbortSignal,
  ): Promise<SkillsShDescriptor> {
    const id = sourceIdSafe(externalSkillId);
    const response = await this.request(
      this.urlFor(
        `/api/v1/skills/${id.split("/").map(encodeURIComponent).join("/")}`,
      ),
      signal,
    );
    try {
      const detail = SkillsShDetailResponseSchema.parse(
        JSON.parse(response.body),
      );
      return SkillsShDescriptorSchema.parse({
        externalSkillId: detail.id,
        sourceId: SKILLS_SH_SOURCE_ID,
        name: detail.slug,
        slug:
          detail.slug
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 60) || "skill",
        summary: undefined,
        source: detail.source,
        sourceVersion: detail.hash ?? undefined,
        canonicalSourceRef: `${SKILLS_SH_ORIGIN}/${detail.id}`,
        discoveredAt: new Date().toISOString(),
        metadata: { fileCount: detail.files?.length ?? 0 },
      });
    } catch (error) {
      if (error instanceof SkillsShError) throw error;
      if (error instanceof SyntaxError)
        throw new SkillsShError(
          "SKILLS_SH_RESPONSE_INVALID",
          "The skills.sh skill descriptor is not valid JSON.",
          { endpoint: "detail" },
        );
      throw contractError("detail", error);
    }
  }
  async getSkillAudit(
    externalSkillId: string,
    signal?: AbortSignal,
  ) {
    const id = sourceIdSafe(externalSkillId);
    let response: SkillsShHttpResponse;
    try {
      response = await this.request(
        this.urlFor(
          `/api/v1/skills/audit/${id.split("/").map(encodeURIComponent).join("/")}`,
        ),
        signal,
        { allowedStatuses: [404] },
      );
    } catch (error) {
      return SkillsShAuditResultSchema.parse({
        available: false,
        reason:
          error instanceof SkillsShError
            ? error.message
            : "The external audit source could not be reached.",
      });
    }
    if (response.status === 404)
      return SkillsShAuditResultSchema.parse({
        available: false,
        reason: "No external audit metadata is available.",
      });
    try {
      return SkillsShAuditResultSchema.parse({
        available: true,
        response: SkillsShAuditResponseSchema.parse(JSON.parse(response.body)),
      });
    } catch {
      return SkillsShAuditResultSchema.parse({
        available: false,
        reason: "The external audit response was invalid.",
      });
    }
  }
  async fetchSkillCandidate(
    externalSkillId: string,
    signal?: AbortSignal,
  ): Promise<SkillsShCandidate> {
    const id = sourceIdSafe(externalSkillId);
    const response = await this.request(
      this.urlFor(
        `/api/v1/skills/${id.split("/").map(encodeURIComponent).join("/")}`,
      ),
      signal,
    );
    let detail: ReturnType<typeof SkillsShDetailResponseSchema.parse>;
    try {
      detail = SkillsShDetailResponseSchema.parse(JSON.parse(response.body));
    } catch (error) {
      if (error instanceof SyntaxError)
        throw new SkillsShError(
          "SKILLS_SH_RESPONSE_INVALID",
          "The skills.sh skill content response is not valid JSON.",
          { endpoint: "detail" },
        );
      throw contractError("detail", error);
    }
    if (!detail.files)
      throw new SkillsShError(
        "SKILLS_SH_CONTENT_INVALID",
        "The skills.sh candidate has no available file snapshot.",
      );
    const files = detail.files.map((file) => ({
      path: pathSafe(file.path),
      contents: file.contents,
    }));
    if (
      files.length > this.source.fetchPolicy.maxFiles ||
      !files.some((file) => file.path === "SKILL.md")
    )
      throw new SkillsShError(
        "SKILLS_SH_CONTENT_INVALID",
        "The skills.sh candidate must contain a bounded SKILL.md file set.",
      );
    if (
      files.some(
        (file) =>
          Buffer.byteLength(file.contents, "utf8") >
          this.source.fetchPolicy.maxFileBytes,
      )
    )
      throw new SkillsShError(
        "SKILLS_SH_RESPONSE_TOO_LARGE",
        "A skills.sh file is too large.",
      );
    const retrievedAt = new Date().toISOString();
    const retrievedContentChecksum = sha256(
      JSON.stringify({ id: detail.id, files }),
    );
    const descriptor = await this.getSkillDescriptor(id, signal);
    const normalizedContentChecksum = sha256(
      JSON.stringify({
        descriptor: {
          externalSkillId: descriptor.externalSkillId,
          slug: descriptor.slug,
          source: descriptor.source,
          sourceVersion: descriptor.sourceVersion,
        },
        files,
      }),
    );
    return {
      descriptor: { ...descriptor, contentChecksum: normalizedContentChecksum },
      files: files.map((file) => ({
        path: file.path,
        contents: file.contents,
      })),
      retrievedAt,
      retrievedContentChecksum,
      normalizedContentChecksum,
    };
  }
  async fetchPublicSkillCandidate(
    externalSkillId: string,
    signal?: AbortSignal,
  ): Promise<SkillsShCandidate> {
    const id = sourceIdSafe(externalSkillId);
    const response = await this.requestPublicPage(id, signal);
    const markdown = htmlToBoundedMarkdown(response.body, id);
    const files = [{ path: "SKILL.md", contents: markdown }];
    const retrievedAt = new Date().toISOString();
    const sourceVersion = `public-page-${sha256(response.body).slice(0, 12)}`;
    const sourceUrl = `https://www.skills.sh/${id.toLowerCase()}`;
    const retrievedContentChecksum = sha256(JSON.stringify({ id, sourceUrl, body: response.body }));
    const normalizedContentChecksum = sha256(JSON.stringify({ id, sourceVersion, files }));
    const slug = id.split("/").at(-1)?.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "skill";
    const descriptor = SkillsShDescriptorSchema.parse({
      externalSkillId: id,
      sourceId: SKILLS_SH_SOURCE_ID,
      name: slug,
      slug,
      summary: "Bounded public SKILL.md snapshot from skills.sh.",
      source: id.split("/").slice(0, 2).join("/"),
      sourceVersion,
      canonicalSourceRef: sourceUrl,
      contentChecksum: normalizedContentChecksum,
      discoveredAt: retrievedAt,
      metadata: { retrievalMode: "public-read-only-page", contentType: "text/html", writeAuthority: "NONE" },
    });
    return SkillsShCandidateSchema.parse({ descriptor, files, retrievedAt, retrievedContentChecksum, normalizedContentChecksum });
  }
  async stageSkillCandidate(
    candidate: SkillsShCandidate,
    registry: SkillRegistry,
    options: {
      idempotencyKey?: string;
      reviewer?: string;
      license?: string;
      skillId?: string;
    } = {},
  ) {
    let parsed: SkillsShCandidate;
    try {
      parsed = SkillsShCandidateSchema.parse(candidate);
    } catch (error) {
      throw new SkillsShError(
        "SKILLS_SH_CONTENT_INVALID",
        "The skills.sh candidate failed strict validation.",
        undefined,
        error,
      );
    }
    const temp = await mkdtemp(path.join(os.tmpdir(), "skills-sh-import-"));
    try {
      for (const file of parsed.files) {
        const target = path.join(temp, file.path);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, file.contents, { flag: "wx", mode: 0o600 });
      }
      return await registry.stageLocalImport(temp, {
        sourceType: "skills-sh",
        displayName: parsed.descriptor.name,
        skillId: options.skillId,
        version: parsed.descriptor.sourceVersion ?? "0.1.0",
        license: options.license,
        sourceRepository: `https://github.com/${parsed.descriptor.source}`,
        sourceCommit: parsed.retrievedContentChecksum,
        reviewer: options.reviewer,
        idempotencyKey: options.idempotencyKey,
        externalSkillId: parsed.descriptor.externalSkillId,
        canonicalSourceRef: parsed.descriptor.canonicalSourceRef,
        retrievedContentChecksum: parsed.retrievedContentChecksum,
        normalizedContentChecksum: parsed.normalizedContentChecksum,
      });
    } catch (error) {
      if (error instanceof SkillError) throw error;
      throw new SkillsShError(
        "SKILL_IMPORT_REJECTED",
        "The skills.sh candidate could not be staged.",
        undefined,
        error,
      );
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  }
}
