import { createHash } from "node:crypto";
import { z } from "zod";
import { CURATION_POLICY_VERSION } from "./contracts";
import {
  SkillLicenseEvidenceSchema,
  SkillMetadataEvidenceReferenceSchema,
  SkillMetadataEvidenceSchema,
} from "@/skills/registry/contracts";

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const ExternalSkillEvidenceSchema = SkillLicenseEvidenceSchema.extend({
  policyVersion: z.literal(CURATION_POLICY_VERSION),
});
export type ExternalSkillEvidence = z.infer<
  typeof ExternalSkillEvidenceSchema
>;

export function createHumanLicenseEvidence(input: {
  externalSkillId: string;
  candidateChecksum: string;
  sourceRepository: string;
  recordedAt: string;
}) {
  return ExternalSkillEvidenceSchema.parse({
    evidenceId: `license-${input.candidateChecksum.slice(0, 12)}`,
    evidenceType: "CANONICAL_SOURCE_LICENSE",
    externalSkillId: input.externalSkillId,
    candidateChecksum: input.candidateChecksum,
    sourceRepository: input.sourceRepository,
    sourceRef: `https://github.com/${input.sourceRepository}`,
    assertedValue: "MIT",
    suppliedBy: "HUMAN",
    recordedAt: input.recordedAt,
    policyVersion: CURATION_POLICY_VERSION,
  });
}

export const MetadataEvidenceReferenceSchema = SkillMetadataEvidenceReferenceSchema;
export type MetadataEvidenceReference = z.infer<
  typeof MetadataEvidenceReferenceSchema
>;
export const ExtractedMetadataEvidenceSchema = SkillMetadataEvidenceSchema;
export type ExtractedMetadataEvidence = z.infer<
  typeof ExtractedMetadataEvidenceSchema
>;
type MetadataEvidenceSource = z.infer<
  typeof SkillMetadataEvidenceReferenceSchema
>["source"];

const hashFragment = (lines: string[]) =>
  createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
