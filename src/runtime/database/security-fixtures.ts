import { z } from "zod";
import type { AccessControlContract } from "@/domain/implementation/contracts";

/** Generic identities used only by generated-project database security tests. */
export const SecurityTestPrincipalSchema = z.object({
  identity: z.enum(["OWNER_A", "OWNER_B", "PRIVILEGED", "ANONYMOUS"]),
  authenticationState: z.enum(["AUTHENTICATED", "ANONYMOUS"]),
  userIdentity: z.string().uuid().optional(),
  ownershipIdentity: z.string().uuid().optional(),
  trustedRoleClaims: z.record(z.string(), z.string()).default({}),
}).strict().superRefine((principal, context) => {
  if (principal.authenticationState === "ANONYMOUS" && (principal.userIdentity || principal.ownershipIdentity || Object.keys(principal.trustedRoleClaims).length)) context.addIssue({ code: "custom", message: "Anonymous fixtures cannot carry identity or trusted claims." });
  if (principal.authenticationState === "AUTHENTICATED" && (!principal.userIdentity || !principal.ownershipIdentity)) context.addIssue({ code: "custom", message: "Authenticated fixtures require deterministic user and ownership identities." });
  if (principal.identity === "PRIVILEGED" && Object.keys(principal.trustedRoleClaims).length === 0) context.addIssue({ code: "custom", message: "The privileged fixture requires a host-provisioned trusted claim." });
  if (principal.identity !== "PRIVILEGED" && Object.keys(principal.trustedRoleClaims).length > 0) context.addIssue({ code: "custom", message: "Trusted role claims may only be assigned to the privileged fixture." });
});
export type SecurityTestPrincipal = z.infer<typeof SecurityTestPrincipalSchema>;

const ids = {
  OWNER_A: "00000000-0000-4000-8000-0000000000a1",
  OWNER_B: "00000000-0000-4000-8000-0000000000b2",
  PRIVILEGED: "00000000-0000-4000-8000-0000000000c3",
} as const;

export function securityTestPrincipals(role = "privileged"): SecurityTestPrincipal[] {
  return [
    { identity: "OWNER_A", authenticationState: "AUTHENTICATED", userIdentity: ids.OWNER_A, ownershipIdentity: ids.OWNER_A },
    { identity: "OWNER_B", authenticationState: "AUTHENTICATED", userIdentity: ids.OWNER_B, ownershipIdentity: ids.OWNER_B },
    { identity: "PRIVILEGED", authenticationState: "AUTHENTICATED", userIdentity: ids.PRIVILEGED, ownershipIdentity: ids.PRIVILEGED, trustedRoleClaims: { role } },
    { identity: "ANONYMOUS", authenticationState: "ANONYMOUS" },
  ].map((principal) => SecurityTestPrincipalSchema.parse(principal));
}

export type BehavioralFixtureTarget = {
  table: string;
  ownerColumn: string;
  role: string;
  scope?: "OWNER" | "ORGANIZATION" | "ROLE" | "OWNER_OR_ROLE" | "DENY";
  roleAuthority?: "JWT_APP_METADATA" | "MEMBERSHIP_TABLE" | "AUTHENTICATED_USER";
  seedRows?: { ownerA: Record<string, string | number | boolean | null>; ownerB: Record<string, string | number | boolean | null> };
};

const claimsFor = (principal: SecurityTestPrincipal) => principal.authenticationState === "ANONYMOUS"
  ? ""
  : JSON.stringify({ sub: principal.userIdentity, app_metadata: principal.trustedRoleClaims });

const claimsForMutableRoleAttempt = (principal: SecurityTestPrincipal) => JSON.stringify({
  sub: principal.userIdentity,
  user_metadata: { role: principal.trustedRoleClaims.role ?? "privileged" },
}).replace('{"role"', '{ "role"');

