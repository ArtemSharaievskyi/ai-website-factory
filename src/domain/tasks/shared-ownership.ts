export type MutableArtifactOwner = "FRONTEND" | "BACKEND" | "DATABASE" | "INTEGRATION" | "IMMUTABLE";

const shared = new Set(["package.json", "package-lock.json", "next.config.mjs", "next.config.ts", "tsconfig.json", "eslint.config.mjs", "eslint.config.js"]);

/** Small host-owned inventory for current generated-project shared surfaces. */
export function ownerForGeneratedArtifact(relativePath: string): MutableArtifactOwner {
  const path = relativePath.replaceAll("\\", "/").toLowerCase();
  if (shared.has(path) || /^src\/(?:lib\/supabase\/database\.types|contracts\/implementation)/.test(path)) return "INTEGRATION";
  if (path.startsWith("supabase/")) return "DATABASE";
  if (/^src\/(?:actions|lib\/(?:auth|supabase|storage|email))\//.test(path) || path.startsWith("src/app/api/")) return "BACKEND";
  return "FRONTEND";
}

/** Only the host integration foundation task may mutate shared root artifacts. */
export function taskOwnsGeneratedArtifact(taskType: string, implementationDomain: "FRONTEND" | "BACKEND" | "DATABASE" | undefined, relativePath: string) {
  const owner = ownerForGeneratedArtifact(relativePath);
  if (owner === "INTEGRATION") return taskType === "implement-project-foundation";
  if (taskType === "implement-project-foundation" && owner === "FRONTEND") return true;
  return implementationDomain === owner && (owner !== "FRONTEND" || !["package.json", "package-lock.json"].includes(relativePath.replaceAll("\\", "/").toLowerCase()));
}

export function preflightExclusivePathClaims(claims: ReadonlyArray<{ taskId: string; taskType: string; implementationDomain?: "FRONTEND" | "BACKEND" | "DATABASE"; paths: readonly string[] }>) {
  const seen = new Map<string, string>();
  for (const claim of claims) for (const path of claim.paths) {
    if (!taskOwnsGeneratedArtifact(claim.taskType, claim.implementationDomain, path)) return { valid: false as const, code: "TASK_PATH_OWNER_DENIED" as const };
    const key = path.replaceAll("\\", "/").toLowerCase();
    const owner = seen.get(key);
    if (owner && owner !== claim.taskId) return { valid: false as const, code: "TASK_PATH_COLLISION" as const };
    seen.set(key, claim.taskId);
  }
  return { valid: true as const, code: "APPROVED" as const };
}
