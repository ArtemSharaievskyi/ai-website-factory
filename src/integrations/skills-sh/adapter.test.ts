import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SkillRegistry } from "@/skills/registry/registry";
import { DEFAULT_SKILLS_SH_SOURCE, SKILLS_SH_ORIGIN } from "./contracts";
import { SkillsShError } from "./errors";
import { SkillsShSourceAdapter, validateSkillsShUrl } from "./adapter";

const detail = {
  id: "vercel-labs/skills/review",
  source: "vercel-labs/skills",
  slug: "review",
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
          url: "https://skills.sh/vercel-labs/skills/review",
        },
      ],
      query: "review",
      count: 1,
    });
    const adapter = new SkillsShSourceAdapter({ transport: fixture.transport });
    const result = await adapter.searchSkills("review", { limit: 200 });
    expect(result[0].sourceId).toBe("skills-sh");
    expect(result[0].canonicalSourceRef).toContain("skills.sh/");
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
    const fixture = transportFor({ data: [] }, [503, 503, 200]);
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
