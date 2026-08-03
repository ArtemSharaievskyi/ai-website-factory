import { describe, expect, it } from "vitest";
import { foundationSummary } from "./foundation";

describe("foundation summary", () => {
  it("exposes the product identity and initialized state", () => {
    expect(foundationSummary.name).toContain("professional foundation");
    expect(foundationSummary.status).toBe("Foundation initialized");
    expect(foundationSummary.description).toContain("single-user");
  });
});
