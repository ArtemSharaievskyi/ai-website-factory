import { z } from "zod";

export const CandidateApprovalReadinessSchema = z.enum([
  "APPROVAL_ELIGIBLE",
  "METADATA_INCOMPLETE",
  "LICENSE_EVIDENCE_MISSING",
  "UPSTREAM_CHANGED",
  "SECURITY_BLOCKED",
  "SOURCE_UNAVAILABLE",
]);
export type CandidateApprovalReadiness = z.infer<
  typeof CandidateApprovalReadinessSchema
>;

export const CandidateEvidenceStatusSchema = z.object({
  externalSkillId: z.string().min(1),
  expectedChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  stagedChecksum: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  upstreamChecksum: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  metadataUnresolved: z.array(z.string()),
  metadataStatus: z.enum(["COMPLETE", "INCOMPLETE"]),
  licenseEvidenceStatus: z.enum(["PRESENT", "MISSING", "MALFORMED"]),
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
  stagedExternalSkillId?: string;
  stagedChecksum?: string;
  evaluationChecksum?: string;
  upstreamExternalSkillId?: string;
  upstreamChecksum?: string;
  metadataUnresolved: readonly string[];
  license?: unknown;
  hasApprovalBlockingFinding: boolean;
  externalAuditStatus: "pass" | "warn" | "fail" | "unavailable";
};

/**
 * The registry only accepts explicit non-empty license evidence. This check is
 * intentionally stricter than a truthiness check so whitespace/control data
 * cannot be mistaken for provenance. It never infers a license from a name or
 * repository.
 */
export function isSupportedRegistryLicenseEvidence(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 100 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

const auditStatus = (
  value: CandidateEvidenceInput["externalAuditStatus"],
): CandidateEvidenceStatus["externalAuditStatus"] => value.toUpperCase() as CandidateEvidenceStatus["externalAuditStatus"];

export function assessCandidateEvidence(
  input: CandidateEvidenceInput,
): CandidateEvidenceStatus {
  const blockers: string[] = [];
  const metadataUnresolved = [...input.metadataUnresolved];
  const metadataStatus = metadataUnresolved.length ? "INCOMPLETE" : "COMPLETE";
  const licenseEvidenceStatus =
    input.license === undefined || input.license === null || input.license === ""
      ? "MISSING"
      : isSupportedRegistryLicenseEvidence(input.license)
        ? "PRESENT"
        : "MALFORMED";

  if (input.externalSkillId !== input.expectedExternalSkillId)
    blockers.push("external ID does not match the selected candidate");
  if (input.stagedExternalSkillId !== input.expectedExternalSkillId)
    blockers.push("staged external ID does not match the selected candidate");
  if (input.upstreamExternalSkillId !== undefined && input.upstreamExternalSkillId !== input.expectedExternalSkillId)
    blockers.push("upstream external ID does not match the selected candidate");

  const checksums = [input.stagedChecksum, input.evaluationChecksum, input.upstreamChecksum];
  if (checksums.some((checksum) => checksum !== undefined && checksum !== input.expectedChecksum))
    blockers.push("candidate checksum differs from the exact reviewed checksum");
  if (input.evaluationChecksum === undefined)
    blockers.push("exact curation evaluation is missing");
  if (metadataUnresolved.length)
    blockers.push(`unresolved metadata: ${metadataUnresolved.join(", ")}`);
  if (licenseEvidenceStatus === "MISSING")
    blockers.push("explicit license evidence is missing");
  if (licenseEvidenceStatus === "MALFORMED")
    blockers.push("license evidence is malformed");
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
  if (input.externalSkillId !== input.expectedExternalSkillId || input.stagedExternalSkillId !== input.expectedExternalSkillId)
    readiness = "SOURCE_UNAVAILABLE";
  else if (upstreamStatus === "STALE" || checksums.some((checksum) => checksum !== undefined && checksum !== input.expectedChecksum))
    readiness = "UPSTREAM_CHANGED";
  else if (upstreamStatus === "NOT_VERIFIED")
    readiness = "SOURCE_UNAVAILABLE";
  else if (input.hasApprovalBlockingFinding)
    readiness = "SECURITY_BLOCKED";
  else if (metadataStatus === "INCOMPLETE")
    readiness = "METADATA_INCOMPLETE";
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
    licenseEvidenceStatus,
    upstreamStatus,
    localSecurityStatus: input.hasApprovalBlockingFinding ? "BLOCKED" : "PASS",
    externalAuditStatus: auditStatus(input.externalAuditStatus),
    readiness,
    blockers,
  });
}
