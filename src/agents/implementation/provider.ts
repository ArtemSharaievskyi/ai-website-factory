import { randomUUID, createHash } from "node:crypto";
import { ImplementationChangeProposalSchema, type ImplementationContext, type ImplementationProvider } from "./contracts";
import { ImplementationError } from "./errors";
import { FOUNDATION_ESLINT_CONFIG, FOUNDATION_ESLINT_CONFIG_PATH, FOUNDATION_NEXT_CONFIG, FOUNDATION_NEXT_CONFIG_PATH, FOUNDATION_TSCONFIG, FOUNDATION_TSCONFIG_PATH, designSystemStylesheet, foundationPackageJson } from "./foundation-policy";
import { storagePlanContractChecksum, type StoragePlan } from "@/agents/planner/contracts";
import { renderBehavioralSecurityFixture } from "@/runtime/database/security-fixtures";

const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const storageContent = [
  'import "server-only";',
  'import { getAuthenticatedUser, getServerSupabaseClient } from "@/lib/supabase/auth";',
  '',
  'const STORAGE_BUCKET = "approved-uploads";',
  'const SIGNED_URL_EXPIRY_SECONDS = 60;',
  '',
  'export function validateUpload(file: { type: string; size: number }) { return file.type.startsWith("image/") && file.size <= 5000000; }',
  '',
  'function safeObjectName(fileName: string) {',
  '  const normalized = fileName.normalize("NFKC").trim();',
  '  if (!normalized || normalized === "." || normalized === ".." || normalized.includes("/") || normalized.includes("\\\\") || normalized.includes("\\0")) return null;',
  '  return normalized.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 128) || null;',
  '}',
  '',
  'function ownedObjectPath(userId: string, fileName: string) {',
  '  const safeName = safeObjectName(fileName);',
  '  return safeName ? `${userId}/${safeName}` : null;',
  '}',
  '',
  'function isOwnedObjectPath(userId: string, objectPath: string) {',
  '  const parts = objectPath.split("/");',
  '  return parts.length === 2 && parts[0] === userId && Boolean(safeObjectName(parts[1])) && !objectPath.includes("..") && !objectPath.includes("\\\\");',
  '}',
  '',
  'export async function createSignedUploadUrl(fileName: string, file: { type: string; size: number }) {',
  '  const user = await getAuthenticatedUser();',
  '  if (!user) return { ok: false as const };',
  '  const objectPath = ownedObjectPath(user.id, fileName);',
  '  if (!objectPath || !validateUpload(file)) return { ok: false as const };',
  '  const supabase = await getServerSupabaseClient();',
  '  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUploadUrl(objectPath);',
  '  if (error || !data?.signedUrl) return { ok: false as const };',
  '  return { ok: true as const, objectPath, signedUrl: data.signedUrl };',
  '}',
  '',
  'export async function createSignedDownloadUrl(objectPath: string) {',
  '  const user = await getAuthenticatedUser();',
  '  if (!user || !isOwnedObjectPath(user.id, objectPath)) return { ok: false as const };',
  '  const supabase = await getServerSupabaseClient();',
  '  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(objectPath, SIGNED_URL_EXPIRY_SECONDS);',
  '  if (error || !data?.signedUrl) return { ok: false as const };',
  '  return { ok: true as const, signedUrl: data.signedUrl };',
  '}',
  '',
  'export async function updateOwnedObject(objectPath: string, file: { type: string; size: number }) {',
  '  const user = await getAuthenticatedUser();',
  '  if (!user || !isOwnedObjectPath(user.id, objectPath) || !validateUpload(file)) return { ok: false as const };',
  '  const supabase = await getServerSupabaseClient();',
  '  const { error } = await supabase.storage.from(STORAGE_BUCKET).update(objectPath, file, { contentType: file.type, upsert: false });',
  '  return error ? { ok: false as const } : { ok: true as const };',
  '}',
  '',
  'export async function deleteOwnedObject(objectPath: string) {',
  '  const user = await getAuthenticatedUser();',
  '  if (!user || !isOwnedObjectPath(user.id, objectPath)) return { ok: false as const };',
  '  const supabase = await getServerSupabaseClient();',
  '  const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([objectPath]);',
  '  return error ? { ok: false as const } : { ok: true as const };',
  '}',
].join("\\n") + "\\n";
const storageSourceForPlan = (plan: StoragePlan) => {
  const checksum = storagePlanContractChecksum(plan);
  return [
    `// storage-contract-checksum: ${checksum}`,
    'import "server-only";',
    'import { getAuthenticatedUser, getServerSupabaseClient } from "@/lib/supabase/auth";',
    '',
    `const STORAGE_BUCKET = ${JSON.stringify(plan.bucketId)};`,
    `const SIGNED_URL_EXPIRY_SECONDS = ${plan.signedUrl.expirySeconds};`,
    '',
    'export function validateUpload(file: { type: string; size: number }) { return file.type.startsWith("image/") && file.size <= 5000000; }',
    '',
    'function safeObjectName(fileName: string) {',
    '  const normalized = fileName.normalize("NFKC").trim();',
    '  if (!normalized || normalized === "." || normalized === ".." || normalized.includes("/") || normalized.includes("\\\\") || normalized.includes("\\0")) return null;',
    '  return normalized.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 128) || null;',
    '}',
    '',
    'function ownedObjectPath(userId: string, fileName: string) {',
    '  const safeName = safeObjectName(fileName);',
    '  return safeName ? `${userId}/${safeName}` : null;',
    '}',
    '',
    'function isOwnedObjectPath(userId: string, objectPath: string) {',
    '  const parts = objectPath.split("/");',
    '  return parts.length === 2 && parts[0] === userId && Boolean(safeObjectName(parts[1])) && !objectPath.includes("..") && !objectPath.includes("\\\\");',
    '}',
    '',
    'export async function createSignedUploadUrl(fileName: string, file: { type: string; size: number }) {',
    '  const user = await getAuthenticatedUser();',
    '  if (!user) return { ok: false as const };',
    '  const objectPath = ownedObjectPath(user.id, fileName);',
    '  if (!objectPath || !validateUpload(file)) return { ok: false as const };',
    '  const supabase = await getServerSupabaseClient();',
    '  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUploadUrl(objectPath);',
    '  if (error || !data?.signedUrl) return { ok: false as const };',
    '  return { ok: true as const, objectPath, signedUrl: data.signedUrl };',
    '}',
    '',
    'export async function createSignedDownloadUrl(objectPath: string) {',
    '  const user = await getAuthenticatedUser();',
    '  if (!user || !isOwnedObjectPath(user.id, objectPath)) return { ok: false as const };',
    '  const supabase = await getServerSupabaseClient();',
    '  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(objectPath, SIGNED_URL_EXPIRY_SECONDS);',
    '  if (error || !data?.signedUrl) return { ok: false as const };',
    '  return { ok: true as const, signedUrl: data.signedUrl };',
    '}',
    '',
    'export async function updateOwnedObject(objectPath: string, file: { type: string; size: number }) {',
    '  const user = await getAuthenticatedUser();',
    '  if (!user || !isOwnedObjectPath(user.id, objectPath) || !validateUpload(file)) return { ok: false as const };',
    '  const supabase = await getServerSupabaseClient();',
    '  const { error } = await supabase.storage.from(STORAGE_BUCKET).update(objectPath, file, { contentType: file.type, upsert: false });',
    '  return error ? { ok: false as const } : { ok: true as const };',
    '}',
    '',
    'export async function deleteOwnedObject(objectPath: string) {',
    '  const user = await getAuthenticatedUser();',
    '  if (!user || !isOwnedObjectPath(user.id, objectPath)) return { ok: false as const };',
    '  const supabase = await getServerSupabaseClient();',
    '  const { error } = await supabase.storage.from(STORAGE_BUCKET).remove([objectPath]);',
    '  return error ? { ok: false as const } : { ok: true as const };',
    '}',
  ].join("\\n") + "\\n";
};
const files: Record<string, { path: string; content: string }> = {
  "prepare-workspace": { path: "src/app/factory-prepared.ts", content: "export const factoryWorkspacePrepared = true;\n" },
  "implement-project-foundation": { path: "src/app/layout.tsx", content: "export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang=\"en\"><body>{children}</body></html>; }\n" },
  "implement-design-system": { path: "src/app/globals.css", content: designSystemStylesheet() },
  "implement-shared-layout": { path: "src/components/layout/factory-shell.tsx", content: "export function FactoryShell({ children }: { children: React.ReactNode }) { return <main>{children}</main>; }\n" },
  "implement-navigation": { path: "src/components/navigation/factory-navigation.tsx", content: "export function FactoryNavigation() { return <nav aria-label=\"Primary\" />; }\n" },
  "implement-page": { path: "src/app/page.tsx", content: "export default function Page() { return <main />; }\n" },
  "implement-shared-component": { path: "src/components/factory-shared.tsx", content: "export function FactoryShared() { return null; }\n" },
  "integrate-content": { path: "src/content/approved-content.ts", content: "export const approvedContent = [];\n" },
  "integrate-assets": { path: "src/assets/approved-assets.ts", content: "export const approvedAssets = [];\n" },
  "implement-seo": { path: "src/app/metadata.ts", content: "export const metadata = { title: \"Approved project\" };\n" },
  "write-unit-tests": { path: "src/factory-foundation.test.ts", content: "import { describe, expect, it } from \"vitest\";\nimport { factoryWorkspacePrepared } from \"./app/factory-prepared\";\n\ndescribe(\"approved workspace foundation\", () => { it(\"exposes the host-prepared marker\", () => { expect(factoryWorkspacePrepared).toBe(true); }); });\n" },
  "write-integration-tests": { path: "tests/integration/factory-integration.integration.test.ts", content: "import { describe, expect, it } from \"vitest\";\n\ndescribe(\"approved integration boundary\", () => { it(\"preserves the approved local execution contract\", () => { const boundary = { network: false, provider: false, persistence: \"factory-controlled\" }; expect(boundary).toMatchObject({ network: false, provider: false, persistence: \"factory-controlled\" }); }); });\n" },
  "write-e2e-tests": { path: "tests/e2e/factory-flow.spec.ts", content: "import { describe, expect, it } from \"vitest\";\n\ndescribe(\"approved browser flow boundary\", () => { it(\"records the host-owned functional QA boundary\", () => { const boundary = { runner: \"playwright-functional-qa\", externalRequests: false }; expect(boundary).toMatchObject({ runner: \"playwright-functional-qa\", externalRequests: false }); }); });\n" },
  "implement-form": { path: "src/components/forms/approved-form.tsx", content: "import { z } from \"zod\";\nconst formSchema = z.object({});\nexport function ApprovedForm() { return null; }\n" },
  "implement-server-action": { path: "src/actions/approved-action.ts", content: "\"use server\";\nimport { z } from \"zod\";\nimport { getAuthenticatedUser, getServerSupabaseClient } from \"@/lib/supabase/auth\";\nconst inputSchema = z.object({ resourceId: z.string().uuid() });\nexport async function approvedAction(input: unknown) { const parsed = inputSchema.safeParse(input); if (!parsed.success) return { ok: false }; const user = await getAuthenticatedUser(); if (!user) return { ok: false }; const supabase = await getServerSupabaseClient(); const { data: resource, error } = await supabase.from(\"approved_records\").select(\"id,user_id\").eq(\"id\", parsed.data.resourceId).maybeSingle(); if (error || !resource || resource.user_id !== user.id) return { ok: false }; return { ok: true }; }\n" },
  "implement-route-handler": { path: "src/app/api/approved/route.ts", content: "import { z } from \"zod\";\nimport { getAuthenticatedUser, getServerSupabaseClient } from \"@/lib/supabase/auth\";\nconst inputSchema = z.object({ resourceId: z.string().uuid() });\nexport async function POST(request: Request) { const parsed = inputSchema.safeParse(await request.json()); if (!parsed.success) return Response.json({ ok: false }, { status: 400 }); const user = await getAuthenticatedUser(); if (!user) return Response.json({ ok: false }, { status: 401 }); const supabase = await getServerSupabaseClient(); const { data: resource, error } = await supabase.from(\"approved_records\").select(\"id,user_id\").eq(\"id\", parsed.data.resourceId).maybeSingle(); if (error || !resource || resource.user_id !== user.id) return Response.json({ ok: false }, { status: 403 }); return Response.json({ ok: true }); }\n" },
  "implement-database-schema": { path: "supabase/migrations/20260807120000_create_approved_schema.sql", content: "create table if not exists approved_records (id uuid primary key, user_id uuid not null references auth.users(id), created_at timestamptz not null default now());\n" },
  "implement-rls-policy": { path: "supabase/migrations/20260807120001_create_approved_rls.sql", content: "alter table approved_records enable row level security;\ncreate policy approved_records_select on approved_records for select to authenticated using (auth.uid() = user_id);\ncreate policy approved_records_insert on approved_records for insert to authenticated with check (auth.uid() = user_id);\ncreate policy approved_records_update on approved_records for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);\ncreate policy approved_records_delete on approved_records for delete to authenticated using (auth.uid() = user_id);\n" },
  "write-database-tests": { path: "supabase/tests/database/001_approved_records.test.sql", content: "begin;\nselect plan(1);\nselect has_table('public', 'approved_records', 'approved_records exists');\nselect * from finish();\nrollback;\n" },
  "implement-authentication": { path: "src/lib/supabase/auth.ts", content: "import \"server-only\";\nimport { cookies } from \"next/headers\";\nimport { createServerClient } from \"@supabase/ssr\";\nimport type { SupabaseClient, User } from \"@supabase/supabase-js\";\n\nexport async function getServerSupabaseClient(): Promise<SupabaseClient> {\n  const cookieStore = await cookies();\n  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: { getAll: () => cookieStore.getAll(), setAll: (cookiesToSet) => { try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); } catch { /* Middleware may own cookie writes. */ } } } });\n}\n\nexport async function getAuthenticatedUser(): Promise<User | null> {\n  const supabase = await getServerSupabaseClient();\n  const { data, error } = await supabase.auth.getUser();\n  if (error || !data.user) return null;\n  return data.user;\n}\n" },
  "implement-storage": { path: "src/lib/storage/uploads.ts", content: storageContent },
  "implement-email": { path: "src/lib/email/adapter.ts", content: "export async function sendApprovedEmail(input: { subject: string; body: string }) { return { ok: Boolean(input.subject && input.body) }; }\n" },
};

