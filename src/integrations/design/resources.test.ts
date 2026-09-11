import { describe, expect, it } from "vitest";
import { AceternityAdapter } from "./aceternity";
import { ColorHuntAdapter } from "./color-hunt";
import { GoogleFontsAdapter } from "./google-fonts";

const response = (status: number, body: string) => ({ status, headers: { "content-type": "application/json" }, body });

describe("frontend design resource adapters", () => {
  it("normalizes official Google Fonts metadata without a browser font request", async () => {
    const adapter = new GoogleFontsAdapter({ transport: async (url, input) => {
      expect(new URL(url).pathname).toBe("/webfonts/v1/webfonts");
      expect(input.method).toBe("GET");
      expect(url).not.toContain("key=");
      return response(200, JSON.stringify({ items: [{ family: "Fraunces", category: "serif", subsets: ["latin", "latin-ext"], variants: ["400", "700", "700italic"], axes: [] }] }));
    } });
    const result = await adapter.searchFonts({ idempotencyKey: "google-fonts-fixture", query: "Fraunces", languageCoverage: ["latin", "latin-ext"] });
    expect(result).toMatchObject({ source: "GOOGLE_FONTS", writeAuthority: "NONE", liveEvidence: true });
    expect(result.candidates[0]).toMatchObject({ family: "Fraunces", availableWeights: [400, 700], languageCoverage: ["latin", "latin-ext"], variableFont: false });
  });

  it("treats Color Hunt as bounded inspiration and preserves semantic conversion for the host", async () => {
    const adapter = new ColorHuntAdapter({ transport: async (url) => {
      expect(url).toBe("https://colorhunt.co/palettes/earth");
      return response(200, JSON.stringify([{ id: "earth-1", colors: ["#0f172a", "#f8fafc", "#14b8a6", "#042f2e"] }]));
    } });
    const result = await adapter.searchPalettes({ idempotencyKey: "color-hunt-fixture", characteristics: ["Earth"] });
    expect(result).toMatchObject({ source: "COLOR_HUNT", inspirationOnly: true, writeAuthority: "NONE" });
    expect(result.candidates[0]?.colors).toEqual(["#0f172a", "#f8fafc", "#14b8a6", "#042f2e"]);
  });

  it("inspects the namespaced Aceternity registry and preserves license metadata", async () => {
    const calls: string[] = [];
    const adapter = new AceternityAdapter({ transport: async (url) => {
      calls.push(url);
      return response(200, JSON.stringify({ name: "spotlight", type: "registry:ui", description: "A spotlight primitive.", dependencies: ["framer-motion"], registryDependencies: [], premium: false }));
    } });
    const result = await adapter.searchComponents({ componentNames: ["spotlight", "spotlight"], directionId: "00000000-0000-4000-8000-000000000001" });
    expect(calls).toEqual(["https://ui.aceternity.com/registry/spotlight.json"]);
    expect(result).toMatchObject({ source: "ACETERNITY_UI", registryNamespace: "@aceternity", writeAuthority: "NONE" });
    expect(result.candidates[0]).toMatchObject({ componentName: "spotlight", kind: "COMPONENT", entitlement: { tier: "FREE", entitlementVerified: true }, licenseReference: "https://ui.aceternity.com/licence" });
  });
});