const cleanScalar = (value: string) =>
  value.trim().replace(/^['"]|['"]$/g, "").trim();
const headingMatch = (line: string) => line.match(/^(#{2,6})\s+(.+?)\s*$/);

function summaryFor(lines: string[]) {
  const summary = lines
    .map((line) => line.trim())
    .filter((line) => line && line !== "---" && !line.startsWith("```") )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return summary.slice(0, 500) || "Explicit structured evidence.";
}

function reference(
  field: "purpose" | "steps",
  source: MetadataEvidenceSource,
  lines: string[],
  lineStart: number,
  lineEnd: number,
  heading?: string,
): MetadataEvidenceReference {
  return MetadataEvidenceReferenceSchema.parse({
    field,
    source,
    heading,
    lineStart,
    lineEnd,
    fragmentChecksum: hashFragment(lines.slice(lineStart - 1, lineEnd)),
    summary: summaryFor(lines.slice(lineStart - 1, lineEnd)),
  });
}

function sectionRange(lines: string[], headingIndex: number) {
  const current = headingMatch(lines[headingIndex]);
  if (!current) return [headingIndex + 1, headingIndex + 1] as const;
  const level = current[1].length;
  let end = lines.length;
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const next = headingMatch(lines[index]);
    if (next && next[1].length <= level) {
      end = index;
      break;
    }
  }
  return [headingIndex + 1, end] as const;
}

function frontmatterDescription(lines: string[]) {
  if (lines[0]?.trim() !== "---") return undefined;
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) return undefined;
  for (let index = 1; index < end; index += 1) {
    const match = lines[index].match(/^description:\s*(.*)$/i);
    if (!match) continue;
    const value = match[1].trim();
    if (value && value !== ">-" && value !== "|-")
      return { value: cleanScalar(value), lineStart: index + 1, lineEnd: index + 1 };
    const continuation: string[] = [];
    let cursor = index + 1;
    while (cursor < end && /^\s+/.test(lines[cursor])) {
      continuation.push(lines[cursor].trim());
      cursor += 1;
    }
    return {
      value: continuation.join(" ").replace(/\s+/g, " ").trim(),
      lineStart: index + 1,
      lineEnd: Math.max(index + 1, cursor),
    };
  }
  return undefined;
}

/** Extracts indexes into exact local content; it never rewrites the skill. */
export function extractMetadataEvidence(text: string): ExtractedMetadataEvidence {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const headings = lines
    .map((line, index) => ({ index, match: headingMatch(line) }))
    .filter((item): item is { index: number; match: RegExpMatchArray } => Boolean(item.match));
  const frontmatter = frontmatterDescription(lines);
  const purposeHeading = headings.find((item) =>
    /^(purpose|core purpose|overview|goal)$/i.test(item.match[2]),
  );
  const purpose = frontmatter
    ? reference(
        "purpose",
        "frontmatter-description",
        lines,
        frontmatter.lineStart,
        frontmatter.lineEnd,
      )
    : purposeHeading
      ? (() => {
          const [start, end] = sectionRange(lines, purposeHeading.index);
          return reference(
            "purpose",
            /overview/i.test(purposeHeading.match[2])
              ? "overview-section"
              : "purpose-section",
            lines,
            start,
            end,
            purposeHeading.match[2],
          );
        })()
      : undefined;

  const steps: MetadataEvidenceReference[] = [];
  const stepHeadingGroups = headings.filter((item) =>
    /^step\s+\d+\s*:/i.test(item.match[2]),
  );
  for (const item of stepHeadingGroups) {
    const [, end] = sectionRange(lines, item.index);
    steps.push(
      reference(
        "steps",
        "sequenced-heading",
        lines,
        item.index + 1,
        end,
        item.match[2],
      ),
    );
  }
  for (const item of headings) {
    const [start, end] = sectionRange(lines, item.index);
    const body = lines.slice(start - 1, end);
    const ordered = body
      .map((line, offset) => ({ line, offset }))
      .filter((entry) => /^\s*\d+[.)]\s+/.test(entry.line));
    const checklist = body
      .map((line, offset) => ({ line, offset }))
      .filter((entry) => /^\s*[-*]\s+\[[ xX]\]\s+/.test(entry.line));
    const selected = ordered.length ? ordered : checklist;
    if (!selected.length) continue;
    const source = ordered.length ? "ordered-procedure" : "checklist";
    const first = start + selected[0].offset;
    const last = start + selected[selected.length - 1].offset;
    steps.push(reference("steps", source, lines, first, last, item.match[2]));
  }
  const uniqueSteps = steps.filter(
    (item, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.lineStart === item.lineStart &&
          candidate.lineEnd === item.lineEnd,
      ) === index,
  );
  return ExtractedMetadataEvidenceSchema.parse({
    purpose,
    steps: uniqueSteps,
    unresolved: [
      ...(purpose ? [] : ["purpose"]),
      ...(uniqueSteps.length ? [] : ["steps"]),
    ],
  });
}

export const CandidateApprovalReadinessSchema = z.enum([
  "APPROVAL_ELIGIBLE",
  "METADATA_INCOMPLETE",
  "LICENSE_EVIDENCE_MISSING",
  "UPSTREAM_CHANGED",
  "SECURITY_BLOCKED",
  "SOURCE_UNAVAILABLE",
  "EVIDENCE_CONFLICT",
]);
export type CandidateApprovalReadiness = z.infer<
  typeof CandidateApprovalReadinessSchema
>;

export const CandidateEvidenceStatusSchema = z.object({
  externalSkillId: z.string().min(1),
  expectedChecksum: Sha256Schema,
  stagedChecksum: Sha256Schema.optional(),
  upstreamChecksum: Sha256Schema.optional(),
  metadataUnresolved: z.array(z.string()),
  metadataStatus: z.enum(["COMPLETE", "INCOMPLETE"]),
  metadataEvidence: ExtractedMetadataEvidenceSchema.optional(),
  licenseEvidenceStatus: z.enum(["PRESENT", "MISSING", "MALFORMED"]),
  licenseEvidence: ExternalSkillEvidenceSchema.optional(),
  upstreamStatus: z.enum(["CURRENT", "STALE", "NOT_VERIFIED"]),
  localSecurityStatus: z.enum(["PASS", "BLOCKED"]),
  externalAuditStatus: z.enum(["PASS", "WARN", "FAIL", "UNAVAILABLE"]),
  readiness: CandidateApprovalReadinessSchema,
  blockers: z.array(z.string()),
});
export type CandidateEvidenceStatus = z.infer<
  typeof CandidateEvidenceStatusSchema
>;

export type CandidateEvidenceInput = {
  externalSkillId: string;
  expectedExternalSkillId: string;
  expectedChecksum: string;
  expectedSourceRepository?: string;
  stagedExternalSkillId?: string;
  stagedChecksum?: string;
  evaluationChecksum?: string;
  upstreamExternalSkillId?: string;
  upstreamChecksum?: string;
  metadataUnresolved: readonly string[];
  metadataEvidence?: ExtractedMetadataEvidence;
  licenseEvidence?: unknown;
  hasApprovalBlockingFinding: boolean;
  externalAuditStatus: "pass" | "warn" | "fail" | "unavailable";
  contradictoryLicenseEvidence?: boolean;
};

const auditStatus = (
  value: CandidateEvidenceInput["externalAuditStatus"],
): CandidateEvidenceStatus["externalAuditStatus"] =>
  value.toUpperCase() as CandidateEvidenceStatus["externalAuditStatus"];

function readLicenseEvidence(input: CandidateEvidenceInput) {
  if (input.licenseEvidence === undefined) return undefined;
  const parsed = ExternalSkillEvidenceSchema.safeParse(input.licenseEvidence);
  if (!parsed.success) return undefined;
  if (parsed.data.externalSkillId !== input.expectedExternalSkillId) return undefined;
  if (parsed.data.candidateChecksum !== input.expectedChecksum) return undefined;
  if (
    input.expectedSourceRepository &&
    parsed.data.sourceRepository !== input.expectedSourceRepository
  )
    return undefined;
  return parsed.data;
}

export function assessCandidateEvidence(
  input: CandidateEvidenceInput,
): CandidateEvidenceStatus {
  const blockers: string[] = [];
  const metadataUnresolved = [...input.metadataUnresolved];
  const metadataStatus = metadataUnresolved.length ? "INCOMPLETE" : "COMPLETE";
  const licenseEvidence = readLicenseEvidence(input);
  const hasMalformedLicenseEvidence =
    input.licenseEvidence !== undefined && !licenseEvidence;
  const licenseEvidenceStatus = licenseEvidence
    ? "PRESENT"
    : input.licenseEvidence === undefined
      ? "MISSING"
      : "MALFORMED";

  if (input.externalSkillId !== input.expectedExternalSkillId)
    blockers.push("external ID does not match the selected candidate");
  if (input.stagedExternalSkillId !== input.expectedExternalSkillId)
    blockers.push("staged external ID does not match the selected candidate");
  if (
    input.upstreamExternalSkillId !== undefined &&
    input.upstreamExternalSkillId !== input.expectedExternalSkillId
  )
    blockers.push("upstream external ID does not match the selected candidate");
  const checksums = [
    input.stagedChecksum,
    input.evaluationChecksum,
    input.upstreamChecksum,
  ];
  if (
    checksums.some(
      (checksum) => checksum !== undefined && checksum !== input.expectedChecksum,
    )
  )
    blockers.push("candidate checksum differs from the exact reviewed checksum");
  if (input.evaluationChecksum === undefined)
    blockers.push("exact curation evaluation is missing");
  if (metadataUnresolved.length)
    blockers.push(`unresolved metadata: ${metadataUnresolved.join(", ")}`);
  if (licenseEvidenceStatus === "MISSING")
    blockers.push("explicit license evidence is missing");
  if (hasMalformedLicenseEvidence)
    blockers.push("license evidence does not match the candidate provenance");
  if (input.contradictoryLicenseEvidence) {
    blockers.push("contradictory license evidence requires human review");
  }
  if (input.hasApprovalBlockingFinding)
    blockers.push("local static security review has an approval-blocking finding");

  const upstreamStatus =
    input.upstreamChecksum === undefined
      ? "NOT_VERIFIED"
      : input.upstreamChecksum === input.expectedChecksum &&
          input.upstreamExternalSkillId === input.expectedExternalSkillId
        ? "CURRENT"
        : "STALE";
  if (upstreamStatus === "STALE") blockers.push("upstream candidate changed");
  if (upstreamStatus === "NOT_VERIFIED")
    blockers.push("upstream candidate has not been verified");

  let readiness: CandidateApprovalReadiness = "APPROVAL_ELIGIBLE";
  if (
    input.externalSkillId !== input.expectedExternalSkillId ||
    input.stagedExternalSkillId !== input.expectedExternalSkillId
  )
    readiness = "SOURCE_UNAVAILABLE";
  else if (
    upstreamStatus === "STALE" ||
    checksums.some(
      (checksum) => checksum !== undefined && checksum !== input.expectedChecksum,
    )
  )
    readiness = "UPSTREAM_CHANGED";
  else if (input.contradictoryLicenseEvidence)
    readiness = "EVIDENCE_CONFLICT";
  else if (hasMalformedLicenseEvidence) readiness = "EVIDENCE_CONFLICT";
  else if (upstreamStatus === "NOT_VERIFIED") readiness = "SOURCE_UNAVAILABLE";
  else if (input.hasApprovalBlockingFinding) readiness = "SECURITY_BLOCKED";
  else if (metadataStatus === "INCOMPLETE") readiness = "METADATA_INCOMPLETE";
  else if (licenseEvidenceStatus !== "PRESENT")
    readiness = "LICENSE_EVIDENCE_MISSING";
  else if (input.evaluationChecksum === undefined)
    readiness = "SOURCE_UNAVAILABLE";

  return CandidateEvidenceStatusSchema.parse({
    externalSkillId: input.externalSkillId,
    expectedChecksum: input.expectedChecksum,
    stagedChecksum: input.stagedChecksum,
    upstreamChecksum: input.upstreamChecksum,
    metadataUnresolved,
    metadataStatus,
    metadataEvidence: input.metadataEvidence,
    licenseEvidenceStatus,
    licenseEvidence,
    upstreamStatus,
    localSecurityStatus: input.hasApprovalBlockingFinding ? "BLOCKED" : "PASS",
    externalAuditStatus: auditStatus(input.externalAuditStatus),
    readiness,
    blockers,
  });
}
