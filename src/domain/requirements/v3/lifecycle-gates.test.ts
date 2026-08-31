import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalBriefChecksum } from "./normalize";
import { cleanBriefV3 } from "./fixtures";
import {
  evaluateRealFormProcessingGate,
  evaluateReleaseLifecycleGates,
  hasExplicitRealFormProcessingApproval,
  REAL_FORM_PROCESSING_APPROVAL_CATEGORY,
  REAL_FORM_PROCESSING_APPROVAL_DECISION,
} from "./lifecycle-gates";
import { CanonicalBriefV3Schema } from "./schema";

const timestamp = "2026-01-01T00:00:00.000Z";
const approval = (briefChecksum: string, overrides: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  timestamp,
  actorType: "user" as const,
  actorIdentifier: "synthetic-user",
  category: REAL_FORM_PROCESSING_APPROVAL_CATEGORY,
  decision: REAL_FORM_PROCESSING_APPROVAL_DECISION,
  rationale: "Synthetic explicit approval for real form processing.",
  affectedDocuments: [`brief-v3:${briefChecksum}`],
  requirementChange: false,
  userApprovalRequired: true,
  userApprovalStatus: "approved" as const,
  ...overrides,
});

const realFormBrief = CanonicalBriefV3Schema.parse({
  ...cleanBriefV3,
  decisions: {
    ...cleanBriefV3.decisions,
    form: {
      ...cleanBriefV3.decisions.form,
      mode: "REAL",
      transmissionMode: "EMAIL",
    },
  },
});

describe("canonical lifecycle gate ownership", () => {
  it("keeps simulated Design form UX free of a processing gate", () => {
    const result = evaluateRealFormProcessingGate({ brief: cleanBriefV3, decisions: [], approvedBriefChecksum: canonicalBriefChecksum(cleanBriefV3) });
    expect(result).toMatchObject({ owner: "IMPLEMENTATION", required: false, allowed: true, blockers: [] });
  });

  it("does not treat generic project or Brief approval as real form approval", () => {
    const checksum = canonicalBriefChecksum(realFormBrief);
    const generic = approval(checksum, { category: "brief-approval", decision: "APPROVED" });
    expect(hasExplicitRealFormProcessingApproval({ decisions: [generic], approvedBriefChecksum: checksum })).toBe(false);
    expect(evaluateRealFormProcessingGate({ brief: realFormBrief, decisions: [generic], approvedBriefChecksum: checksum })).toMatchObject({ required: true, approved: false, allowed: false });
  });

  it("activates real form processing only for the current explicit approval", () => {
    const checksum = canonicalBriefChecksum(realFormBrief);
    expect(evaluateRealFormProcessingGate({ brief: realFormBrief, decisions: [approval(checksum)], approvedBriefChecksum: checksum })).toMatchObject({ required: true, approved: true, allowed: true, blockers: [] });
    expect(evaluateRealFormProcessingGate({ brief: realFormBrief, decisions: [approval("f".repeat(64))], approvedBriefChecksum: checksum })).toMatchObject({ required: true, approved: false, allowed: false });
  });

  it("keeps unresolved legal evidence as a hard publication gate", () => {
    const result = evaluateReleaseLifecycleGates({ brief: cleanBriefV3, decisions: [], approvedBriefChecksum: canonicalBriefChecksum(cleanBriefV3) });
    expect(result.ready).toBe(false);
    expect(result.publicationReady).toBe(false);
    expect(result.blockers).toContain("FINAL_LEGAL_FACTS_REQUIRED");
    expect(result.formProcessing.allowed).toBe(true);
  });

  it("allows publication only after legal facts are resolved", () => {
    const resolved = CanonicalBriefV3Schema.parse({ ...cleanBriefV3, legal: { ...cleanBriefV3.legal, placeholderPolicy: "NO_PLACEHOLDERS" } });
    const result = evaluateReleaseLifecycleGates({ brief: resolved, decisions: [], approvedBriefChecksum: canonicalBriefChecksum(resolved) });
    expect(result).toMatchObject({ ready: true, publicationReady: true, blockers: [] });
  });
});
