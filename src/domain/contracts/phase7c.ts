import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { DEPENDENCY_AUTHORITY_POLICY_VERSION, decideDependency, getDependencyCatalogEntry, parseDependencySpec, type DependencyAuthorityContext } from "@/dependencies/authority";
import { DocumentBaseSchema, IsoDateTimeSchema, NonEmptyStringSchema, ProjectVersionSchema, UuidSchema } from "@/domain/shared/schemas";
import { stableValue } from "@/persistence/database/serialization";

export const PHASE_7C_SCHEMA_VERSION = 1 as const;
export const PHASE_7C_POLICY_VERSION = "phase-7c-contracts-v1";
export const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);

const deterministicTaskContractId = (taskId: string) => {
  const bytes = createHash("sha256").update(`phase-7c-task-contract:${taskId}`).digest("hex");
  return `${bytes.slice(0, 8)}-${bytes.slice(8, 12)}-4${bytes.slice(13, 16)}-8${bytes.slice(17, 20)}-${bytes.slice(20, 32)}`;
};

export const ContractReferenceSchema = z.object({ id: NonEmptyStringSchema, checksum: HashSchema }).strict();
export type ContractReference = z.infer<typeof ContractReferenceSchema>;

export const ContractCurrentnessSchema = z.object({
  status: z.enum(["CURRENT", "STALE"]),
  derivedFromChecksum: HashSchema,
  checkedAt: IsoDateTimeSchema,
  reason: NonEmptyStringSchema.optional(),
}).strict();
export type ContractCurrentness = z.infer<typeof ContractCurrentnessSchema>;

export const DatabaseModeSchema = z.enum(["NONE", "SUPABASE_NEW", "SUPABASE_EXISTING"]);
export type DatabaseMode = z.infer<typeof DatabaseModeSchema>;
export const DatabasePlannerRecommendationSchema = z.enum(["REQUIRED", "NOT_REQUIRED", "UNCERTAIN"]);
export const DatabaseUserDecisionSchema = z.enum(["PENDING", "APPROVED", "REQUESTED_CHANGE"]);
export const DatabaseProviderSchema = z.enum(["NONE", "SUPABASE_POSTGRESQL"]);
export const DatabaseConnectionStatusSchema = z.enum(["NOT_REQUIRED", "MISSING", "PARTIAL", "READY", "INVALID"]);
export const ConnectionVerificationSchema = z.enum(["NOT_RUN", "PASSED", "FAILED"]);
export const DatabaseRequirementUseSchema = z.enum(["DATABASE", "AUTH", "STORAGE"]);
export type DatabaseRequirementUse = z.infer<typeof DatabaseRequirementUseSchema>;
export const EnvironmentPresenceSchema = z.enum(["PRESENT", "MISSING"]);
export const EnvironmentVisibilitySchema = z.enum(["PUBLIC", "SERVER_ONLY", "SERVER_SECRET"]);

export const SafeEnvironmentMetadataSchema = z.object({
  name: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  purpose: NonEmptyStringSchema,
  required: z.boolean(),
  visibility: EnvironmentVisibilitySchema,
  requiredFor: z.array(DatabaseRequirementUseSchema).min(1),
  presence: EnvironmentPresenceSchema,
  connectionVerification: ConnectionVerificationSchema,
  source: NonEmptyStringSchema,
}).strict();
export type SafeEnvironmentMetadata = z.infer<typeof SafeEnvironmentMetadataSchema>;

export const DatabaseDecisionApprovalSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REQUESTED_CHANGE", "STALE"]),
  actorType: z.literal("USER").optional(),
  actorId: NonEmptyStringSchema.optional(),
  approvedAt: IsoDateTimeSchema.optional(),
  approvedChecksum: HashSchema.optional(),
}).strict();

export const DatabaseDecisionSchema = z.object({
  schemaVersion: z.literal(PHASE_7C_SCHEMA_VERSION),
  contractType: z.literal("DatabaseDecision"),
  databaseDecisionId: UuidSchema,
  projectId: UuidSchema,
  projectVersion: ProjectVersionSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  mode: DatabaseModeSchema,
  provider: DatabaseProviderSchema,
  plannerRecommendation: DatabasePlannerRecommendationSchema,
  recommendationRationale: NonEmptyStringSchema,
  userDecision: DatabaseUserDecisionSchema,
  reason: NonEmptyStringSchema,
  authRequired: z.boolean(),
  storageRequired: z.boolean(),
  realtimeRequired: z.boolean(),
  connectionRequirements: z.array(SafeEnvironmentMetadataSchema),
  connectionStatus: DatabaseConnectionStatusSchema,
  connectionVerification: ConnectionVerificationSchema,
  dataContractIds: z.array(UuidSchema),
  dependencyProposalId: UuidSchema.optional(),
  approval: DatabaseDecisionApprovalSchema,
  currentness: ContractCurrentnessSchema,
  checksum: HashSchema,
}).strict();
export type DatabaseDecision = z.infer<typeof DatabaseDecisionSchema>;

const DataFieldSchema = z.object({
  fieldId: z.string().regex(/^[a-z][A-Za-z0-9_]*$/),
  type: NonEmptyStringSchema,
  required: z.boolean(),
  sensitivity: z.enum(["PUBLIC", "INTERNAL", "CONFIDENTIAL", "SECRET"]),
}).strict();

export const DataContractSchema = z.object({
  schemaVersion: z.literal(PHASE_7C_SCHEMA_VERSION),
  contractType: z.literal("DataContract"),
  dataContractId: UuidSchema,
  projectId: UuidSchema,
  projectVersion: ProjectVersionSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  name: NonEmptyStringSchema,
  requirementReferences: z.array(NonEmptyStringSchema).min(1),
  producerTaskId: UuidSchema.optional(),
  consumerTaskIds: z.array(UuidSchema),
  fields: z.array(DataFieldSchema),
  persistence: z.enum(["EPHEMERAL", "DATABASE_PERSISTED", "EXTERNAL", "NOT_PERSISTED"]),
  databaseDecisionRef: ContractReferenceSchema.optional(),
  databaseEntity: NonEmptyStringSchema.optional(),
  validationRules: z.array(NonEmptyStringSchema),
  trustBoundary: z.enum(["BROWSER", "SERVER", "DATABASE", "EXTERNAL_SERVICE"]),
  currentness: ContractCurrentnessSchema,
  checksum: HashSchema,
}).strict();
export type DataContract = z.infer<typeof DataContractSchema>;

