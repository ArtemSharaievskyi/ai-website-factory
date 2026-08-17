import { readFile } from "node:fs/promises";
import path from "node:path";

export type ProductionPath = { id: string; label: string; testFile: string; markers: string[] };
export type ProductionPathResult = { id: string; label: string; present: boolean; code: "PASS" | "FILE_MISSING" | "MARKER_MISSING" };

export function productionPath(id: string, label: string, testFile: string, markers: readonly string[]): ProductionPath {
  return { id, label, testFile, markers: [...markers] };
}

export const PRODUCTION_PATHS: readonly ProductionPath[] = [
  productionPath("WORKBENCH_MUTATION", "Workbench mutation", "src/runtime/workbench/brief-revision-production-trace.test.ts", ["new WorkbenchApplication", "action: \"request-brief-changes\""]),
  productionPath("TRIAL_ENTRY_CONTINUATION", "Trial Entry continuation", "src/runtime/trial-entry/service.test.ts", ["new TrialEntryService", "entry.respond", "DeterministicLeadProvider"]),
  productionPath("BRIEF_V3_MUTATION_PATH", "Brief V3 mutation path", "src/runtime/workbench/brief-revision-production-trace.test.ts", ["action: \"request-brief-changes\"", "BriefV3TransactionService"]),
  productionPath("ASSET_INTAKE", "Asset intake", "src/runtime/trial-entry/lead-asset-context.test.ts", ["new ProjectAssetService", "assets.upload", "new WorkbenchApplication"]),
];

export async function verifyProductionPathEvidence(root: string, ids: readonly string[]) {
  const results: ProductionPathResult[] = [];
  for (const id of [...new Set(ids)]) {
    const pathEntry = PRODUCTION_PATHS.find((candidate) => candidate.id === id);
    if (!pathEntry) { results.push({ id, label: id, present: false, code: "FILE_MISSING" }); continue; }
    let source: string;
    try { source = await readFile(path.join(root, pathEntry.testFile), "utf8"); } catch { results.push({ id, label: pathEntry.label, present: false, code: "FILE_MISSING" }); continue; }
    results.push({ id, label: pathEntry.label, present: pathEntry.markers.every((marker) => source.includes(marker)), code: pathEntry.markers.every((marker) => source.includes(marker)) ? "PASS" : "MARKER_MISSING" });
  }
  return results;
}
