const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function isWithinTaskScope(pattern: string, value: string) { const normalized = pattern.replaceAll("\\", "/"); let expression = ""; for (let index = 0; index < normalized.length; index++) { if (normalized[index] === "*" && normalized[index + 1] === "*") { expression += ".*"; index++; } else if (normalized[index] === "*") expression += "[^/]*"; else expression += escapeRegex(normalized[index]!); } return new RegExp(`^${expression}$`, "i").test(value.replaceAll("\\", "/")); }

/** Domain policy narrows a TaskGraph path grant; it never expands one. */
export function isWithinSpecialistDomainScope(domain: "FRONTEND" | "BACKEND" | "DATABASE" | undefined, value: string) {
  if (!domain) return true;
  const relative = value.replaceAll("\\", "/").toLowerCase();
  if (domain === "DATABASE") return relative === "supabase/config.toml" || relative === "supabase/seed.sql" || relative.startsWith("supabase/migrations/") || relative.startsWith("supabase/tests/");
  if (domain === "BACKEND") return !relative.startsWith("supabase/") && !/^src\/(?:app(?:\/.*)?\/page\.|components\/)/.test(relative);
  return !relative.startsWith("supabase/") && !/^src\/(?:actions|lib\/(?:auth|supabase|storage|email))\//.test(relative) && !/^src\/app\/api\//.test(relative);
}
