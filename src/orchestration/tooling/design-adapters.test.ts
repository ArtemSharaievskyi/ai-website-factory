import { describe, expect, it } from "vitest";
import { executeBoundToolOperation } from "./adapters";

describe("registered Phase 7F tool adapters", () => {
  it("dispatches Magic Patterns through its typed executor identity", async () => {
    const result = await executeBoundToolOperation({ toolId: "magic-patterns-design", operationId: "create-direction-artifact", executor: { createDirectionArtifact: async () => JSON.stringify({ artifactId: "artifact", sourceFileNames: [], responseChecksum: "a".repeat(64), createdAt: "2026-01-01T00:00:00.000Z" }) }, input: { prompt: "bounded", idempotencyKey: "adapter-1" } });
    expect(result).toMatchObject({ toolId: "magic-patterns-design", operationId: "create-direction-artifact", status: "passed", contentTrust: "UNTRUSTED_EXTERNAL" });
  });

  it("dispatches Fontpair and host quality detection without exposing raw executors", async () => {
    const pair = await executeBoundToolOperation({ toolId: "fontpair-read", operationId: "resolve-curated-pair", executor: { resolveCuratedPair: async () => JSON.stringify({ displayFamily: "Fraunces", bodyFamily: "Sora", sourceUrl: "https://fontpair.co/", sourceChecksum: "b".repeat(64), normalizedChecksum: "c".repeat(64) }) }, input: { idempotencyKey: "adapter-2" } });
    const quality = await executeBoundToolOperation({ toolId: "design-quality-validation", operationId: "detect-antipatterns", executor: { detectAntipatterns: async () => JSON.stringify({ toolId: "impeccable", status: "PASS", findings: [], sourceChecksum: "d".repeat(64), detectorVersion: "impeccable-host-detector-v1" }) }, input: { files: [{ path: "src/page.tsx", content: "safe" }] } });
    expect(pair.status).toBe("passed");
    expect(quality.status).toBe("passed");
  });
});
