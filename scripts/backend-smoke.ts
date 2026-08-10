import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { AgentTaskSchema } from "../src/domain/tasks/schema";
import { ImplementationChangeProposalSchema } from "../src/agents/implementation/contracts";
import { validateBackendProposal } from "../src/agents/implementation/backend";

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
    console.log(JSON.stringify({ tasksPassed: 2, migrationExecuted: false, npmExecuted: false, networkRequested: false, temporaryRoot: true }));
  } finally { await rm(root, { recursive: true, force: true }); }
}
void main();
