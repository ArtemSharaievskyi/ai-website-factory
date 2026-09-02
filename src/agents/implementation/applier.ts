import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentTask } from "@/domain/tasks/schema";
import { ownershipForTask } from "@/domain/tasks/ownership";
import { assertGeneratedPackageManifest, DependencyAuthorityError, type DependencyAuthorityContext } from "@/dependencies/authority";
import { validatePhase7CContractPackage, validateTaskContractBinding, type Phase7CContractPackage } from "@/domain/contracts/phase7c";
import { AstPatchOperationSchema, type AstPatchExecutionEvidence, type AstPatchOperation } from "@/domain/implementation/ast-patching";
import { applyAstPatch, AstPatchFailure } from "./ast-patch-executor";
import { ImplementationChangeProposalSchema, type ImplementationChangeProposal, type ExecutionPolicy } from "./contracts";
import { ImplementationError } from "./errors";
import { isWithinTaskScope } from "./scope";
import { validateTaskCapabilityBinding } from "@/orchestration/tooling/authority";

const sha = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const fileNameUnsafe = (value: string) => value.startsWith("/") || /^[A-Za-z]:/.test(value) || value.includes("\0") || value.split("/").includes("..") || value.split("/").some((part) => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(part));
const forbidden = (value: string) => value === ".git" || value.startsWith(".git/") || value === ".factory" || value.startsWith(".factory/") || /(^|\/)\.env(?:\.|$)/i.test(value) && value !== ".env.example" || value.startsWith("node_modules/") || value.startsWith(".next/") || value.startsWith("dist/") || value.startsWith("coverage/") || /(^|\/)(pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|bun\.lockb?)$/i.test(value) || /\.(zip|tar|gz|7z|rar|exe|dll)$/i.test(value);
const secretLike = /(sk-[A-Za-z0-9]{12,}|AKIA[A-Z0-9]{12,}|BEGIN .*PRIVATE KEY|DATABASE_URL\s*[:=]|password\s*[:=])/i;

type Currentness = { taskGraphChecksum?: string };
const normalized = (value: string) => value.replaceAll("\\", "/");
const isAst = (operation: { type: string }): operation is AstPatchOperation => operation.type === "ast-patch";
const astModule = (operation: AstPatchOperation) => operation.patchKind === "ADD_NAMED_IMPORT" ? operation.payload.moduleSpecifier : operation.selector.selectorKind === "import-declaration" || operation.selector.selectorKind === "import-specifier" ? operation.selector.moduleSpecifier : "";

function astError(error: AstPatchFailure) {
  return new ImplementationError(error.code, error.message, undefined, error.details);
}