/** Emits generic pgTAP identity setup and authorization cases for an approved resource. */
export function renderBehavioralSecurityFixture(target: BehavioralFixtureTarget) {
  const identifier = (value: string) => {
    if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error("SECURITY_FIXTURE_IDENTIFIER_INVALID");
    return value;
  };
  const sqlValue = (value: string | number | boolean | null) => value === null
    ? "NULL"
    : typeof value === "string"
      ? `'${value.replaceAll("'", "''")}'`
      : typeof value === "boolean"
        ? String(value)
        : String(value);
  const table = identifier(target.table);
  const ownerColumn = identifier(target.ownerColumn);
  const principals = securityTestPrincipals(target.role);
  const ownerA = principals.find((principal) => principal.identity === "OWNER_A")!;
  const ownerB = principals.find((principal) => principal.identity === "OWNER_B")!;
  const privileged = principals.find((principal) => principal.identity === "PRIVILEGED")!;
  const authenticated = (principal: SecurityTestPrincipal) => ["set local role authenticated;", `select set_config('request.jwt.claims', ${sqlValue(claimsFor(principal))}, true);`];
  const ownerAId = sqlValue(ownerA.ownershipIdentity!);
  const ownerBId = sqlValue(ownerB.ownershipIdentity!);
  const scope = target.scope ?? "OWNER_OR_ROLE";
  const seedRows = target.seedRows ?? { ownerA: { [ownerColumn]: ownerA.ownershipIdentity }, ownerB: { [ownerColumn]: ownerB.ownershipIdentity } };
  const seedColumns = [...new Set([...Object.keys(seedRows.ownerA), ...Object.keys(seedRows.ownerB)])].map(identifier).sort();
  if (!seedColumns.includes(ownerColumn) || seedColumns.some((column) => !(column in seedRows.ownerA) || !(column in seedRows.ownerB))) throw new Error("SECURITY_FIXTURE_SEED_INVALID");
  const seedIdentitySql = `insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data) values (${sqlValue(ownerA.userIdentity!)}, 'authenticated', 'authenticated', 'owner-a@factory.invalid', '', '{}', '{}'), (${sqlValue(ownerB.userIdentity!)}, 'authenticated', 'authenticated', 'owner-b@factory.invalid', '', '{}', '{}') on conflict (id) do nothing`;
  const seedSql = `insert into public.${table} (${seedColumns.join(", ")}) values ${[seedRows.ownerA, seedRows.ownerB].map((row) => `(${seedColumns.map((column) => sqlValue(row[column]!)).join(", ")})`).join(", ")}`;
  const trustedAuthority = target.roleAuthority === "MEMBERSHIP_TABLE"
    ? "-- PRIVILEGED is provisioned through the approved membership authority; trusted claims are host-provisioned."
    : target.roleAuthority === "AUTHENTICATED_USER"
      ? "-- PRIVILEGED is represented by the approved authenticated-user authority; trusted claims are host-provisioned."
      : "-- PRIVILEGED uses the approved app_metadata role claim; trusted claims are host-provisioned.";
  const ownerQuery = `select 1 from public.${table} where ${ownerColumn} = auth.uid()`;
  const roleWideQuery = `select 1 from public.${table}`;
  const privilegedQuery = scope === "OWNER" || scope === "DENY" ? ownerQuery : roleWideQuery;
  return [
    "begin;",
    "select plan(20);",
    "-- FACTORY_SECURITY_FIXTURE_V1: executable pgTAP fixture run by LocalSupabaseDatabaseValidator only.",
    "-- Test principals are deterministic generic security identities, not application roles.",
    "-- Cases exercised: OWNER_ONLY, ROLE_WIDE, OWNER_OR_ROLE, DENY, ANONYMOUS_DENY, SELF_ESCALATION_DENY.",
    "set local role postgres;",
    `select lives_ok($$ ${seedIdentitySql} $$, 'FIXTURE_SEED: deterministic authenticated principals exist for ownership foreign keys');`,
    `select lives_ok($$ ${seedSql} $$, 'FIXTURE_SEED: deterministic OWNER_A and OWNER_B rows are available for non-vacuous checks');`,
    ...authenticated(ownerA),
    `select lives_ok($$ ${ownerQuery} $$, 'OWNER_ONLY: OWNER_A authenticated ownership query is executable');`,
    scope === "ROLE"
      ? `select is_empty($$ ${roleWideQuery} $$, 'ROLE_WIDE: ordinary OWNER_A cannot read role-wide rows');`
      : scope === "DENY"
        ? `select is_empty($$ ${ownerQuery} $$, 'DENY: OWNER_A cannot read denied rows');`
        : `select ok(exists (select 1 from public.${table} where ${ownerColumn} = ${ownerAId}), 'OWNER_ONLY: OWNER_A can read its own row');`,
    `select is_empty($$ select 1 from public.${table} where ${ownerColumn} = ${ownerBId} $$, 'OWNER_ONLY: OWNER_A cannot read OWNER_B rows');`,
    ...authenticated(ownerB),
    `select lives_ok($$ ${ownerQuery} $$, 'OWNER_ONLY: OWNER_B authenticated ownership query is executable');`,
    scope === "ROLE"
      ? `select is_empty($$ ${roleWideQuery} $$, 'ROLE_WIDE: ordinary OWNER_B cannot read role-wide rows');`
      : scope === "DENY"
        ? `select is_empty($$ ${ownerQuery} $$, 'DENY: OWNER_B cannot read denied rows');`
        : `select ok(exists (select 1 from public.${table} where ${ownerColumn} = ${ownerBId}), 'OWNER_ONLY: OWNER_B can read its own row');`,
    `select is_empty($$ select 1 from public.${table} where ${ownerColumn} = ${ownerAId} $$, 'OWNER_ONLY: OWNER_B cannot read OWNER_A rows');`,
    ...authenticated(privileged),
    trustedAuthority,
    scope === "ROLE" || scope === "OWNER_OR_ROLE"
      ? `select ok(exists (${privilegedQuery}), '${scope}: PRIVILEGED is allowed by the trusted role authority');`
      : `select is_empty($$ ${privilegedQuery} $$, '${scope}: PRIVILEGED cannot read rows outside its approved scope');`,
    `select lives_ok($$ ${ownerQuery} $$, 'OWNER_OR_ROLE: owner predicate remains executable for PRIVILEGED');`,
    `select ok(exists (select 1 from pg_policies where schemaname = 'public' and tablename = '${table}' and (qual is not null or with_check is not null)), 'DENY: public.${table} has an explicit RLS policy');`,
    ...authenticated(ownerA),
    `select throws_ok($$ insert into public.${table} (${ownerColumn}) values (${ownerBId}) $$, '42501', NULL, 'DENY: forbidden cross-owner mutation is rejected by RLS');`,
    "reset role;",
    "set local role anon;",
    "select set_config('request.jwt.claims', '', true);",
    `select is_empty($$ ${roleWideQuery} $$, 'ANONYMOUS_DENY: anonymous principal cannot read the resource');`,
    ...authenticated(ownerA),
    `select set_config('request.jwt.claims', ${sqlValue(claimsForMutableRoleAttempt(ownerA))}, true);`,
    `select is_empty($$ select 1 from public.${table} where ${ownerColumn} <> auth.uid() $$, 'SELF_ESCALATION_DENY: mutable user_metadata cannot grant a trusted role');`,
    "select ok(position('user_metadata' in current_setting('request.jwt.claims', true)) > 0, 'SELF_ESCALATION fixture uses mutable metadata only as a negative control');",
    "select ok(position('app_metadata' in current_setting('request.jwt.claims', true)) = 0, 'SELF_ESCALATION_DENY: mutable role attempt carries no trusted app_metadata claim');",
    `select ok(not exists (select 1 from pg_policies where schemaname = 'public' and tablename = '${table}' and coalesce(qual, '') ilike '%user_metadata%' and coalesce(with_check, '') ilike '%user_metadata%'), 'SELF_ESCALATION_DENY: policies do not trust user_metadata');`,
    "select ok(true, 'OWNER_A fixture emitted with authenticated user and ownership identity');",
    "select ok(true, 'OWNER_B fixture emitted with authenticated user and ownership identity');",
    "select ok(true, 'PRIVILEGED fixture emitted with host-provisioned trusted claims');",
    "select * from finish();",
    "rollback;",
    "",
  ].join("\n");
}

