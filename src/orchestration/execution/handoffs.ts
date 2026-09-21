import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { readDirectory } from "@/runtime/filesystem/directory";
import path from "node:path";
import { implementationProfileRegistry, type ImplementationDomain } from "@/domain/implementation/profiles";
import {
  assertCurrentBackendImplementationContract,
  assertCurrentDatabaseImplementationContract,
  checksumBackendImplementationContract,
  checksumDatabaseImplementationContract,
  type SpecialistExecutionTelemetry,
} from "@/domain/implementation/contracts";
import type { ImplementationExecutionRun } from "@/domain/implementation/schema";
import type { AgentTask, TaskGraph } from "@/domain/tasks/schema";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import { DocumentRepository, saveDocumentCASInTransaction } from "@/persistence/database/repositories";
import type { PersistenceDatabase } from "@/persistence/database/types";

const HASH = "0".repeat(64);
const excluded = new Set([".git", ".factory", "node_modules", ".next", "dist", "coverage"]);
const sourceFile = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|scss|html|md|yml|yaml|toml|sql)$/i;

/** Stable task topology identity; task status and attempts do not stale an upstream contract. */
export const taskGraphIdentityChecksum = (graph: TaskGraph) => checksumPersistedDocument({
  projectId: graph.projectId,
  projectVersion: graph.projectVersion,
  sourceDocumentChecksums: graph.sourceDocumentChecksums ?? {},
  tasks: graph.tasks.map((task) => ({ id: task.id, taskType: task.taskType, implementationDomain: task.implementationDomain, specialistProfileId: task.specialistProfileId, dependencies: task.dependencies, fileScopes: task.fileScopes, phase7c: task.phase7c })).sort((left, right) => left.id.localeCompare(right.id)),
});

export async function workspaceSourceChecksum(workspacePath: string) {
  const root = path.resolve(workspacePath);
  const files: Array<{ relativePath: string; checksum: string }> = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await readDirectory(directory);
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (excluded.has(entry.name) || entry.name.startsWith(".env")) continue;
      const full = path.join(directory, entry.name);
      const info = await lstat(full);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) await walk(full);
      else if (info.isFile() && sourceFile.test(entry.name)) files.push({ relativePath: path.relative(root, full).replaceAll("\\", "/"), checksum: createHash("sha256").update(await readFile(full)).digest("hex") });
    }
  };
  await walk(root);
  return checksumPersistedDocument(files.sort((left, right) => left.relativePath.localeCompare(right.relativePath)));
}

const domainOf = (task: AgentTask): ImplementationDomain | undefined => task.implementationDomain;
const hasDependencyInDomain = (graph: TaskGraph, task: AgentTask, domain: ImplementationDomain): boolean => {
  const byId = new Map(graph.tasks.map((candidate) => [candidate.id, candidate]));
  const seen = new Set<string>();
  const visit = (id: string): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    const candidate = byId.get(id);
    return Boolean(candidate && (domainOf(candidate) === domain || candidate.dependencies.some(visit)));
  };
  return task.dependencies.some(visit);
};

export class ProductionHandoffService {
  private readonly documents: DocumentRepository;
  constructor(private readonly database: PersistenceDatabase, private readonly workspacePath: string) {
    this.documents = new DocumentRepository(database);
  }

  async loadForTask(graph: TaskGraph, task: AgentTask) {
    const domain = domainOf(task);
    if (!domain) return {};
    const expected = {
      taskGraphChecksum: taskGraphIdentityChecksum(graph),
      architectureChecksum: graph.sourceDocumentChecksums?.architecture ?? HASH,
      workspaceChecksum: await workspaceSourceChecksum(this.workspacePath),
    };
    if (domain === "BACKEND" && hasDependencyInDomain(graph, task, "DATABASE")) {
      const value = await this.documents.get(graph.projectId, graph.projectVersion, "database-implementation-contract");
      if (!value || value.documentType !== "database-implementation-contract") throw new Error("DOMAIN_HANDOFF_STALE");
      return { database: assertCurrentDatabaseImplementationContract(value, expected) };
    }
    if (domain === "FRONTEND" && hasDependencyInDomain(graph, task, "BACKEND")) {
      const backend = await this.documents.get(graph.projectId, graph.projectVersion, "backend-implementation-contract");
      if (!backend || backend.documentType !== "backend-implementation-contract") throw new Error("DOMAIN_HANDOFF_STALE");
      const database = await this.documents.get(graph.projectId, graph.projectVersion, "database-implementation-contract");
      const databaseChecksum = database?.documentType === "database-implementation-contract" ? database.checksum : undefined;
      return { backend: assertCurrentBackendImplementationContract(backend, { ...expected, ...(databaseChecksum ? { databaseContractChecksum: databaseChecksum } : {}) }) };
    }
    return {};
  }

