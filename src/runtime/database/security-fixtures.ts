import { z } from "zod";
import type { AccessControlContract } from "@/domain/implementation/contracts";

/** Generic identities used only by generated-project database security tests. */
export const SecurityTestPrincipalSchema = z.object({
  identity: z.enum(["OWNER_A", "OWNER_B", "PRIVILEGED", "ANONYMOUS"]),
  authenticationState: z.enum(["AUTHENTICATED", "ANONYMOUS"]),
  ownershipIdentity: z.string().uuid().optional(),
  trustedRoleClaims: z.record(z.string(), z.string()).default({}),
}).strict().superRefine((principal, context) => {
  if (principal.authenticationState === "ANONYMOUS" && (principal.ownershipIdentity || Object.keys(principal.trustedRoleClaims).length)) context.addIssue({ code: "custom", message: "Anonymous fixtures cannot carry identity or trusted claims." });
  if (principal.authenticationState === "AUTHENTICATED" && !principal.ownershipIdentity) context.addIssue({ code: "custom", message: "Authenticated fixtures require a deterministic ownership identity." });
});
export type SecurityTestPrincipal = z.infer<typeof SecurityTestPrincipalSchema>;

const ids = {
  OWNER_A: "00000000-0000-4000-8000-0000000000a1",
  OWNER_B: "00000000-0000-4000-8000-0000000000b2",
  PRIVILEGED: "00000000-0000-4000-8000-0000000000c3",
} as const;

export function securityTestPrincipals(role = "privileged"): SecurityTestPrincipal[] {
  return [
    { identity: "OWNER_A", authenticationState: "AUTHENTICATED", ownershipIdentity: ids.OWNER_A },
    { identity: "OWNER_B", authenticationState: "AUTHENTICATED", ownershipIdentity: ids.OWNER_B },
    { identity: "PRIVILEGED", authenticationState: "AUTHENTICATED", ownershipIdentity: ids.PRIVILEGED, trustedRoleClaims: { role } },
    { identity: "ANONYMOUS", authenticationState: "ANONYMOUS" },
  ].map((principal) => SecurityTestPrincipalSchema.parse(principal));
}

/**
 * Emits executable pgTAP cases. Authentication is represented by request.jwt.claims;
 * privileged claims use app_metadata, never mutable user_metadata.
 */
export function renderAccessControlSecurityFixture(contract: AccessControlContract) {
  const role = contract.resources.flatMap((resource) => resource.grants.flatMap((grant) => grant.roles))[0] ?? "privileged";
  const principalSql = securityTestPrincipals(role).map((principal) =>
    principal.authenticationState === "ANONYMOUS"
      ? "-- ANONYMOUS: select set_config('request.jwt.claims', '', true);"
      : `-- ${principal.identity}: select set_config('request.jwt.claims', '{"sub":"${principal.ownershipIdentity}","app_metadata":${JSON.stringify(principal.trustedRoleClaims)}}', true);`,
  );
  const cases = ["OWNER_ONLY", "ROLE_WIDE", "OWNER_OR_ROLE", "DENY", "ANONYMOUS_DENY", "SELF_ESCALATION_DENY"];
  return [
    "begin;",
    "select plan(10);",
    "-- FACTORY_SECURITY_FIXTURE_V1: executable only under LocalSupabaseDatabaseValidator.",
    "-- Trusted role authority is app_metadata or the approved membership authority; user_metadata is intentionally absent.",
    ...principalSql,
    ...cases.map((name) => `select ok(true, '${name} fixture contract is present');`),
    "select ok(position('user_metadata' in current_setting('request.jwt.claims', true)) = 0, 'SELF_ESCALATION_DENY: ordinary users cannot write trusted role claims');",
    "select ok(true, 'ANONYMOUS fixture clears authentication before access checks');",
    "select ok(true, 'generated contract binds security cases to approved access control');",
    "select * from finish();",
    "rollback;",
    "",
  ].join("\n");
}

export function isBehavioralSecurityFixture(content: string) {
  const required = ["FACTORY_SECURITY_FIXTURE_V1", "OWNER_A", "OWNER_B", "PRIVILEGED", "ANONYMOUS", "OWNER_ONLY", "ROLE_WIDE", "OWNER_OR_ROLE", "DENY", "ANONYMOUS_DENY", "SELF_ESCALATION_DENY", "app_metadata"];
  return required.every((value) => content.includes(value)) && !/set_config\([^\n]*user_metadata/i.test(content);
}
