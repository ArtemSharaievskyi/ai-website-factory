import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { DocumentBaseSchema, IsoDateTimeSchema, NonEmptyStringSchema, ProjectVersionSchema, UuidSchema } from "@/domain/shared/schemas";
import { stableValue } from "@/persistence/database/serialization";

export const IMPLEMENTATION_HANDOFF_POLICY_VERSION = "implementation-handoff-v1";
export const ACCESS_CONTROL_POLICY_VERSION = "access-control-contract-v1";
export const CROSS_DOMAIN_CHANGE_POLICY_VERSION = "cross-domain-change-v1";
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const ImplementationDomainSchema = z.enum(["FRONTEND", "BACKEND", "DATABASE"]);

export const AccessOperationSchema = z.enum(["SELECT", "INSERT", "UPDATE", "DELETE"]);
export const AccessScopeSchema = z.enum(["OWNER", "ORGANIZATION", "ROLE", "OWNER_OR_ROLE", "DENY"]);
export const RoleAuthoritySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("AUTHENTICATED_USER") }).strict(),
  z.object({ kind: z.literal("JWT_APP_METADATA"), claim: NonEmptyStringSchema.refine((claim) => !/^user_metadata(?:\.|$)/i.test(claim), "Authorization roles must use trusted app metadata, not user metadata.") }).strict(),
  z.object({ kind: z.literal("MEMBERSHIP_TABLE"), table: NonEmptyStringSchema, userColumn: NonEmptyStringSchema, roleColumn: NonEmptyStringSchema, organizationColumn: NonEmptyStringSchema.optional() }).strict(),
]);
export const AccessGrantSchema = z.object({
  operation: AccessOperationSchema,
  scope: AccessScopeSchema,
  roles: z.array(NonEmptyStringSchema).default([]),
  allowedStatuses: z.array(NonEmptyStringSchema).default([]),
}).strict().superRefine((grant, context) => {
  if (["ROLE", "OWNER_OR_ROLE"].includes(grant.scope) && grant.roles.length === 0) context.addIssue({ code: "custom", message: "Role-scoped grants require at least one approved role." });
});
export const AccessResourceSchema = z.object({
  resourceId: NonEmptyStringSchema,
  table: z.string().regex(/^[a-z][a-z0-9_]*$/),
  ownerColumn: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
  organizationColumn: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
  statusColumn: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
  grants: z.array(AccessGrantSchema).min(1),
}).strict().superRefine((resource, context) => {
  if (resource.grants.some((grant) => ["OWNER", "OWNER_OR_ROLE"].includes(grant.scope)) && !resource.ownerColumn) context.addIssue({ code: "custom", message: "Owner-scoped grants require an owner column." });
  if (resource.grants.some((grant) => grant.scope === "ORGANIZATION") && !resource.organizationColumn) context.addIssue({ code: "custom", message: "Organization-scoped grants require an organization column." });
  if (resource.grants.some((grant) => grant.allowedStatuses.length > 0) && !resource.statusColumn) context.addIssue({ code: "custom", message: "Status-scoped grants require a status column." });
});
export const AccessControlContractSchema = z.object({
  schemaVersion: z.literal(1), contractType: z.literal("AccessControlContract"), contractId: UuidSchema,
  projectId: UuidSchema, projectVersion: ProjectVersionSchema, createdAt: IsoDateTimeSchema, updatedAt: IsoDateTimeSchema,
  architectureChecksum: HashSchema, taskGraphChecksum: HashSchema, roleAuthority: RoleAuthoritySchema,
  resources: z.array(AccessResourceSchema).min(1), requirementReferences: z.array(NonEmptyStringSchema).min(1),
  policyVersion: z.literal(ACCESS_CONTROL_POLICY_VERSION), checksum: HashSchema,
}).strict();
export type AccessControlContract = z.infer<typeof AccessControlContractSchema>;

