import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const SourcePathSchema = z.string().regex(/^(?![A-Za-z]:)[^\\]*$/);
const SourceDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const CRITICAL_SOURCE_ENTRYPOINTS = ["scripts/brief-v3-live-acceptance.ts"] as const;
export const CRITICAL_SOURCE_ARTIFACTS = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "supabase/migrations/202608060001_factory_metadata.sql",
  "supabase/migrations/202608160001_brief_revision_v3_transaction.sql",
] as const;

export const LEGACY_V2_MUTATION_PATHS = [
  "src/agents/lead/service.ts",
  "src/domain/requirements/revision.ts",
  "src/integrations/openai/adapters.ts",
  "src/runtime/trial-entry/service.ts",
  "src/runtime/trial-entry/idempotency.ts",
] as const;

export const REQUIRED_CRITICAL_SOURCE_PATHS = [
  ...CRITICAL_SOURCE_ENTRYPOINTS,
  ...CRITICAL_SOURCE_ARTIFACTS,
  "src/domain/requirements/v3/changeset.ts",
  "src/domain/requirements/v3/history.ts",
  "src/domain/requirements/v3/invariants.ts",
  "src/domain/requirements/v3/normalize.ts",
  "src/domain/requirements/v3/reducer.ts",
  "src/domain/requirements/v3/schema.ts",
  "src/domain/requirements/v3/serialization.ts",
  "src/domain/requirements/v3/targets.ts",
  "src/integrations/openai/client.ts",
  "src/integrations/openai/config.ts",
  "src/integrations/openai/errors.ts",
  "src/integrations/openai/limiter.ts",
  "src/integrations/openai/usage.ts",
  "src/integrations/openai-v3/changeset.ts",
  "src/integrations/openai-v3/errors.ts",
  "src/integrations/openai-v3/mapper.ts",
  "src/integrations/openai-v3/prompt.ts",
  "src/integrations/openai-v3/provider.ts",
  "src/persistence/database/brief-revision-v3-contracts.ts",
  "src/persistence/database/errors.ts",
  "src/persistence/database/fake.ts",
  "src/persistence/database/mapping.ts",
  "src/persistence/database/postgres.ts",
  "src/persistence/database/repositories.ts",
  "src/persistence/database/serialization.ts",
  "src/persistence/database/sync.ts",
  "src/persistence/database/types.ts",
  "src/persistence/project-memory/filenames.ts",
  "src/persistence/project-memory/store.ts",
  "src/runtime/brief-revision-v3/acceptance-window.ts",
  "src/runtime/brief-revision-v3/acceptance-verifier.ts",
  "src/runtime/brief-revision-v3/certification-evidence.ts",
  "src/runtime/brief-revision-v3/cleanup-policy.ts",
  "src/runtime/brief-revision-v3/errors.ts",
  "src/runtime/brief-revision-v3/identity.ts",
  "src/runtime/brief-revision-v3/ports.ts",
  "src/runtime/brief-revision-v3/projection.ts",
  "src/runtime/brief-revision-v3/service.ts",
  "src/runtime/brief-revision-v3/source-fingerprint.ts",
  "src/runtime/context/assembler.ts",
  "src/runtime/context/bridge.ts",
  "src/runtime/context/contracts.ts",
  "src/runtime/context/slicing.ts",
  "src/runtime/context/telemetry.ts",
  "src/runtime/workspace/sync.ts",
] as const;

export type SourceManifestEntry = { path: string; digest: string };
export type SourceFingerprint = { fingerprint: string; manifest: readonly SourceManifestEntry[]; closure: readonly string[] };

function normalizeRelativePath(value: string) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function sourceSpecifierCandidates(root: string, importer: string, specifier: string) {
  const base = specifier.startsWith("@/")
    ? path.join(root, "src", specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(path.join(root, importer)), specifier)
      : undefined;
  if (!base) return [];
  return [base, ...[".ts", ".tsx", ".js", ".mjs", ".json"].map((extension) => `${base}${extension}`), ...["index.ts", "index.tsx", "index.js", "index.mjs"].map((name) => path.join(base, name))];
}

async function resolveSourceSpecifier(root: string, importer: string, specifier: string) {
  for (const candidate of sourceSpecifierCandidates(root, importer, specifier)) {
    try {
      const relative = normalizeRelativePath(path.relative(root, candidate));
      await readFile(candidate);
      return relative;
    } catch {
      // Try the next source extension.
    }
  }
  return undefined;
}

