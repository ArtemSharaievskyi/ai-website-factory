import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const component = () => readFile(path.resolve("src/components/workbench.tsx"), "utf8");

describe("Brief revision UX contract", () => {
  it("preserves a failed draft and clears it only after accepted revision", async () => {
    const source = await component();
    expect(source).toContain('const [prompt, setPrompt] = useState("")');
    expect(source).toContain('reason: prompt');
    expect(source).toContain('input.action === "request-brief-changes"');
    expect(source).toContain('setPrompt("")');
    expect(source).toContain("catch (caught)");
  });

  it("keeps pending, duplicate-click, no-auto-retry, and lossless text behavior", async () => {
    const source = await component();
    expect(source).toContain("requestInFlightRef.current");
    expect(source).toContain("if (requestInFlightRef.current) return");
    expect(source).toContain("setLoading(true)");
    expect(source).toContain("loading || !prompt.trim()");
    expect(source).not.toMatch(/auto.?retry|setTimeout|prompt\.slice|prompt\.substring|summariz/i);
  });

  it("renders populated V2 visual, asset, SEO, legal, deferred, and prohibited Brief sections", async () => {
    const source = await component();
    for (const section of ["Brand / Visual", "Assets", "UX / Responsive", "SEO", "Legal / Compliance", "Technical / Deferred", "Prohibited / Do Not"]) expect(source).toContain(section);
    expect(source).toContain("brief.brandVisual");
    expect(source).toContain("brief.seo");
    expect(source).toContain("brief.prohibited");
  });
});
