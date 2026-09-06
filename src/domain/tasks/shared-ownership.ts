export type MutableArtifactOwner = "FRONTEND" | "BACKEND" | "DATABASE" | "INTEGRATION" | "IMMUTABLE";

type ClaimDomain = "FRONTEND" | "BACKEND" | "DATABASE" | "INTEGRATION" | undefined;
const shared = new Set([
  "package.json", "package-lock.json", "next.config.js", "next.config.mjs", "next.config.ts",
  "tsconfig.json", "tsconfig.base.json", "eslint.config.js", "eslint.config.mjs", "eslint.config.ts",
]);
const normalizedPath = (relativePath: string) => relativePath.replaceAll("\\", "/");
const isUnsafePath = (relativePath: string) => {
  const normalized = normalizedPath(relativePath);
  return !normalized
    || normalized.startsWith("/")
    || /^[A-Za-z]:/.test(normalized)
    || normalized.includes("\0")
    || normalized.split("/").includes("..")
    || /[*?\[\]]/.test(normalized);
};
const pathSegments = (relativePath: string) => normalizedPath(relativePath).toLowerCase().split("/");
const segmentMatches = (pattern: string, value: string) => pattern === "*" || pattern === value;
const scopeMatchesPath = (scope: string, relativePath: string): boolean => {
  const scopeParts = pathSegments(scope);
  const pathParts = pathSegments(relativePath);
  const visit = (scopeIndex: number, pathIndex: number): boolean => {
    if (scopeIndex === scopeParts.length) return pathIndex === pathParts.length;
    if (scopeParts[scopeIndex] === "**") return visit(scopeIndex + 1, pathIndex) || (pathIndex < pathParts.length && visit(scopeIndex, pathIndex + 1));
    return pathIndex < pathParts.length && segmentMatches(scopeParts[scopeIndex]!, pathParts[pathIndex]!) && visit(scopeIndex + 1, pathIndex + 1);
  };
  return visit(0, 0);
};

/** Conservative overlap check used before a specialist/provider is admitted. */
export function exclusivePathsOverlap(left: string, right: string) {
  const leftHasGlob = /[*?\[\]]/.test(left);
  const rightHasGlob = /[*?\[\]]/.test(right);
  if (!leftHasGlob && !rightHasGlob) return normalizedPath(left).toLowerCase() === normalizedPath(right).toLowerCase();
  if (leftHasGlob && !rightHasGlob) return scopeMatchesPath(left, right);
  if (!leftHasGlob && rightHasGlob) return scopeMatchesPath(right, left);
  const leftPrefix = pathSegments(left).findIndex((part) => part === "**" || /[*?\[\]]/.test(part));
  const rightPrefix = pathSegments(right).findIndex((part) => part === "**" || /[*?\[\]]/.test(part));
  return pathSegments(left).slice(0, leftPrefix < 0 ? undefined : leftPrefix).join("/") === pathSegments(right).slice(0, rightPrefix < 0 ? undefined : rightPrefix).join("/");
}

/** Small host-owned inventory for current generated-project shared surfaces. */
export function ownerForGeneratedArtifact(relativePath: string): MutableArtifactOwner {
  const path = normalizedPath(relativePath).toLowerCase();
  if (path.startsWith("docs/admin/") || path.startsWith(".factory-generated/") || path.startsWith(".factory-assets/")) return "IMMUTABLE";
  if (
    shared.has(path)
    || /^(?:\.env(?:\.[a-z0-9._-]+)?|config\/|src\/(?:config|env(?:\.[a-z0-9._-]+)?|contracts\/|domain\/contracts\/))/.test(path)
    || /^src\/lib\/supabase\/database\.types(?:\.|\/|$)/.test(path)
    || /^src\/types\/(?:api|database|contracts)(?:\.|\/|$)/.test(path)
  ) return "INTEGRATION";
  if (path.startsWith("supabase/")) return "DATABASE";
  if (/^src\/(?:actions|lib\/(?:auth|supabase|storage|email))\//.test(path) || path.startsWith("src/app/api/")) return "BACKEND";
  return "FRONTEND";
}

/** Only the host integration foundation task may mutate shared root artifacts. */
export function taskOwnsGeneratedArtifact(taskType: string, implementationDomain: ClaimDomain, relativePath: string) {
  const owner = ownerForGeneratedArtifact(relativePath);
  if (owner === "IMMUTABLE") return false;
  if (owner === "INTEGRATION") return ["implement-project-foundation", "integrate-dependencies", "integrate-project-foundation"].includes(taskType) && (taskType === "implement-project-foundation" || implementationDomain === "INTEGRATION");
  if (taskType === "implement-project-foundation" && owner === "FRONTEND") return true;
  return implementationDomain === owner;
}

export function preflightExclusivePathClaims(claims: ReadonlyArray<{ taskId: string; taskType: string; implementationDomain?: ClaimDomain; paths: readonly string[] }>) {
  const seen = new Map<string, string>();
  for (const claim of claims) for (const path of claim.paths) {
    if (isUnsafePath(path)) return { valid: false as const, code: "TASK_PATH_INVALID" as const };
    if (!taskOwnsGeneratedArtifact(claim.taskType, claim.implementationDomain, path)) return { valid: false as const, code: "TASK_PATH_OWNER_DENIED" as const };
    const key = normalizedPath(path).toLowerCase();
    const owner = seen.get(key);
    if (owner && owner !== claim.taskId) return { valid: false as const, code: "TASK_PATH_COLLISION" as const };
    seen.set(key, claim.taskId);
  }
  return { valid: true as const, code: "APPROVED" as const };
}