export function validateProposal(
  task: AgentTask,
  proposal: ImplementationChangeProposal,
  root: string,
  policy: ExecutionPolicy,
  dependencyContext: DependencyAuthorityContext = {},
  phase7cPackage?: Phase7CContractPackage,
  currentness: Currentness = {},
) {
  try { ImplementationChangeProposalSchema.parse(proposal); } catch (error) { throw new ImplementationError("IMPLEMENTATION_INPUT_INVALID", "Change proposal does not match the strict contract.", error); }
  if (proposal.projectId !== task.projectId || proposal.projectVersion !== task.projectVersion || proposal.taskId !== task.id || proposal.taskAttempt !== task.attempt) throw new ImplementationError("IMPLEMENTATION_GRAPH_STALE", "Change proposal does not match the authorized task attempt.");
  const astOperations = proposal.operations.filter(isAst);
  if (astOperations.length > 0) {
    const capabilityBinding = validateTaskCapabilityBinding(task);
    if (!capabilityBinding.valid || task.role !== "implementation" || !task.allowedTools.includes("controlled-edit") || !task.requiredCapabilities?.includes("edit.ast-patch")) throw new ImplementationError("AST_PATCH_UNAUTHORIZED_CAPABILITY", "AST patching requires the implementation role, controlled-edit permission, and edit.ast-patch capability.");
    if (!phase7cPackage || !task.phase7c || !proposal.phase7c) throw new ImplementationError("AST_PATCH_TASK_CONTRACT_STALE", "AST patching requires the current Phase 7C TaskContract binding.");
    if (currentness.taskGraphChecksum && currentness.taskGraphChecksum !== astOperations[0].taskGraphChecksum) throw new ImplementationError("AST_PATCH_TASK_CONTRACT_STALE", "AST patching is bound to a stale TaskGraph checksum.");
    if (astOperations.length > (policy.maxAstPatchOperations ?? 8)) throw new ImplementationError("AST_PATCH_PAYLOAD_TOO_LARGE", "AST patch operation count exceeded the bounded policy.");
  }
  if (phase7cPackage) {
    try {
      const contract = phase7cPackage.taskContracts.find((candidate) => candidate.taskId === (task.taskType === "repair-targeted-failure" ? task.repairOfTaskId : task.id) || (task.taskType === "repair-targeted-failure" && candidate.taskContractId === task.phase7c?.taskContractId));
      if (!contract) throw new Error("TaskContract is missing.");
      validateTaskContractBinding({ ...task, phase7cTaskContractId: task.phase7c?.taskContractId }, contract);
      if (!proposal.phase7c || proposal.phase7c.taskContractId !== contract.taskContractId || proposal.phase7c.taskContractChecksum !== contract.checksum) throw new Error("ChangeProposal is not bound to the current TaskContract.");
      if (proposal.phase7c.databaseDecisionId && proposal.phase7c.databaseDecisionChecksum !== phase7cPackage.databaseDecision.checksum) throw new Error("ChangeProposal database binding is stale.");
      if (phase7cPackage.databaseDecision.mode === "NONE" && ((task.taskType.includes("database")) || task.taskType === "implement-rls-policy" || proposal.operations.some((operation) => /^(supabase\/migrations|src\/lib\/supabase)(?:\/|$)/i.test(operation.relativePath)))) throw new Error("Database implementation is forbidden under DatabaseDecision NONE.");
      validatePhase7CContractPackage(phase7cPackage);
    } catch (error) { throw new ImplementationError(astOperations.length > 0 ? "AST_PATCH_TASK_CONTRACT_STALE" : "IMPLEMENTATION_GRAPH_STALE", "Change proposal violates the current Phase 7C contract chain.", error); }
  }
  if (proposal.operations.length > policy.maxProposalOperations) throw new ImplementationError("IMPLEMENTATION_CONTENT_LIMIT_EXCEEDED", "Proposal operation limit was exceeded.");
  const paths = proposal.operations.map((operation) => normalized(operation.relativePath));
  for (const relative of new Set(paths)) {
    const operationsForPath = proposal.operations.filter((operation) => normalized(operation.relativePath) === relative);
    if (operationsForPath.length > 1 && operationsForPath.some((operation) => !isAst(operation))) throw new ImplementationError("IMPLEMENTATION_OPERATION_CONFLICT", "Only AST patch operations may be sequenced against one file.");
  }
  const scopes = task.taskType === "implement-project-foundation" ? [...new Set([...task.fileScopes, ...(ownershipForTask(task.taskType)?.scopes ?? [])])] : task.fileScopes;
  for (const operation of proposal.operations) {
    const relative = normalized(operation.relativePath);
    if (relative === "package-lock.json") throw new ImplementationError("IMPLEMENTATION_FORBIDDEN_FILE", "package-lock.json is Factory-generated by the fixed npm materialization command and cannot be AI-authored.");
    if (fileNameUnsafe(relative)) throw new ImplementationError("IMPLEMENTATION_PATH_INVALID", "Proposal path is unsafe.");
    if (forbidden(relative)) throw new ImplementationError(isAst(operation) ? "AST_PATCH_RESTRICTED_PATH" : "IMPLEMENTATION_FORBIDDEN_FILE", "Proposal targets a forbidden file.");
    if (!scopes.some((scope) => isWithinTaskScope(scope, relative))) throw new ImplementationError(isAst(operation) ? "AST_PATCH_SCOPE_VIOLATION" : "IMPLEMENTATION_SCOPE_VIOLATION", `Proposal path is outside task scope: path=${relative}; operation=${operation.type}; scopes=${scopes.join(",")}.`);
    if (operation.encoding !== "utf-8") throw new ImplementationError("IMPLEMENTATION_BINARY_UNSUPPORTED", "Only UTF-8 text operations are supported.");
    if (isAst(operation)) {
      if (!/\.(?:ts|tsx)$/i.test(relative)) throw new ImplementationError("AST_PATCH_UNSUPPORTED_FILE", "AST patches are supported only for .ts and .tsx files.");
      if (operation.taskId !== task.id || operation.projectId !== task.projectId || operation.projectVersion !== task.projectVersion || (currentness.taskGraphChecksum && operation.taskGraphChecksum !== currentness.taskGraphChecksum)) throw new ImplementationError("AST_PATCH_TASK_CONTRACT_STALE", "AST patch identity is stale for the current task graph.");
      if (!task.phase7c || operation.taskContractId !== task.phase7c.taskContractId || operation.taskContractChecksum !== task.phase7c.taskContractChecksum) throw new ImplementationError("AST_PATCH_TASK_CONTRACT_STALE", "AST patch is not bound to the current task contract.");
      const parsed = AstPatchOperationSchema.safeParse(operation);
      if (!parsed.success) throw new ImplementationError("AST_PATCH_PAYLOAD_INVALID", "AST patch operation failed strict validation.");
      const payload = JSON.stringify(operation.payload);
      if (Buffer.byteLength(payload, "utf8") > (policy.maxAstPatchPayloadBytes ?? 32000) || secretLike.test(payload)) throw new ImplementationError("AST_PATCH_PAYLOAD_TOO_LARGE", "AST patch payload is too large or contains secret-like data.");
      if (phase7cPackage?.databaseDecision.mode === "NONE" && /(?:supabase|@supabase)/i.test(astModule(operation))) throw new ImplementationError("AST_PATCH_UNAPPROVED_DEPENDENCY", "Supabase imports are forbidden when DatabaseDecision is NONE.");
    } else {
      const content = operation.type === "patch-text" ? operation.newText : operation.type === "delete-file" ? "" : operation.content;
      if (Buffer.byteLength(content, "utf8") > policy.maxOperationContentBytes || secretLike.test(content)) throw new ImplementationError("IMPLEMENTATION_CONTENT_LIMIT_EXCEEDED", "Proposal content is too large or contains secret-like data.");
      if (relative === "package.json" && operation.type !== "delete-file") {
        let parsed: unknown;
        try { parsed = JSON.parse(content); } catch (error) { throw new ImplementationError("PACKAGE_JSON_INVALID", "package.json content is invalid.", error); }
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new ImplementationError("PACKAGE_JSON_INVALID", "package.json must contain a JSON object.");
        try { assertGeneratedPackageManifest(parsed as Record<string, unknown>, dependencyContext); } catch (error) { if (error instanceof DependencyAuthorityError) { if (error.code === "PACKAGE_MANAGER_NOT_ALLOWED") throw new ImplementationError("PACKAGE_MANAGER_POLICY_VIOLATION", error.message, error); throw new ImplementationError("UNAPPROVED_DEPENDENCY", error.message, error); } throw error; }
      }
    }
  }
  return true;
}