export class DeterministicImplementationProvider implements ImplementationProvider {
  async proposeTaskChanges(context: ImplementationContext, signal?: AbortSignal) {
    if (signal?.aborted) throw new ImplementationError("IMPLEMENTATION_CANCELLED", "Implementation was cancelled before proposal generation.");
    if (context.task.taskType === "implement-storage" && (!context.storagePlan || context.storagePlan.decision !== "supabase-storage")) throw new ImplementationError("STORAGE_POLICY_UNSAFE", "Storage generation requires the accepted typed StoragePlan in implementation context.");
    const daisyUiApproved = context.phase7c?.dependencyApprovals.some((dependency) => dependency.packageName === "daisyui" && dependency.class === "PLANNED_OPTIONAL_DEPENDENCY" && (dependency.approvalStatus === "APPROVED" || dependency.approvalStatus === "NOT_REQUIRED")) ?? false;
    const candidate = context.task.taskType === "implement-storage" ? { path: "src/lib/storage/uploads.ts", content: storageSourceForPlan(context.storagePlan!) } : context.task.taskType === "implement-design-system" ? { path: "src/app/globals.css", content: designSystemStylesheet(daisyUiApproved) } : files[context.task.taskType];
    if (!candidate) throw new ImplementationError("IMPLEMENTATION_TASK_TYPE_UNSUPPORTED", "This task type has no deterministic implementation handler.");
    const exactScope = context.task.fileScopes.find((scope) => !scope.includes("*"));
    const sharedComponentScope = context.task.taskType === "implement-shared-component" ? context.task.fileScopes.find((scope) => scope.startsWith("src/components/shared/") && scope.endsWith("/**")) : undefined;
    const pageScope = context.task.taskType === "implement-page" ? context.task.fileScopes.find((scope) => scope.startsWith("src/app") && scope.endsWith("/**")) : undefined;
    const seoScope = context.task.taskType === "implement-seo" ? context.task.fileScopes.find((scope) => scope.includes("metadata")) : undefined;
    const integrationScope = context.task.taskType === "write-integration-tests" ? context.task.fileScopes.find((scope) => scope.startsWith("tests/integration/")) : undefined;
    const candidatePath = ["implement-server-action", "implement-route-handler"].includes(context.task.taskType) && exactScope ? exactScope : sharedComponentScope ? `${sharedComponentScope.slice(0, -3)}/index.tsx` : pageScope ? `${pageScope.slice(0, -3)}/page.tsx` : seoScope ? "src/app/seo/metadata.ts" : integrationScope ? "tests/integration/factory-integration.integration.test.ts" : candidate.path;
    const operation = { type: "create-file" as const, relativePath: candidatePath, expectedResultChecksum: sha(candidate.content), encoding: "utf-8" as const, reason: `Deterministic foundation output for ${context.task.taskType}.`, requirementReferences: context.requirementReferences, planningReferences: context.planningReferences, selectedDesignReferences: context.selectedDesignReferences, content: candidate.content };
    const databaseConfig = context.task.taskType === "implement-database-schema" ? { ...operation, relativePath: "supabase/config.toml", content: "project_id = \"generated-project\"\n", expectedResultChecksum: sha("project_id = \"generated-project\"\n") } : undefined;
    const foundationManifest = foundationPackageJson(context.phase7c?.dependencyApprovals.filter((dependency) => dependency.class === "PLANNED_OPTIONAL_DEPENDENCY" && (dependency.approvalStatus === "APPROVED" || dependency.approvalStatus === "NOT_REQUIRED")) ?? []);
    const behavioralSecurityFixture = renderBehavioralSecurityFixture({ table: "approved_records", ownerColumn: "user_id", role: "privileged", scope: "OWNER", roleAuthority: "JWT_APP_METADATA", seedRows: { ownerA: { id: "00000000-0000-4000-8000-0000000000d1", user_id: "00000000-0000-4000-8000-0000000000a1" }, ownerB: { id: "00000000-0000-4000-8000-0000000000d2", user_id: "00000000-0000-4000-8000-0000000000b2" } } });
    const operations = context.task.taskType === "implement-project-foundation" ? [{ ...operation, relativePath: "package.json", content: foundationManifest, expectedResultChecksum: sha(foundationManifest) }, operation, { ...operation, relativePath: FOUNDATION_ESLINT_CONFIG_PATH, content: FOUNDATION_ESLINT_CONFIG, expectedResultChecksum: sha(FOUNDATION_ESLINT_CONFIG) }, { ...operation, relativePath: FOUNDATION_NEXT_CONFIG_PATH, content: FOUNDATION_NEXT_CONFIG, expectedResultChecksum: sha(FOUNDATION_NEXT_CONFIG) }, { ...operation, relativePath: FOUNDATION_TSCONFIG_PATH, content: FOUNDATION_TSCONFIG, expectedResultChecksum: sha(FOUNDATION_TSCONFIG) }] : context.task.taskType === "write-database-tests" ? [operation, { ...operation, relativePath: "supabase/tests/security/001_access_control.test.sql", content: behavioralSecurityFixture, expectedResultChecksum: sha(behavioralSecurityFixture) }] : databaseConfig ? [operation, databaseConfig] : [operation];
    return ImplementationChangeProposalSchema.parse({ proposalId: randomUUID(), projectId: context.task.projectId, projectVersion: context.task.projectVersion, taskId: context.task.id, taskAttempt: context.task.attempt, summary: `Prepared deterministic ${context.task.taskType} proposal.`, operations, expectedChangedFiles: operations.map((item) => item.relativePath), expectedCreatedFiles: operations.map((item) => item.relativePath), expectedDeletedFiles: [], validationPlan: [context.task.taskType], requirementReferences: context.requirementReferences, planningReferences: context.planningReferences, selectedDesignReferences: context.selectedDesignReferences, ...(context.phase7c ? { phase7c: { taskContractId: context.phase7c.taskContract.taskContractId, taskContractChecksum: context.phase7c.taskContract.checksum, dataContractIds: [...new Set([...context.phase7c.taskContract.inputDataContractIds, ...context.phase7c.taskContract.outputDataContractIds])], ...(context.phase7c.databaseMode !== "NONE" && context.phase7c.taskContract.databaseDecisionRef ? { databaseDecisionId: context.phase7c.databaseDecisionId, databaseDecisionChecksum: context.phase7c.taskContract.databaseDecisionRef.checksum } : {}) } } : {}), providerMetadata: { provider: "deterministic" }, generatedAt: new Date().toISOString() });
  }
}