function importedSpecifiers(source: string) {
  const values = new Set<string>();
  const pattern = /(?:from\s*|import\s*(?:\(\s*)?|require\s*\(\s*)["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) {
    const value = match[1];
    if (value && (value.startsWith("@/") || value.startsWith("."))) values.add(value);
  }
  return [...values].sort();
}

function assertStaticInternalImports(source: string, importer: string) {
  const dynamicImport = /\bimport\s*\(\s*([^"'`][^)]*)\)/g;
  const dynamicRequire = /\brequire\s*\(\s*([^"'`][^)]*)\)/g;
  for (const match of [...source.matchAll(dynamicImport), ...source.matchAll(dynamicRequire)]) {
    if (match[1]?.trim()) throw new Error(`CERTIFICATION_SOURCE_COVERAGE_INCOMPLETE:DYNAMIC_IMPORT:${importer}`);
  }
}

async function collectDependencyClosure(root: string, entrypoints: readonly string[]) {
  const visited = new Set<string>();
  const pending = [...entrypoints].map(normalizeRelativePath);
  const unresolved: Array<{ importer: string; specifier: string }> = [];
  while (pending.length) {
    const relative = pending.shift()!;
    if (visited.has(relative)) continue;
    visited.add(relative);
    const source = await readFile(path.join(root, relative), "utf8");
    assertStaticInternalImports(source, relative);
    for (const specifier of importedSpecifiers(source)) {
      const resolved = await resolveSourceSpecifier(root, relative, specifier);
      if (!resolved) unresolved.push({ importer: relative, specifier });
      else if (!visited.has(resolved)) pending.push(resolved);
    }
  }
  if (unresolved.length) throw new Error(`CERTIFICATION_SOURCE_COVERAGE_INCOMPLETE:${unresolved.map((item) => `${item.importer}:${item.specifier}`).join(",")}`);
  return [...visited].sort();
}

async function digestFile(root: string, relative: string) {
  const content = await readFile(path.join(root, relative));
  return createHash("sha256").update(content).digest("hex");
}

export function sourceFingerprintFromManifest(manifest: readonly SourceManifestEntry[]) {
  const canonical = [...manifest].sort((left, right) => left.path.localeCompare(right.path)).map((entry) => `${entry.path}:${entry.digest}`).join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export async function computeCriticalSourceFingerprint(options: { root?: string; entrypoints?: readonly string[]; additionalArtifacts?: readonly string[] } = {}): Promise<SourceFingerprint> {
  const root = options.root ?? process.cwd();
  const entrypoints = options.entrypoints ?? CRITICAL_SOURCE_ENTRYPOINTS;
  const additionalArtifacts = options.additionalArtifacts ?? CRITICAL_SOURCE_ARTIFACTS;
  const closure = await collectDependencyClosure(root, entrypoints);
  const paths = [...new Set([...closure, ...additionalArtifacts.map(normalizeRelativePath)])].sort();
  const manifest = await Promise.all(paths.map(async (relative) => ({ path: SourcePathSchema.parse(relative), digest: SourceDigestSchema.parse(await digestFile(root, relative)) })));
  return { fingerprint: sourceFingerprintFromManifest(manifest), manifest, closure };
}

export function assertCriticalSourceCoverage(manifest: readonly SourceManifestEntry[], closure?: readonly string[]) {
  const present = new Set(manifest.map((entry) => entry.path));
  const missing = REQUIRED_CRITICAL_SOURCE_PATHS.filter((relative) => !present.has(relative));
  if (missing.length) throw new Error(`CERTIFICATION_SOURCE_COVERAGE_INCOMPLETE:${missing.join(",")}`);
  if (closure?.some((relative) => !present.has(relative))) throw new Error("CERTIFICATION_SOURCE_COVERAGE_INCOMPLETE:CLOSURE_ENTRY_MISSING");
  return true;
}

export function assertSourceManifestCanonical(manifest: readonly SourceManifestEntry[]) {
  const paths = manifest.map((entry) => entry.path);
  if (paths.some((entry) => path.isAbsolute(entry) || entry.includes("\\"))) throw new Error("CERTIFICATION_SOURCE_MANIFEST_PATH_INVALID");
  const sorted = [...paths].sort();
  if (JSON.stringify(paths) !== JSON.stringify(sorted) || new Set(paths).size !== paths.length) throw new Error("CERTIFICATION_SOURCE_MANIFEST_NOT_CANONICAL");
  return true;
}

export function assertV3SourceDoesNotReachV2(manifest: readonly SourceManifestEntry[]) {
  const reachable = legacyMutationPathsInManifest(manifest);
  if (reachable.length) throw new Error(`V2_MUTATION_PATH_REACHABLE:${reachable.join(",")}`);
  return true;
}

export function assertV3SourceClosureDoesNotReachV2(closure: readonly string[]) {
  const reachable = legacyMutationPathsInClosure(closure);
  if (reachable.length) throw new Error(`V2_MUTATION_PATH_REACHABLE:${reachable.join(",")}`);
  return true;
}

export function legacyMutationPathsInManifest(manifest: readonly SourceManifestEntry[]) {
  return legacyMutationPathsInClosure(manifest.map((entry) => entry.path));
}

export function legacyMutationPathsInClosure(closure: readonly string[]) {
  const present = new Set(closure);
  return LEGACY_V2_MUTATION_PATHS.filter((relative) => present.has(relative));
}