export const SpecialistHandoffSchema = z.object({
  schemaVersion: z.literal(1), contractType: z.literal("SpecialistHandoff"), handoffId: UuidSchema,
  projectId: UuidSchema, projectVersion: ProjectVersionSchema, taskId: UuidSchema, domain: ImplementationDomainSchema,
  specialistProfileId: z.enum(["frontend-implementation", "backend-implementation", "database-implementation"]),
  sourceChecksums: z.object({ brief: HashSchema, planning: HashSchema, architecture: HashSchema, design: HashSchema, taskGraph: HashSchema }).strict(),
  taskContractChecksum: HashSchema, inputArtifactChecksums: z.record(z.string(), HashSchema), allowedContextCategories: z.array(NonEmptyStringSchema).min(1),
  fileScopes: z.array(NonEmptyStringSchema).min(1), allowedTools: z.array(NonEmptyStringSchema), allowedSkillIds: z.array(NonEmptyStringSchema),
  budget: z.object({ maxContextBytes: z.number().int().positive(), maxProviderRequests: z.number().int().min(0).max(1), maxRetries: z.literal(0), maxCorrections: z.literal(0) }).strict(),
  acceptanceCriteria: z.array(NonEmptyStringSchema).min(1), createdAt: IsoDateTimeSchema, policyVersion: z.literal(IMPLEMENTATION_HANDOFF_POLICY_VERSION), checksum: HashSchema,
}).strict().superRefine((handoff, context) => {
  const expected = handoff.domain === "FRONTEND" ? "frontend-implementation" : handoff.domain === "BACKEND" ? "backend-implementation" : "database-implementation";
  if (handoff.specialistProfileId !== expected) context.addIssue({ code: "custom", message: "Specialist profile does not own the handoff domain." });
});
export type SpecialistHandoff = z.infer<typeof SpecialistHandoffSchema>;

export const CrossDomainChangeProposalSchema = z.object({
  schemaVersion: z.literal(1), contractType: z.literal("CrossDomainChangeProposal"), proposalId: UuidSchema,
  projectId: UuidSchema, projectVersion: ProjectVersionSchema, sourceTaskId: UuidSchema, sourceDomain: ImplementationDomainSchema,
  targetDomain: ImplementationDomainSchema, requestedFileScopes: z.array(NonEmptyStringSchema).min(1), rationale: NonEmptyStringSchema,
  requestedContractDelta: z.array(z.object({ contractId: NonEmptyStringSchema, change: NonEmptyStringSchema, compatibleWithArchitecture: z.boolean() }).strict()).min(1),
  canonicalImpact: z.enum(["IMPLEMENTATION_CONTRACT_REPAIR", "LIFECYCLE_ESCALATION_REQUIRED"]),
  currentness: z.object({ taskGraphChecksum: HashSchema, architectureChecksum: HashSchema, sourceArtifactChecksum: HashSchema, workspaceChecksum: HashSchema }).strict(),
  affectedContractIds: z.array(NonEmptyStringSchema).min(1), status: z.enum(["PENDING", "APPROVED", "REJECTED"]),
  approval: z.object({ actorType: z.literal("HOST"), actorId: NonEmptyStringSchema, decidedAt: IsoDateTimeSchema, approvedChecksum: HashSchema }).strict().optional(),
  createdAt: IsoDateTimeSchema, policyVersion: z.literal(CROSS_DOMAIN_CHANGE_POLICY_VERSION), checksum: HashSchema,
}).strict().superRefine((proposal, context) => {
  if (proposal.sourceDomain === proposal.targetDomain) context.addIssue({ code: "custom", message: "Cross-domain proposals must target another domain." });
  if (proposal.status === "APPROVED" && !proposal.approval) context.addIssue({ code: "custom", message: "Approved cross-domain proposals require host approval." });
});
export type CrossDomainChangeProposal = z.infer<typeof CrossDomainChangeProposalSchema>;

/** Immutable, bounded evidence of a host-routed cross-domain repair request. */
export const CrossDomainChangeProposalDocumentSchema = DocumentBaseSchema.extend({
  documentType: z.literal("cross-domain-change-proposal"),
  proposal: CrossDomainChangeProposalSchema,
}).strict();
export type CrossDomainChangeProposalDocument = z.infer<typeof CrossDomainChangeProposalDocumentSchema>;

const checksumWithoutField = (value: Record<string, unknown>) => {
  const copy = { ...value };
  delete copy.checksum;
  if (copy.approval && typeof copy.approval === "object") copy.approval = { ...(copy.approval as Record<string, unknown>), approvedChecksum: "0".repeat(64) };
  return createHash("sha256").update(JSON.stringify(stableValue(copy))).digest("hex");
};
export const checksumAccessControlContract = (value: Omit<AccessControlContract, "checksum"> | AccessControlContract) => checksumWithoutField(value as unknown as Record<string, unknown>);
export const checksumSpecialistHandoff = (value: Omit<SpecialistHandoff, "checksum"> | SpecialistHandoff) => checksumWithoutField(value as unknown as Record<string, unknown>);
export const checksumCrossDomainChangeProposal = (value: Omit<CrossDomainChangeProposal, "checksum"> | CrossDomainChangeProposal) => checksumWithoutField(value as unknown as Record<string, unknown>);

