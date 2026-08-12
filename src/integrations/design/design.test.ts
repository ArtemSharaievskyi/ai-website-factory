import { describe, expect, it } from "vitest";
import { FontpairAdapter } from "./fontpair";
import { detectImpeccableAntiPatterns } from "./impeccable";
import { MAGIC_PATTERNS_API_ORIGIN, MagicPatternsAdapter } from "./magic-patterns";
import { FONTPAIR_ORIGIN } from "./fontpair";

const response = (status: number, body: string) => ({ status, headers: {}, body });

describe("Phase 7F bounded design integrations", () => {
  it("fails closed without printing or accepting a Magic Patterns credential", async () => {
    const adapter = new MagicPatternsAdapter({ credentialProvider: () => undefined });
    await expect(adapter.createMinimalArtifact({ prompt: "bounded", idempotencyKey: "missing-key" })).rejects.toThrow("MAGIC_PATTERNS_CREDENTIAL_REQUIRED");
    await expect(adapter.health()).resolves.toMatchObject({ status: "AUTH_REQUIRED" });
  });

  it("uses only the current Magic Patterns API origin and bounded create operation", async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];
    const adapter = new MagicPatternsAdapter({ credentialProvider: () => "test-secret", maxRetries: 0, transport: async (url, input) => { calls.push({ url, method: input.method, headers: input.headers, body: input.body }); return response(201, JSON.stringify({ id: "artifact-1", editorUrl: "https://magicpatterns.com/editor/artifact-1", sourceFiles: [{ name: "reference.json" }] })); } });
    const artifact = await adapter.createMinimalArtifact({ prompt: "Create exactly one bounded direction reference.", idempotencyKey: "magic-1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: `${MAGIC_PATTERNS_API_ORIGIN}/api/v3/designs`, method: "POST" });
    expect(calls[0]?.headers["x-mp-api-key"]).toBe("test-secret");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ prompt: "Create exactly one bounded direction reference.", mode: "fast" });
    expect(artifact).toMatchObject({ artifactId: "artifact-1", sourceFileNames: ["reference.json"] });
  });

  it("normalizes a live Fontpair page through the dedicated allowlisted root", async () => {
    const adapter = new FontpairAdapter({ transport: async (url, input) => { expect(url).toBe(`${FONTPAIR_ORIGIN}/`); expect(input.method).toBe("GET"); return response(200, "<html><body><h2>Headline Fraunces</h2><p>Body Sora</p><script>Headline Fake Body Fake</script></body></html>"); } });
    await expect(adapter.recommendPair({ idempotencyKey: "fontpair-1" })).resolves.toMatchObject({ displayFamily: "Fraunces", bodyFamily: "Sora", sourceUrl: `${FONTPAIR_ORIGIN}/` });
  });

  it("rejects redirects and malformed/empty Fontpair source content", async () => {
    const redirecting = new FontpairAdapter({ transport: async () => response(302, "") });
    await expect(redirecting.recommendPair({ idempotencyKey: "fontpair-redirect" })).rejects.toThrow("FONTPAIR_HTTP_302");
    const empty = new FontpairAdapter({ transport: async () => response(200, "<html><body>No curated pairs.</body></html>") });
    await expect(empty.recommendPair({ idempotencyKey: "fontpair-empty" })).rejects.toThrow("FONTPAIR_PAIR_NOT_FOUND");
  });

  it("runs the host-controlled Impeccable detector without executing external skill code", () => {
    const safe = detectImpeccableAntiPatterns([{ path: "src/page.tsx", content: "<h1 className='text-4xl'>Clear</h1>" }]);
    expect(safe).toMatchObject({ toolId: "impeccable", status: "PASS", detectorVersion: "impeccable-host-detector-v1" });
    const unsafe = detectImpeccableAntiPatterns([{ path: "src/page.tsx", content: "background: linear-gradient(purple, violet); animation: margin 2s infinite;" }]);
    expect(unsafe.status).toBe("FAIL");
    expect(unsafe.findings.map((finding) => finding.ruleId)).toEqual(expect.arrayContaining(["generic-purple-gradient", "layout-property-animation", "decorative-perpetual-motion"]));
  });
});
