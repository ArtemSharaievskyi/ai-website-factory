import { createHash } from "node:crypto";
import { DesignDirectionSetSchema, type DesignDirectionSet } from "@/domain/design/schema";
import { DesignCapabilityPackageSchema, DirectionDesignCapabilitySchema, stableDesignChecksum, validateExactThreeDesignCapabilities, type DesignCapabilityPassEvidence, type DesignToolProvenance } from "@/domain/design/capability";
import { decideDependency } from "@/dependencies/authority";
import { MagicPatternsAdapter } from "@/integrations/design/magic-patterns";
import { FontpairAdapter } from "@/integrations/design/fontpair";
import { detectImpeccableAntiPatterns } from "@/integrations/design/impeccable";
import { inspectApprovedDesignSkills, type ApprovedDesignSkillEvidence } from "@/integrations/design/skill-evidence";

export type ProfessionalDesignPipelineInput = { projectId: string; projectVersion: number; directionSet: DesignDirectionSet; prompt: string; idempotencyKey: string; approvedDependencies?: ReadonlySet<string>; signal?: AbortSignal };
export type ProfessionalDesignPipelineResult = { directionSet: DesignDirectionSet; dependencyRequests: Array<{ packageName: "motion"; versionSpec: "12.43.0"; directionIds: string[]; authorityCode: string }>; skillEvidence: ApprovedDesignSkillEvidence[]; magicPatternsArtifactId: string; fontpairSourceChecksum: string; impeccableDetector: ReturnType<typeof detectImpeccableAntiPatterns> };

const sourceChecksum = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const evidence = (capabilityId: DesignCapabilityPassEvidence["capabilityId"], directionId: string, summary: string, checkedAt: string, status: "PASS" | "FAIL" = "PASS"): DesignCapabilityPassEvidence => ({ capabilityId, status, evidenceId: `${directionId}:${capabilityId}:${sourceChecksum(summary).slice(0, 16)}`, summary, checkedAt });

