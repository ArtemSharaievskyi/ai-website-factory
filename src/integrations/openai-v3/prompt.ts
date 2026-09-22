import { createHash } from "node:crypto";
import { canonicalBriefChecksum } from "@/domain/requirements/v3/normalize";
import { validateCanonicalBriefV3 } from "@/domain/requirements/v3/invariants";
import { assembleContext, contextBundleMetadata, renderContextItems, type ContextCandidate } from "@/runtime/context/assembler";
import { CONTEXT_BUDGET_PROFILES, type ContextBundle, type ContextPriority } from "@/runtime/context/contracts";
import { providerTargetContract } from "./changeset";
import type { CanonicalBriefV3 } from "@/domain/requirements/v3/schema";

export const BRIEF_V3_PROVIDER_SCHEMA_NAME = "brief-revision-v3";
export const BRIEF_V3_PROVIDER_PROMPT_VERSION = "brief-revision-v3.v2";

export type BriefV3SupportingContext = {
  sourceRef: string;
  content: string;
  selectionReason: string;
  priority: ContextPriority;
};

export type BriefV3RevisionProviderInput = {
  revisionInstruction: string;
  currentCanonicalV3: CanonicalBriefV3;
  supportingContext?: readonly BriefV3SupportingContext[];
  newRequirementHandles?: readonly string[];
};

export type BriefV3RevisionPrompt = {
  promptVersion: string;
  system: string;
  user: string;
  contextBundle: ContextBundle;
  promptPrefixChecksum: string;
  promptPrefixBytes: number;
};

const BRIEF_V3_PROVIDER_POLICY = [
  "Interpret the requested revision and emit only semantic SET, UPSERT, and REMOVE operations.",
  "Do not regenerate a full Brief, candidate, requirement collection, history, approval, checksum, identity, currentness, or persistence state.",
  "Do not explicitly preserve untouched fields; the host owns preservation through the current canonical state.",
  "Canonical customer-confirmed public contact email is host-owned and is preserved from current state; it is not a provider-writable target.",
  "Use only the semantic target contract supplied below and the strict output schema.",
  "Do not resolve contradictions by choosing a winner. Emit the requested operations and let deterministic host normalization reject conflicts.",
  "Semantic target IDs are the only mutation authority; never use prose as a target.",
  "For a new requirement, use only a host-issued REQUIREMENT:NEW:<handle> target from the supplied handle list; never invent a canonical requirement ID.",
].join(" ");

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function canonicalContextContent(input: BriefV3RevisionProviderInput) {
  return JSON.stringify({
    revisionInstruction: input.revisionInstruction,
    currentCanonicalV3: validateCanonicalBriefV3(input.currentCanonicalV3),
    newRequirementHandles: input.newRequirementHandles ?? [],
  });
}

/** Build the isolated V3 provider context without using the legacy Lead/V2 prompt. */
export function buildBriefV3RevisionPrompt(input: BriefV3RevisionProviderInput): BriefV3RevisionPrompt {
  const current = validateCanonicalBriefV3(input.currentCanonicalV3);
  const canonicalContent = canonicalContextContent({ ...input, currentCanonicalV3: current });
  const targetContractContent = JSON.stringify({ targets: providerTargetContract() });
  const candidates: ContextCandidate[] = [
    {
      kind: "CANONICAL_CONTRACT",
      authority: "CANONICAL_REQUIREMENT",
      canonicalDocumentType: "BriefRevisionInstruction",
      sourceRef: "canonical:brief-revision-v3",
      selectionReason: "Lossless user revision and current canonical V3 semantic state.",
      priority: "HIGH",
      required: true,
      content: canonicalContent,
    },
    {
      kind: "STRUCTURAL_RELATION",
      authority: "SUPPORTING_TECHNICAL",
      sourceRef: "contract:brief-revision-v3-targets",
      selectionReason: "Host-owned V3 target and operation contract.",
      priority: "HIGH",
      required: true,
      content: targetContractContent,
    },
    ...(input.supportingContext ?? []).map((item) => ({
      kind: "EVIDENCE_SLICE" as const,
      authority: "SUPPORTING_TECHNICAL" as const,
      sourceRef: item.sourceRef,
      selectionReason: item.selectionReason,
      priority: item.priority,
      content: item.content,
    })),
  ];
  const result = assembleContext({
    agentId: "lead-brief-v3",
    agentRole: "lead",
    workflowStage: "brief-revision-v3",
    currentnessIdentity: canonicalBriefChecksum(current),
    candidates,
    budget: CONTEXT_BUDGET_PROFILES.default,
  });
  if (result.status === "BLOCKED") throw new Error(`CONTEXT_ASSEMBLY_BLOCKED:${result.blocker.code}`);
  const system = `${BRIEF_V3_PROVIDER_POLICY} The provider output schema is ${BRIEF_V3_PROVIDER_SCHEMA_NAME}; its contractVersion is 1 and its changes array is the complete provider authority. The target descriptions are supporting guidance only; the host schema and mapper remain authoritative. Host-issued new requirement handles are included in the canonical context; they are single-use proposal slots, not canonical identities.`;
  return {
    promptVersion: BRIEF_V3_PROVIDER_PROMPT_VERSION,
    system,
    user: `${JSON.stringify(contextBundleMetadata(result.bundle))}\n${renderContextItems(result.bundle.selectedItems)}`,
    contextBundle: result.bundle,
    promptPrefixChecksum: digest(JSON.stringify({ promptVersion: BRIEF_V3_PROVIDER_PROMPT_VERSION, system })),
    promptPrefixBytes: Buffer.byteLength(system, "utf8"),
  };
}
