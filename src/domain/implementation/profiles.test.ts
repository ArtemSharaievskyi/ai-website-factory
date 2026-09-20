import { describe, expect, it } from "vitest";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { activeImplementationSkillIds, AgentProfileSchema, APPROVED_IMPLEMENTATION_PROFILES, implementationProfileRegistry, shouldActivateSupabaseImplementationSkill } from "./profiles";
import { EMIL_ANIMATE_SKILL_ID, EMIL_DESIGN_ENGINEERING_SKILL_ID } from "@/domain/design/emil-identifiers";

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

  it("binds the frontend and backend capability surfaces to the existing approved skills", () => {
    const frontend = implementationProfileRegistry.get("frontend-implementation");
    const backend = implementationProfileRegistry.get("backend-implementation");
    expect(frontend.allowedSkillIds).toEqual([
      "nextjs-server-client-implementation",
      "typed-form-implementation",
      "maintainable-performance-implementation",
      EMIL_DESIGN_ENGINEERING_SKILL_ID,
      EMIL_ANIMATE_SKILL_ID,
      "design-motion-principles",
      "magic-ui-adaptation",
      "daisyui-tailwind-v4",
    ]);
    expect(frontend.skillBindings.map((binding) => binding.skillId)).toEqual(frontend.allowedSkillIds);
    expect(frontend.implementationCapabilities).toEqual(expect.arrayContaining([
      "ACCESSIBILITY_IMPLEMENTATION", "RESPONSIVE_IMPLEMENTATION", "SERVER_CLIENT_BOUNDARIES", "FORM_IMPLEMENTATION",
      "STATE_BOUNDARIES", "PERFORMANCE_IMPLEMENTATION", "FRONTEND_TESTING", "CANONICAL_CONTRACT_CONSUMPTION",
      "DEPENDENCY_DISCIPLINE", "ERROR_LOADING_EMPTY_STATES", "DESIGN_CONTRACT_IMPLEMENTATION",
      "VISUAL_CRAFT_IMPLEMENTATION", "MOTION_DESIGN_IMPLEMENTATION", "IMPECCABLE_DESIGN_INTEGRATION",
      "DIALKIT_AUTHORING", "ANTI_AI_SLOP_DESIGN_GUARD", "DESIGN_SYSTEM_CHECKLIST",
    ]));
    expect(backend.implementationCapabilities).toEqual(expect.arrayContaining([
      "AUTHENTICATION", "AUTHORIZATION", "SERVER_TRUST_BOUNDARY", "TYPED_BACKEND_CONTRACTS", "TRANSACTION_CONCURRENCY",
      "ERROR_MODELING", "SERVER_ONLY_BOUNDARIES", "CACHE_REVALIDATION", "BACKEND_TESTING", "CANONICAL_CONTRACT_CONSUMPTION",
      "DEPENDENCY_DISCIPLINE", "CONDITIONAL_SUPABASE", "CONDITIONAL_POSTGRES_APPLICATION", "DATABASE_OWNERSHIP_HANDOFF",
    ]));
    for (const profile of [frontend, backend, implementationProfileRegistry.get("database-implementation")]) {
      for (const binding of profile.skillBindings) {
        expect(profile.allowedSkillIds).toContain(binding.skillId);
        expect(binding.tools.every((tool) => profile.allowedTools.includes(tool))).toBe(true);
        expect(binding.permissions.every((permission) => profile.capabilitySurface.includes(permission))).toBe(true);
        expect(binding.inputContract).toBe("implementation.input");
        expect(binding.outputContract).toBe("implementation.output");
      }
    }
  });

  it("composes only relevant approved skills and activates Supabase context conditionally", () => {
    const frontend = implementationProfileRegistry.get("frontend-implementation");
    const backend = implementationProfileRegistry.get("backend-implementation");
    const database = implementationProfileRegistry.get("database-implementation");
    expect(activeImplementationSkillIds(frontend, "implement-page")).toEqual([
      "nextjs-server-client-implementation",
      "maintainable-performance-implementation",
      EMIL_DESIGN_ENGINEERING_SKILL_ID,
    ]);
    expect(activeImplementationSkillIds(frontend, "implement-form")).toEqual([
      "nextjs-server-client-implementation",
      "typed-form-implementation",
      "maintainable-performance-implementation",
      EMIL_DESIGN_ENGINEERING_SKILL_ID,
    ]);
    expect(activeImplementationSkillIds(frontend, "implement-motion", { motionRequested: true })).toEqual([
      "nextjs-server-client-implementation",
      "maintainable-performance-implementation",
      EMIL_DESIGN_ENGINEERING_SKILL_ID,
      EMIL_ANIMATE_SKILL_ID,
      "design-motion-principles",
    ]);
    expect(activeImplementationSkillIds(frontend, "implement-design-system", { daisyUiRequested: true })).toEqual([
      "nextjs-server-client-implementation",
      "maintainable-performance-implementation",
      EMIL_DESIGN_ENGINEERING_SKILL_ID,
      "daisyui-tailwind-v4",
    ]);
    expect(activeImplementationSkillIds(frontend, "implement-page", { daisyUiRequested: true })).toContain("daisyui-tailwind-v4");
    expect(activeImplementationSkillIds(frontend, "implement-page", { magicUiRequested: true })).toEqual([
      "nextjs-server-client-implementation",
      "maintainable-performance-implementation",
      EMIL_DESIGN_ENGINEERING_SKILL_ID,
      "magic-ui-adaptation",
    ]);
    expect(activeImplementationSkillIds(backend, "implement-route-handler")).toEqual([]);
    expect(activeImplementationSkillIds(backend, "implement-route-handler", { supabaseRequired: true })).toEqual(["supabase-application-integration"]);
    expect(activeImplementationSkillIds(database, "implement-database-schema", { supabaseRequired: true })).toEqual(["supabase-application-integration"]);
    expect(shouldActivateSupabaseImplementationSkill({ domain: "BACKEND", taskType: "implement-route-handler" })).toBe(false);
    expect(shouldActivateSupabaseImplementationSkill({ domain: "BACKEND", taskType: "implement-route-handler", hasDatabaseHandoff: true })).toBe(true);
    expect(shouldActivateSupabaseImplementationSkill({ domain: "BACKEND", taskType: "implement-route-handler", databaseMode: "SUPABASE_EXISTING" })).toBe(true);
    expect(shouldActivateSupabaseImplementationSkill({ domain: "BACKEND", taskType: "implement-route-handler", databaseMode: "NONE" })).toBe(false);
  });

  it("does not allow imported content to add wildcard authority", () => {
    const profile = APPROVED_IMPLEMENTATION_PROFILES[0]!;
    expect(() => AgentProfileSchema.parse({ ...profile, allowedSkillIds: ["*"] })).toThrow();
    expect(() => AgentProfileSchema.parse({ ...profile, allowedTools: ["git-write"] })).toThrow();
  });
});
