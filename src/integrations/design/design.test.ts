import { describe, expect, it } from "vitest";
import { FontpairAdapter, FONTPAIR_ORIGIN } from "./fontpair";
import { MagicUiAdapter, ReactBitsAdapter, TwentyFirstDevAdapter, MAGIC_UI_REGISTRY_URL, normalizeAndDeduplicateCandidates } from "./component-sources";
import { detectImpeccableAntiPatterns } from "./impeccable";

const response = (status: number, body: string, contentType = "text/html") => ({ status, headers: { "content-type": contentType }, body });
const fontpairBody = "<html><head><link href=\"https://fonts.googleapis.com/css2?family=Young+Serif&family=DM+Sans\" /></head><body><h2>Headline Fraunces</h2><p>Body Sora</p><script>Headline Fake Body Fake</script></body></html>";

describe("Phase 7F bounded design integrations", () => {
  it("normalizes multiple real Fontpair candidates through its dedicated allowlisted root", async () => {
    const adapter = new FontpairAdapter({ transport: async (url, input) => { expect(url).toBe(`${FONTPAIR_ORIGIN}/`); expect(input.method).toBe("GET"); return response(200, fontpairBody); } });
    const pairs = await adapter.listPairings({ idempotencyKey: "fontpair-1" });
    expect(pairs.length).toBeGreaterThanOrEqual(2);
    expect(pairs[0]).toMatchObject({ displayFamily: "Fraunces", bodyFamily: "Sora", sourceUrl: `${FONTPAIR_ORIGIN}/` });
    await expect(adapter.getFontPairing({ idempotencyKey: "fontpair-1", pairingId: pairs[0]!.pairingId })).resolves.toMatchObject({ pairingId: pairs[0]!.pairingId });
  });

  it("fails closed on redirects and malformed/empty Fontpair source content", async () => {
    const redirecting = new FontpairAdapter({ transport: async () => response(302, "") });
    await expect(redirecting.listPairings({ idempotencyKey: "fontpair-redirect" })).rejects.toThrow("FONTPAIR_HTTP_302");
    const empty = new FontpairAdapter({ transport: async () => response(200, "<html><body>No curated pairs.</body></html>") });
    await expect(empty.listPairings({ idempotencyKey: "fontpair-empty" })).rejects.toThrow("FONTPAIR_PAIR_NOT_FOUND");
  });

  it("uses exact bounded first-party sources for 21st.dev and React Bits discovery", async () => {
    const calls: string[] = [];
    const transport = async (url: string) => { calls.push(url); return response(200, '{"name":"Hero","name":"Dashboard"}'); };
    const twentyFirst = await new TwentyFirstDevAdapter({ transport }).searchComponents({ category: "hero", directionId: "00000000-0000-4000-8000-000000000001" });
    const reactBits = await new ReactBitsAdapter({ transport }).searchComponents({ category: "motion", directionId: "00000000-0000-4000-8000-000000000002" });
    expect(calls).toEqual(["https://21st.dev/", "https://reactbits.dev/"]);
    expect(twentyFirst.writeAuthority).toBe("NONE");
    expect(reactBits.writeAuthority).toBe("NONE");
    expect(twentyFirst.candidates.length).toBeGreaterThan(0);
  });

  it("reads only the free public Magic UI registry and excludes paid names", async () => {
    const adapter = new MagicUiAdapter({ transport: async (url) => { expect(url).toBe(MAGIC_UI_REGISTRY_URL); return response(200, JSON.stringify({ items: [{ name: "magic-card", type: "registry:ui", description: "Free card", dependencies: ["motion"] }, { name: "pro-template", type: "registry:ui", description: "Premium template" }] }), "application/json"); } });
    const result = await adapter.searchComponents({ category: "card", directionId: "00000000-0000-4000-8000-000000000003" });
    expect(result.candidates.map((item) => item.componentIdentity)).toEqual(["magic-card"]);
    expect(result.candidates[0]).toMatchObject({ freePolicy: "FREE_OPEN_SOURCE", disposition: "USED_FOR_RESEARCH_NOT_SELECTED" });
  });

  it("deduplicates equivalent bounded candidates without granting write authority", () => {
    const source = { source: "react-bits" as const, query: "hero", sourceReference: "https://reactbits.dev/", sourceChecksum: "a".repeat(64), retrievedAt: "2026-01-01T00:00:00.000Z", liveEvidence: true, writeAuthority: "NONE" as const, candidates: [{ candidateId: "hero", source: "react-bits" as const, componentIdentity: "Hero", category: "hero", purpose: "Hero", dependencies: [], motionCharacteristics: "none", compatibility: "adaptation-required" as const, sourceReference: "https://reactbits.dev/", sourceChecksum: "a".repeat(64), retrievedAt: "2026-01-01T00:00:00.000Z", freePolicy: "FREE_PUBLIC_READ_ONLY" as const, disposition: "USED_FOR_RESEARCH_NOT_SELECTED" as const, decisionReason: "Compared." }] };
    expect(normalizeAndDeduplicateCandidates([source, { ...source, source: "twenty-first-dev", candidates: [{ ...source.candidates[0]!, source: "twenty-first-dev", candidateId: "hero-2" }] }])).toHaveLength(1);
  });

  it("runs the host-controlled Impeccable detector without executing external skill code", () => {
    const safe = detectImpeccableAntiPatterns([{ path: "src/page.tsx", content: "<h1 className='text-4xl'>Clear</h1>" }]);
    expect(safe).toMatchObject({ toolId: "impeccable", status: "PASS", detectorVersion: "impeccable-host-detector-v1" });
    const unsafe = detectImpeccableAntiPatterns([{ path: "src/page.tsx", content: "background: linear-gradient(purple, violet); animation: margin 2s infinite;" }]);
    expect(unsafe.status).toBe("FAIL");
    expect(unsafe.findings.map((finding) => finding.ruleId)).toEqual(expect.arrayContaining(["generic-purple-gradient", "layout-property-animation", "decorative-perpetual-motion"]));
  });

  it("does not classify an explicit prohibition of perpetual motion as an implementation violation", () => {
    const result = detectImpeccableAntiPatterns([{
      path: "direction/synthetic.design-contract",
      content: "Short opacity transitions are allowed, but the page should not drift, parallax, or animate continuously.",
    }]);
    expect(result.status).toBe("PASS");
    expect(result.findings).toEqual([]);
  });
});
