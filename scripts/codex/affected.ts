import { changedFilesSince, normalizeRepoPath } from "./git";
import { loadCheckMap, loadProviderContractRegistry, loadRegressionMap, type CheckMapConfig, type RegressionConfig, type RegressionId } from "./config";
import type { ControlledCheckId } from "./checks";

export type AffectedResolution = {
  changedFiles: string[];
  areas: string[];
  checkIds: ControlledCheckId[];
  regressionIds: RegressionId[];
  productionPathIds: string[];
};

export const matchesPrefix = (file: string, prefix: string) => {
  const normalizedFile = normalizeRepoPath(file).toLowerCase();
  const normalizedPrefix = normalizeRepoPath(prefix).toLowerCase().replace(/\/$/, "");
  return normalizedFile === normalizedPrefix || normalizedFile.startsWith(`${normalizedPrefix}/`);
};
const addUnique = <T>(target: T[], values: readonly T[]) => { for (const value of values) if (!target.includes(value)) target.push(value); };

export function resolveAffectedChecks(changedFiles: readonly string[], checkMap: CheckMapConfig, regressionMap: RegressionConfig): AffectedResolution {
  const areas: string[] = [];
  const checkIds: ControlledCheckId[] = [];
  const productionPathIds: string[] = [];
  for (const rule of checkMap.rules) {
    if (!changedFiles.some((file) => rule.pathPrefixes.some((prefix) => matchesPrefix(file, prefix)))) continue;
    areas.push(rule.area);
    addUnique(checkIds, rule.checkIds);
    addUnique(productionPathIds, rule.productionPathIds ?? []);
  }
  const regressionIds: RegressionId[] = [];
  for (const regression of regressionMap.regressions) {
    if (!changedFiles.some((file) => regression.pathPrefixes.some((prefix) => matchesPrefix(file, prefix)))) continue;
    regressionIds.push(regression.id);
    addUnique(checkIds, regression.checkIds);
  }
  addUnique(checkIds, checkMap.defaultCheckIds);
  return { changedFiles: [...new Set(changedFiles.map(normalizeRepoPath))].sort(), areas: [...new Set(areas)], checkIds, regressionIds, productionPathIds: [...new Set(productionPathIds)] };
}

export async function resolveAffectedFromBaseline(root: string, baseline: string, baselineUntrackedFiles: readonly string[] = []) {
  const [changedFiles, checkMap, regressionMap, providerRegistry] = await Promise.all([changedFilesSince(root, baseline, baselineUntrackedFiles), loadCheckMap(), loadRegressionMap(), loadProviderContractRegistry()]);
  const result = resolveAffectedChecks(changedFiles, checkMap, regressionMap);
  if (changedFiles.some((file) => providerRegistry.contracts.some((contract) => contract.triggerPathPrefixes.some((prefix) => matchesPrefix(file, prefix)))) && !result.checkIds.includes("provider-contracts")) result.checkIds.unshift("provider-contracts");
  return result;
}