export const TaskContractSchema = z.object({
  schemaVersion: z.literal(PHASE_7C_SCHEMA_VERSION),
  contractType: z.literal("TaskContract"),
  taskContractId: UuidSchema,
  taskId: UuidSchema,
  projectId: UuidSchema,
  projectVersion: ProjectVersionSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  taskType: NonEmptyStringSchema,
  implementationDomain: z.enum(["FRONTEND", "BACKEND", "DATABASE"]).optional(),
  specialistProfileId: z.enum(["frontend-implementation", "backend-implementation", "database-implementation"]).optional(),
  requirementReferences: z.array(NonEmptyStringSchema),
  planningReferences: z.array(NonEmptyStringSchema),
  capabilityIds: z.array(NonEmptyStringSchema),
  allowedTools: z.array(NonEmptyStringSchema),
  allowedSkillIds: z.array(NonEmptyStringSchema),
  fileScopes: z.array(NonEmptyStringSchema),
  ownedArtifactTypes: z.array(NonEmptyStringSchema),
  inputDataContractIds: z.array(UuidSchema),
  outputDataContractIds: z.array(UuidSchema),
  databaseDecisionRef: ContractReferenceSchema.optional(),
  dependencyProposalRef: ContractReferenceSchema.optional(),
  selectedDesignReferences: z.array(NonEmptyStringSchema),
  acceptanceCriteria: z.array(NonEmptyStringSchema).min(1),
  validationRequirements: z.array(NonEmptyStringSchema).min(1),
  dependencyTaskIds: z.array(UuidSchema),
  currentness: ContractCurrentnessSchema,
  checksum: HashSchema,
}).strict();
export type TaskContract = z.infer<typeof TaskContractSchema>;

export const DependencyProposalEntrySchema = z.object({
  packageName: NonEmptyStringSchema,
  versionSpec: NonEmptyStringSchema,
  section: z.enum(["dependencies", "devDependencies"]),
  class: z.enum(["FOUNDATION_DEPENDENCY", "PLANNED_OPTIONAL_DEPENDENCY", "TRANSITIVE_DEPENDENCY", "FORBIDDEN_DEPENDENCY"]),
  required: z.boolean(),
  requirementReferences: z.array(NonEmptyStringSchema),
  rationale: NonEmptyStringSchema,
  authorityCode: NonEmptyStringSchema,
  authorityPolicyVersion: z.literal(DEPENDENCY_AUTHORITY_POLICY_VERSION),
  approvalRequired: z.boolean(),
  approvalStatus: z.enum(["NOT_REQUIRED", "PENDING", "APPROVED", "REJECTED", "STALE"]),
  approvedBy: NonEmptyStringSchema.optional(),
  approvedAt: IsoDateTimeSchema.optional(),
}).strict();

export const DependencyProposalSchema = z.object({
  schemaVersion: z.literal(PHASE_7C_SCHEMA_VERSION),
  contractType: z.literal("DependencyProposal"),
  dependencyProposalId: UuidSchema,
  projectId: UuidSchema,
  projectVersion: ProjectVersionSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  planningChecksum: HashSchema,
  dependencies: z.array(DependencyProposalEntrySchema),
  authorityPolicyVersion: z.literal(DEPENDENCY_AUTHORITY_POLICY_VERSION),
  currentness: ContractCurrentnessSchema,
  checksum: HashSchema,
}).strict();
export type DependencyProposal = z.infer<typeof DependencyProposalSchema>;

export const PlanningAcceptanceSchema = z.object({
  schemaVersion: z.literal(PHASE_7C_SCHEMA_VERSION),
  contractType: z.literal("PlanningAcceptance"),
  planningAcceptanceId: UuidSchema,
  projectId: UuidSchema,
  projectVersion: ProjectVersionSchema,
  status: z.enum(["PENDING", "APPROVED", "CHANGES_REQUESTED", "STALE"]),
  approvedBy: NonEmptyStringSchema.optional(),
  approvedAt: IsoDateTimeSchema.optional(),
  requestedChanges: z.array(NonEmptyStringSchema),
  planningChecksum: HashSchema,
  databaseDecisionRef: ContractReferenceSchema,
  dependencyProposalRef: ContractReferenceSchema,
  architectureChecksum: HashSchema,
  designChecksum: HashSchema,
  currentness: ContractCurrentnessSchema,
  checksum: HashSchema,
}).strict();
export type PlanningAcceptance = z.infer<typeof PlanningAcceptanceSchema>;

export const Phase7CTraceabilitySchema = z.object({
  requirementReference: NonEmptyStringSchema,
  planningReference: NonEmptyStringSchema,
  taskContractId: UuidSchema,
  dataContractIds: z.array(UuidSchema),
  artifactPaths: z.array(NonEmptyStringSchema),
  validationIds: z.array(NonEmptyStringSchema),
}).strict();

export const Phase7CContractPackageSchema = DocumentBaseSchema.extend({
  documentType: z.literal("phase-7c-contract-package"),
  phaseId: z.literal("PHASE_7C"),
  contractPolicyVersion: z.literal(PHASE_7C_POLICY_VERSION),
  approvedBriefChecksum: HashSchema,
  // Semantic PlanningPackage identity; never the accepted document/envelope checksum.
  planningChecksum: HashSchema,
  architectureChecksum: HashSchema,
  designChecksum: HashSchema,
  status: z.enum(["PENDING_USER_APPROVAL", "APPROVED", "STALE"]),
  databaseDecision: DatabaseDecisionSchema,
  dataContracts: z.array(DataContractSchema),
  taskContracts: z.array(TaskContractSchema),
  dependencyProposal: DependencyProposalSchema,
  planningAcceptance: PlanningAcceptanceSchema,
  safeEnvironmentMetadata: z.array(SafeEnvironmentMetadataSchema),
  traceability: z.array(Phase7CTraceabilitySchema),
  architectureAccepted: z.boolean(),
  contractAuditAccepted: z.boolean(),
  designSelected: z.boolean(),
  currentness: ContractCurrentnessSchema,
}).strict();
export type Phase7CContractPackage = z.infer<typeof Phase7CContractPackageSchema>;