export function validateAccessControlContract(value: unknown) { const parsed = AccessControlContractSchema.parse(value); if (parsed.checksum !== checksumAccessControlContract(parsed)) throw new Error("ACCESS_CONTROL_CONTRACT_STALE"); return parsed; }
export function validateSpecialistHandoff(value: unknown) { const parsed = SpecialistHandoffSchema.parse(value); if (parsed.checksum !== checksumSpecialistHandoff(parsed)) throw new Error("SPECIALIST_HANDOFF_STALE"); return parsed; }
export function assertApprovedCrossDomainChange(value: unknown) { const parsed = CrossDomainChangeProposalSchema.parse(value); if (parsed.checksum !== checksumCrossDomainChangeProposal(parsed) || parsed.status !== "APPROVED" || parsed.approval?.approvedChecksum !== parsed.checksum) throw new Error("CROSS_DOMAIN_CHANGE_NOT_APPROVED"); return parsed; }

export function createCrossDomainChangeProposal(input: Omit<CrossDomainChangeProposal, "schemaVersion" | "contractType" | "proposalId" | "status" | "policyVersion" | "checksum" | "approval">): CrossDomainChangeProposal {
  const base = { schemaVersion: 1 as const, contractType: "CrossDomainChangeProposal" as const, proposalId: randomUUID(), ...input, status: "PENDING" as const, policyVersion: CROSS_DOMAIN_CHANGE_POLICY_VERSION };
  return CrossDomainChangeProposalSchema.parse({ ...base, checksum: checksumCrossDomainChangeProposal(base as Omit<CrossDomainChangeProposal, "checksum">) });
}

/** Only the host may bind approval to the exact proposed checksum domain. */
export function approveCrossDomainChangeProposal(value: CrossDomainChangeProposal, approval: { actorId: string; decidedAt: string }): CrossDomainChangeProposal {
  const pending = CrossDomainChangeProposalSchema.parse(value);
  if (pending.status !== "PENDING" || pending.checksum !== checksumCrossDomainChangeProposal(pending)) throw new Error("CROSS_DOMAIN_CHANGE_NOT_APPROVABLE");
  const base = { ...pending, status: "APPROVED" as const, approval: { actorType: "HOST" as const, actorId: approval.actorId, decidedAt: approval.decidedAt, approvedChecksum: "0".repeat(64) } };
  const checksum = checksumCrossDomainChangeProposal(base);
  return CrossDomainChangeProposalSchema.parse({ ...base, checksum, approval: { ...base.approval, approvedChecksum: checksum } });
}

const HandoffCurrentnessSchema = z.object({
  taskGraphChecksum: HashSchema,
  architectureChecksum: HashSchema,
  workspaceChecksum: HashSchema,
  upstreamArtifactChecksum: HashSchema.optional(),
}).strict();

/** Bounded artifact emitted by a Database task for dependent server work. */
export const DatabaseImplementationContractSchema = DocumentBaseSchema.extend({
  documentType: z.literal("database-implementation-contract"),
  contractId: UuidSchema,
  sourceTaskId: UuidSchema,
  sourceTaskAttempt: z.number().int().positive(),
  specialistProfileId: z.literal("database-implementation"),
  specialistProfileChecksum: HashSchema,
  currentness: HandoffCurrentnessSchema,
  schemaChecksum: HashSchema,
  migrationChecksum: HashSchema,
  entities: z.array(z.object({ name: NonEmptyStringSchema, typeReference: NonEmptyStringSchema, allowedOperations: z.array(AccessOperationSchema).min(1) }).strict()),
  accessControlContractChecksum: HashSchema.optional(),
  hostLifecycle: z.object({ createdBy: z.literal("Factory"), providerAttempts: z.literal(0) }).strict(),
  checksum: HashSchema,
}).strict();
export type DatabaseImplementationContract = z.infer<typeof DatabaseImplementationContractSchema>;

