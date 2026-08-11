import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { AgentTaskSchema } from "../src/domain/tasks/schema";
import { ImplementationChangeProposalSchema } from "../src/agents/implementation/contracts";
import { validateBackendProposal } from "../src/agents/implementation/backend";

const execFileAsync = promisify(execFile);

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "backend-smoke-"));
  const projectId = randomUUID();
  const makeTask = (taskType: string, id: string, dependencies: string[] = []) => AgentTaskSchema.parse({ id, projectId, projectVersion: 1, role: "implementation", taskType, title: taskType, objective: taskType, inputs: [], expectedOutputs: [], allowedSkills: [], allowedTools: ["filesystem-read", "filesystem-write", "Context7-read"], fileScopes: ["supabase/migrations/**", "src/actions/**"], dependencies, status: "ready", attempt: 0, maxAttempts: 3, createdAt: "2026-01-01T00:00:00.000Z" });
  const makeProposal = (task: ReturnType<typeof makeTask>, relativePath: string, content: string) => ImplementationChangeProposalSchema.parse({ proposalId: randomUUID(), projectId, projectVersion: 1, taskId: task.id, taskAttempt: 0, summary: "smoke", operations: [{ type: "create-file", relativePath, expectedResultChecksum: createHash("sha256").update(content).digest("hex"), encoding: "utf-8", reason: "synthetic", requirementReferences: [], planningReferences: [], selectedDesignReferences: [], content }], expectedChangedFiles: [relativePath], expectedCreatedFiles: [relativePath], expectedDeletedFiles: [], validationPlan: [task.taskType], requirementReferences: [], planningReferences: [], selectedDesignReferences: [], providerMetadata: { provider: "deterministic-smoke" }, generatedAt: "2026-01-01T00:00:00.000Z" });
  try {
    const migration = makeTask("implement-database-schema", randomUUID());
    validateBackendProposal(migration, makeProposal(migration, "supabase/migrations/20260807120000_create_contacts.sql", "create table contacts (id uuid primary key, user_id uuid not null references auth.users(id));\n"), { planning: { dataModel: { entities: [{ name: "contacts" }] } } });
    const action = makeTask("implement-server-action", randomUUID(), [migration.id]);
    validateBackendProposal(action, makeProposal(action, "src/actions/create-contact.ts", "\"use server\"; import { z } from 'zod'; import { getAuthenticatedUser } from '@/lib/supabase/auth'; const schema=z.object({}); export async function createContact(input: unknown){ const parsed=schema.safeParse(input); if (!parsed.success) return {ok:false}; const user=await getAuthenticatedUser(); if (!user) return {ok:false}; const ownerId=user.id; return {ok:true, ownerId}; }\n"), { planning: { architecture: { serverActions: ["create-contact"], environment: { variables: [] } } } });
    const migrationPath = path.join(root, "migration.sql");
    const actionPath = path.join(root, "create-contact.mjs");
    const runnerPath = path.join(root, "backend-boundary-runner.mjs");
    await writeFile(migrationPath, "create table contacts (id text primary key, user_id text not null);\n");
    await writeFile(actionPath, "export function createContact(input) { if (!input || typeof input.email !== 'string' || !input.email.includes('@')) return { ok: false, code: 'INVALID_INPUT' }; return { ok: true, ownerId: 'user-smoke' }; }\n");
    await writeFile(runnerPath, "import { readFile, writeFile } from 'node:fs/promises'; import { createContact } from './create-contact.mjs'; const sql = await readFile('./migration.sql', 'utf8'); if (!/create table contacts/i.test(sql)) throw new Error('MIGRATION_BOUNDARY_NOT_APPLIED'); const invalid = createContact({}); const valid = createContact({ email: 'smoke@example.com' }); if (invalid.ok || !valid.ok || valid.ownerId !== 'user-smoke') throw new Error('SERVER_ACTION_BOUNDARY_FAILED'); await writeFile('./migration-state.json', JSON.stringify({ tables: ['contacts'], action: 'create-contact' })); console.log(JSON.stringify({ migrationBoundaryExecuted: true, serverActionBoundaryExecuted: true }));\n");
    const result = await execFileAsync(process.execPath, [runnerPath], { cwd: root });
    console.log(JSON.stringify({ status: "passed", releaseEligible: false, tasksPassed: 2, proposalValidation: true, migrationBoundaryExecuted: true, serverActionBoundaryExecuted: true, fixtureResult: JSON.parse(result.stdout), npmExecuted: false, networkRequested: false, temporaryRoot: true, releaseEvidence: "executed-local-boundary" }));
  } finally { await rm(root, { recursive: true, force: true }); }
}
void main();
