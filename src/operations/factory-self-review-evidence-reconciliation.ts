export type EvidenceFailureType =
  | "PATH_FORMAT_INVALID"
  | "EVIDENCE_NOT_IN_SCOPE_PACK"
  | "PATH_NOT_FOUND"
  | "LINE_RANGE_OUT_OF_BOUNDS"
  | "EVIDENCE_MANIFEST_MISMATCH"
  | "OTHER";

export type ReconciliationOutcome =
  | "VALIDATED_ORIGINAL"
  | "VALIDATED_REFERENCE_REPAIRED"
  | "VALIDATED_BY_TARGETED_REVIEW"
  | "REJECTED_UNSUPPORTED"
  | "REJECTED_OUT_OF_SCOPE"
  | "REJECTED_HALLUCINATED_REFERENCE";

export type ReconciliationManifestEntry = {
  relativePath: string;
  checksum: string;
  lineCount: number;
};

export type ReconciliationPack = {
  scopeId: string;
  evidencePackChecksum: string;
  allowedPaths: readonly string[];
};

export type EvidenceValidation = {
  valid: boolean;
  canonicalReference?: string;
  failureType?: EvidenceFailureType;
  reason?: string;
};

export type DeterministicRepair = {
  originalReference: string;
  repairedReference?: string;
  validation: EvidenceValidation;
};

export function validateManifestChecksum(
  actualChecksum: string,
  expectedChecksum: string,
) {
  return actualChecksum === expectedChecksum;
}

const EVIDENCE_REFERENCE = /^([^:]+):(\d+)(?:-(\d+))?$/;

export function normalizeReconciliationPath(value: string) {
  const normalized = value.replaceAll("\\", "/");
  if (normalized.startsWith("./")) return normalized.slice(2);
  return normalized;
}

export function validateReconciliationReference(
  reference: string,
  manifest: readonly ReconciliationManifestEntry[],
  pack?: ReconciliationPack,
): EvidenceValidation {
  const match = EVIDENCE_REFERENCE.exec(reference);
  if (!match) {
    return {
      valid: false,
      failureType: "PATH_FORMAT_INVALID",
      reason: "Evidence reference must use repository-relative path:start-end syntax.",
    };
  }

  const relativePath = normalizeReconciliationPath(match[1]);
  if (
    relativePath.startsWith("/") ||
    /^[A-Za-z]:\//.test(relativePath) ||
    relativePath.split("/").some((part) => part === "..")
  ) {
    return {
      valid: false,
      failureType: "PATH_FORMAT_INVALID",
      reason: "Evidence reference must be repository-relative.",
    };
  }

  const entry = manifest.find((item) => item.relativePath === relativePath);
  if (!entry) {
    return {
      valid: false,
      failureType: "PATH_NOT_FOUND",
      reason: "Evidence path is absent from the immutable evidence manifest.",
    };
  }
  if (pack && !pack.allowedPaths.includes(relativePath)) {
    return {
      valid: false,
      failureType: "EVIDENCE_NOT_IN_SCOPE_PACK",
      reason: "Evidence path is not in the original scope evidence pack.",
    };
  }

  const startLine = Number(match[2]);
  const endLine = Number(match[3] ?? match[2]);
  if (
    !Number.isInteger(startLine) ||
    !Number.isInteger(endLine) ||
    startLine <= 0 ||
    endLine < startLine ||
    endLine > entry.lineCount
  ) {
    return {
      valid: false,
      failureType: "LINE_RANGE_OUT_OF_BOUNDS",
      reason: "Evidence line range is outside the manifest line count.",
    };
  }

  return {
    valid: true,
    canonicalReference: `${relativePath}:${startLine}${
      endLine === startLine ? "" : `-${endLine}`
    }`,
  };
}

export function repairEvidenceReferences(
  references: readonly string[],
  deterministicMappings: Readonly<Record<string, string>>,
  manifest: readonly ReconciliationManifestEntry[],
  pack: ReconciliationPack,
): DeterministicRepair[] {
  return references.map((originalReference) => {
    const candidate = deterministicMappings[originalReference];
    const validation = validateReconciliationReference(
      candidate ?? originalReference,
      manifest,
      pack,
    );
    return {
      originalReference,
      repairedReference: validation.valid ? validation.canonicalReference : undefined,
      validation,
    };
  });
}

export function buildTargetedReconciliationQueue<T extends { originalFindingId: string }>(
  records: readonly T[],
  terminalFindingIds: ReadonlySet<string>,
) {
  return records.filter((record) => !terminalFindingIds.has(record.originalFindingId));
}

export function createVersionedSuccessor<T extends Record<string, unknown>>(
  finding: T,
  evidenceRefs: readonly string[],
  suffix = "evidence-v1",
) {
  const originalFindingId = String(finding.findingId);
  return {
    ...finding,
    findingId: `${originalFindingId}-${suffix}`,
    supersedesOriginalFindingId: originalFindingId,
    evidenceRefs: [...evidenceRefs],
  };
}

export function summarizeReconciliationOutcomes(
  outcomes: readonly ReconciliationOutcome[],
) {
  return outcomes.reduce<Record<ReconciliationOutcome, number>>(
    (counts, outcome) => {
      counts[outcome] += 1;
      return counts;
    },
    {
      VALIDATED_ORIGINAL: 0,
      VALIDATED_REFERENCE_REPAIRED: 0,
      VALIDATED_BY_TARGETED_REVIEW: 0,
      REJECTED_UNSUPPORTED: 0,
      REJECTED_OUT_OF_SCOPE: 0,
      REJECTED_HALLUCINATED_REFERENCE: 0,
    },
  );
}
