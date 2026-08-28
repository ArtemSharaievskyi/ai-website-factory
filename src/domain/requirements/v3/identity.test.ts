import { describe, expect, it } from "vitest";
import { CanonicalBriefV3Schema } from "./schema";
import { cleanBriefV3 } from "./fixtures";
import {
  assertCurrentV3RequirementNamespace,
  bindProviderRequirementIdentities,
  canonicalizeLegacyBriefV3WithLineage,
  createRequirementProposalHandles,
  createV3RequirementId,
  createV3RequirementIdentity,
  isLegacyRequirementId,
  isV3RequirementId,
} from "./identity";
import type { BriefChange } from "./changeset";

const projectId = "11111111-1111-4111-8111-111111111111";
const otherProjectId = "22222222-2222-4222-8222-222222222222";

describe("host-owned V3 requirement identity", () => {
  it("is deterministic, project/version scoped, and independent of mutable wording", () => {
    const first = createV3RequirementIdentity({ projectId, projectVersion: 1, stableSemanticKey: "page:home:primary-purpose" });
    const same = createV3RequirementIdentity({ projectId, projectVersion: 1, stableSemanticKey: "page:home:primary-purpose" });
    expect(first).toEqual(same);
    expect(createV3RequirementId({ projectId, projectVersion: 1, stableSemanticKey: "page:home:other-purpose" })).not.toBe(first.requirementId);
    expect(createV3RequirementId({ projectId: otherProjectId, projectVersion: 1, stableSemanticKey: "page:home:primary-purpose" })).not.toBe(first.requirementId);
    expect(createV3RequirementId({ projectId, projectVersion: 2, stableSemanticKey: "page:home:primary-purpose" })).not.toBe(first.requirementId);
    expect(isV3RequirementId(first.requirementId)).toBe(true);
    expect(isLegacyRequirementId("REQUIREMENT:legacy-v1-old-source")).toBe(true);
  });

  it("converts historical legacy IDs with one immutable lineage per source", () => {
    const historical = CanonicalBriefV3Schema.parse({
      ...cleanBriefV3,
      requirements: cleanBriefV3.requirements.map((entry, index) => ({ ...entry, id: `REQUIREMENT:legacy-v1-source-${index}` })),
    });
    const converted = canonicalizeLegacyBriefV3WithLineage(historical, { projectId, projectVersion: 1 });
    expect(converted.lineage).toHaveLength(historical.requirements.length);
    expect(converted.lineage.every((entry) => entry.fromNamespace === "legacy-v1" && isV3RequirementId(entry.toRequirementId))).toBe(true);
    expect(converted.brief.requirements.every((entry) => isV3RequirementId(entry.id))).toBe(true);
    expect(converted.brief.requirements.map((entry) => entry.statement)).toEqual(historical.requirements.map((entry) => entry.statement));
  });

  it("rejects conflicting canonical evidence under one legacy source ID", () => {
    const source = "REQUIREMENT:legacy-v1-conflicting-source";
    const historical = CanonicalBriefV3Schema.parse({
      ...cleanBriefV3,
      requirements: [{ ...cleanBriefV3.requirements[0]!, id: source }, { ...cleanBriefV3.requirements[1]!, id: source, statement: "Conflicting historical evidence." }],
    });
    expect(() => canonicalizeLegacyBriefV3WithLineage(historical, { projectId, projectVersion: 1 })).toThrow("BRIEF_V3_IDENTITY_AMBIGUOUS");
  });

  it("accepts historical structural state only through the explicit namespace guard", () => {
    const historical = CanonicalBriefV3Schema.parse({ ...cleanBriefV3, requirements: [{ ...cleanBriefV3.requirements[0]!, id: "REQUIREMENT:legacy-v2-historical" }] });
    expect(isLegacyRequirementId(historical.requirements[0]!.id)).toBe(true);
    expect(() => assertCurrentV3RequirementNamespace(historical)).toThrow("BRIEF_V3_IDENTITY_INVALID");
  });

  it("binds only host-issued new-requirement handles before reduction", () => {
    const handle = createRequirementProposalHandles({ projectId, projectVersion: 1, operationKey: "synthetic-operation" })[0]!;
    const bound = bindProviderRequirementIdentities({
      current: cleanBriefV3,
      projectId,
      projectVersion: 1,
      proposalHandles: [handle],
      changeSet: { contractVersion: 1, unresolved: [], changes: [{ operation: "UPSERT", target: `REQUIREMENT:NEW:${handle}`, value: { category: "FEATURE", statement: "A host-bound synthetic requirement.", sourceRefs: ["fixture"] } }] },
    });
    expect(bound.changes[0]?.target).toBe(createV3RequirementId({ projectId, projectVersion: 1, stableSemanticKey: `provider-slot:${handle}` }));
    expect(() => bindProviderRequirementIdentities({ current: cleanBriefV3, projectId, projectVersion: 1, proposalHandles: [handle], changeSet: { contractVersion: 1, unresolved: [], changes: [{ operation: "UPSERT", target: "REQUIREMENT:v3-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", value: { category: "FEATURE", statement: "Provider-authored canonical ID.", sourceRefs: ["fixture"] } }] } })).toThrow("BRIEF_V3_IDENTITY_INVALID");
  });

  it("fails host binding closed for a duplicate handle", () => {
    const handle = createRequirementProposalHandles({ projectId, projectVersion: 1, operationKey: "duplicate-operation" })[0]!;
    const change: BriefChange = { operation: "UPSERT", target: `REQUIREMENT:NEW:${handle}`, value: { category: "FEATURE", statement: "Duplicate proposal.", sourceRefs: ["fixture"] } };
    expect(() => bindProviderRequirementIdentities({ current: cleanBriefV3, projectId, projectVersion: 1, proposalHandles: [handle], changeSet: { contractVersion: 1, unresolved: [], changes: [change, change] } })).toThrow("BRIEF_V3_IDENTITY_INVALID");
  });

});
