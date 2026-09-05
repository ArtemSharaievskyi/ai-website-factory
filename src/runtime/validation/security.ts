import { ImplementationError } from "@/agents/implementation/errors";
import type { StoragePlan } from "@/agents/planner/contracts";
import { storagePlanContractChecksum } from "@/agents/planner/contracts";
import type { AccessControlContract } from "@/domain/implementation/contracts";

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

const sqlName = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const policyOperation = (block: string, operation: string) => new RegExp(`\\bfor\\s+(?:${operation}|all)\\b`, "i").test(block);
const ownerExpression = (column: string) => new RegExp(`(?:auth\\.uid\\s*\\(\\s*\\)\\s*=\\s*${sqlName(column)}|${sqlName(column)}\\s*=\\s*auth\\.uid\\s*\\(\\s*\\))`, "i");
const trustedRoleExpression = (contract: AccessControlContract, roles: readonly string[]) => {
  const alternatives = roles.map(sqlName).join("|");
  if (contract.roleAuthority.kind === "JWT_APP_METADATA") return new RegExp(`auth\\.jwt\\s*\\(\\s*\\)[\\s\\S]*(?:app_metadata)[\\s\\S]*(?:${alternatives})`, "i");
  if (contract.roleAuthority.kind === "MEMBERSHIP_TABLE") return new RegExp(`exists\\s*\\([\\s\\S]*from\\s+${sqlName(contract.roleAuthority.table)}[\\s\\S]*${sqlName(contract.roleAuthority.userColumn)}\\s*=\\s*auth\\.uid\\s*\\(\\s*\\)[\\s\\S]*${sqlName(contract.roleAuthority.roleColumn)}[\\s\\S]*(?:${alternatives})`, "i");
  return /(?!)a/;
};

