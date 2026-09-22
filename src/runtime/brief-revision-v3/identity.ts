import { createHash } from "node:crypto";
import { z } from "zod";
import { WorkflowStateSchema } from "@/domain/project/schema";
import type { WorkflowState } from "@/domain/workflow/engine";
import { stableSerialize } from "@/domain/requirements/v3/serialization";
import type { BriefV3AssetBinding } from "./ports";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const normalizeInstruction = (value: string) => value.replace(/\r\n?/g, "\n");
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

export const RevisionCurrentnessTokenSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: z.string().uuid(),
  projectVersion: z.number().int().positive(),
  projectRowVersion: z.number().int().positive(),
  projectVersionRowVersion: z.number().int().positive(),
  workflowState: WorkflowStateSchema,
  documentType: z.string().min(1).max(120),
  briefChecksum: Sha256Schema,
  documentChecksum: Sha256Schema,
  documentRowVersion: z.number().int().positive(),
  canonicalSchemaVersion: z.literal(3),
}).strict();

export type RevisionCurrentnessToken = z.infer<typeof RevisionCurrentnessTokenSchema>;

export type BriefV3OperationIdentity = {
  operationKind: "REQUEST_BRIEF_CHANGES_V3";
  contractVersion: 1;
  projectId: string;
  projectVersion: number;
  revisionInstructionDigest: string;
  targetHints: string[];
  targetWorkflowState: WorkflowState;
  assetBindings?: BriefV3AssetBinding[];
  currentness: RevisionCurrentnessToken;
  operationKey: string;
  payloadHash: string;
};

export function createRevisionCurrentnessToken(input: Omit<RevisionCurrentnessToken, "schemaVersion" | "canonicalSchemaVersion">): RevisionCurrentnessToken {
  return RevisionCurrentnessTokenSchema.parse({ ...input, schemaVersion: 1, canonicalSchemaVersion: 3 });
}

export function createBriefV3OperationIdentity(input: { projectId: string; projectVersion: number; revisionInstruction: string; targetHints?: readonly string[]; targetWorkflowState?: WorkflowState; currentness: RevisionCurrentnessToken; assetBindings?: readonly BriefV3AssetBinding[] }): BriefV3OperationIdentity {
  const targetHints = [...new Set(input.targetHints ?? [])].sort();
  const assetBindings = [...(input.assetBindings ?? [])].map((binding) => ({ ...binding })).sort((left, right) => `${left.target}:${left.assetId}:${left.sha256}`.localeCompare(`${right.target}:${right.assetId}:${right.sha256}`));
  const revisionInstructionDigest = digest(normalizeInstruction(input.revisionInstruction));
  const identity = {
    operationKind: "REQUEST_BRIEF_CHANGES_V3" as const,
    contractVersion: 1 as const,
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    revisionInstructionDigest,
    targetHints,
    targetWorkflowState: input.targetWorkflowState ?? input.currentness.workflowState,
    currentness: RevisionCurrentnessTokenSchema.parse(input.currentness),
    ...(assetBindings.length ? { assetBindings } : {}),
  };
  const identityDigest = digest(stableSerialize(identity));
  return { ...identity, operationKey: `brief-revision-v3:${input.projectId}:${identityDigest}`, payloadHash: identityDigest };
}

export function sameRevisionCurrentness(left: RevisionCurrentnessToken, right: RevisionCurrentnessToken): boolean {
  return stableSerialize(RevisionCurrentnessTokenSchema.parse(left)) === stableSerialize(RevisionCurrentnessTokenSchema.parse(right));
}

export function normalizeRevisionInstruction(value: string): string {
  return normalizeInstruction(value);
}

export type { WorkflowState };
