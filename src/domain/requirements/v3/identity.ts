import { createHash } from "node:crypto";
import { z } from "zod";
import { UuidSchema, NonEmptyStringSchema, ProjectVersionSchema, IsoDateTimeSchema } from "@/domain/shared/schemas";
import { BriefV3Error } from "./errors";
import type { CanonicalBriefV3, CanonicalRequirement } from "./schema";
import { CanonicalBriefV3Schema, CanonicalRequirementSchema } from "./schema";
import { stableSerialize } from "./serialization";
import type { BriefChange, BriefChangeSet } from "./changeset";

/** The only namespace that may be used for newly-created current V3 requirements. */
export const V3_REQUIREMENT_NAMESPACE = "v3" as const;
export const REQUIREMENT_IDENTITY_POLICY_VERSION = "requirement-identity-v3.v1" as const;

const V3_REQUIREMENT_ID_PATTERN = /^REQUIREMENT:v3-[a-f0-9]{64}$/;
const LEGACY_REQUIREMENT_ID_PATTERN = /^REQUIREMENT:legacy-v([12])-[A-Za-z0-9_.:-]{1,180}$/;
const LINEAGE_ID_PATTERN = /^lineage:v3-[a-f0-9]{64}$/;
const StableSemanticKeySchema = NonEmptyStringSchema.max(300).refine((value) => !/[\r\n]/.test(value), "Stable semantic keys must be single-line.");

export const RequirementIdentitySchema = z.object({
  requirementId: z.string().regex(V3_REQUIREMENT_ID_PATTERN),
  namespace: z.literal(V3_REQUIREMENT_NAMESPACE),
  projectId: UuidSchema,
  projectVersion: ProjectVersionSchema,
  stableSemanticKey: StableSemanticKeySchema,
}).strict();
export type RequirementIdentity = z.infer<typeof RequirementIdentitySchema>;

export const LegacyRequirementNamespaceSchema = z.enum(["legacy-v1", "legacy-v2"]);
export type LegacyRequirementNamespace = z.infer<typeof LegacyRequirementNamespaceSchema>;

function deterministicLineageId(input: { projectId: string; projectVersion: number; fromNamespace: LegacyRequirementNamespace; fromRequirementId: string; toRequirementId: string; canonicalSemanticIdentity: string }): string {
  return `lineage:v3-${createHash("sha256").update(stableSerialize({
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    fromNamespace: input.fromNamespace,
    fromRequirementId: input.fromRequirementId,
    toRequirementId: input.toRequirementId,
    canonicalSemanticIdentity: input.canonicalSemanticIdentity,
    migrationPolicyVersion: REQUIREMENT_IDENTITY_POLICY_VERSION,
  }), "utf8").digest("hex")}`;
}

export const RequirementIdentityLineageSchema = z.object({
  lineageId: z.string().regex(LINEAGE_ID_PATTERN),
  projectId: UuidSchema,
  projectVersion: ProjectVersionSchema,
  fromNamespace: LegacyRequirementNamespaceSchema,
  fromRequirementId: z.string().regex(LEGACY_REQUIREMENT_ID_PATTERN),
  toNamespace: z.literal(V3_REQUIREMENT_NAMESPACE),
  toRequirementId: z.string().regex(V3_REQUIREMENT_ID_PATTERN),
  canonicalSemanticIdentity: StableSemanticKeySchema,
  migrationPolicyVersion: z.literal(REQUIREMENT_IDENTITY_POLICY_VERSION),
}).strict().superRefine((value, context) => {
  if (!value.fromRequirementId.startsWith(`REQUIREMENT:${value.fromNamespace}-`)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["fromRequirementId"], message: "Legacy namespace and source requirement ID must agree." });
  if (value.lineageId !== deterministicLineageId(value)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["lineageId"], message: "Lineage IDs must be deterministic host-owned identities." });
});
export type RequirementIdentityLineage = z.infer<typeof RequirementIdentityLineageSchema>;

/** Database-facing immutable lineage record. */
export const RequirementIdentityLineageRecordSchema = RequirementIdentityLineageSchema.extend({ createdAt: IsoDateTimeSchema }).strict();
export type RequirementIdentityLineageRecord = z.infer<typeof RequirementIdentityLineageRecordSchema>;

export const RequirementIdentityMigrationRecordSchema = z.object({
  migrationId: NonEmptyStringSchema.max(180),
  projectId: UuidSchema,
  projectVersion: ProjectVersionSchema,
  planChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  previousBriefChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  nextBriefChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  previousPlanningSemanticChecksum: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  nextPlanningSemanticChecksum: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  migrationPolicyVersion: z.literal(REQUIREMENT_IDENTITY_POLICY_VERSION),
  createdAt: IsoDateTimeSchema,
}).strict();
export type RequirementIdentityMigrationRecord = z.infer<typeof RequirementIdentityMigrationRecordSchema>;

export const isV3RequirementId = (value: string): boolean => V3_REQUIREMENT_ID_PATTERN.test(value);
export const isLegacyRequirementId = (value: string): boolean => LEGACY_REQUIREMENT_ID_PATTERN.test(value);

