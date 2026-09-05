import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AccessControlContractSchema, checksumAccessControlContract } from "@/domain/implementation/contracts";
import { isBehavioralSecurityFixture, renderAccessControlSecurityFixture, securityTestPrincipals, SecurityTestPrincipalSchema } from "./security-fixtures";

const base = { schemaVersion: 1 as const, contractType: "AccessControlContract" as const, contractId: randomUUID(), projectId: randomUUID(), projectVersion: 1, createdAt: "2026-09-05T00:00:00.000Z", updatedAt: "2026-09-05T00:00:00.000Z", architectureChecksum: "a".repeat(64), taskGraphChecksum: "b".repeat(64), roleAuthority: { kind: "JWT_APP_METADATA" as const, claim: "role" }, resources: [{ resourceId: "records", table: "records", ownerColumn: "user_id", grants: [{ operation: "SELECT" as const, scope: "OWNER_OR_ROLE" as const, roles: ["staff"], allowedStatuses: [] }] }], requirementReferences: ["requirement:access"], policyVersion: "access-control-contract-v1" as const };
const contract = AccessControlContractSchema.parse({ ...base, checksum: checksumAccessControlContract(base) });

describe("generated database behavioral security fixtures", () => {
  it("emits every deterministic principal and behavioral case", () => {
    expect(securityTestPrincipals("staff").map((principal) => principal.identity)).toEqual(["OWNER_A", "OWNER_B", "PRIVILEGED", "ANONYMOUS"]);
    const fixture = renderAccessControlSecurityFixture(contract);
    expect(isBehavioralSecurityFixture(fixture)).toBe(true);
  });
  it("rejects malformed principals and untrusted claim placement", () => {
    expect(() => SecurityTestPrincipalSchema.parse({ identity: "ANONYMOUS", authenticationState: "ANONYMOUS", trustedRoleClaims: { role: "staff" } })).toThrow();
    expect(() => SecurityTestPrincipalSchema.parse({ identity: "OWNER_A", authenticationState: "AUTHENTICATED" })).toThrow();
  });
});
