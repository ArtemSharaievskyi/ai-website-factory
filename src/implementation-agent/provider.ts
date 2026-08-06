import { randomUUID, createHash } from "node:crypto";
import { ImplementationChangeProposalSchema, type ImplementationContext, type ImplementationProvider } from "./contracts";
import { ImplementationError } from "./errors";
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const files: Record<string, { path: string; content: string }> = {
  "prepare-workspace": { path: "src/app/factory-prepared.ts", content: "export const factoryWorkspacePrepared = true;\n" },
  "implement-project-foundation": { path: "src/app/layout.tsx", content: "export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang=\"en\"><body>{children}</body></html>; }\n" },
  "implement-design-system": { path: "src/styles/design-tokens.css", content: ":root { --factory-canvas: #ffffff; --factory-text: #111111; }\n" },
  "implement-shared-layout": { path: "src/components/layout/factory-shell.tsx", content: "export function FactoryShell({ children }: { children: React.ReactNode }) { return <main>{children}</main>; }\n" },
  "implement-navigation": { path: "src/components/navigation/factory-navigation.tsx", content: "export function FactoryNavigation() { return <nav aria-label=\"Primary\" />; }\n" },
  "implement-page": { path: "src/app/page.tsx", content: "export default function Page() { return <main />; }\n" },
  "implement-shared-component": { path: "src/components/factory-shared.tsx", content: "export function FactoryShared() { return null; }\n" },
  "integrate-content": { path: "src/content/approved-content.ts", content: "export const approvedContent = [];\n" },
  "implement-seo": { path: "src/app/metadata.ts", content: "export const metadata = { title: \"Approved project\" };\n" },
  "write-unit-tests": { path: "src/factory-foundation.test.ts", content: "import { describe, expect, it } from \"vitest\"; describe(\"approved implementation\", () => { it(\"is deterministic\", () => expect(true).toBe(true)); });\n" },
};
export class DeterministicImplementationProvider implements ImplementationProvider {
  async proposeTaskChanges(context: ImplementationContext, signal?: AbortSignal) { if (signal?.aborted) throw new ImplementationError("IMPLEMENTATION_CANCELLED", "Implementation was cancelled before proposal generation."); const candidate = files[context.task.taskType]; if (!candidate) throw new ImplementationError("IMPLEMENTATION_TASK_TYPE_UNSUPPORTED", "This task type has no deterministic implementation handler."); const operation = { type: "create-file" as const, relativePath: candidate.path, expectedResultChecksum: sha(candidate.content), encoding: "utf-8" as const, reason: `Deterministic foundation output for ${context.task.taskType}.`, requirementReferences: context.requirementReferences, planningReferences: context.planningReferences, selectedDesignReferences: context.selectedDesignReferences, content: candidate.content }; return ImplementationChangeProposalSchema.parse({ proposalId: randomUUID(), projectId: context.task.projectId, projectVersion: context.task.projectVersion, taskId: context.task.id, taskAttempt: context.task.attempt, summary: `Prepared deterministic ${context.task.taskType} proposal.`, operations: [operation], expectedChangedFiles: [candidate.path], expectedCreatedFiles: [candidate.path], expectedDeletedFiles: [], validationPlan: [context.task.taskType], requirementReferences: context.requirementReferences, planningReferences: context.planningReferences, selectedDesignReferences: context.selectedDesignReferences, providerMetadata: { provider: "deterministic" }, generatedAt: new Date().toISOString() }); }
}
