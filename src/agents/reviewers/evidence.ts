import { checksumPersistedDocument } from "@/persistence/database/serialization";
import {
  ReviewEvidenceCatalogSchema,
  ReviewEvidenceIdSchema,
  ReviewEvidenceProvenanceSchema,
  type ReviewEvidenceCatalog,
  type ReviewEvidenceProvenance,
} from "@/domain/review/schema";

export type ProviderReviewEvidenceCatalog = ReviewEvidenceCatalog;

export function withoutProviderEvidenceCatalog<T>(input: T): T {
  if (!input || typeof input !== "object" || !("evidenceCatalog" in input)) return input;
  const canonicalInput = { ...(input as T & Record<string, unknown>) };
  delete canonicalInput.evidenceCatalog;
  return canonicalInput as T;
}

export function createReviewEvidenceCatalog(input: {
  projectId: string;
  projectVersion: number;
  evidenceRefs: Iterable<string>;
  requestContext?: unknown;
  providerReferences?: Readonly<Record<string, string>>;
}): ReviewEvidenceCatalog {
  const refs = [...new Set(input.evidenceRefs)].sort((left, right) => left.localeCompare(right));
  const contextChecksum = checksumPersistedDocument({
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    evidenceRefs: refs,
    requestContext: input.requestContext ?? null,
  });
  const catalogId = `evidence-catalog-${contextChecksum.slice(0, 16)}`;
  const entries = refs.map((canonicalRef, index) => ({
    id: `E${contextChecksum.slice(0, 16)}-${String(index + 1).padStart(3, "0")}`,
    canonicalRef,
    ...(input.providerReferences?.[canonicalRef] ? { providerRef: input.providerReferences[canonicalRef] } : {}),
  }));
  return ReviewEvidenceCatalogSchema.parse({
    catalogId,
    contextChecksum,
    projectId: input.projectId,
    projectVersion: input.projectVersion,
    entries,
  });
}

export function providerEvidenceCatalog(catalog: ReviewEvidenceCatalog) {
  return {
    catalogId: catalog.catalogId,
    contextChecksum: catalog.contextChecksum,
    entries: catalog.entries.map(({ id, canonicalRef, providerRef }) => ({ id, canonicalRef: providerRef ?? canonicalRef })),
  };
}

export function evidenceCatalogChecksum(catalog: ReviewEvidenceCatalog) {
  return checksumPersistedDocument(catalog);
}

export function evidenceIdFor(input: unknown, canonicalRef: string, fallbackCatalog?: ReviewEvidenceCatalog) {
  const candidate = input as { evidenceCatalog?: ReviewEvidenceCatalog };
  const catalog = candidate.evidenceCatalog ?? fallbackCatalog;
  const entry = catalog?.entries.find((item) => item.canonicalRef === canonicalRef);
  if (!entry) throw new Error(`HOST_EVIDENCE_REFERENCE_UNAVAILABLE: ${canonicalRef}`);
  return entry.id;
}

export function resolveProviderEvidenceRefs(
  catalog: ReviewEvidenceCatalog,
  evidenceIds: readonly string[],
): { canonicalRefs: string[]; provenance: ReviewEvidenceProvenance[] } {
  const canonicalRefs: string[] = [];
  const provenance: ReviewEvidenceProvenance[] = [];
  const seen = new Set<string>();
  for (const rawId of evidenceIds) {
    const id = ReviewEvidenceIdSchema.parse(rawId);
    const entry = catalog.entries.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`HOST_EVIDENCE_ID_NOT_IN_CATALOG: ${id}`);
    if (seen.has(id)) continue;
    seen.add(id);
    canonicalRefs.push(entry.canonicalRef);
    provenance.push(ReviewEvidenceProvenanceSchema.parse({ evidenceId: id, canonicalRef: entry.canonicalRef }));
  }
  return { canonicalRefs, provenance };
}

export function resolveProviderReviewEvidence<
  T extends { evidenceRefs: readonly string[]; affectedArtifacts: readonly string[] },
>(
  catalog: ReviewEvidenceCatalog,
  input: {
    reviewedArtifactRefs: readonly string[];
    findings: readonly T[];
  },
) {
  const reviewed = resolveProviderEvidenceRefs(catalog, input.reviewedArtifactRefs);
  const provenance = new Map<string, ReviewEvidenceProvenance>();
  for (const item of reviewed.provenance) provenance.set(item.evidenceId, item);
  const findings = input.findings.map((finding) => {
    const evidence = resolveProviderEvidenceRefs(catalog, finding.evidenceRefs);
    const affected = resolveProviderEvidenceRefs(catalog, finding.affectedArtifacts);
    for (const item of [...evidence.provenance, ...affected.provenance]) provenance.set(item.evidenceId, item);
    return {
      ...finding,
      evidenceRefs: evidence.canonicalRefs,
      affectedArtifacts: affected.canonicalRefs,
    };
  });
  return {
    reviewedArtifactRefs: reviewed.canonicalRefs,
    findings,
    provenance: [...provenance.values()].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)),
  };
}

export function toProviderReviewEvidence<
  T extends {
    reviewedArtifactRefs: readonly string[];
    findings: readonly { evidenceRefs: readonly string[]; affectedArtifacts: readonly string[] }[];
  },
>(input: unknown, output: T, fallbackCatalog: ReviewEvidenceCatalog) {
  return {
    ...output,
    reviewedArtifactRefs: output.reviewedArtifactRefs.map((reference) =>
      evidenceIdFor(input, reference, fallbackCatalog),
    ),
    findings: output.findings.map((finding) => ({
      ...finding,
      evidenceRefs: finding.evidenceRefs.map((reference) =>
        evidenceIdFor(input, reference, fallbackCatalog),
      ),
      affectedArtifacts: finding.affectedArtifacts.map((reference) =>
        evidenceIdFor(input, reference, fallbackCatalog),
      ),
    })),
  };
}