export interface AppliedChanges { changedFiles: string[]; createdFiles: string[]; deletedFiles: string[]; beforeChecksums: Record<string, string>; afterChecksums: Record<string, string>; astPatchEvidence?: AstPatchExecutionEvidence[]; rollback: () => Promise<void>; }

export class AtomicChangeApplier {
  async apply(task: AgentTask, proposal: ImplementationChangeProposal, rootDirectory: string, policy: ExecutionPolicy, isCancelled: () => boolean = () => false, dependencyContext: DependencyAuthorityContext = {}, phase7cPackage?: Phase7CContractPackage, currentness: Currentness = {}): Promise<AppliedChanges> {
    validateProposal(task, proposal, rootDirectory, policy, dependencyContext, phase7cPackage, currentness);
    const root = path.resolve(rootDirectory);
    const transaction = path.join(root, policy.transactionDirectoryName, proposal.proposalId);
    await mkdir(transaction, { recursive: true });
    const backups = new Map<string, Buffer | null>();
    const beforeChecksums: Record<string, string> = {};
    const touched = [...new Set(proposal.operations.map((operation) => normalized(operation.relativePath)))];
    const astPatchEvidence: AstPatchExecutionEvidence[] = [];
    const appliedTargetKeys = new Set<string>();
    let rolledBack = false;
    const rollback = async () => {
      if (rolledBack) return;
      let rollbackError: unknown;
      for (const [relative, previous] of backups) {
        const target = path.resolve(root, relative);
        try { if (previous === null) await rm(target, { force: true }); else { await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, previous, { flag: "w", mode: 0o600 }); } } catch (error) { rollbackError ??= error; }
      }
      if (!rollbackError) for (const [relative, previous] of backups) {
        const target = path.resolve(root, relative);
        try {
          if (previous === null) { await lstat(target); rollbackError = new Error(`Created target remained after rollback: ${relative}`); }
          else if (sha(await readFile(target)) !== sha(previous)) rollbackError = new Error(`Original target checksum was not restored: ${relative}`);
        } catch (error) { if (previous !== null || (error as NodeJS.ErrnoException).code !== "ENOENT") rollbackError = error; }
      }
      if (rollbackError) throw new ImplementationError("AST_PATCH_ROLLBACK_FAILED", "Workspace rollback could not be proven complete.", rollbackError);
      rolledBack = true;
    };
    try {
      for (const [index, operation] of proposal.operations.entries()) {
        if (isCancelled()) throw new ImplementationError("IMPLEMENTATION_CANCELLED", "Implementation was cancelled before file application.");
        const relative = normalized(operation.relativePath);
        const target = path.resolve(root, relative);
        if (!target.toLowerCase().startsWith(`${root.toLowerCase()}${path.sep}`)) throw new ImplementationError("IMPLEMENTATION_PATH_INVALID", "Resolved proposal path escapes the staging workspace.");
        let previous: Buffer | null = null;
        try { const info = await lstat(target); if (info.isSymbolicLink() || !info.isFile()) throw new ImplementationError("IMPLEMENTATION_WORKSPACE_TAMPERED", "A target path is not a regular file."); previous = await readFile(target); } catch (error) { if (error instanceof ImplementationError) throw error; if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        if (!backups.has(relative)) { backups.set(relative, previous); if (previous) beforeChecksums[relative] = sha(previous); }
        const previousChecksum = previous ? sha(previous) : undefined;
        if (!isAst(operation) && operation.expectedPriorChecksum && operation.expectedPriorChecksum !== previousChecksum) throw new ImplementationError("IMPLEMENTATION_CHECKSUM_MISMATCH", "A proposal prior checksum is stale.");
        let next: Buffer | null = null;
        if (operation.type === "delete-file") next = null;
        else if (operation.type === "patch-text") {
          if (!previous) throw new ImplementationError("IMPLEMENTATION_EXPECTED_FILE_MISSING", "Patch target does not exist.");
          const current = previous.toString("utf8");
          if (current.split(operation.oldText).length - 1 !== 1) throw new ImplementationError("IMPLEMENTATION_OPERATION_CONFLICT", "Patch text must match exactly once.");
          next = Buffer.from(current.replace(operation.oldText, operation.newText), "utf8");
        } else if (isAst(operation)) {
          if (!previous || (sha(previous) !== operation.expectedFileChecksum && sha(previous) !== operation.expectedResultChecksum)) throw new ImplementationError("AST_PATCH_FILE_STALE", "The AST patch target changed after proposal generation.");
          const replayed = sha(previous) === operation.expectedResultChecksum && sha(previous) !== operation.expectedFileChecksum;
          let result;
          try { result = applyAstPatch(replayed ? { ...operation, expectedFileChecksum: sha(previous) } : operation, previous.toString("utf8"), { task, taskScopes: task.fileScopes, dependencyContext, maxPayloadBytes: policy.maxAstPatchPayloadBytes ?? 32000 }); } catch (error) { if (error instanceof AstPatchFailure) throw astError(error); throw error; }
          if (appliedTargetKeys.has(result.targetKey)) throw new ImplementationError("AST_PATCH_OPERATION_CONFLICT", "AST operations overlap the same structural target.");
          appliedTargetKeys.add(result.targetKey);
          astPatchEvidence.push(replayed ? { ...result.evidence, result: "IDEMPOTENT_NOOP" } : result.evidence);
          next = Buffer.from(result.source, "utf8");
        } else next = Buffer.from(operation.content, "utf8");
        if (next && sha(next) !== operation.expectedResultChecksum) throw new ImplementationError("IMPLEMENTATION_RESULT_CHECKSUM_MISMATCH", "Operation result checksum does not match.");
        if (next) { await mkdir(path.dirname(target), { recursive: true }); const temp = path.join(transaction, `${index}.tmp`); await writeFile(temp, next, { flag: "wx", mode: 0o600 }); await rename(temp, target); }
        else if (previous) await rm(target, { force: false });
      }
      const afterChecksums: Record<string, string> = {};
      const createdFiles: string[] = [];
      const deletedFiles: string[] = [];
      for (const relative of touched) {
        const target = path.resolve(root, relative);
        try { const current = await readFile(target); afterChecksums[relative] = sha(current); if (!backups.get(relative)) createdFiles.push(relative); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") deletedFiles.push(relative); else throw error; }
      }
      await rm(transaction, { recursive: true, force: true });
      return { changedFiles: touched, createdFiles, deletedFiles, beforeChecksums, afterChecksums, ...(astPatchEvidence.length ? { astPatchEvidence } : {}), rollback };
    } catch (error) {
      let rollbackError: unknown;
      try { await rollback(); } catch (rollbackFailure) { rollbackError = rollbackFailure; }
      await rm(transaction, { recursive: true, force: true }).catch((cleanupFailure) => { rollbackError ??= cleanupFailure; });
      if (rollbackError) throw rollbackError;
      if (error instanceof ImplementationError) throw error;
      throw new ImplementationError("IMPLEMENTATION_WORKSPACE_TAMPERED", "Atomic proposal application failed and was rolled back.", error);
    }
  }
}