export type Phase7CErrorCode =
  | "DATABASE_DECISION_MISSING"
  | "DATABASE_NOT_APPROVED"
  | "DATABASE_DECISION_STALE"
  | "DATABASE_CONNECTION_MISSING"
  | "DATABASE_CONNECTION_INVALID"
  | "DATABASE_REQUIRED_BY_DATA_CONTRACT"
  | "UNAPPROVED_DATABASE_DEPENDENCY"
  | "PLANNING_ACCEPTANCE_STALE"
  | "TASK_CONTRACT_MISSING"
  | "TASK_CONTRACT_STALE"
  | "TASK_CONTRACT_ESCALATION"
  | "CONTRACT_PACKAGE_STALE"
  | "CONTRACT_PACKAGE_INVALID";

export class Phase7CContractError extends Error {
  constructor(public readonly code: Phase7CErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "Phase7CContractError";
  }
}

const omit = <T extends Record<string, unknown>, K extends keyof T>(value: T, ...keys: K[]) => {
  const result = { ...value } as Record<string, unknown>;
  for (const key of keys) delete result[key as string];
  return result;
};

function hash(value: unknown) {
  return createHash("sha256").update(`${JSON.stringify(stableValue(value))}\n`, "utf8").digest("hex");
}

export function checksumDatabaseDecision(value: DatabaseDecision | Omit<DatabaseDecision, "checksum">) {
  const decision = value as DatabaseDecision;
  return hash(omit(decision, "checksum", "currentness", "approval")).toString();
}

export function checksumDataContract(value: DataContract | Omit<DataContract, "checksum">) {
  return hash(omit(value as DataContract, "checksum", "currentness")).toString();
}

export function checksumTaskContract(value: TaskContract | Omit<TaskContract, "checksum">) {
  return hash(omit(value as TaskContract, "checksum", "currentness")).toString();
}

export function checksumDependencyProposal(value: DependencyProposal | Omit<DependencyProposal, "checksum">) {
  return hash(omit(value as DependencyProposal, "checksum", "currentness")).toString();
}

export function checksumPlanningAcceptance(value: PlanningAcceptance | Omit<PlanningAcceptance, "checksum">) {
  return hash(omit(value as PlanningAcceptance, "checksum", "currentness")).toString();
}

function secretKey(key: string) {
  return /^(?:value|rawValue|secretValue|token|password|privateKey|connectionString|secret)$/i.test(key);
}

export function assertNoPhase7CSecrets(value: unknown, path = "contract") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPhase7CSecrets(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && /(postgres(?:ql)?:\/\/|-----BEGIN .*PRIVATE KEY-----|sk-[A-Za-z0-9]{12,}|password\s*[:=])/i.test(value)) throw new Phase7CContractError("CONTRACT_PACKAGE_INVALID", `Secret-like content is not permitted at ${path}.`);
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (secretKey(key)) throw new Phase7CContractError("CONTRACT_PACKAGE_INVALID", `Raw secret field ${path}.${key} is not permitted.`);
    assertNoPhase7CSecrets(entry, `${path}.${key}`);
  }
}

export function validateDatabaseDecision(value: unknown): DatabaseDecision {
  const decision = DatabaseDecisionSchema.parse(value);
  assertNoPhase7CSecrets(decision);
  if (decision.mode === "NONE") {
    if (decision.provider !== "NONE" || decision.connectionStatus !== "NOT_REQUIRED" || decision.connectionRequirements.some((item) => item.requiredFor.includes("DATABASE"))) throw new Phase7CContractError("DATABASE_NOT_APPROVED", "NONE cannot carry a database provider, database credentials, or a database connection requirement.");
  } else {
    if (decision.provider !== "SUPABASE_POSTGRESQL") throw new Phase7CContractError("DATABASE_DECISION_MISSING", "A Supabase database mode must use the canonical Supabase PostgreSQL provider.");
    if (!decision.connectionRequirements.some((item) => item.requiredFor.includes("DATABASE"))) throw new Phase7CContractError("DATABASE_CONNECTION_MISSING", "A database mode must declare safe database connection metadata.");
  }
  if (decision.checksum !== checksumDatabaseDecision(decision)) throw new Phase7CContractError("DATABASE_DECISION_STALE", "Database decision checksum is stale.");
  if (decision.currentness.status !== "CURRENT" || decision.currentness.derivedFromChecksum !== decision.checksum) throw new Phase7CContractError("DATABASE_DECISION_STALE", "Database decision is not current.");
  if (decision.approval.status === "APPROVED" && (decision.userDecision !== "APPROVED" || decision.approval.actorType !== "USER" || !decision.approval.actorId || !decision.approval.approvedAt || decision.approval.approvedChecksum !== decision.checksum)) throw new Phase7CContractError("DATABASE_NOT_APPROVED", "Database approval must be explicit, user-owned, and bound to the exact checksum.");
  if (decision.userDecision === "APPROVED" && decision.approval.status !== "APPROVED") throw new Phase7CContractError("DATABASE_NOT_APPROVED", "Database user approval is incomplete.");
  return decision;
}

export function validateDataContract(value: unknown): DataContract {
  const contract = DataContractSchema.parse(value);
  assertNoPhase7CSecrets(contract);
  if (contract.persistence === "DATABASE_PERSISTED" && !contract.databaseDecisionRef) throw new Phase7CContractError("DATABASE_REQUIRED_BY_DATA_CONTRACT", "Persisted data must reference the approved database decision.");
  if (contract.checksum !== checksumDataContract(contract) || contract.currentness.status !== "CURRENT" || contract.currentness.derivedFromChecksum !== contract.checksum) throw new Phase7CContractError("CONTRACT_PACKAGE_STALE", `DataContract ${contract.dataContractId} is stale.`);
  return contract;
}

export function validateTaskContract(value: unknown): TaskContract {
  const contract = TaskContractSchema.parse(value);
  assertNoPhase7CSecrets(contract);
  if (contract.checksum !== checksumTaskContract(contract) || contract.currentness.status !== "CURRENT" || contract.currentness.derivedFromChecksum !== contract.checksum) throw new Phase7CContractError("TASK_CONTRACT_STALE", `TaskContract ${contract.taskContractId} is stale.`);
  return contract;
}

