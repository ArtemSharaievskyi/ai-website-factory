import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AccessControlContractSchema, SpecialistHandoffSchema, checksumAccessControlContract, checksumSpecialistHandoff, createCrossDomainChangeProposal, validateAccessControlContract, validateSpecialistHandoff } from "./contracts";

const hash = (character: string) => character.repeat(64);
const timestamp = "2026-09-05T08:00:00.000Z";

describe("typed implementation boundary contracts", () => {
  it("represents owner, role, organization, and status-aware access without trusting user metadata", () => {
    const base = { schemaVersion: 1 as const, contractType: "AccessControlContract" as const, contractId: randomUUID(), projectId: randomUUID(), projectVersion: 1, createdAt: timestamp, updatedAt: timestamp, architectureChecksum: hash("a"), taskGraphChecksum: hash("b"), roleAuthority: { kind: "JWT_APP_METADATA" as const, claim: "role" }, resources: [{ resourceId: "service-requests", table: "service_requests", ownerColumn: "requester_id", organizationColumn: "organization_id", statusColumn: "status", grants: [{ operation: "SELECT" as const, scope: "OWNER_OR_ROLE" as const, roles: ["staff"], allowedStatuses: ["submitted", "in_progress"] }, { operation: "INSERT" as const, scope: "OWNER" as const, roles: [], allowedStatuses: ["submitted"] }] }], requirementReferences: ["REQUIREMENT:service-request-access"], policyVersion: "access-control-contract-v1" as const };
    const contract = AccessControlContractSchema.parse({ ...base, checksum: checksumAccessControlContract(base) });
    expect(validateAccessControlContract(contract).resources[0]?.grants).toHaveLength(2);
    expect(() => AccessControlContractSchema.parse({ ...contract, roleAuthority: { kind: "JWT_APP_METADATA", claim: "user_metadata.role" } })).toThrow();
  });
  it("rejects a specialist profile/domain mismatch and stale handoff", () => {
    const base = { schemaVersion: 1 as const, contractType: "SpecialistHandoff" as const, handoffId: randomUUID(), projectId: randomUUID(), projectVersion: 1, taskId: randomUUID(), domain: "DATABASE" as const, specialistProfileId: "database-implementation" as const, sourceChecksums: { brief: hash("a"), planning: hash("b"), architecture: hash("c"), design: hash("d"), taskGraph: hash("e") }, taskContractChecksum: hash("f"), inputArtifactChecksums: {}, allowedContextCategories: ["approved-requirements", "database-contracts"], fileScopes: ["supabase/**"], allowedTools: [], allowedSkillIds: [], budget: { maxContextBytes: 12000, maxProviderRequests: 1, maxRetries: 0 as const, maxCorrections: 0 as const }, acceptanceCriteria: ["Database contract is satisfied."], createdAt: timestamp, policyVersion: "implementation-handoff-v1" as const };
    const handoff = SpecialistHandoffSchema.parse({ ...base, checksum: checksumSpecialistHandoff(base) });
    expect(validateSpecialistHandoff(handoff).domain).toBe("DATABASE");
    expect(() => SpecialistHandoffSchema.parse({ ...handoff, specialistProfileId: "frontend-implementation" })).toThrow();
    expect(() => validateSpecialistHandoff({ ...handoff, fileScopes: ["src/**"] })).toThrow(/STALE/);
  });
  it("keeps cross-domain requests pending until a host approves the exact checksum", () => {
    const proposal = createCrossDomainChangeProposal({ projectId: randomUUID(), projectVersion: 1, sourceTaskId: randomUUID(), sourceDomain: "BACKEND", targetDomain: "DATABASE", requestedFileScopes: ["supabase/migrations/20260905000000_add_index.sql"], rationale: "A new backend query requires an indexed database field.", requestedContractDelta: [{ contractId: "access-control", change: "Add the approved indexed field.", compatibleWithArchitecture: true }], canonicalImpact: "IMPLEMENTATION_CONTRACT_REPAIR", currentness: { taskGraphChecksum: hash("a"), architectureChecksum: hash("b"), sourceArtifactChecksum: hash("c"), workspaceChecksum: hash("d") }, affectedContractIds: ["access-control"], createdAt: timestamp });
    expect(proposal.status).toBe("PENDING");
    expect(proposal.checksum).toMatch(/^[a-f0-9]{64}$/);
  });
});