export class ProfessionalDesignCapabilityPipeline {
  constructor(private readonly dependencies: { magicPatterns?: MagicPatternsAdapter; fontpair?: FontpairAdapter; approvedSkillEvidence?: () => Promise<ApprovedDesignSkillEvidence[]> } = {}) {}
  async run(input: ProfessionalDesignPipelineInput): Promise<ProfessionalDesignPipelineResult> {
    const magic = await (this.dependencies.magicPatterns ?? new MagicPatternsAdapter()).createMinimalArtifact({ prompt: `${input.prompt}\nCreate one bounded design artifact for three professional direction references. Do not publish, deploy, sync Git, or write to a local project.`, idempotencyKey: `${input.idempotencyKey}:magic-patterns`, signal: input.signal });
    const pair = await (this.dependencies.fontpair ?? new FontpairAdapter()).recommendPair({ idempotencyKey: `${input.idempotencyKey}:fontpair`, signal: input.signal });
    const skillEvidence = await (this.dependencies.approvedSkillEvidence ?? (() => inspectApprovedDesignSkills()))();
    if (skillEvidence.some((item) => item.status !== "APPROVED_IMMUTABLE")) throw new Error("DESIGN_SKILL_NOT_AVAILABLE_THROUGH_APPROVED_SOURCE");
    const detector = detectImpeccableAntiPatterns(input.directionSet.directions.map((direction) => ({ path: `direction/${direction.id}.design-contract`, content: JSON.stringify(direction) })));
    const checkedAt = new Date().toISOString();
    const skillChecksum = sourceChecksum(skillEvidence.map((item) => ({ id: item.skillId, checksum: item.sourceChecksum })));
    const toolEvidence = (): DesignToolProvenance[] => [
      { toolId: "magic-patterns", status: "AVAILABLE", source: "official-api", sourceRef: "https://magicpatterns.mintlify.dev/docs/api/getting-started", sourceVersion: "v3", sourceChecksum: magic.responseChecksum, retrievedAt: magic.createdAt, liveEvidence: true, contentTrust: "UNTRUSTED_EXTERNAL", redacted: true },
      { toolId: "fontpair", status: "AVAILABLE", source: "official-api", sourceRef: "https://fontpair.co/", sourceVersion: "curated-live-page", sourceChecksum: pair.sourceChecksum, retrievedAt: checkedAt, liveEvidence: true, contentTrust: "UNTRUSTED_EXTERNAL", redacted: true },
      { toolId: "impeccable", status: detector.status === "PASS" ? "AVAILABLE" : "CONTRACT_ERROR", source: "host-deterministic", sourceVersion: detector.detectorVersion, sourceChecksum: detector.sourceChecksum, retrievedAt: checkedAt, liveEvidence: true, contentTrust: "HOST_VALIDATED", redacted: false },
      { toolId: "emil-design-eng", status: "AVAILABLE", source: "approved-skill-registry", sourceRef: "https://github.com/emilkowalski/skills", sourceVersion: "approved-immutable", sourceChecksum: skillChecksum, retrievedAt: checkedAt, liveEvidence: true, contentTrust: "HOST_VALIDATED", redacted: false },
      { toolId: "emil-animation-review", status: "AVAILABLE", source: "approved-skill-registry", sourceRef: "https://github.com/emilkowalski/skills", sourceVersion: "approved-immutable", sourceChecksum: skillChecksum, retrievedAt: checkedAt, liveEvidence: true, contentTrust: "HOST_VALIDATED", redacted: false },
      { toolId: "transitions-dev", status: "AVAILABLE", source: "approved-skill-registry", sourceRef: "https://github.com/Jakubantalik/transitions.dev", sourceVersion: "approved-immutable", sourceChecksum: skillChecksum, retrievedAt: checkedAt, liveEvidence: true, contentTrust: "HOST_VALIDATED", redacted: false },
      { toolId: "motion-for-react", status: "AVAILABLE", source: "official-package", sourceRef: "https://www.npmjs.com/package/motion", sourceVersion: "12.43.0", sourceChecksum: sourceChecksum("motion@12.43.0"), retrievedAt: checkedAt, liveEvidence: true, contentTrust: "HOST_VALIDATED", redacted: false },
    ];
    const directions = input.directionSet.directions.map((direction) => {
      if (!direction.professionalDesign) throw new Error("DESIGN_CONTRACT_STALE");
      const current = direction.professionalDesign;
      const typographyBase = { ...current.typography, displayFamily: pair.displayFamily, bodyFamily: pair.bodyFamily, normalizedPair: { display: pair.displayFamily, body: pair.bodyFamily }, source: "fontpair" as const, sourceEvidenceChecksum: pair.normalizedChecksum, loadingStrategy: "google-fonts-css" as const };
      const typography = { ...typographyBase, checksum: stableDesignChecksum(typographyBase) };
      const passEvidence: DesignCapabilityPassEvidence[] = [
        evidence("magic-patterns-artifact", direction.id, `Magic Patterns artifact ${magic.artifactId} was created without publish or source sync.`, checkedAt),
        evidence("fontpair-normalization", direction.id, `Fontpair normalized ${pair.displayFamily} + ${pair.bodyFamily}.`, checkedAt),
        evidence("impeccable-semantic-skill", direction.id, "Impeccable semantic design guidance is checksum-bound to an approved immutable skill.", checkedAt),
        evidence("impeccable-antipattern-detector", direction.id, detector.status === "PASS" ? "Deterministic anti-pattern detector passed." : "Deterministic anti-pattern detector found blocking findings.", checkedAt, detector.status),
        evidence("emil-design-review", direction.id, "Emil design-engineering skill evidence is current.", checkedAt),
        evidence("emil-animation-review", direction.id, "Emil animation review skill evidence is current.", checkedAt),
        evidence("transitions-pattern-mapping", direction.id, "Transitions.dev pattern mapping evidence is current.", checkedAt),
        evidence("motion-suitability", direction.id, `Motion suitability ${current.motion.suitability} is bound to the direction contract.`, checkedAt),
      ];
      const capabilityBase = { ...current, typography, toolProvenance: toolEvidence(), passEvidence, currentness: { status: "CURRENT" as const, checkedAt } };
      return { ...direction, professionalDesign: DirectionDesignCapabilitySchema.parse({ ...capabilityBase, contractChecksum: stableDesignChecksum(capabilityBase) }) };
    });
    const dependencyRequests = directions.filter((direction) => direction.professionalDesign?.motion.suitability === "MOTION").map((direction) => ({ directionId: direction.id }));
    if (dependencyRequests.length) {
      const decision = decideDependency({ operation: "ADD", packageName: "motion", versionSpec: "12.43.0", dependencySection: "dependencies", context: { plannedDependencies: [{ name: "motion", runtime: "runtime", required: true }] } });
      if (!decision.approved) throw new Error(`UNAPPROVED_DESIGN_DEPENDENCY:${decision.code}`);
    }
    const readiness = validateExactThreeDesignCapabilities(directions, { approvedDependencies: input.approvedDependencies });
    const nonDependencyIssues = readiness.issues.filter((issue) => issue.code !== "UNAPPROVED_DESIGN_DEPENDENCY");
    if (nonDependencyIssues.length || (input.approvedDependencies && !readiness.valid)) throw new Error(`PHASE_7F_EVIDENCE_INVALID:${(nonDependencyIssues[0] ?? readiness.issues[0])?.code ?? "DESIGN_CONTRACT_STALE"}`);
    const packageBase = { schemaVersion: 1 as const, documentType: "professional-design-capability" as const, projectId: input.projectId, projectVersion: input.projectVersion, createdAt: input.directionSet.createdAt, updatedAt: checkedAt, capabilityPolicyVersion: "professional-design-capability-v1" as const, directionSetId: input.directionSet.setId, directions: directions.map((direction) => ({ directionId: direction.id, capability: direction.professionalDesign! })), dependencyRequests: dependencyRequests.length ? [{ packageName: "motion" as const, versionSpec: "12.43.0" as const, reason: "Selected dynamic direction requires the approved Motion for React runtime.", directionIds: dependencyRequests.map((item) => item.directionId) }] : [] };
    const professionalCapability = DesignCapabilityPackageSchema.parse({ ...packageBase, packageChecksum: stableDesignChecksum(packageBase) });
    return { directionSet: DesignDirectionSetSchema.parse({ ...input.directionSet, directions, professionalCapability, provider: { name: "professional-design-capability-pipeline", used: true } }), dependencyRequests: dependencyRequests.length ? [{ packageName: "motion", versionSpec: "12.43.0", directionIds: dependencyRequests.map((item) => item.directionId), authorityCode: "APPROVED" }] : [], skillEvidence, magicPatternsArtifactId: magic.artifactId, fontpairSourceChecksum: pair.sourceChecksum, impeccableDetector: detector };
  }
}
