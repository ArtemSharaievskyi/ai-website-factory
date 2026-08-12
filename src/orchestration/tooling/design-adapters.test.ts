import { describe, expect, it } from "vitest";
import { executeBoundToolOperation } from "./adapters";

const research = (source: "twenty-first-dev" | "react-bits" | "magic-ui" | "shadcn-ui") => JSON.stringify({ source, query: "hero", sourceReference: source === "twenty-first-dev" ? "https://21st.dev/" : source === "react-bits" ? "https://reactbits.dev/" : source === "magic-ui" ? "https://raw.githubusercontent.com/magicuidesign/magicui/main/registry.json" : "https://ui.shadcn.com/", sourceChecksum: "a".repeat(64), retrievedAt: "2026-01-01T00:00:00.000Z", liveEvidence: true, writeAuthority: "NONE", candidates: [{ candidateId: `${source}-hero`, source, componentIdentity: "Hero", category: "hero", purpose: "Bounded research candidate.", dependencies: [], motionCharacteristics: "Evaluated for restraint.", compatibility: "adaptation-required", sourceReference: source === "twenty-first-dev" ? "https://21st.dev/" : source === "react-bits" ? "https://reactbits.dev/" : source === "magic-ui" ? "https://raw.githubusercontent.com/magicuidesign/magicui/main/registry.json" : "https://ui.shadcn.com/", sourceChecksum: "a".repeat(64), retrievedAt: "2026-01-01T00:00:00.000Z", freePolicy: source === "shadcn-ui" ? "EXISTING_APPROVED" : source === "magic-ui" ? "FREE_OPEN_SOURCE" : "FREE_PUBLIC_READ_ONLY", disposition: "USED_FOR_RESEARCH_NOT_SELECTED", decisionReason: "Compared." }] });

describe("registered Phase 7F tool adapters", () => {
  it("dispatches each source through the typed read-only discovery executor", async () => {
    const executor = {
      search21stComponents: async () => research("twenty-first-dev"),
      searchReactBitsComponents: async () => research("react-bits"),
      searchMagicUiComponents: async () => research("magic-ui"),
      discoverShadcnBase: async () => research("shadcn-ui"),
    };
    const results = await Promise.all([
      executeBoundToolOperation({ toolId: "design-source-discovery", operationId: "search-21st-components", executor, input: { category: "hero", directionId: "00000000-0000-4000-8000-000000000001" } }),
      executeBoundToolOperation({ toolId: "design-source-discovery", operationId: "search-react-bits-components", executor, input: { category: "hero", directionId: "00000000-0000-4000-8000-000000000001" } }),
      executeBoundToolOperation({ toolId: "design-source-discovery", operationId: "search-magic-ui-components", executor, input: { category: "hero", directionId: "00000000-0000-4000-8000-000000000001" } }),
      executeBoundToolOperation({ toolId: "design-source-discovery", operationId: "discover-shadcn-base", executor, input: { category: "hero", directionId: "00000000-0000-4000-8000-000000000001" } }),
    ]);
    expect(results.every((result) => result.status === "passed" && result.contentTrust === "UNTRUSTED_EXTERNAL")).toBe(true);
  });

  it("dispatches Fontpair and host quality detection without exposing raw executors", async () => {
    const pair = await executeBoundToolOperation({ toolId: "fontpair-read", operationId: "resolve-curated-pair", executor: { resolveCuratedPair: async () => JSON.stringify({ pairingId: "pair-1", displayFamily: "Fraunces", bodyFamily: "Sora", sourceTypes: ["google-fonts"], styleUseCase: "editorial", sourceUrl: "https://fontpair.co/", sourceChecksum: "b".repeat(64), normalizedChecksum: "c".repeat(64) }) }, input: { idempotencyKey: "adapter-2" } });
    const quality = await executeBoundToolOperation({ toolId: "design-quality-validation", operationId: "detect-antipatterns", executor: { detectAntipatterns: async () => JSON.stringify({ toolId: "impeccable", status: "PASS", findings: [], sourceChecksum: "d".repeat(64), detectorVersion: "impeccable-host-detector-v1" }) }, input: { files: [{ path: "src/page.tsx", content: "safe" }] } });
    expect(pair.status).toBe("passed");
    expect(quality.status).toBe("passed");
  });
});
