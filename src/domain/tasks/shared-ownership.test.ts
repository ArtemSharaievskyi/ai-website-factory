import { describe, expect, it } from "vitest";
import { exclusivePathsOverlap, ownerForGeneratedArtifact, preflightExclusivePathClaims, taskOwnsGeneratedArtifact } from "./shared-ownership";

describe("generated-project exclusive shared ownership", () => {
  it("classifies current mutable surfaces without overlapping specialist authority", () => {
    expect(ownerForGeneratedArtifact("package.json")).toBe("INTEGRATION");
    expect(ownerForGeneratedArtifact(".env.example")).toBe("INTEGRATION");
    expect(ownerForGeneratedArtifact("src/contracts/api.ts")).toBe("INTEGRATION");
    expect(ownerForGeneratedArtifact("supabase/migrations/001.sql")).toBe("DATABASE");
    expect(ownerForGeneratedArtifact("src/app/page.tsx")).toBe("FRONTEND");
    expect(ownerForGeneratedArtifact("src/app/api/x/route.ts")).toBe("BACKEND");
    expect(ownerForGeneratedArtifact("docs/admin/evidence.json")).toBe("IMMUTABLE");
  });
  it("denies specialists shared and foreign paths while permitting their owned paths", () => {
    expect(taskOwnsGeneratedArtifact("implement-page", "FRONTEND", "package.json")).toBe(false);
    expect(taskOwnsGeneratedArtifact("implement-page", "FRONTEND", "supabase/migrations/001.sql")).toBe(false);
    expect(taskOwnsGeneratedArtifact("implement-server-action", "BACKEND", "package.json")).toBe(false);
    expect(taskOwnsGeneratedArtifact("implement-server-action", "BACKEND", "supabase/migrations/001.sql")).toBe(false);
    expect(taskOwnsGeneratedArtifact("implement-database-schema", "DATABASE", "package.json")).toBe(false);
    expect(taskOwnsGeneratedArtifact("implement-database-schema", "DATABASE", "src/components/ui/button.tsx")).toBe(false);
    expect(taskOwnsGeneratedArtifact("implement-project-foundation", "FRONTEND", "package.json")).toBe(true);
    expect(taskOwnsGeneratedArtifact("integrate-dependencies", "INTEGRATION", "package.json")).toBe(true);
    expect(taskOwnsGeneratedArtifact("integrate-dependencies", "INTEGRATION", "package-lock.json")).toBe(true);
    expect(taskOwnsGeneratedArtifact("implement-page", "INTEGRATION", "package.json")).toBe(false);
    expect(taskOwnsGeneratedArtifact("implement-page", "FRONTEND", "src/app/page.tsx")).toBe(true);
    expect(taskOwnsGeneratedArtifact("implement-server-action", "BACKEND", "src/actions/x.ts")).toBe(true);
    expect(taskOwnsGeneratedArtifact("implement-database-schema", "DATABASE", "supabase/migrations/001.sql")).toBe(true);
  });
  it("rejects a collision before a provider can be called", () => {
    expect(preflightExclusivePathClaims([{ taskId: "a", taskType: "implement-project-foundation", implementationDomain: "FRONTEND", paths: ["package.json"] }, { taskId: "b", taskType: "implement-project-foundation", implementationDomain: "FRONTEND", paths: ["package.json"] }])).toMatchObject({ valid: false, code: "TASK_PATH_COLLISION" });
  });
  it("treats an active broad scope as colliding with a concrete requested path", () => {
    expect(exclusivePathsOverlap("src/app/**", "src/app/account/page.tsx")).toBe(true);
    expect(exclusivePathsOverlap("src/components/**", "src/app/account/page.tsx")).toBe(false);
  });
  it("rejects unsafe or non-concrete claims before worker admission", () => {
    expect(preflightExclusivePathClaims([{ taskId: "a", taskType: "implement-page", implementationDomain: "FRONTEND", paths: ["../package.json"] }])).toMatchObject({ valid: false, code: "TASK_PATH_INVALID" });
    expect(preflightExclusivePathClaims([{ taskId: "a", taskType: "implement-page", implementationDomain: "FRONTEND", paths: ["src/app/**"] }])).toMatchObject({ valid: false, code: "TASK_PATH_INVALID" });
  });
});