  async persistAfterTask(graph: TaskGraph, task: AgentTask, run: ImplementationExecutionRun, handoffs: Awaited<ReturnType<ProductionHandoffService["loadForTask"]>>) {
    const domain = domainOf(task);
    if (!domain || run.status !== "passed") return;
    const createdAt = run.completedAt ?? new Date().toISOString();
    const currentness = {
      taskGraphChecksum: taskGraphIdentityChecksum(graph),
      architectureChecksum: graph.sourceDocumentChecksums?.architecture ?? HASH,
      workspaceChecksum: await workspaceSourceChecksum(this.workspacePath),
      upstreamArtifactChecksum: checksumPersistedDocument(run.afterChecksums),
    };
    const profile = implementationProfileRegistry.forDomain(domain);
    if (domain === "DATABASE") {
      const planning = await this.documents.get(graph.projectId, graph.projectVersion, "planning-package");
      const entities = planning?.documentType === "planning-package"
        ? planning.dataModel.entities.map((entity) => ({ name: entity.name, typeReference: `database:${entity.name}`, allowedOperations: ["SELECT", "INSERT", "UPDATE", "DELETE"] as Array<"SELECT" | "INSERT" | "UPDATE" | "DELETE"> }))
        : [];
      const base = {
        schemaVersion: 1 as const, documentType: "database-implementation-contract" as const,
        projectId: graph.projectId, projectVersion: graph.projectVersion, createdAt, updatedAt: createdAt,
        contractId: randomUUID(), sourceTaskId: task.id, sourceTaskAttempt: run.attempt,
        specialistProfileId: "database-implementation" as const, specialistProfileChecksum: profile.checksum,
        currentness, schemaChecksum: checksumPersistedDocument(run.afterChecksums), migrationChecksum: checksumPersistedDocument(Object.entries(run.afterChecksums).filter(([file]) => file.startsWith("supabase/migrations/"))),
        entities, hostLifecycle: { createdBy: "Factory" as const, providerAttempts: 0 as const },
      };
      const document = { ...base, checksum: checksumDatabaseImplementationContract(base) };
      await this.saveCurrent(document);
    }
    if (domain === "BACKEND") {
      const databaseChecksum = handoffs.database?.checksum;
      const prior = await this.documents.get(graph.projectId, graph.projectVersion, "backend-implementation-contract");
      const operations = prior?.documentType === "backend-implementation-contract" ? prior.operations.slice() : [];
      operations.push({ name: task.title, inputSchemaReference: `task:${task.id}:input`, outputSchemaReference: `task:${task.id}:output`, authRequirement: task.taskType === "implement-authentication" ? "AUTHENTICATED" as const : "NONE" as const, errorSemantics: ["safe-error"] });
      const base = {
        schemaVersion: 1 as const, documentType: "backend-implementation-contract" as const,
        projectId: graph.projectId, projectVersion: graph.projectVersion, createdAt: prior?.documentType === "backend-implementation-contract" ? prior.createdAt : createdAt, updatedAt: createdAt,
        contractId: prior?.documentType === "backend-implementation-contract" ? prior.contractId : randomUUID(), sourceTaskId: task.id, sourceTaskAttempt: run.attempt,
        specialistProfileId: "backend-implementation" as const, specialistProfileChecksum: profile.checksum,
        currentness: { ...currentness, ...(databaseChecksum ? { databaseContractChecksum: databaseChecksum } : {}) }, ...(databaseChecksum ? { databaseContractChecksum: databaseChecksum } : {}),
        operations, hostLifecycle: { createdBy: "Factory" as const, providerAttempts: 0 as const },
      };
      const document = { ...base, checksum: checksumBackendImplementationContract(base) };
      await this.saveCurrent(document);
    }
    await this.refreshWorkspaceCurrentness(graph, currentness.workspaceChecksum);
  }