export function validateDependencyProposal(value: unknown, authorityContext: DependencyAuthorityContext = {}, allowPendingApprovals = false): DependencyProposal {
  const proposal = DependencyProposalSchema.parse(value);
  assertNoPhase7CSecrets(proposal);
  for (const dependency of proposal.dependencies) {
    if (dependency.class === "FORBIDDEN_DEPENDENCY") throw new Phase7CContractError("UNAPPROVED_DATABASE_DEPENDENCY", `Forbidden dependency ${dependency.packageName} is not executable.`);
    if (dependency.class === "TRANSITIVE_DEPENDENCY") continue;
    const decision = decideDependency({ operation: "ADD", packageName: dependency.packageName, versionSpec: dependency.versionSpec, dependencySection: dependency.section, context: authorityContext });
    if (dependency.authorityCode !== decision.code || !decision.approved) throw new Phase7CContractError("UNAPPROVED_DATABASE_DEPENDENCY", `Dependency Authority rejected ${dependency.packageName}: ${decision.code}.`);
    if (dependency.approvalRequired && dependency.approvalStatus !== "APPROVED" && !allowPendingApprovals) throw new Phase7CContractError("UNAPPROVED_DATABASE_DEPENDENCY", `Optional dependency ${dependency.packageName} lacks current user approval.`);
  }
  if (proposal.checksum !== checksumDependencyProposal(proposal) || proposal.currentness.status !== "CURRENT" || proposal.currentness.derivedFromChecksum !== proposal.checksum) throw new Phase7CContractError("CONTRACT_PACKAGE_STALE", "Dependency proposal is stale.");
  return proposal;
}

function dependencyAuthorityContextFromProposal(proposal: DependencyProposal): DependencyAuthorityContext {
  return {
    plannedDependencies: proposal.dependencies.map((dependency) => ({
      name: `${dependency.packageName}@${dependency.versionSpec}`,
      runtime: dependency.section === "dependencies" ? "runtime" as const : "dev",
      required: dependency.required,
    })),
  };
}

export function validatePhase7CContractPackage(value: unknown, authorityContext: DependencyAuthorityContext = {}): Phase7CContractPackage {
  const pkg = Phase7CContractPackageSchema.parse(value);
  assertNoPhase7CSecrets(pkg);
  const decision = validateDatabaseDecision(pkg.databaseDecision);
  pkg.dataContracts.forEach(validateDataContract);
  pkg.taskContracts.forEach(validateTaskContract);
  const resolvedAuthorityContext = authorityContext.plannedDependencies === undefined ? dependencyAuthorityContextFromProposal(pkg.dependencyProposal) : authorityContext;
  validateDependencyProposal(pkg.dependencyProposal, resolvedAuthorityContext, pkg.status !== "APPROVED");
  if (pkg.planningAcceptance.databaseDecisionRef.id !== decision.databaseDecisionId || pkg.planningAcceptance.databaseDecisionRef.checksum !== decision.checksum) throw new Phase7CContractError("PLANNING_ACCEPTANCE_STALE", "Planning Acceptance is not bound to the current DatabaseDecision.");
  if (pkg.planningAcceptance.checksum !== checksumPlanningAcceptance(pkg.planningAcceptance) || pkg.planningAcceptance.currentness.status !== "CURRENT" || pkg.planningAcceptance.currentness.derivedFromChecksum !== pkg.planningAcceptance.checksum) throw new Phase7CContractError("PLANNING_ACCEPTANCE_STALE", "Planning Acceptance checksum or currentness is stale.");
  if (pkg.currentness.status !== "CURRENT" || pkg.currentness.derivedFromChecksum !== pkg.planningChecksum) throw new Phase7CContractError("CONTRACT_PACKAGE_STALE", "Phase 7C contract package is stale.");
  if (pkg.databaseDecision.mode === "NONE" && pkg.dataContracts.some((contract) => contract.persistence === "DATABASE_PERSISTED")) throw new Phase7CContractError("DATABASE_REQUIRED_BY_DATA_CONTRACT", "NONE cannot coexist with persisted DataContracts.");
  if (pkg.dataContracts.some((contract) => contract.persistence === "DATABASE_PERSISTED" && (!contract.databaseDecisionRef || contract.databaseDecisionRef.id !== decision.databaseDecisionId || contract.databaseDecisionRef.checksum !== decision.checksum))) throw new Phase7CContractError("DATABASE_REQUIRED_BY_DATA_CONTRACT", "Every persisted DataContract must bind the current DatabaseDecision.");
  return pkg;
}

export type StartImplementationGateInput = {
  contractPackage: Phase7CContractPackage;
  taskContracts?: readonly TaskContract[];
  databaseTask?: boolean;
};

export function validateStartImplementationGate(input: StartImplementationGateInput) {
  const pkg = validatePhase7CContractPackage(input.contractPackage);
  if (pkg.status !== "APPROVED" || pkg.planningAcceptance.status !== "APPROVED") throw new Phase7CContractError("PLANNING_ACCEPTANCE_STALE", "Planning and dependency acceptance must be current before implementation.");
  if (!pkg.architectureAccepted || !pkg.contractAuditAccepted || !pkg.designSelected) throw new Phase7CContractError("PLANNING_ACCEPTANCE_STALE", "Architecture, Contract Audit, and design selection approvals are required before implementation.");
  if (pkg.databaseDecision.userDecision !== "APPROVED" || pkg.databaseDecision.approval.status !== "APPROVED") throw new Phase7CContractError("DATABASE_NOT_APPROVED", "The user has not approved the exact DatabaseDecision.");
  if (pkg.databaseDecision.connectionStatus === "MISSING" || pkg.databaseDecision.connectionStatus === "PARTIAL") throw new Phase7CContractError("DATABASE_CONNECTION_MISSING", "Required database connection metadata is missing or incomplete.");
  if (pkg.databaseDecision.connectionStatus === "INVALID") throw new Phase7CContractError("DATABASE_CONNECTION_INVALID", "Database connection metadata is invalid.");
  if (input.databaseTask && pkg.databaseDecision.mode === "NONE") throw new Phase7CContractError("DATABASE_NOT_APPROVED", "Database implementation is forbidden when the approved mode is NONE.");
  const contracts = input.taskContracts ?? pkg.taskContracts;
  if (!contracts.length) throw new Phase7CContractError("TASK_CONTRACT_MISSING", "Every implementation task must bind a current TaskContract.");
  for (const contract of contracts) {
    validateTaskContract(contract);
    if (contract.taskType.includes("database") || contract.taskType === "implement-rls-policy") {
      if (!contract.databaseDecisionRef || contract.databaseDecisionRef.id !== pkg.databaseDecision.databaseDecisionId || contract.databaseDecisionRef.checksum !== pkg.databaseDecision.checksum) throw new Phase7CContractError("DATABASE_DECISION_STALE", `Database task ${contract.taskId} is not bound to the current DatabaseDecision.`);
    }
  }
  return { valid: true as const, databaseMode: pkg.databaseDecision.mode, taskContractCount: contracts.length };
}