function identityDigest(input: { projectId: string; projectVersion: number; stableSemanticKey: string }): string {
  return createHash("sha256").update(stableSerialize({
    namespace: V3_REQUIREMENT_NAMESPACE,
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    stableSemanticKey: input.stableSemanticKey,
  }), "utf8").digest("hex");
}

/** Host-owned deterministic identity. Mutable statement/display text is not an input. */
export function createV3RequirementIdentity(input: { projectId: string; projectVersion: number; stableSemanticKey: string }): RequirementIdentity {
  const stableSemanticKey = StableSemanticKeySchema.parse(input.stableSemanticKey);
  return RequirementIdentitySchema.parse({
    requirementId: `REQUIREMENT:v3-${identityDigest({ ...input, stableSemanticKey })}`,
    namespace: V3_REQUIREMENT_NAMESPACE,
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    stableSemanticKey,
  });
}

export function createV3RequirementId(input: { projectId: string; projectVersion: number; stableSemanticKey: string }): string {
  return createV3RequirementIdentity(input).requirementId;
}

/** Host-issued handles let a provider request a new requirement without authoring its canonical identity. */
export function createRequirementProposalHandles(input: { projectId: string; projectVersion: number; operationKey: string; count?: number }): readonly string[] {
  const count = Math.max(1, Math.min(input.count ?? 16, 32));
  return Array.from({ length: count }, (_, index) => `slot-${createHash("sha256").update(stableSerialize({ namespace: V3_REQUIREMENT_NAMESPACE, projectId: input.projectId, projectVersion: input.projectVersion, operationKey: input.operationKey, index }), "utf8").digest("hex").slice(0, 24)}`);
}

const NEW_REQUIREMENT_TARGET_PATTERN = /^REQUIREMENT:NEW:([A-Za-z0-9-]{1,80})$/;

/** Bind provider proposal handles to host-owned V3 IDs before reduction or persistence. */
export function bindProviderRequirementIdentities(input: { changeSet: BriefChangeSet; current: CanonicalBriefV3; projectId: string; projectVersion: number; proposalHandles: readonly string[]; allowProviderProposalLabels?: boolean }): BriefChangeSet {
  const currentIds = new Set(canonicalRequirementEntries(input.current).map((entry) => entry.id));
  const allowedHandles = new Set(input.proposalHandles);
  const usedHandles = new Set<string>();
  const changes = input.changeSet.changes.map((change): BriefChange => {
    if (!change.target.startsWith("REQUIREMENT:")) return change;
    const proposal = NEW_REQUIREMENT_TARGET_PATTERN.exec(change.target);
    if (proposal) {
      if (change.operation !== "UPSERT" || !allowedHandles.has(proposal[1]) || usedHandles.has(proposal[1])) throw new BriefV3Error("BRIEF_V3_IDENTITY_INVALID", { target: change.target });
      usedHandles.add(proposal[1]);
      return { ...change, target: createV3RequirementId({ projectId: input.projectId, projectVersion: input.projectVersion, stableSemanticKey: `provider-slot:${proposal[1]}` }) } as BriefChange;
    }
    if (!currentIds.has(change.target)) {
      if (input.allowProviderProposalLabels && change.operation === "UPSERT" && !isV3RequirementId(change.target) && !isLegacyRequirementId(change.target)) return { ...change, target: createV3RequirementId({ projectId: input.projectId, projectVersion: input.projectVersion, stableSemanticKey: `provider-label:${change.target}` }) } as BriefChange;
      throw new BriefV3Error("BRIEF_V3_IDENTITY_INVALID", { target: change.target });
    }
    if (isLegacyRequirementId(change.target)) throw new BriefV3Error("BRIEF_V3_IDENTITY_INVALID", { target: change.target });
    return change;
  });
  return { ...input.changeSet, changes };
}

export function createRequirementIdentityLineage(input: {
  projectId: string;
  projectVersion: number;
  fromRequirementId: string;
  canonicalSemanticIdentity: string;
}): RequirementIdentityLineage {
  const fromNamespace = legacyNamespaceForId(input.fromRequirementId);
  const identity = createV3RequirementIdentity({ projectId: input.projectId, projectVersion: input.projectVersion, stableSemanticKey: input.canonicalSemanticIdentity });
  const lineageId = deterministicLineageId({ projectId: input.projectId, projectVersion: input.projectVersion, fromNamespace, fromRequirementId: input.fromRequirementId, toRequirementId: identity.requirementId, canonicalSemanticIdentity: input.canonicalSemanticIdentity });
  return RequirementIdentityLineageSchema.parse({
    lineageId,
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    fromNamespace,
    fromRequirementId: input.fromRequirementId,
    toNamespace: V3_REQUIREMENT_NAMESPACE,
    toRequirementId: identity.requirementId,
    canonicalSemanticIdentity: input.canonicalSemanticIdentity,
    migrationPolicyVersion: REQUIREMENT_IDENTITY_POLICY_VERSION,
  });
}

