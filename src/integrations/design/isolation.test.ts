import { describe, expect, it } from "vitest";
import { assertWorkbenchStyleIsolation } from "./isolation";

describe("generated-site design boundary", () => {
  it("accepts project-owned design inputs", () => {
    expect(assertWorkbenchStyleIsolation({ siteLanguage: "de", brand: "Haus & Garten", direction: "editorial" })).toBe(true);
  });

  it("rejects Workbench visual tokens", () => {
    expect(() => assertWorkbenchStyleIsolation({ tokens: ["--workbench-bg", "--workbench-accent"] })).toThrow("DESIGN_INPUT_WORKBENCH_STYLE_LEAK");
  });
});