const normalizeContractScope = (value: string) => value.replaceAll("\\", "/").replace(/^\.\//, "");
const contractScopeCovers = (allowed: string, requested: string) => {
  const allowedScope = normalizeContractScope(allowed);
  const requestedScope = normalizeContractScope(requested);
  if (allowedScope === requestedScope) return true;
  if (allowedScope.endsWith("/**")) {
    const base = allowedScope.slice(0, -3).replace(/\/$/, "");
    return requestedScope === base || requestedScope.startsWith(`${base}/`);
  }
  if (allowedScope.endsWith("/*")) {
    const base = allowedScope.slice(0, -2).replace(/\/$/, "");
    const relative = requestedScope.startsWith(`${base}/`) ? requestedScope.slice(base.length + 1) : "";
    return relative.length > 0 && !relative.includes("/");
  }
  if (allowedScope.endsWith("*")) {
    const prefix = allowedScope.slice(0, -1);
    const relative = requestedScope.startsWith(prefix) ? requestedScope.slice(prefix.length) : "";
    return relative.length > 0 && !relative.includes("/");
  }
  return false;
};

export function validateTaskContractBinding(task: { id: string; projectId: string; projectVersion: number; taskType: string; implementationDomain?: "FRONTEND" | "BACKEND" | "DATABASE"; specialistProfileId?: "frontend-implementation" | "backend-implementation" | "database-implementation"; allowedTools: string[]; allowedSkills: string[]; fileScopes: string[]; requiredCapabilities?: string[]; expectedArtifactTypes?: string[]; repairOfTaskId?: string; phase7cTaskContractId?: string }, contract: TaskContract) {
  validateTaskContract(contract);
  const boundedRepair = task.taskType === "repair-targeted-failure" && (task.repairOfTaskId === contract.taskId || task.phase7cTaskContractId === contract.taskContractId);
  if ((!boundedRepair && task.id !== contract.taskId) || task.projectId !== contract.projectId || task.projectVersion !== contract.projectVersion || (!boundedRepair && task.taskType !== contract.taskType)) throw new Phase7CContractError("TASK_CONTRACT_ESCALATION", "Task identity does not match its TaskContract.");
  if ((task.implementationDomain !== undefined && contract.implementationDomain !== undefined && task.implementationDomain !== contract.implementationDomain) || (task.specialistProfileId !== undefined && contract.specialistProfileId !== undefined && task.specialistProfileId !== contract.specialistProfileId) || task.allowedTools.some((tool) => !contract.allowedTools.includes(tool)) || task.allowedSkills.some((skill) => !contract.allowedSkillIds.includes(skill)) || (task.requiredCapabilities ?? []).some((capability) => !contract.capabilityIds.includes(capability)) || task.fileScopes.some((scope) => !contract.fileScopes.some((allowedScope) => contractScopeCovers(allowedScope, scope))) || (task.expectedArtifactTypes ?? []).some((artifact) => !contract.ownedArtifactTypes.includes(artifact))) throw new Phase7CContractError("TASK_CONTRACT_ESCALATION", "Task exceeds the tools, skills, capabilities, file scopes, or artifacts authorized by its TaskContract.");
  return true;
}

export function defaultEnvironmentMetadata(names: readonly string[], requiredFor: DatabaseRequirementUse, source = "phase-7c-safe-inspection"): SafeEnvironmentMetadata[] {
  return names.map((name) => ({ name, purpose: `${requiredFor.toLowerCase()} connection metadata`, required: true, visibility: name.includes("SECRET") || name === "DATABASE_URL" ? "SERVER_SECRET" : "PUBLIC", requiredFor: [requiredFor], presence: process.env[name] ? "PRESENT" : "MISSING", connectionVerification: "NOT_RUN", source }));
}

export function databaseConnectionStatus(requirements: readonly SafeEnvironmentMetadata[], mode: DatabaseMode): z.infer<typeof DatabaseConnectionStatusSchema> {
  const databaseRequirements = requirements.filter((item) => item.requiredFor.includes("DATABASE"));
  if (mode === "NONE" && databaseRequirements.length === 0) return "NOT_REQUIRED";
  if (databaseRequirements.every((item) => item.presence === "PRESENT")) return "READY";
  return databaseRequirements.some((item) => item.presence === "PRESENT") ? "PARTIAL" : "MISSING";
}

export function createDatabaseDecisionProposal(input: { databaseDecisionId: string; projectId: string; projectVersion: number; createdAt: string; planningChecksum: string; recommendation: z.infer<typeof DatabasePlannerRecommendationSchema>; rationale: string; authRequired?: boolean; storageRequired?: boolean; realtimeRequired?: boolean; dataContractIds?: string[]; mode?: DatabaseMode; connectionRequirements?: SafeEnvironmentMetadata[] }) {
  const required = input.recommendation === "REQUIRED";
  const mode = input.mode ?? (required ? "SUPABASE_NEW" : "NONE");
  const connectionRequirements = input.connectionRequirements ?? (mode === "NONE" ? [] : defaultEnvironmentMetadata(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"], "DATABASE"));
  const base = { schemaVersion: PHASE_7C_SCHEMA_VERSION, contractType: "DatabaseDecision" as const, databaseDecisionId: input.databaseDecisionId, projectId: input.projectId, projectVersion: input.projectVersion, createdAt: input.createdAt, updatedAt: input.createdAt, mode, provider: mode === "NONE" ? "NONE" as const : "SUPABASE_POSTGRESQL" as const, plannerRecommendation: input.recommendation, recommendationRationale: input.rationale, userDecision: "PENDING" as const, reason: "Awaiting explicit user database decision.", authRequired: input.authRequired ?? false, storageRequired: input.storageRequired ?? false, realtimeRequired: input.realtimeRequired ?? false, connectionRequirements, connectionStatus: databaseConnectionStatus(connectionRequirements, mode), connectionVerification: "NOT_RUN" as const, dataContractIds: input.dataContractIds ?? [], approval: { status: "PENDING" as const }, currentness: { status: "CURRENT" as const, derivedFromChecksum: "0".repeat(64), checkedAt: input.createdAt }, checksum: "0".repeat(64) };
  const checksum = checksumDatabaseDecision(base);
  return DatabaseDecisionSchema.parse({ ...base, checksum, currentness: { ...base.currentness, derivedFromChecksum: checksum } });
}

export function approveDatabaseDecision(proposed: DatabaseDecision, input: { actorId: string; approvedAt: string; mode?: DatabaseMode; reason?: string; connectionRequirements?: SafeEnvironmentMetadata[] }) {
  const mode = input.mode ?? proposed.mode;
  const requirements = input.connectionRequirements ?? (mode === proposed.mode ? proposed.connectionRequirements : mode === "NONE" ? [] : defaultEnvironmentMetadata(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"], "DATABASE"));
  const base = { ...proposed, mode, provider: mode === "NONE" ? "NONE" as const : "SUPABASE_POSTGRESQL" as const, userDecision: "APPROVED" as const, reason: input.reason ?? `User ${input.actorId} approved the selected database mode.`, connectionRequirements: requirements, connectionStatus: databaseConnectionStatus(requirements, mode), approval: { status: "APPROVED" as const, actorType: "USER" as const, actorId: input.actorId, approvedAt: input.approvedAt }, currentness: { ...proposed.currentness, status: "CURRENT" as const, checkedAt: input.approvedAt, derivedFromChecksum: "0".repeat(64) }, checksum: "0".repeat(64) };
  const checksum = checksumDatabaseDecision(base);
  return validateDatabaseDecision({ ...base, checksum, approval: { ...base.approval, approvedChecksum: checksum }, currentness: { ...base.currentness, derivedFromChecksum: checksum } });
}

export function buildDependencyProposal(input: { dependencyProposalId: string; projectId: string; projectVersion: number; createdAt: string; planningChecksum: string; dependencies: Array<{ packageName: string; versionSpec: string; section: "dependencies" | "devDependencies"; required: boolean; requirementReferences: string[]; rationale: string }> }, authorityContext: DependencyAuthorityContext = {}) {
  const dependencies = input.dependencies.map((dependency) => {
    const entry = getDependencyCatalogEntry(dependency.packageName);
    const authority = decideDependency({ operation: "ADD", packageName: dependency.packageName, versionSpec: dependency.versionSpec, dependencySection: dependency.section, context: authorityContext });
    const foundation = Boolean(entry?.baselineRequired);
    return { ...dependency, class: foundation ? "FOUNDATION_DEPENDENCY" as const : authority.approved ? "PLANNED_OPTIONAL_DEPENDENCY" as const : "FORBIDDEN_DEPENDENCY" as const, authorityCode: authority.code, authorityPolicyVersion: DEPENDENCY_AUTHORITY_POLICY_VERSION, approvalRequired: !foundation, approvalStatus: foundation ? "NOT_REQUIRED" as const : "PENDING" as const };
  });
  const base: Omit<DependencyProposal, "checksum"> = { schemaVersion: PHASE_7C_SCHEMA_VERSION, contractType: "DependencyProposal", dependencyProposalId: input.dependencyProposalId, projectId: input.projectId, projectVersion: input.projectVersion, createdAt: input.createdAt, updatedAt: input.createdAt, planningChecksum: input.planningChecksum, dependencies: dependencies as DependencyProposal["dependencies"], authorityPolicyVersion: DEPENDENCY_AUTHORITY_POLICY_VERSION, currentness: { status: "CURRENT", derivedFromChecksum: "0".repeat(64), checkedAt: input.createdAt } };
  const checksum = checksumDependencyProposal(base);
  return DependencyProposalSchema.parse({ ...base, checksum, currentness: { ...base.currentness, derivedFromChecksum: checksum } });
}

export function createDataContract(input: { dataContractId?: string; projectId: string; projectVersion: number; createdAt: string; name: string; requirementReferences: string[]; producerTaskId?: string; consumerTaskIds?: string[]; fields: Array<z.input<typeof DataFieldSchema>>; persistence: DataContract["persistence"]; databaseDecisionRef?: ContractReference; databaseEntity?: string; validationRules?: string[]; trustBoundary: DataContract["trustBoundary"] }) {
  const base: Omit<DataContract, "checksum"> = { schemaVersion: PHASE_7C_SCHEMA_VERSION, contractType: "DataContract", dataContractId: input.dataContractId ?? randomUUID(), projectId: input.projectId, projectVersion: input.projectVersion, createdAt: input.createdAt, updatedAt: input.createdAt, name: input.name, requirementReferences: input.requirementReferences, ...(input.producerTaskId ? { producerTaskId: input.producerTaskId } : {}), consumerTaskIds: input.consumerTaskIds ?? [], fields: input.fields, persistence: input.persistence, ...(input.databaseDecisionRef ? { databaseDecisionRef: input.databaseDecisionRef } : {}), ...(input.databaseEntity ? { databaseEntity: input.databaseEntity } : {}), validationRules: input.validationRules ?? [], trustBoundary: input.trustBoundary, currentness: { status: "CURRENT", derivedFromChecksum: "0".repeat(64), checkedAt: input.createdAt } };
  const checksum = checksumDataContract(base);
  return validateDataContract({ ...base, checksum, currentness: { ...base.currentness, derivedFromChecksum: checksum } });
}

export function createTaskContract(input: { taskContractId?: string; taskId: string; projectId: string; projectVersion: number; createdAt: string; taskType: string; implementationDomain?: "FRONTEND" | "BACKEND" | "DATABASE"; specialistProfileId?: "frontend-implementation" | "backend-implementation" | "database-implementation"; requirementReferences?: string[]; planningReferences?: string[]; capabilityIds?: string[]; allowedTools: string[]; allowedSkillIds?: string[]; fileScopes: string[]; ownedArtifactTypes?: string[]; inputDataContractIds?: string[]; outputDataContractIds?: string[]; databaseDecisionRef?: ContractReference; dependencyProposalRef?: ContractReference; selectedDesignReferences?: string[]; acceptanceCriteria: string[]; validationRequirements: string[]; dependencyTaskIds?: string[] }) {
  const base: Omit<TaskContract, "checksum"> = { schemaVersion: PHASE_7C_SCHEMA_VERSION, contractType: "TaskContract", taskContractId: input.taskContractId ?? randomUUID(), taskId: input.taskId, projectId: input.projectId, projectVersion: input.projectVersion, createdAt: input.createdAt, updatedAt: input.createdAt, taskType: input.taskType, ...(input.implementationDomain ? { implementationDomain: input.implementationDomain } : {}), ...(input.specialistProfileId ? { specialistProfileId: input.specialistProfileId } : {}), requirementReferences: input.requirementReferences ?? [], planningReferences: input.planningReferences ?? [], capabilityIds: input.capabilityIds ?? [], allowedTools: input.allowedTools, allowedSkillIds: input.allowedSkillIds ?? [], fileScopes: input.fileScopes, ownedArtifactTypes: input.ownedArtifactTypes ?? [], inputDataContractIds: input.inputDataContractIds ?? [], outputDataContractIds: input.outputDataContractIds ?? [], ...(input.databaseDecisionRef ? { databaseDecisionRef: input.databaseDecisionRef } : {}), ...(input.dependencyProposalRef ? { dependencyProposalRef: input.dependencyProposalRef } : {}), selectedDesignReferences: input.selectedDesignReferences ?? [], acceptanceCriteria: input.acceptanceCriteria, validationRequirements: input.validationRequirements, dependencyTaskIds: input.dependencyTaskIds ?? [], currentness: { status: "CURRENT", derivedFromChecksum: "0".repeat(64), checkedAt: input.createdAt } };
  const checksum = checksumTaskContract(base);
  return validateTaskContract({ ...base, checksum, currentness: { ...base.currentness, derivedFromChecksum: checksum } });
}

export function bindTaskContractsToPackage(pkg: Phase7CContractPackage, tasks: ReadonlyArray<{ id: string; projectId: string; projectVersion: number; taskType: string; implementationDomain?: "FRONTEND" | "BACKEND" | "DATABASE"; specialistProfileId?: "frontend-implementation" | "backend-implementation" | "database-implementation"; requirementReferences?: string[]; planningReferences?: string[]; requiredCapabilities?: string[]; allowedTools: string[]; allowedSkills: string[]; fileScopes: string[]; expectedArtifactTypes?: string[]; acceptanceCriteria?: string[]; dependencies: string[]; selectedDesignReferences?: string[] }>) {
  const existing = new Map(pkg.taskContracts.map((contract) => [contract.taskId, contract]));
  const contracts = tasks.map((task) => existing.get(task.id) ?? createTaskContract({ taskContractId: deterministicTaskContractId(task.id), taskId: task.id, projectId: task.projectId, projectVersion: task.projectVersion, createdAt: pkg.updatedAt, taskType: task.taskType, ...(task.implementationDomain ? { implementationDomain: task.implementationDomain } : {}), ...(task.specialistProfileId ? { specialistProfileId: task.specialistProfileId } : {}), requirementReferences: task.requirementReferences ?? [], planningReferences: task.planningReferences ?? [], capabilityIds: task.requiredCapabilities ?? [], allowedTools: task.allowedTools, allowedSkillIds: task.allowedSkills, fileScopes: task.fileScopes, ownedArtifactTypes: task.expectedArtifactTypes ?? [], inputDataContractIds: task.taskType.includes("database") || task.taskType === "implement-rls-policy" ? pkg.dataContracts.map((contract) => contract.dataContractId) : [], outputDataContractIds: task.taskType.includes("database") || task.taskType === "implement-rls-policy" ? pkg.dataContracts.map((contract) => contract.dataContractId) : [], ...(task.taskType.includes("database") || task.taskType === "implement-rls-policy" ? { databaseDecisionRef: { id: pkg.databaseDecision.databaseDecisionId, checksum: pkg.databaseDecision.checksum } } : {}), dependencyProposalRef: { id: pkg.dependencyProposal.dependencyProposalId, checksum: pkg.dependencyProposal.checksum }, selectedDesignReferences: task.selectedDesignReferences ?? [], acceptanceCriteria: task.acceptanceCriteria?.length ? task.acceptanceCriteria : ["Output matches the approved TaskContract."], validationRequirements: ["Deterministic validation evidence is required."], dependencyTaskIds: task.dependencies }));
  return Phase7CContractPackageSchema.parse({ ...pkg, taskContracts: contracts, updatedAt: pkg.updatedAt });
}

export function approveDependencyProposal(proposal: DependencyProposal, input: { actorId: string; approvedAt: string }) {
  const dependencies = proposal.dependencies.map((dependency) => dependency.approvalRequired ? { ...dependency, approvalStatus: "APPROVED" as const, approvedBy: input.actorId, approvedAt: input.approvedAt } : dependency);
  const base: Omit<DependencyProposal, "checksum"> = { ...proposal, dependencies, currentness: { ...proposal.currentness, status: "CURRENT", checkedAt: input.approvedAt, derivedFromChecksum: "0".repeat(64) } };
  const checksum = checksumDependencyProposal(base);
  return validateDependencyProposal({ ...base, checksum, currentness: { ...base.currentness, derivedFromChecksum: checksum } }, dependencyAuthorityContextFromProposal(proposal));
}

export function createPlanningAcceptance(input: { planningAcceptanceId?: string; projectId: string; projectVersion: number; planningChecksum: string; databaseDecision: DatabaseDecision; dependencyProposal: DependencyProposal; architectureChecksum: string; designChecksum: string; createdAt: string }) {
  const base: Omit<PlanningAcceptance, "checksum"> = { schemaVersion: PHASE_7C_SCHEMA_VERSION, contractType: "PlanningAcceptance", planningAcceptanceId: input.planningAcceptanceId ?? randomUUID(), projectId: input.projectId, projectVersion: input.projectVersion, status: "PENDING", requestedChanges: [], planningChecksum: input.planningChecksum, databaseDecisionRef: { id: input.databaseDecision.databaseDecisionId, checksum: input.databaseDecision.checksum }, dependencyProposalRef: { id: input.dependencyProposal.dependencyProposalId, checksum: input.dependencyProposal.checksum }, architectureChecksum: input.architectureChecksum, designChecksum: input.designChecksum, currentness: { status: "CURRENT", derivedFromChecksum: "0".repeat(64), checkedAt: input.createdAt } };
  const checksum = checksumPlanningAcceptance(base);
  return PlanningAcceptanceSchema.parse({ ...base, checksum, currentness: { ...base.currentness, derivedFromChecksum: checksum } });
}

export function approvePlanningAcceptance(acceptance: PlanningAcceptance, input: { actorId: string; approvedAt: string }) {
  const base: Omit<PlanningAcceptance, "checksum"> = { ...acceptance, status: "APPROVED", approvedBy: input.actorId, approvedAt: input.approvedAt, currentness: { ...acceptance.currentness, status: "CURRENT", checkedAt: input.approvedAt, derivedFromChecksum: "0".repeat(64) } };
  const checksum = checksumPlanningAcceptance(base);
  return PlanningAcceptanceSchema.parse({ ...base, checksum, currentness: { ...base.currentness, derivedFromChecksum: checksum } });
}

export function buildPhase7CContractPackage(input: { projectId: string; projectVersion: number; createdAt: string; approvedBriefChecksum: string; planningChecksum: string; architectureChecksum: string; designChecksum: string; planning: { dataModel: { entities: Array<{ id: string; name: string; fields: Array<{ name: string; type: string; required: boolean; public: boolean }>; requirementReferences: string[] }> }; authentication: { required: boolean }; storage: { decision: string }; dependencies: { dependencies: Array<{ name: string; runtime: "runtime" | "dev"; required: boolean; requirementReferences: string[]; purpose: string }> } }; databaseDecision?: DatabaseDecision; dependencyProposal?: DependencyProposal; dataContracts?: DataContract[] }) {
  const entityIds = input.planning.dataModel.entities.map(() => randomUUID());
  const databaseDecision = input.databaseDecision ?? createDatabaseDecisionProposal({ databaseDecisionId: randomUUID(), projectId: input.projectId, projectVersion: input.projectVersion, createdAt: input.createdAt, planningChecksum: input.planningChecksum, recommendation: input.planning.dataModel.entities.length ? "REQUIRED" : "NOT_REQUIRED", rationale: input.planning.dataModel.entities.length ? "The approved data model contains persistent entities; the user must approve a database mode." : "The approved planning package contains no persistent entities; the user must explicitly approve NONE.", authRequired: input.planning.authentication.required, storageRequired: input.planning.storage.decision === "supabase-storage", dataContractIds: entityIds });
  const decisionRef = { id: databaseDecision.databaseDecisionId, checksum: databaseDecision.checksum };
  const dataContracts = input.dataContracts ?? input.planning.dataModel.entities.map((entity, index) => createDataContract({ dataContractId: entityIds[index], projectId: input.projectId, projectVersion: input.projectVersion, createdAt: input.createdAt, name: entity.name, requirementReferences: entity.requirementReferences, fields: entity.fields.map((field) => ({ fieldId: field.name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^[^a-z]/, "field_"), type: field.type, required: field.required, sensitivity: field.public ? "PUBLIC" as const : "CONFIDENTIAL" as const })), persistence: "DATABASE_PERSISTED", databaseDecisionRef: decisionRef, databaseEntity: entity.name, validationRules: ["Strict schema validation before persistence"], trustBoundary: "SERVER" }));
  const dependencyProposal = input.dependencyProposal ?? buildDependencyProposal({ dependencyProposalId: randomUUID(), projectId: input.projectId, projectVersion: input.projectVersion, createdAt: input.createdAt, planningChecksum: input.planningChecksum, dependencies: input.planning.dependencies.dependencies.map((dependency) => { const parsed = parseDependencySpec(dependency.name); return { packageName: parsed.packageName, versionSpec: parsed.versionSpec ?? getDependencyCatalogEntry(parsed.packageName)?.allowedVersionSpec ?? "*", section: dependency.runtime === "runtime" ? "dependencies" as const : "devDependencies" as const, required: dependency.required, requirementReferences: dependency.requirementReferences, rationale: dependency.purpose }; }) }, { projectId: input.projectId, projectVersion: input.projectVersion, planningChecksum: input.planningChecksum, plannedDependencies: input.planning.dependencies.dependencies.map((dependency) => ({ name: dependency.name, runtime: dependency.runtime, required: dependency.required })) });
  const planningAcceptance = createPlanningAcceptance({ projectId: input.projectId, projectVersion: input.projectVersion, planningChecksum: input.planningChecksum, databaseDecision, dependencyProposal, architectureChecksum: input.architectureChecksum, designChecksum: input.designChecksum, createdAt: input.createdAt });
  const base = { schemaVersion: PHASE_7C_SCHEMA_VERSION, documentType: "phase-7c-contract-package" as const, projectId: input.projectId, projectVersion: input.projectVersion, createdAt: input.createdAt, updatedAt: input.createdAt, phaseId: "PHASE_7C" as const, contractPolicyVersion: PHASE_7C_POLICY_VERSION, approvedBriefChecksum: input.approvedBriefChecksum, planningChecksum: input.planningChecksum, architectureChecksum: input.architectureChecksum, designChecksum: input.designChecksum, status: "PENDING_USER_APPROVAL" as const, databaseDecision, dataContracts, taskContracts: [] as TaskContract[], dependencyProposal, planningAcceptance, safeEnvironmentMetadata: databaseDecision.connectionRequirements, traceability: dataContracts.flatMap((contract) => contract.requirementReferences.map((requirementReference) => ({ requirementReference, planningReference: `data:${contract.name}`, taskContractId: "00000000-0000-4000-8000-000000000000", dataContractIds: [contract.dataContractId], artifactPaths: [], validationIds: ["validate-contracts"] }))), architectureAccepted: false, contractAuditAccepted: false, designSelected: false, currentness: { status: "CURRENT" as const, derivedFromChecksum: input.planningChecksum, checkedAt: input.createdAt } };
  return Phase7CContractPackageSchema.parse(base);
}

export function approvePhase7CContractPackage(pkg: Phase7CContractPackage, input: { actorId: string; approvedAt: string }) {
  const dependencyProposal = validateDependencyProposal(pkg.dependencyProposal, dependencyAuthorityContextFromProposal(pkg.dependencyProposal));
  const databaseDecision = validateDatabaseDecision(pkg.databaseDecision);
  const planningAcceptance = approvePlanningAcceptance(pkg.planningAcceptance, input);
  return validatePhase7CContractPackage({ ...pkg, status: "APPROVED", databaseDecision, dependencyProposal, planningAcceptance, updatedAt: input.approvedAt });
}
