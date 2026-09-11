import { describe, expect, it } from "vitest";
import { implementationAgentDefinition } from "@/agents/catalog";
import { SEOOptimizationAgent } from "./seo-optimization";

describe("SEO optimization capability", () => {
  it("uses the existing Implementation Agent and keeps SEO writes bounded", () => {
    const agent = new SEOOptimizationAgent();
    expect(agent.agentId).toBe("implementation");
    expect(agent.capability).toBe("implementation.seo");
    expect(agent.taskType).toBe("implement-seo");
    expect(agent.getAgentDefinition()).toBe(implementationAgentDefinition);
    expect(agent.independentReviewer).toBe("seo-review");
    expect(agent.canWrite("src/app/metadata.ts")).toBe(true);
    expect(agent.canWrite("src/app/sitemap.ts")).toBe(true);
    expect(agent.canWrite("src/app/page.tsx")).toBe(false);
    expect(() => agent.assertWriteScope("package.json")).toThrow("SEO_OPTIMIZATION_SCOPE_INVALID");
  });
});
