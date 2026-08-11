const forbiddenDirectoryNames = new Set(["node_modules", ".next", ".git", ".context7-cache"]);
const forbiddenSensitiveFile = /(^|\/)(?:\.npmrc|\.git-credentials|credentials?|secrets?|id_rsa(?:\.[^/]+)?|.*private[-_]?key.*)(?:$|[._-])/i;
const forbiddenSensitiveExtension = /\.(?:pem|key|p12|pfx|der)$/i;

export function normalizeToolRelativePath(value: string) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isSafeToolRelativePath(value: string) {
  const normalized = normalizeToolRelativePath(value);
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.includes("..")) return false;
  if (normalized.split("/").some((segment) => forbiddenDirectoryNames.has(segment))) return false;
  if (normalized === ".env" || normalized.startsWith(".env.") || /(^|\/)\.env(?:\.|$)/i.test(normalized)) return false;
  if (normalized.startsWith(".qa-foundation-") || normalized.includes("/.qa-foundation-")) return false;
  if (forbiddenSensitiveFile.test(normalized) || forbiddenSensitiveExtension.test(normalized)) return false;
  return true;
}

function scopeMatches(scope: string, path: string) {
  const normalizedScope = normalizeToolRelativePath(scope);
  const normalizedPath = normalizeToolRelativePath(path);
  if (normalizedScope.endsWith("/**")) {
    const base = normalizedScope.slice(0, -3).replace(/\/$/, "");
    return normalizedPath === base || normalizedPath.startsWith(`${base}/`);
  }
  if (normalizedScope.endsWith("/*")) {
    const base = normalizedScope.slice(0, -2).replace(/\/$/, "");
    const relative = normalizedPath.startsWith(`${base}/`) ? normalizedPath.slice(base.length + 1) : "";
    return relative.length > 0 && !relative.includes("/");
  }
  return normalizedScope.toLowerCase() === normalizedPath.toLowerCase();
}

export function isPathWithinToolScopes(value: string, scopes: readonly string[]) {
  return isSafeToolRelativePath(value) && scopes.some((scope) => scopeMatches(scope, value));
}
