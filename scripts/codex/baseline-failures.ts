import { createHash } from "node:crypto";

export type GuardFailure = {
  guardId: string;
  key: string;
  fingerprint: string;
  code: string;
  triggerPathPrefixes: string[];
  affectedPathPrefixes?: string[];
};

export type ClassifiedFailure = GuardFailure & {
  reason: "NEW_FAILURE" | "CHANGED_FINGERPRINT" | "TOUCHED_BASELINE_FAILURE" | "BASELINE_FAILURE";
};

export type FailureClassification = {
  blocking: ClassifiedFailure[];
  baselineFailures: ClassifiedFailure[];
  resolved: GuardFailure[];
};

const normalizePath = (value: string) => value.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();

function matchesPath(file: string, prefix: string) {
  const normalizedFile = normalizePath(file);
  const normalizedPrefix = normalizePath(prefix).replace(/\/$/, "");
  return normalizedFile === normalizedPrefix || normalizedFile.startsWith(`${normalizedPrefix}/`);
}

export function fingerprintFailure(guardId: string, key: string, code: string, detail = "") {
  return createHash("sha256").update([guardId, key, code, detail].join("\0")).digest("hex");
}

export function classifyBaselineFailures(baseline: readonly GuardFailure[], current: readonly GuardFailure[], changedFiles: readonly string[]): FailureClassification {
  const baselineByIdentity = new Map(baseline.map((failure) => [`${failure.guardId}\0${failure.key}`, failure]));
  const currentIdentities = new Set<string>();
  const blocking: ClassifiedFailure[] = [];
  const baselineFailures: ClassifiedFailure[] = [];

  for (const failure of current) {
    const identity = `${failure.guardId}\0${failure.key}`;
    currentIdentities.add(identity);
    const previous = baselineByIdentity.get(identity);
    if (!previous) {
      blocking.push({ ...failure, reason: "NEW_FAILURE" });
      continue;
    }
    if (previous.fingerprint !== failure.fingerprint) {
      blocking.push({ ...failure, reason: "CHANGED_FINGERPRINT" });
      continue;
    }
    const activationPaths = failure.affectedPathPrefixes?.length ? failure.affectedPathPrefixes : failure.triggerPathPrefixes;
    if (activationPaths.some((prefix) => changedFiles.some((file) => matchesPath(file, prefix)))) {
      blocking.push({ ...failure, reason: "TOUCHED_BASELINE_FAILURE" });
      continue;
    }
    baselineFailures.push({ ...failure, reason: "BASELINE_FAILURE" });
  }

  const resolved = baseline.filter((failure) => !currentIdentities.has(`${failure.guardId}\0${failure.key}`));
  return { blocking, baselineFailures, resolved };
}