/** Bounded artifact emitted by a Backend task for dependent UI work. */
export const BackendImplementationContractSchema = DocumentBaseSchema.extend({
  documentType: z.literal("backend-implementation-contract"),
  contractId: UuidSchema,
  sourceTaskId: UuidSchema,
  sourceTaskAttempt: z.number().int().positive(),
  specialistProfileId: z.literal("backend-implementation"),
  specialistProfileChecksum: HashSchema,
  currentness: HandoffCurrentnessSchema.extend({ databaseContractChecksum: HashSchema.optional() }).strict(),
  databaseContractChecksum: HashSchema.optional(),
  operations: z.array(z.object({ name: NonEmptyStringSchema, inputSchemaReference: NonEmptyStringSchema, outputSchemaReference: NonEmptyStringSchema, authRequirement: z.enum(["NONE", "AUTHENTICATED", "ROLE"]), errorSemantics: z.array(NonEmptyStringSchema).min(1) }).strict()),
  hostLifecycle: z.object({ createdBy: z.literal("Factory"), providerAttempts: z.literal(0) }).strict(),
  checksum: HashSchema,
}).strict();
export type BackendImplementationContract = z.infer<typeof BackendImplementationContractSchema>;

export const SpecialistExecutionTelemetryEntrySchema = z.object({
  taskId: UuidSchema,
  domain: ImplementationDomainSchema,
  specialistProfileId: z.enum(["frontend-implementation", "backend-implementation", "database-implementation"]),
  specialistProfileChecksum: HashSchema,
  contextBytes: z.number().int().nonnegative(),
  estimatedContextTokens: z.number().int().nonnegative(),
  skillsBytes: z.number().int().nonnegative(),
  canonicalSliceBytes: z.number().int().nonnegative(),
  contractBytes: z.number().int().nonnegative(),
  resolvedCapabilities: z.array(NonEmptyStringSchema),
  allowedPathCount: z.number().int().nonnegative(),
  providerInputTokens: z.number().int().nonnegative().optional(),
  providerOutputTokens: z.number().int().nonnegative().optional(),
  startedAt: IsoDateTimeSchema,
  finishedAt: IsoDateTimeSchema,
  result: z.enum(["passed", "failed", "cancelled"]),
}).strict();
export const SpecialistExecutionTelemetrySchema = DocumentBaseSchema.extend({
  documentType: z.literal("specialist-execution-telemetry"),
  entries: z.array(SpecialistExecutionTelemetryEntrySchema).max(100),
}).strict();
export type SpecialistExecutionTelemetry = z.infer<typeof SpecialistExecutionTelemetrySchema>;

const checksumDocument = <T extends { checksum: string }>(value: Omit<T, "checksum"> | T) => checksumWithoutField(value as unknown as Record<string, unknown>);
export const checksumDatabaseImplementationContract = (value: Omit<DatabaseImplementationContract, "checksum"> | DatabaseImplementationContract) => checksumDocument(value);
export const checksumBackendImplementationContract = (value: Omit<BackendImplementationContract, "checksum"> | BackendImplementationContract) => checksumDocument(value);
export function assertCurrentDatabaseImplementationContract(value: unknown, expected: { taskGraphChecksum: string; architectureChecksum: string; workspaceChecksum: string }) {
  const parsed = DatabaseImplementationContractSchema.parse(value);
  if (parsed.checksum !== checksumDatabaseImplementationContract(parsed) || parsed.currentness.taskGraphChecksum !== expected.taskGraphChecksum || parsed.currentness.architectureChecksum !== expected.architectureChecksum || parsed.currentness.workspaceChecksum !== expected.workspaceChecksum) throw new Error("DOMAIN_HANDOFF_STALE");
  return parsed;
}
export function assertCurrentBackendImplementationContract(value: unknown, expected: { taskGraphChecksum: string; architectureChecksum: string; workspaceChecksum: string; databaseContractChecksum?: string }) {
  const parsed = BackendImplementationContractSchema.parse(value);
  if (parsed.checksum !== checksumBackendImplementationContract(parsed) || parsed.currentness.taskGraphChecksum !== expected.taskGraphChecksum || parsed.currentness.architectureChecksum !== expected.architectureChecksum || parsed.currentness.workspaceChecksum !== expected.workspaceChecksum || (expected.databaseContractChecksum && parsed.databaseContractChecksum !== expected.databaseContractChecksum)) throw new Error("DOMAIN_HANDOFF_STALE");
  return parsed;
}