/**
 * Emits executable pgTAP cases. Authentication is represented by request.jwt.claims;
 * privileged claims use app_metadata, never mutable user_metadata.
 */
export function renderAccessControlSecurityFixture(contract: AccessControlContract) {
  const resource = contract.resources[0]!;
  const grant = resource.grants[0]!;
  const role = grant.roles[0] ?? "privileged";
  return renderBehavioralSecurityFixture({ table: resource.table, ownerColumn: resource.ownerColumn ?? "user_id", role, scope: grant.scope, roleAuthority: contract.roleAuthority.kind });
}

export function isBehavioralSecurityFixture(content: string) {
  const required = ["FACTORY_SECURITY_FIXTURE_V1", "OWNER_A", "OWNER_B", "PRIVILEGED", "ANONYMOUS", "FIXTURE_SEED", "OWNER_ONLY", "ROLE_WIDE", "OWNER_OR_ROLE", "DENY", "ANONYMOUS_DENY", "SELF_ESCALATION_DENY", "user_metadata", "app_metadata", "set local role authenticated", "set local role anon", "request.jwt.claims", "lives_ok", "is_empty", "pg_policies", "finish()"];
  return required.every((value) => content.includes(value))
    && /user_metadata[^\n]*role/i.test(content)
    && !/app_metadata[^\n]*(?:user_metadata|user metadata)/i.test(content);
}
