import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SkillRegistry } from "@/skills/registry/registry";
import {
  DEFAULT_SKILLS_SH_SOURCE,
  SKILLS_SH_ORIGIN,
} from "./contracts";
import { SkillsShError } from "./errors";
import { SkillsShSourceAdapter, validateSkillsShUrl } from "./adapter";

const detail = {
  id: "vercel-labs/skills/review",
  source: "vercel-labs/skills",
  slug: "review",
  installs: 42,
  hash: "revision-a",
  files: [
    {
      path: "SKILL.md",
      contents:
        "# Review Skill\nA safe procedure.\n\n## Purpose\n- Review bounded code.\n\n## Steps\n- Read approved files.\n- Report results.\n",
    },
    { path: "references/checklist.md", contents: "Check requirements." },
  ],
};
const response = (
  body: unknown,
  status = 200,
  headers: Record<string, string | undefined> = {
    "content-type": "application/json",
  },
) => ({ status, headers, body: JSON.stringify(body) });
const emptySearchResponse = {
  data: [],
  query: "review",
  count: 0,
  searchType: "fuzzy" as const,
  durationMs: 0,
};
const transportFor = (body: unknown, statuses: number[] = []) => {
  let calls = 0;
  const transport = async (_url: string, input: { signal: AbortSignal }) => {
    calls += 1;
    if (input.signal.aborted) throw new DOMException("cancelled", "AbortError");
    const status = statuses.shift() ?? 200;
    return response(body, status);
  };
  return { transport, calls: () => calls };
};
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("skills.sh source adapter", () => {
  it("accepts only the official HTTPS origin", () => {
    expect(validateSkillsShUrl(SKILLS_SH_ORIGIN).hostname).toBe("skills.sh");
    for (const url of [
      "http://skills.sh",
      "https://evil.example",
      "file:///tmp/skill",
      "https://127.0.0.1",
    ])
      expect(() => validateSkillsShUrl(url)).toThrow(SkillsShError);
  });
  it("searches the bounded official API and normalizes descriptors", async () => {
    const fixture = transportFor({
      data: [
        {
          id: "vercel-labs/skills/review",
          slug: "review",
          name: "Review",
          source: "vercel-labs/skills",
          installs: 42,
          sourceType: "github",
          installUrl: null,
          url: "https://skills.sh/vercel-labs/skills/review",
        },
      ],
      query: "review",
      count: 1,
      searchType: "semantic",
      durationMs: 42,
    });
    const adapter = new SkillsShSourceAdapter({ transport: fixture.transport });
    const result = await adapter.searchSkills("review", { limit: 200 });
    expect(result[0].sourceId).toBe("skills-sh");
    expect(result[0].canonicalSourceRef).toContain("skills.sh/");
    expect(result[0].source).not.toBe(result[0].slug);
    expect(result[0].installs).toBe(42);
  });
  it("parses the official paginated list response with zero-based page semantics", async () => {
    let requestedUrl = "";
    const adapter = new SkillsShSourceAdapter({
      transport: async (url) => {
        requestedUrl = url;
        return response({
          data: [
            {
              id: "vercel-labs/skills/find-skills",
              slug: "find-skills",
              name: "find-skills",
              source: "vercel-labs/skills",
              installs: 2879230,
              sourceType: "github",
              installUrl: "https://github.com/vercel-labs/skills",
              url: "https://www.skills.sh/vercel-labs/skills/find-skills",
            },
          ],
          pagination: { page: 0, perPage: 1, total: 9311, hasMore: true },
        });
      },
    });
    const result = await adapter.listSkills({ page: 0, perPage: 1 });
    expect(new URL(requestedUrl).searchParams.get("page")).toBe("0");
    expect(new URL(requestedUrl).searchParams.get("per_page")).toBe("1");
    expect(result.pagination).toEqual({
      page: 0,
      perPage: 1,
      total: 9311,
      hasMore: true,
    });
    expect(result.data[0]?.id).toBe("vercel-labs/skills/find-skills");
    expect(result.data[0]?.canonicalSourceRef).toBe(
      "https://www.skills.sh/vercel-labs/skills/find-skills",
    );
  });
  it("rejects malformed summary and pagination fields with safe contract diagnostics", async () => {
    const missingSummaryField = new SkillsShSourceAdapter({
      transport: async () =>
        response({
          data: [
            {
              id: "vercel-labs/skills/review",
              slug: "review",
              name: "Review",
              source: "vercel-labs/skills",
              sourceType: "github",
              installUrl: null,
              url: "https://skills.sh/vercel-labs/skills/review",
            },
          ],
          pagination: { page: 0, perPage: 1, total: 1, hasMore: false },
        }),
    });
    await expect(missingSummaryField.listSkills()).rejects.toMatchObject({
      code: "SKILLS_SH_API_CONTRACT_MISMATCH",
    });
    const malformedPagination = new SkillsShSourceAdapter({
      transport: async () =>
        response({
          data: [],
          pagination: { page: "0", perPage: 1, total: 0, hasMore: false },
        }),
    });
    const error = await malformedPagination.listSkills().catch((value) => value);
    expect(error.code).toBe("SKILLS_SH_API_CONTRACT_MISMATCH");
    expect(error.details).toMatchObject({
      endpoint: "list",
      path: "pagination.page",
      received: "string",
    });
    expect(JSON.stringify(error)).not.toContain("Authorization");
  });
  it("accepts legitimate nullable metadata and rejects malformed numeric and URL fields", async () => {
    const nullable = new SkillsShSourceAdapter({
      transport: async () =>
        response({
          data: [
            {
              id: "vercel-labs/skills/review",
              slug: "review",
              name: "Review",
              source: "vercel-labs/skills",
              installs: 0,
              sourceType: "github",
              installUrl: null,
              url: "https://skills.sh/vercel-labs/skills/review",
            },
          ],
          pagination: { page: 0, perPage: 1, total: 0, hasMore: false },
        }),
    });
    await expect(nullable.listSkills()).resolves.toMatchObject({
      data: [{ installUrl: null, installs: 0 }],
    });
    const malformed = new SkillsShSourceAdapter({
      transport: async () =>
        response({
          data: [
            {
              id: "vercel-labs/skills/review",
              slug: "review",
              name: "Review",
              source: "vercel-labs/skills",
              installs: "popular",
              sourceType: "github",
              installUrl: null,
              url: "not-a-url",
            },
          ],
          pagination: { page: 0, perPage: 1, total: 1, hasMore: false },
        }),
    });
    await expect(malformed.listSkills()).rejects.toMatchObject({
      code: "SKILLS_SH_API_CONTRACT_MISMATCH",
    });
  });
  it("fetches a bounded candidate and produces deterministic checksums", async () => {
    const fixture = transportFor(detail);
    const adapter = new SkillsShSourceAdapter({ transport: fixture.transport });
    const first = await adapter.fetchSkillCandidate(detail.id);
    const second = await adapter.fetchSkillCandidate(detail.id);
    expect(first.retrievedContentChecksum).toBe(
      second.retrievedContentChecksum,
    );
    expect(first.normalizedContentChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(first.files.some((file) => file.path === "SKILL.md")).toBe(true);
  });
  it("accepts nullable detail snapshot fields while retaining strict installs validation", async () => {
    const adapter = new SkillsShSourceAdapter({
      transport: transportFor({
        id: detail.id,
        source: detail.source,
        slug: detail.slug,
        installs: 0,
        hash: null,
        files: null,
      }).transport,
    });
    await expect(adapter.getSkillDescriptor(detail.id)).resolves.toMatchObject({
      externalSkillId: detail.id,
      metadata: { fileCount: 0 },
    });
    await expect(adapter.fetchSkillCandidate(detail.id)).rejects.toMatchObject({
      code: "SKILLS_SH_CONTENT_INVALID",
    });
  });
  it("retrieves advisory audit metadata and treats a missing audit as unavailable", async () => {
    const audit = {
      id: detail.id,
      source: detail.source,
      slug: detail.slug,
      audits: [
        {
          provider: "Socket",
          slug: "socket",
          status: "fail",
          summary: "Risk detected",
          auditedAt: new Date().toISOString(),
          riskLevel: "HIGH",
        },
        {
          provider: "Snyk",
          slug: "snyk",
          status: "pass",
          summary: "No issues detected",
          auditedAt: "2026-08-09T12:00:00",
          riskLevel: "SAFE",
        },
        {
          provider: "Runlayer",
          slug: "runlayer",
          status: "warn",
          summary: "No normalized risk level",
          auditedAt: "2026-08-09T12:00:00",
          riskLevel: null,
        },
      ],
    };
    const available = new SkillsShSourceAdapter({ transport: transportFor(audit).transport });
    const result = await available.getSkillAudit(detail.id);
    expect(result.available).toBe(true);
    expect(result.response?.audits[0].status).toBe("fail");
    const missing = new SkillsShSourceAdapter({ transport: async () => response({}, 404) });
    await expect(missing.getSkillAudit(detail.id)).resolves.toMatchObject({
      available: false,
    });
  });
  it("fails before transport when administrative authentication is missing", async () => {
    vi.stubEnv("VERCEL_OIDC_TOKEN", "");
    const fixture = transportFor({ data: [] });
    const adapter = new SkillsShSourceAdapter({
      transport: fixture.transport,
      requireAuthentication: true,
    });
    await expect(adapter.searchSkills("review")).rejects.toMatchObject({
      code: "SKILLS_SH_AUTH_REQUIRED",
    });
    expect(fixture.calls()).toBe(0);
  });
  it("adds a bearer token only inside the transport and never exposes it in an auth error", async () => {
    const token = "test-oidc-token-not-a-real-secret";
    let observedHeaders: Record<string, string> | undefined;
    const adapter = new SkillsShSourceAdapter({
      requireAuthentication: true,
      credentialProvider: () => token,
      transport: async (_url, input) => {
        observedHeaders = input.headers;
        return response({}, 401);
      },
    });
    const failure = await adapter.searchSkills("review").catch((error) => error);
    expect(failure.code).toBe("SKILLS_SH_AUTH_INVALID");
    expect(observedHeaders?.Authorization).toBe(`Bearer ${token}`);
    expect(String(failure)).not.toContain(token);
  });
  it.each([
    [401, "SKILLS_SH_AUTH_REQUIRED"],
    [403, "SKILLS_SH_ACCESS_FORBIDDEN"],
    [404, "SKILLS_SH_API_CONTRACT_MISMATCH"],
    [400, "SKILLS_SH_API_CONTRACT_MISMATCH"],
    [422, "SKILLS_SH_API_CONTRACT_MISMATCH"],
  ] as const)("classifies HTTP %s without retrying", async (status, code) => {
    const fixture = transportFor({}, [status, 200]);
    const adapter = new SkillsShSourceAdapter({
      transport: fixture.transport,
      requireAuthentication: false,
    });
    await expect(adapter.searchSkills("review")).rejects.toMatchObject({ code });
    expect(fixture.calls()).toBe(1);
  });
  it("retries 429 only within the configured bound", async () => {
    const fixture = transportFor(emptySearchResponse, [429, 429, 200]);
    const adapter = new SkillsShSourceAdapter({
      transport: fixture.transport,
      requireAuthentication: false,
    });
    await expect(adapter.searchSkills("review")).resolves.toEqual([]);
    expect(fixture.calls()).toBe(3);
  });
  it("classifies timeout and network failures safely", async () => {
    const timeout = new SkillsShSourceAdapter({
      source: {
        ...DEFAULT_SKILLS_SH_SOURCE,
        fetchPolicy: { ...DEFAULT_SKILLS_SH_SOURCE.fetchPolicy, timeoutMs: 1, maxRetries: 1 },
      },
      requireAuthentication: false,
      transport: async (_url, input) =>
        await new Promise<never>((_resolve, reject) =>
          input.signal.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")), { once: true }),
        ),
    });
    await expect(timeout.searchSkills("review")).rejects.toMatchObject({ code: "SKILLS_SH_REQUEST_TIMEOUT" });
    const network = new SkillsShSourceAdapter({
      requireAuthentication: false,
      transport: async () => { throw new Error("network unavailable"); },
    });
    await expect(network.searchSkills("review")).rejects.toMatchObject({ code: "SKILLS_SH_NETWORK_FAILED" });
  });
  it("keeps malformed JSON and schema mismatch as response errors", async () => {
    const malformed = new SkillsShSourceAdapter({
      requireAuthentication: false,
      transport: async () => ({
        status: 200,
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    });
    await expect(malformed.searchSkills("review")).rejects.toMatchObject({ code: "SKILLS_SH_RESPONSE_INVALID" });
    const mismatch = new SkillsShSourceAdapter({
      requireAuthentication: false,
      transport: async () => response({ data: "not-an-array" }),
    });
    await expect(mismatch.searchSkills("review")).rejects.toMatchObject({ code: "SKILLS_SH_API_CONTRACT_MISMATCH" });
    const contractError = await mismatch.searchSkills("review").catch((error) => error);
    expect(contractError.details).toMatchObject({ endpoint: "search", path: "data" });
  });
  it("rejects malformed identifiers and unsafe content paths", async () => {
    const fixture = transportFor({
      ...detail,
      files: [{ path: "../escape", contents: "bad" }],
    });
    const adapter = new SkillsShSourceAdapter({ transport: fixture.transport });
    await expect(adapter.fetchSkillCandidate("bad id")).rejects.toMatchObject({
      code: "SKILLS_SH_RESPONSE_INVALID",
    });
    await expect(adapter.fetchSkillCandidate(detail.id)).rejects.toMatchObject({
      code: "SKILLS_SH_CONTENT_INVALID",
    });
  });
  it("rejects oversized, non-JSON, and redirected responses", async () => {
    const oversized = new SkillsShSourceAdapter({
      source: {
        ...DEFAULT_SKILLS_SH_SOURCE,
        fetchPolicy: {
          ...DEFAULT_SKILLS_SH_SOURCE.fetchPolicy,
          maxResponseBytes: 5,
        },
      },
      transport: async () => response({ data: ["large"] }),
    });
    await expect(oversized.searchSkills("safe")).rejects.toMatchObject({
      code: "SKILLS_SH_RESPONSE_TOO_LARGE",
    });
    const html = new SkillsShSourceAdapter({
      transport: async () =>
        response("html", 200, { "content-type": "text/html" }),
    });
    await expect(html.searchSkills("safe")).rejects.toMatchObject({
      code: "SKILLS_SH_RESPONSE_INVALID",
    });
    const redirect = new SkillsShSourceAdapter({
      transport: async () =>
        response({}, 302, { location: "https://evil.example" }),
    });
    await expect(redirect.searchSkills("safe")).rejects.toMatchObject({
      code: "SKILLS_SH_UNSAFE_REDIRECT",
    });
  });
  it("retries bounded transient failures and supports cancellation", async () => {
    const fixture = transportFor(emptySearchResponse, [503, 503, 200]);
    const adapter = new SkillsShSourceAdapter({ transport: fixture.transport });
    await expect(adapter.searchSkills("safe")).resolves.toEqual([]);
    expect(fixture.calls()).toBe(3);
    const controller = new AbortController();
    controller.abort();
    await expect(
      adapter.searchSkills("safe", { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "SKILLS_SH_SOURCE_UNAVAILABLE" });
  });
  it("hands candidates to existing staging without approving or executing content", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "skills-sh-registry-"));
    roots.push(root);
    const registry = new SkillRegistry(root);
    const adapter = new SkillsShSourceAdapter({
      transport: transportFor(detail).transport,
    });
    const candidate = await adapter.fetchSkillCandidate(detail.id);
    const staged = await adapter.stageSkillCandidate(candidate, registry, {
      idempotencyKey: "skills-sh-review-a",
    });
    expect(staged.definition.status).toBe("under-review");
    expect(staged.definition.sourceType).toBe("skills-sh");
    expect(staged.approval).toBeUndefined();
    const record = JSON.parse(
      await readFile(
        path.join(root, "registry", `${staged.definition.id}.json`),
        "utf8",
      ),
    );
    expect(record.source.externalSkillId).toBe(detail.id);
    expect(record.source.retrievedContentChecksum).toBe(
      candidate.retrievedContentChecksum,
    );
  });
  it("never invokes a process while importing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "skills-sh-registry-"));
    roots.push(root);
    const registry = new SkillRegistry(root);
    const adapter = new SkillsShSourceAdapter({
      transport: transportFor(detail).transport,
    });
    const candidate = await adapter.fetchSkillCandidate(detail.id);
    const staged = await adapter.stageSkillCandidate(candidate, registry);
    expect(staged.definition.scriptFiles).toEqual([]);
  });
});