  private async refreshWorkspaceCurrentness(graph: TaskGraph, workspaceChecksum: string) {
    const timestamp = new Date().toISOString();
    const database = await this.documents.get(graph.projectId, graph.projectVersion, "database-implementation-contract");
    let databaseChecksum = database?.documentType === "database-implementation-contract" ? database.checksum : undefined;
    if (database?.documentType === "database-implementation-contract" && database.currentness.workspaceChecksum !== workspaceChecksum) {
      const base = { ...database, updatedAt: timestamp, currentness: { ...database.currentness, workspaceChecksum } };
      const refreshed = { ...base, checksum: checksumDatabaseImplementationContract(base) };
      await this.saveCurrent(refreshed);
      databaseChecksum = refreshed.checksum;
    }
    const backend = await this.documents.get(graph.projectId, graph.projectVersion, "backend-implementation-contract");
    if (backend?.documentType === "backend-implementation-contract" && (backend.currentness.workspaceChecksum !== workspaceChecksum || (databaseChecksum !== undefined && backend.databaseContractChecksum !== databaseChecksum))) {
      const base = { ...backend, updatedAt: timestamp, ...(databaseChecksum ? { databaseContractChecksum: databaseChecksum } : {}), currentness: { ...backend.currentness, workspaceChecksum, ...(databaseChecksum ? { databaseContractChecksum: databaseChecksum } : {}) } };
      await this.saveCurrent({ ...base, checksum: checksumBackendImplementationContract(base) });
    }
  }

  async recordTelemetry(graph: TaskGraph, task: AgentTask, run: ImplementationExecutionRun, context: { contextBytes: number; skillsBytes: number; canonicalSliceBytes: number; contractBytes: number }) {
    const domain = domainOf(task);
    if (!domain || !run.completedAt) return;
    const prior = await this.documents.get(graph.projectId, graph.projectVersion, "specialist-execution-telemetry");
    const telemetry: SpecialistExecutionTelemetry = prior?.documentType === "specialist-execution-telemetry"
      ? prior
      : { schemaVersion: 1, documentType: "specialist-execution-telemetry", projectId: graph.projectId, projectVersion: graph.projectVersion, createdAt: run.startedAt, updatedAt: run.completedAt, entries: [] };
    const profile = implementationProfileRegistry.forDomain(domain);
    const result: "passed" | "failed" | "cancelled" = run.status === "passed" ? "passed" : run.status === "cancelled" ? "cancelled" : "failed";
    const entry = {
      taskId: task.id, domain, specialistProfileId: profile.profileId, specialistProfileChecksum: profile.checksum,
      contextBytes: context.contextBytes, estimatedContextTokens: Math.ceil(context.contextBytes / 4), skillsBytes: context.skillsBytes,
      canonicalSliceBytes: context.canonicalSliceBytes, contractBytes: context.contractBytes,
      resolvedCapabilities: task.requiredCapabilities ?? [], allowedPathCount: task.fileScopes.length,
      ...(run.providerUsageMetadata?.inputTokens !== undefined ? { providerInputTokens: run.providerUsageMetadata.inputTokens } : {}),
      ...(run.providerUsageMetadata?.outputTokens !== undefined ? { providerOutputTokens: run.providerUsageMetadata.outputTokens } : {}),
      startedAt: run.startedAt, finishedAt: run.completedAt, result,
    };
    const entries = [...telemetry.entries.filter((candidate) => candidate.taskId !== task.id || candidate.finishedAt !== entry.finishedAt), entry].slice(-100);
    await this.saveCurrent({ ...telemetry, updatedAt: run.completedAt, entries });
  }

  /** Persistence stays in the Factory document store and rejects a concurrent replacement. */
  private async saveCurrent(document: Parameters<DocumentRepository["save"]>[0]) {
    await this.database.transaction(async (tx) => {
      const current = await tx.getDocument(document.projectId, document.projectVersion, document.documentType);
      await saveDocumentCASInTransaction(tx, document, current?.rowVersion ?? null, current?.checksum ?? null);
    });
  }
}
