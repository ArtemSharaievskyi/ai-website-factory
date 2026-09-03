import { describe, expect, it } from "vitest";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { AgentProfileSchema, APPROVED_IMPLEMENTATION_PROFILES, implementationProfileRegistry } from "./profiles";

describe("approved implementation specialist profiles", () => {
  it("contains exactly three immutable, checksum-bound Factory profiles", () => {
    expect(APPROVED_IMPLEMENTATION_PROFILES.map((profile) => profile.profileId)).toEqual([
      "frontend-implementation",
      "backend-implementation",
      "database-implementation",
    ]);
    for (const profile of APPROVED_IMPLEMENTATION_PROFILES) {
      const withoutChecksum = Object.fromEntries(Object.entries(profile).filter(([key]) => key !== "checksum"));
      expect(profile.status).toBe("APPROVED");
      expect(profile.agentId).toBe("implementation");
      expect(profile.checksum).toBe(checksumPersistedDocument(withoutChecksum));
      expect(Object.isFrozen(profile)).toBe(true);
      expect(profile.normalizedGuidance.join(" ")).not.toMatch(/OpenCode|Claude|MCP|question tool|slash command|Prisma|Express/i);
      expect(profile.rejectedForeignAssumptions.join(" ")).toMatch(/foreign|OpenCode|Claude/i);
    }
    expect(implementationProfileRegistry.all()).toHaveLength(3);
  });

  it("does not allow imported content to add wildcard authority", () => {
    const profile = APPROVED_IMPLEMENTATION_PROFILES[0]!;
    expect(() => AgentProfileSchema.parse({ ...profile, allowedSkillIds: ["*"] })).toThrow();
    expect(() => AgentProfileSchema.parse({ ...profile, allowedTools: ["git-write"] })).toThrow();
  });
});
