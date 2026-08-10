import { ImplementationError } from "@/agents/implementation/errors";

export const GENERATED_SECURITY_VALIDATION_POLICY_VERSION = "generated-security-v1";

const ownershipPredicate = /auth\.uid\s*\(\s*\)\s*=\s*user_id/i;
const policyBlocks = (content: string) => content.split(/(?=\bcreate\s+policy\b)/i).filter((block) => /\bcreate\s+policy\b/i.test(block));
const hasAuthenticatedRole = (block: string) => /\bto\s+authenticated\b/i.test(block);
const hasPolicyFor = (blocks: string[], operation: string, predicate: RegExp) => blocks.some((block) => new RegExp(`\\bfor\\s+(?:${operation}|all)\\b`, "i").test(block) && hasAuthenticatedRole(block) && predicate.test(block));

export function validateGeneratedAuthentication(content: string) {
  if (/"use\s+client"|'use\s+client'/i.test(content)) throw new ImplementationError("AUTH_SECRET_EXPOSURE", "Authentication must remain in a server-only module.");
  if (!/server-only/i.test(content) || !/cookies\s*\(/i.test(content) || !/createServerClient/i.test(content) || !/auth\.getUser\s*\(/i.test(content)) throw new ImplementationError("AUTH_CLIENT_BOUNDARY_VIOLATION", "Supabase Auth must verify the server session with a server-only client.");
  if (!/error\s*\|\|\s*!.*user|!.*user.*\|\|\s*error/i.test(content) || !/return\s+null/i.test(content)) throw new ImplementationError("AUTHORIZATION_INCOMPLETE", "Authentication must fail closed when the session or user is unavailable.");
  if (/SUPABASE_SERVICE_ROLE_KEY|service_role/i.test(content)) throw new ImplementationError("AUTH_SECRET_EXPOSURE", "Ordinary authentication must not use a service-role credential.");
}

export function validateGeneratedProtectedHandler(content: string, kind: "server-action" | "route-handler") {
  if (!/getAuthenticatedUser\s*\(/i.test(content) || !/!\s*user/i.test(content)) throw new ImplementationError(kind === "server-action" ? "SERVER_ACTION_AUTHORIZATION_MISSING" : "ROUTE_HANDLER_AUTHORIZATION_MISSING", `${kind} must verify the authenticated user at its own entry point.`);
  if (!/user\.id/i.test(content)) throw new ImplementationError(kind === "server-action" ? "SERVER_ACTION_AUTHORIZATION_MISSING" : "ROUTE_HANDLER_AUTHORIZATION_MISSING", `${kind} must derive protected ownership from the authenticated user's stable ID.`);
  if (/ownerId\s*[:=]\s*(?:input|parsed\.data)|userId\s*[:=]\s*(?:input|parsed\.data)/i.test(content)) throw new ImplementationError("RLS_OWNERSHIP_UNSAFE", `${kind} must not trust a client-supplied owner or user ID.`);
  if (/SUPABASE_SERVICE_ROLE_KEY|service_role/i.test(content)) throw new ImplementationError(kind === "server-action" ? "SERVER_ACTION_SECRET_EXPOSURE" : "AUTH_SECRET_EXPOSURE", `${kind} must not expose or use a service-role credential for ordinary requests.`);
}

export function validateGeneratedDatabaseSchema(content: string) {
  if (!/create\s+table/i.test(content) || !/\buser_id\b[^,\n]*\b(uuid|text)\b/i.test(content) || !/references\s+auth\.users/i.test(content)) throw new ImplementationError("RLS_OWNERSHIP_UNSAFE", "Protected generated tables must bind rows to auth.users through user_id.");
}

export function validateGeneratedRlsPolicy(content: string) {
  if (!/enable\s+row\s+level\s+security/i.test(content)) throw new ImplementationError("DATABASE_RLS_REQUIRED", "Generated protected tables must enable row-level security.");
  if (/\bto\s+public\b|using\s*\(\s*true\s*\)|with\s+check\s*\(\s*true\s*\)|auth\.uid\s*\(\s*\)\s+is\s+not\s+null/i.test(content)) throw new ImplementationError("RLS_POLICY_TOO_BROAD", "Generated RLS must not grant Broad or public access.");
  const blocks = policyBlocks(content);
  if (blocks.length < 4 || blocks.some((block) => !hasAuthenticatedRole(block))) throw new ImplementationError("RLS_POLICY_MISSING", "RLS policies must be limited to authenticated users.");
  if (!hasPolicyFor(blocks, "select", ownershipPredicate) || !hasPolicyFor(blocks, "update", ownershipPredicate) || !hasPolicyFor(blocks, "delete", ownershipPredicate)) throw new ImplementationError("RLS_OWNERSHIP_UNSAFE", "SELECT, UPDATE, and DELETE policies must constrain rows to auth.uid() = user_id.");
  if (!hasPolicyFor(blocks, "insert", /with\s+check[\s\S]*auth\.uid\s*\(\s*\)\s*=\s*user_id/i) || !hasPolicyFor(blocks, "update", /with\s+check[\s\S]*auth\.uid\s*\(\s*\)\s*=\s*user_id/i)) throw new ImplementationError("RLS_OWNERSHIP_UNSAFE", "INSERT and UPDATE policies must constrain written ownership with WITH CHECK.");
}
