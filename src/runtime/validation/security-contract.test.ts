import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AccessControlContractSchema, checksumAccessControlContract } from "@/domain/implementation/contracts";
import { validateGeneratedRlsPolicyAgainstContract } from "./security";

const base = { schemaVersion: 1 as const, contractType: "AccessControlContract" as const, contractId: randomUUID(), projectId: randomUUID(), projectVersion: 1, createdAt: "2026-09-05T08:00:00.000Z", updatedAt: "2026-09-05T08:00:00.000Z", architectureChecksum: "a".repeat(64), taskGraphChecksum: "b".repeat(64), roleAuthority: { kind: "JWT_APP_METADATA" as const, claim: "role" }, resources: [{ resourceId: "requests", table: "service_requests", ownerColumn: "requester_id", statusColumn: "status", grants: [{ operation: "SELECT" as const, scope: "OWNER_OR_ROLE" as const, roles: ["staff"], allowedStatuses: ["submitted"] }, { operation: "INSERT" as const, scope: "OWNER" as const, roles: [], allowedStatuses: ["submitted"] }] }], requirementReferences: ["REQUIREMENT:request-access"], policyVersion: "access-control-contract-v1" as const };
const contract = AccessControlContractSchema.parse({ ...base, checksum: checksumAccessControlContract(base) });
const valid = `
alter table public.service_requests enable row level security;
create policy request_read on public.service_requests for select to authenticated using ((auth.uid() = requester_id or (auth.jwt() -> 'app_metadata' ->> 'role') = 'staff') and status = 'submitted');
create policy request_insert on public.service_requests for insert to authenticated with check (auth.uid() = requester_id and status = 'submitted');
`;

describe("contract-aware generated RLS validation", () => {
  it("accepts an owner-or-trusted-role read policy plus an owner-only insert", () => expect(() => validateGeneratedRlsPolicyAgainstContract(valid, contract)).not.toThrow());
  it("rejects user-controlled role metadata", () => expect(() => validateGeneratedRlsPolicyAgainstContract(valid.replace("app_metadata", "user_metadata"), contract)).toThrow(/metadata|broad/i));
  it("rejects a missing status guard", () => expect(() => validateGeneratedRlsPolicyAgainstContract(valid.replaceAll("and status = 'submitted'", ""), contract)).toThrow(/status/i));
  it("rejects a role policy that omits owner access", () => expect(() => validateGeneratedRlsPolicyAgainstContract(valid.replace("auth.uid() = requester_id or ", ""), contract)).toThrow(/OWNER_OR_ROLE/i));
});