/** Validate generated policies against the approved resource/role/organization/status matrix. */
export function validateGeneratedRlsPolicyAgainstContract(content: string, contract: AccessControlContract) {
  if (/\bto\s+public\b|using\s*\(\s*true\s*\)|with\s+check\s*\(\s*true\s*\)|user_metadata|service_role/i.test(content)) throw new ImplementationError("RLS_POLICY_TOO_BROAD", "Contract-aware RLS cannot use public access, unconditional predicates, user metadata, or service-role bypasses.");
  for (const resource of contract.resources) {
    if (!new RegExp(`alter\\s+table\\s+(?:public\\.)?${sqlName(resource.table)}\\s+enable\\s+row\\s+level\\s+security`, "i").test(content)) throw new ImplementationError("DATABASE_RLS_REQUIRED", `RLS is not enabled for ${resource.table}.`);
    const blocks = policyBlocks(content).filter((block) => new RegExp(`\\bon\\s+(?:public\\.)?${sqlName(resource.table)}\\b`, "i").test(block));
    for (const grant of resource.grants) {
      const block = blocks.find((candidate) => policyOperation(candidate, grant.operation) && hasAuthenticatedRole(candidate));
      if (!block) throw new ImplementationError("RLS_POLICY_MISSING", `${resource.table} lacks its authenticated ${grant.operation} policy.`);
      const owner = resource.ownerColumn ? ownerExpression(resource.ownerColumn).test(block) : false;
      const organization = resource.organizationColumn ? new RegExp(`${sqlName(resource.organizationColumn)}[\\s\\S]*(?:auth\\.jwt|${contract.roleAuthority.kind === "MEMBERSHIP_TABLE" ? sqlName(contract.roleAuthority.table) : "app_metadata"})`, "i").test(block) : false;
      const role = grant.roles.length > 0 && trustedRoleExpression(contract, grant.roles).test(block);
      const scopeSatisfied = grant.scope === "DENY" ? /false/i.test(block) : grant.scope === "OWNER" ? owner : grant.scope === "ORGANIZATION" ? organization : grant.scope === "ROLE" ? role : owner && role;
      if (!scopeSatisfied) throw new ImplementationError("RLS_OWNERSHIP_UNSAFE", `${resource.table} ${grant.operation} does not implement its approved ${grant.scope} scope.`);
      const statusColumn = resource.statusColumn;
      if (grant.allowedStatuses.length > 0 && (!statusColumn || grant.allowedStatuses.some((status) => !new RegExp(`${sqlName(statusColumn)}[\\s\\S]*['\"]${sqlName(status)}['\"]`, "i").test(block)))) throw new ImplementationError("RLS_POLICY_MISSING", `${resource.table} ${grant.operation} does not enforce all approved status constraints.`);
      const predicate = grant.operation === "INSERT" ? /with\s+check\s*\(/i : /using\s*\(/i;
      if (!predicate.test(block) || (grant.operation === "UPDATE" && !/with\s+check\s*\(/i.test(block))) throw new ImplementationError("RLS_POLICY_MISSING", `${resource.table} ${grant.operation} uses the wrong RLS predicate boundary.`);
    }
  }
}

export function validateGeneratedStorage(content: string, plannedBucketNames: readonly string[] = [], storagePlan?: StoragePlan) {
  if (/storage\.from\s*\(\s*(?:input|parsed|request|req)\.|\bbucket\s*\(\s*(?:input|parsed|request|req)\.|(?:bucket|bucketName)\s*[:=]\s*(?:input|parsed|request|req)/i.test(content) || /(?:ownerId|userId|storageOwner|pathOwner)\s*[:=]\s*(?:input|parsed|request|req)/i.test(content)) throw new ImplementationError("STORAGE_PATH_UNSAFE", "Generated storage has an unsafe caller-selected bucket or ownership path.");
  if (!/server-only/i.test(content) || !/getAuthenticatedUser\s*\(/i.test(content) || !/getServerSupabaseClient\s*\(/i.test(content)) throw new ImplementationError("STORAGE_POLICY_UNSAFE", "Generated storage must use the existing server-side authenticated Supabase boundary.");
  if (!/STORAGE_BUCKET\s*=\s*["'][^"']+["']/i.test(content) || !/storage\.from\s*\(\s*STORAGE_BUCKET\s*\)/i.test(content)) throw new ImplementationError("STORAGE_BUCKET_UNAPPROVED", "Generated storage must select an explicit server-owned bucket.");
  if (plannedBucketNames.length && !plannedBucketNames.some((bucket) => new RegExp(`STORAGE_BUCKET\\s*=\\s*["']${bucket.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\s*["']`, "i").test(content))) throw new ImplementationError("STORAGE_BUCKET_UNAPPROVED", "Generated storage must use a bucket declared by the approved storage plan.");
  if (!/user\.id/i.test(content) || !/ownedObjectPath\(user\.id|isOwnedObjectPath\(user\.id/i.test(content)) throw new ImplementationError("STORAGE_PATH_UNSAFE", "Generated storage must derive object ownership from the authenticated user ID.");
  if (!/createSignedUploadUrl|\.upload\s*\(/i.test(content) || !/createSignedUrl\s*\(/i.test(content) || !/\.update\s*\(/i.test(content) || !/\.remove\s*\(/i.test(content)) throw new ImplementationError("STORAGE_POLICY_UNSAFE", "Generated storage must authorize upload, read, update, and delete operations.");
  if (!/!\s*user/i.test(content) || !/!\s*user\s*\|\||!user\s*\|\|/i.test(content)) throw new ImplementationError("STORAGE_POLICY_UNSAFE", "Generated storage must fail closed for unauthenticated requests.");
  for (const operation of ["createSignedDownloadUrl", "updateOwnedObject", "deleteOwnedObject"]) if (!new RegExp(`${operation}[\\s\\S]*?isOwnedObjectPath\\s*\\(\\s*user\\.id`, "i").test(content)) throw new ImplementationError("STORAGE_PATH_UNSAFE", `${operation} must verify the authenticated owner before storage access.`);
  if (!/createSignedUploadUrl[\s\S]*?ownedObjectPath\s*\(\s*user\.id/i.test(content)) throw new ImplementationError("STORAGE_PATH_UNSAFE", "Uploads must derive the object path from the authenticated user ID.");
  if (!/createSignedUploadUrl[\s\S]*?validateUpload\s*\(/i.test(content)) throw new ImplementationError("STORAGE_UPLOAD_VALIDATION_MISSING", "Signed upload URLs must be issued only after the existing upload constraints pass.");
  if (storagePlan && !new RegExp(`STORAGE_BUCKET\\s*=\\s*["']${storagePlan.bucketId.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\s*["']`, "i").test(content)) throw new ImplementationError("STORAGE_BUCKET_UNAPPROVED", "Generated storage must use the exact canonical bucket ID.");
  if (storagePlan && !/storage-contract-checksum:\s*[a-f0-9]{64}/i.test(content)) throw new ImplementationError("STORAGE_POLICY_UNSAFE", "Generated storage must carry the typed StoragePlan contract checksum.");
  if (storagePlan && storagePlan.directClientAccess) throw new ImplementationError("STORAGE_POLICY_UNSAFE", "Direct client Storage is not supported by the current StoragePlan.");
  if (/SUPABASE_SERVICE_ROLE_KEY|service_role/i.test(content)) throw new ImplementationError("AUTH_SECRET_EXPOSURE", "Ordinary storage operations must not use a service-role credential.");
}

export function validateGeneratedStoragePolicy(content: string, storagePlan: StoragePlan) {
  const policyIdentity = storagePlan.policyIdentity.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ownerPredicate = /\(storage\.foldername\s*\(\s*name\s*\)\)\s*\[\s*1\s*\]\s*=\s*\(?\s*auth\.uid\s*\(\s*\)\s*::\s*text\s*\)?/i;
  const blocks = policyBlocks(content);
  if (!/^--\s*storage-contract-checksum:\s*[a-f0-9]{64}/im.test(content)) throw new ImplementationError("STORAGE_POLICY_UNSAFE", "Storage policy migration must carry the typed StoragePlan contract checksum.");
  if (!/on\s+storage\.objects/i.test(content) || !content.includes(`bucket_id = '${storagePlan.bucketId}'`)) throw new ImplementationError("STORAGE_BUCKET_UNAPPROVED", "Storage policies must target storage.objects and the exact planned bucket.");
  if (!new RegExp(`policy\\s+["']?${policyIdentity}[_-]select`, "i").test(content)) throw new ImplementationError("STORAGE_POLICY_UNSAFE", "Storage policy identifiers must be stable and derived from the typed contract.");
  if (!hasAuthenticatedRole(content)) throw new ImplementationError("STORAGE_POLICY_UNSAFE", "Storage must generate four authenticated owner policies.");
  const blockFor = (operation: string) => blocks.find((block) => new RegExp(`\\bfor\\s+${operation}\\b`, "i").test(block)) ?? content;
  for (const operation of ["select", "insert", "update", "delete"]) {
    const block = blockFor(operation);
    if (!content.includes(`create policy ${storagePlan.policyIdentity}_${operation}`) || !new RegExp(`\\bfor\\s+${operation}\\b`, "i").test(content)) throw new ImplementationError("STORAGE_POLICY_UNSAFE", `${operation.toUpperCase()} Storage policy is missing.`);
    if (!block.includes(`bucket_id = '${storagePlan.bucketId}'`) || !ownerPredicate.test(block)) throw new ImplementationError("STORAGE_PATH_UNSAFE", `${operation.toUpperCase()} policy must scope the exact bucket to auth.uid() owner paths.`);
  }
  if (!/for\s+select[\s\S]*using\s*\(/i.test(blockFor("select")) || !/for\s+delete[\s\S]*using\s*\(/i.test(blockFor("delete"))) throw new ImplementationError("STORAGE_POLICY_UNSAFE", "SELECT and DELETE must use USING authorization predicates.");
  if (!/for\s+insert[\s\S]*with\s+check\s*\(/i.test(blockFor("insert")) || !/for\s+update[\s\S]*using\s*\([\s\S]*with\s+check\s*\(/i.test(blockFor("update"))) throw new ImplementationError("STORAGE_POLICY_UNSAFE", "INSERT and UPDATE must use WITH CHECK ownership predicates.");
  if (/to\s+public|using\s*\(\s*true\s*\)|with\s+check\s*\(\s*true\s*\)|service_role/i.test(content)) throw new ImplementationError("STORAGE_POLICY_UNSAFE", "Storage policies must not grant public, unconditional, or service-role access.");
  if (storagePlanContractChecksum(storagePlan) !== content.match(/^--\s*storage-contract-checksum:\s*([a-f0-9]{64})/im)?.[1]) throw new ImplementationError("STORAGE_POLICY_UNSAFE", "Storage policy checksum does not match the accepted typed StoragePlan.");
}
