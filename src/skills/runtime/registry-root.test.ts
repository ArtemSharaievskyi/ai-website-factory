import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveSkillRegistryRoot, SKILLS_REGISTRY_ROOT_ENV } from "./registry-root";

describe("standalone skill-registry root", () => {
  it("uses the launcher-verified source workspace when standalone cwd differs", () => {
    const sourceRoot = path.resolve("D:/factory-source");
    const standaloneRoot = path.resolve("D:/factory-source/.next/standalone");
    expect(resolveSkillRegistryRoot({ cwd: standaloneRoot, env: { ...process.env, FACTORY_SOURCE_WORKSPACE_ROOT: sourceRoot } })).toBe(path.join(sourceRoot, "skills"));
  });

  it("honors an explicit supported registry root", () => {
    const configuredRoot = path.resolve("D:/approved-skills");
    expect(resolveSkillRegistryRoot({ cwd: "D:/wrong-cwd", env: { ...process.env, [SKILLS_REGISTRY_ROOT_ENV]: configuredRoot, FACTORY_SOURCE_WORKSPACE_ROOT: "D:/factory-source" } })).toBe(configuredRoot);
  });
});
