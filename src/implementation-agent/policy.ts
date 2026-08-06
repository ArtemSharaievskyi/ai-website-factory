import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { checksumPersistedDocument } from "../persistence/serialization";
import { ImplementationError } from "./errors";
import { ImplementationContextSchema, type ImplementationAgentInput, type ImplementationContext } from "./contracts";

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const safePattern = (pattern: string, candidate: string) => { const escaped = pattern.replaceAll("\\", "/").replace(/\*\*/g, "§§").replace(/\*/g, "[^/]*").replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("§§", ".*"); return new RegExp(`^${escaped}$`, "i").test(candidate.replaceAll("\\", "/")); };
const secretLike = /(sk-[A-Za-z0-9]{12,}|AKIA[A-Z0-9]{12,}|-----BEGIN .*PRIVATE KEY-----|password\s*[:=]|DATABASE_URL\s*[:=])/i;
export type SkillLoader = { load(request: { skillId: string; role: "implementation"; taskType: string; requestedTools: string[]; contextBudgetBytes: number }): Promise<{ skillMarkdown: string; references: Array<{ relativePath: string; content: string }> }> };
export interface ExecutionWorkspacePort { verifyStaging(projectId: string, version: number, reservationId: string, stagingPath: string): Promise<boolean>; }
export interface ContextAssemblerDependencies { workspace: ExecutionWorkspacePort; skillLoader?: SkillLoader; }
export class TaskContextAssembler {
  constructor(private readonly policy: { maxContextBytes: number; maxContextFiles: number; maxSourceFileBytes: number }, private readonly dependencies: ContextAssemblerDependencies) {}
  async assemble(input: ImplementationAgentInput): Promise<ImplementationContext> {
    if (!(await this.dependencies.workspace.verifyStaging(input.projectId, input.projectVersion, input.workspaceReservationId, input.stagingWorkspacePath))) throw new ImplementationError("IMPLEMENTATION_WORKSPACE_INVALID", "The staging workspace could not be verified.");
    const files: Array<{ relativePath: string; sha256: string; content: string }> = [];
    const root = path.resolve(input.stagingWorkspacePath);
    const walk = async (directory: string) => { let entries; try { entries = await readdir(directory, { withFileTypes: true }); } catch (error) { throw new ImplementationError("IMPLEMENTATION_CONTEXT_FILE_UNREADABLE", "A scoped workspace directory could not be read.", error); } for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) { if (files.length >= this.policy.maxContextFiles) throw new ImplementationError("IMPLEMENTATION_CONTEXT_FILE_LIMIT", "The task context file limit was exceeded."); const full = path.join(directory, entry.name); const relative = path.relative(root, full).replaceAll("\\", "/"); if ([".git", ".factory", "node_modules", ".next", "dist", "coverage"].some((name) => relative === name || relative.startsWith(`${name}/`))) continue; if ((await lstat(full)).isDirectory()) { await walk(full); continue; } if (!input.task.fileScopes.some((scope) => safePattern(scope, relative))) continue; const bytes = await readFile(full); if (bytes.length > this.policy.maxSourceFileBytes) throw new ImplementationError("IMPLEMENTATION_CONTEXT_TOO_LARGE", "A scoped source file exceeds the context file limit."); const content = bytes.toString("utf8"); if (secretLike.test(content)) throw new ImplementationError("IMPLEMENTATION_SECRET_EXPOSURE_BLOCKED", "Secret-like content cannot enter implementation context."); files.push({ relativePath: relative, sha256: sha(bytes.toString("utf8")), content }); } };
    await walk(root);
    const skills = []; for (const skillId of input.task.allowedSkills) { if (!this.dependencies.skillLoader) throw new ImplementationError("IMPLEMENTATION_SKILL_STALE", "An assigned skill cannot be loaded in the current execution boundary."); try { const loaded = await this.dependencies.skillLoader.load({ skillId, role: "implementation", taskType: input.task.taskType, requestedTools: input.task.allowedTools, contextBudgetBytes: this.policy.maxContextBytes }); skills.push({ skillId, markdown: loaded.skillMarkdown, references: loaded.references }); } catch (error) { throw new ImplementationError("IMPLEMENTATION_SKILL_STALE", "An assigned skill could not be loaded safely.", error); } }
    const context = ImplementationContextSchema.parse({ task: input.task, acceptanceCriteria: input.task.acceptanceCriteria ?? [], requirementReferences: input.task.requirementReferences ?? [], planningReferences: input.task.planningReferences ?? [], selectedDesignReferences: input.task.selectedDesignReferences ?? [], architectureExcerpt: input.technicalArchitecture, contentExcerpt: input.contentPlan, assetExcerpt: input.assetManifest, files, skills, allowedTools: input.task.allowedTools, conventions: ["npm only", "UTF-8 text files", "no Factory metadata writes", "no command execution"], contextChecksum: checksumPersistedDocument({ task: input.task, files, skills, allowedTools: input.task.allowedTools }) });
    if (Buffer.byteLength(JSON.stringify(context), "utf8") > this.policy.maxContextBytes) throw new ImplementationError("IMPLEMENTATION_CONTEXT_TOO_LARGE", "The bounded task context exceeds the configured byte limit.");
    return context;
  }
}