export function legacyNamespaceForId(value: string): LegacyRequirementNamespace {
  const match = LEGACY_REQUIREMENT_ID_PATTERN.exec(value);
  if (!match) throw new BriefV3Error("BRIEF_V3_IDENTITY_INVALID", { requirementId: value });
  return `legacy-v${match[1]}` as LegacyRequirementNamespace;
}

/** Current documents may not introduce a legacy identity. Historical documents remain readable by the structural schema. */
export function assertCurrentV3RequirementNamespace(brief: CanonicalBriefV3): CanonicalBriefV3 {
  const entries = canonicalRequirementEntries(brief);
  const legacy = entries.find((entry) => isLegacyRequirementId(entry.id));
  if (legacy) throw new BriefV3Error("BRIEF_V3_IDENTITY_INVALID", { requirementId: legacy.id });
  return brief;
}

export function canonicalRequirementEntries(brief: CanonicalBriefV3): readonly CanonicalRequirement[] {
  return [...brief.requirements, ...brief.decisions.form.interactionStates, ...brief.seo.locationTargeting];
}

export function mapCanonicalBriefRequirementIds(briefInput: CanonicalBriefV3, mappings: ReadonlyMap<string, string>): CanonicalBriefV3 {
  const brief = CanonicalBriefV3Schema.parse(briefInput);
  const mapEntry = (entry: CanonicalRequirement): CanonicalRequirement => CanonicalRequirementSchema.parse({ ...entry, id: mappings.get(entry.id) ?? entry.id });
  return CanonicalBriefV3Schema.parse({
    ...brief,
    requirements: brief.requirements.map(mapEntry),
    decisions: { ...brief.decisions, form: { ...brief.decisions.form, interactionStates: brief.decisions.form.interactionStates.map(mapEntry) } },
    seo: { ...brief.seo, locationTargeting: brief.seo.locationTargeting.map(mapEntry) },
  });
}

function stableLegacyKey(entry: CanonicalRequirement): string {
  // Legacy IDs are the only identity already persisted by V1/V2. Source
  // collection indexes are documentary and may change when a collection is
  // reordered; the V3 mapping remains bound to the historical source ID.
  return `legacy-id:${entry.id}`;
}

export type CanonicalizedLegacyBriefV3 = {
  brief: CanonicalBriefV3;
  lineage: readonly RequirementIdentityLineage[];
};

/** Convert a legacy-derived V3 shape to current IDs using only host evidence. */
export function canonicalizeLegacyBriefV3WithLineage(input: CanonicalBriefV3, scope: { projectId: string; projectVersion: number }): CanonicalizedLegacyBriefV3 {
  const brief = CanonicalBriefV3Schema.parse(input);
  const mappings = new Map<string, string>();
  const lineage: RequirementIdentityLineage[] = [];
  const keys = new Map<string, string>();
  const evidence = new Map<string, string>();
  for (const entry of canonicalRequirementEntries(brief)) {
    if (!isLegacyRequirementId(entry.id)) continue;
    const stableSemanticKey = stableLegacyKey(entry);
    const previousSource = keys.get(stableSemanticKey);
    if (previousSource && previousSource !== entry.id) throw new BriefV3Error("BRIEF_V3_IDENTITY_AMBIGUOUS", { requirementId: entry.id });
    keys.set(stableSemanticKey, entry.id);
    const currentEvidence = stableSerialize({ category: entry.category, statement: entry.statement, sourceRefs: entry.sourceRefs });
    const previousEvidence = evidence.get(entry.id);
    if (previousEvidence && previousEvidence !== currentEvidence) throw new BriefV3Error("BRIEF_V3_IDENTITY_AMBIGUOUS", { requirementId: entry.id });
    evidence.set(entry.id, currentEvidence);
    const record = createRequirementIdentityLineage({ projectId: scope.projectId, projectVersion: scope.projectVersion, fromRequirementId: entry.id, canonicalSemanticIdentity: stableSemanticKey });
    const previousTarget = mappings.get(entry.id);
    if (previousTarget && previousTarget !== record.toRequirementId) throw new BriefV3Error("BRIEF_V3_IDENTITY_AMBIGUOUS", { requirementId: entry.id });
    mappings.set(entry.id, record.toRequirementId);
    if (!lineage.some((candidate) => candidate.fromRequirementId === record.fromRequirementId)) lineage.push(record);
  }
  const next = mapCanonicalBriefRequirementIds(brief, mappings);
  return { brief: assertCurrentV3RequirementNamespace(next), lineage };
}

/** Replace exact host-issued identity values only in explicit requirementReferences fields. */
export function mapRequirementIdentitiesDeep<T>(value: T, mappings: ReadonlyMap<string, string>): T {
  if (Array.isArray(value)) return value.map((item) => mapRequirementIdentitiesDeep(item, mappings)) as T;
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, key === "requirementReferences" && Array.isArray(child)
    ? child.map((reference) => typeof reference === "string" ? mappings.get(reference) ?? reference : reference)
    : mapRequirementIdentitiesDeep(child, mappings)])) as T;
}
