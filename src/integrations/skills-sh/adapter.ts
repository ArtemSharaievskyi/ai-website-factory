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
  SkillsShDescriptorSchema,
  SkillsShSearchResponseSchema,
  SkillsShCandidateSchema,
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

async function defaultTransport(
  url: string,
  input: { signal: AbortSignal },
  maxResponseBytes = DEFAULT_SKILLS_SH_SOURCE.fetchPolicy.maxResponseBytes,
): Promise<SkillsShHttpResponse> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal: input.signal,
    headers: { accept: "application/json" },
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

export class SkillsShSourceAdapter {
  readonly source: SkillsShSource;
  constructor(
    options: {
      source?: SkillsShSource;
      transport?: SkillsShHttpTransport;
    } = {},
  ) {
    this.source = SkillsShSourceSchema.parse(options.source ?? DEFAULT_SKILLS_SH_SOURCE);
    this.transport = options.transport ?? ((url, input) => defaultTransport(url, input, this.source.fetchPolicy.maxResponseBytes));
  }
  private readonly transport: SkillsShHttpTransport;
  private urlFor(pathname: string) {
    const url = validateSkillsShUrl(`${SKILLS_SH_ORIGIN}${pathname}`);
    return url.toString();
  }
  private async request(url: string, signal?: AbortSignal) {
    const target = validateSkillsShUrl(url);
    const external = signal ?? new AbortController().signal;
    if (external.aborted)
      throw new SkillsShError(
        "SKILLS_SH_SOURCE_UNAVAILABLE",
        "The skills.sh request was cancelled.",
      );
    for (
      let attempt = 0;
      attempt <= this.source.fetchPolicy.maxRetries;
      attempt += 1
    ) {
      const timeout = new AbortController();
      const timer = setTimeout(
        () => timeout.abort(),
        this.source.fetchPolicy.timeoutMs,
      );
      const onAbort = () => timeout.abort();
      external.addEventListener("abort", onAbort, { once: true });
      try {
        const result = await this.transport(target.toString(), {
          signal: timeout.signal,
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
        if (result.status === 429 || result.status >= 500) {
          if (attempt < this.source.fetchPolicy.maxRetries) {
            await sleep(25 * (attempt + 1), external);
            continue;
          }
          throw new SkillsShError(
            "SKILLS_SH_SOURCE_UNAVAILABLE",
            "The skills.sh source is temporarily unavailable.",
          );
        }
        if (result.status < 200 || result.status >= 300)
          throw new SkillsShError(
            "SKILLS_SH_SOURCE_UNAVAILABLE",
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
        if (attempt >= this.source.fetchPolicy.maxRetries)
          throw new SkillsShError(
            "SKILLS_SH_SOURCE_UNAVAILABLE",
            "The skills.sh source could not be reached.",
            undefined,
            error,
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
    const limit = Math.max(1, Math.min(50, options.limit ?? 10));
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
      return SkillsShSearchResponseSchema.parse(
        JSON.parse(response.body),
      ).data.map((item) => ({
        ...item,
        sourceId: SKILLS_SH_SOURCE_ID,
        canonicalSourceRef: item.url ?? `${SKILLS_SH_ORIGIN}/${item.id}`,
      }));
    } catch (error) {
      if (error instanceof SkillsShError) throw error;
      throw new SkillsShError(
        "SKILLS_SH_RESPONSE_INVALID",
        "The skills.sh search response is invalid.",
        undefined,
        error,
      );
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
        sourceVersion: detail.hash,
        canonicalSourceRef: `${SKILLS_SH_ORIGIN}/${detail.id}`,
        discoveredAt: new Date().toISOString(),
        metadata: { fileCount: detail.files.length },
      });
    } catch (error) {
      if (error instanceof SkillsShError) throw error;
      throw new SkillsShError(
        "SKILLS_SH_RESPONSE_INVALID",
        "The skills.sh skill descriptor is invalid.",
        undefined,
        error,
      );
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
      throw new SkillsShError(
        "SKILLS_SH_RESPONSE_INVALID",
        "The skills.sh skill content response is invalid.",
        undefined,
        error,
      );
    }
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
  async stageSkillCandidate(
    candidate: SkillsShCandidate,
    registry: SkillRegistry,
    options: {
      idempotencyKey?: string;
      reviewer?: string;
      license?: string;
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
        version: parsed.descriptor.sourceVersion ?? "0.1.0",
        license: options.license,
        sourceRepository: parsed.descriptor.canonicalSourceRef,
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
