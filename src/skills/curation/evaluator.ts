import { createHash } from "node:crypto";
import { z } from "zod";
import {
  SkillsShAuditResultSchema,
  SkillsShCandidateSchema,
  type SkillsShAuditResult,
  type SkillsShCandidate,
} from "@/integrations/skills-sh/contracts";
import { DEFAULT_SKILL_POLICY } from "@/skills/registry/policy";
import { parseSkillMarkdown } from "@/skills/registry/parser";
import { reviewSkill, type SkillReview } from "@/skills/registry/review";
import type { SkillFile } from "@/skills/registry/types";
import {
  ArchitectureCompatibilitySchema,
  CurationCapabilitySchema,
  type CurationCapability,
  CurationDimensionSchema,
  CurationInput,
  CurationReviewer,
  CURATION_POLICY_VERSION,
  ContextEfficiencySchema,
  ExternalAuditStatusSchema,
  OverlapAssessmentSchema,
  ProcedureFitSchema,
  SemanticCurationEvaluator,
  SkillCandidateEvaluation,
  SkillCandidateEvaluationSchema,
  ToolAssumption,
  ToolCompatibilitySchema,
} from "./contracts";

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const textOf = (candidate: SkillsShCandidate) =>
  candidate.files.map((file) => `${file.path}\n${file.contents}`).join("\n");
const words = (value: string) =>
  new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2),
  );
const overlap = (left: string, right: string) => {
  const a = words(left);
  const b = words(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / new Set([...a, ...b]).size;
};
const evidence = (content: string, pattern: RegExp) =>
  content
    .split(/\r?\n/)
    .filter((line) => pattern.test(line))
    .slice(0, 4)
    .map((line) => line.trim().slice(0, 240));
const assumption = (
  category: ToolAssumption["category"],
  content: string,
  pattern: RegExp,
  essentialPattern: RegExp,
): ToolAssumption | undefined => {
  const matches = evidence(content, pattern);
  if (!matches.length) return undefined;
  return {
    category,
    essential: essentialPattern.test(content),
    evidence: matches,
  };
};
const detectToolAssumptions = (content: string) =>
  [
    assumption(
      "agent-or-subagent",
      content,
      /\b(?:subagents?|sub-agents?|spawn agent|delegate to another agent|parallel agents?)\b/i,
      /\b(?:must|always|first)\b.{0,40}\b(?:spawn|delegate|subagent)\b/i,
    ),
    assumption(
      "shell",
      content,
      /\b(?:shell|bash|powershell|command prompt|terminal)\b|\bnpx\b/i,
      /\b(?:must|always|run|execute)\b.{0,50}\b(?:shell|bash|powershell|command|npx)\b/i,
    ),
    assumption(
      "git",
      content,
      /\bgit\b|\bcommit\b|\bbranch\b/i,
      /\b(?:must|always)\b.{0,50}\b(?:git|commit|branch)\b/i,
    ),
    assumption(
      "github",
      content,
      /\bgithub\b|\bgh\s+(?:issue|pr|repo)\b/i,
      /\b(?:must|always|create|open)\b.{0,50}\b(?:github|gh\s+(?:issue|pr))\b/i,
    ),
    assumption(
      "playwright-or-browser",
      content,
      /\bplaywright\b|\bbrowser\b|\bpage\.goto\b/i,
      /\b(?:must|always|run|execute)\b.{0,50}\b(?:playwright|browser|page\.goto)\b/i,
    ),
    assumption(
      "python",
      content,
      /\bpython(?:3)?\b|\bpip\b/i,
      /\b(?:must|always|run|execute)\b.{0,50}\bpython(?:3)?\b/i,
    ),
    assumption(
      "filesystem-write",
      content,
      /\b(?:write|edit|modify|rewrite|refactor)\s+(?:the\s+)?(?:file|code|repository|source)/i,
      /\b(?:must|always)\b.{0,50}\b(?:write|edit|modify|rewrite|refactor)\b/i,
    ),
    assumption(
      "network-fetch",
      content,
      /\b(?:fetch|curl|wget|visit|browse|latest docs|HTTP request)\b/i,
      /\b(?:must|always|before each review)\b.{0,50}\b(?:fetch|curl|wget|visit|browse)\b/i,
    ),
    assumption(
      "mcp",
      content,
      /\bMCP\b|model context protocol/i,
      /\b(?:must|always|requires?)\b.{0,50}\bMCP\b/i,
    ),
    assumption(
      "package-install",
      content,
      /\b(?:npm|pnpm|yarn|pip)\s+(?:install|add)\b/i,
      /\b(?:must|always|first)\b.{0,50}\b(?:npm|pnpm|yarn|pip)\s+(?:install|add)\b/i,
    ),
  ].filter((item): item is ToolAssumption => Boolean(item));

const capabilityKeywords: Record<CurationCapability, RegExp> = {
  "requirements.clarify": /requirements?|elicitation|ambiguity|clarif|intent|scope|brief|acceptance/i,
  "requirements.brief": /requirements?|elicitation|ambiguity|clarif|intent|scope|brief|acceptance/i,
  "planning.architecture": /architecture|decomposition|data model|Next\.js|Supabase|PostgreSQL|dependency|risk|traceability/i,
  "planning.content": /content|information architecture|copy|editorial|requirements?/i,
  "planning.assets": /asset|imagery|media|content|design direction/i,
  "design.directions": /design|UX|responsive|typography|spacing|layout|interaction|motion|accessib/i,
  "design.selection": /design|UX|responsive|typography|spacing|layout|interaction|motion|accessib/i,
  "implementation.code": /implement|React|Next\.js|TypeScript|Server Component|client component|form|Zod|performance|maintain/i,
  "implementation.backend": /Supabase|PostgreSQL|auth|storage|server action|route handler|database|RLS|security/i,
  "implementation.seo": /SEO|metadata|canonical|robots|sitemap|indexab|Open Graph|structured data/i,
  "review.architecture":
    /architecture|module boundaries?|domain model|cohesion|coupling|source of truth|architecture decision/i,
  "review.contracts":
    /requirements?|acceptance criteria|traceability|schema|API contract|specification|consistency/i,
  "review.integration":
    /code review|React|Next\.js|TypeScript|integration|server.?client|module composition/i,
  "review.security":
    /security|authorization|authentication|RLS|Supabase|PostgreSQL|secure input|route handler|server action/i,
  "review.security-threat-model": /threat model|attack surface|trust boundary|STRIDE|OWASP|security control|risk treatment/i,
  "review.security-test": /security test|penetration|authorization|injection|XSS|CSRF|SSRF|headers|cookies|secret scan/i,
  "review.german-web-compliance": /German|Germany|Impressum|Datenschutz|DSGVO|BDSG|DDG|TDDDG|BFSG|VSBG|newsletter|e-commerce|consent/i,
  "review.exploratory-qa": /exploratory|edge case|boundary|user flow|failure mode|reproducible evidence|unexpected state/i,
  "review.ux-critic": /UX|usability|clarity|CTA|flow|mobile|friction|interaction|feedback/i,
  "review.product-critic": /product|scope|audience|outcome|value proposition|conversion|requirement fit/i,
  "review.architecture-critic": /architecture|complexity|trust boundary|failure mode|coupling|module boundary|resilience/i,
  "review.test-quality":
    /test strategy|Playwright|Vitest|assertions?|coverage|quality engineering|user flow/i,
  "review.browser-qa":
    /browser|Playwright|navigation|user flow|console|network|responsive/i,
  "review.accessibility":
    /accessib|WCAG|keyboard|focus|screen reader|contrast|semantic/i,
  "review.performance":
    /performance|bundle|client JavaScript|waterfall|layout shift|cache|render/i,
  "review.visual-regression":
    /visual|screenshot|responsive|layout|spacing|typography|overflow/i,
  "review.release-readiness":
    /release|readiness|build|typecheck|lint|blocking|verdict/i,
  "review.seo":
    /SEO|metadata|canonical|robots|sitemap|indexab|Open Graph/i,
  "review.content-quality":
    /content|placeholder|provenance|factual|copy|testimonial/i,
  "review.dependencies":
    /dependenc|package|lockfile|version|bundle|authorized/i,
  "review.documentation":
    /documentation|README|setup|environment|test commands/i,
  "review.design":
    /design|typography|spacing|hierarchy|visual|polish|component|responsive|motion/i,
  "review.animation":
    /animation|motion|easing|duration|transform|reduced motion|interrupt/i,
};
const responsibilityKeywords: Record<CurationReviewer, RegExp> = {
  lead: /requirements?|elicitation|ambiguity|clarif|intent|scope|brief/i,
  planner: /planning|architecture|decomposition|data model|Next\.js|Supabase|PostgreSQL|dependency|risk|traceability/i,
  design: /design|UX|responsive|typography|spacing|layout|interaction|motion|accessib/i,
  implementation: /implement|React|Next\.js|TypeScript|Server Component|client component|form|Zod|Supabase|PostgreSQL|auth|storage|performance/i,
  "architecture-reviewer": /architecture|module boundaries?|cohesion|coupling|domain model/i,
  "contract-auditor": /requirements?|acceptance criteria|traceability|schema|API contract|specification/i,
  "code-integration-reviewer": /code review|React|Next\.js|TypeScript|integration|server.?client/i,
  "security-reviewer": /security|authorization|authentication|RLS|Supabase|PostgreSQL|secure input/i,
  "test-quality-reviewer": /test|Playwright|Vitest|assertions?|coverage|quality/i,
};
const otherResponsibilityKeywords: Record<CurationReviewer, RegExp> = {
  lead: /architecture|React|Next\.js|TypeScript|security|Playwright|Vitest/i,
  planner: /Playwright|Vitest|RLS|security review|implementation code/i,
  design: /shell|npm|database|server action|route handler/i,
  implementation: /acceptance criteria|architecture review|Playwright strategy/i,
  "architecture-reviewer": /security|Playwright|Vitest|acceptance criteria/i,
  "contract-auditor": /architecture|Playwright|Vitest|RLS|Supabase/i,
  "code-integration-reviewer": /Playwright|Vitest|RLS|Supabase|acceptance criteria/i,
  "security-reviewer": /Playwright|Vitest|architecture decision|acceptance criteria/i,
  "test-quality-reviewer": /RLS|Supabase|architecture decision|acceptance criteria/i,
};

const filesForReview = (candidate: SkillsShCandidate): SkillFile[] =>
  candidate.files.map((file) => ({
    relativePath: file.path,
    sha256: sha256(file.contents),
    byteSize: Buffer.byteLength(file.contents, "utf8"),
    kind:
      file.path === "SKILL.md"
        ? "entry"
        : file.path.startsWith("references/")
          ? "reference"
          : file.path.startsWith("scripts/")
            ? "script"
            : file.path.startsWith("templates/")
              ? "template"
              : "other",
    executable: file.path.startsWith("scripts/"),
    text: file.contents,
  }));
const auditStatus = (audit: SkillsShAuditResult): z.infer<typeof ExternalAuditStatusSchema> => {
  if (!audit.available || !audit.response) return "unavailable";
  if (audit.response.audits.some((item) => item.status === "fail")) return "fail";
  if (audit.response.audits.some((item) => item.status === "warn")) return "warn";
  return "pass";
};
const asRoleFit = (
  content: string,
  capability: CurationCapability,
  reviewer: CurationReviewer,
) => {
  const relevant = capabilityKeywords[capability].test(content);
  const targetSignal = responsibilityKeywords[reviewer].test(content);
  const crossRoleOnly =
    otherResponsibilityKeywords[reviewer].test(content) && !targetSignal;
  return relevant && !crossRoleOnly ? "strong" : "none";
};
const asProcedureFit = (content: string) => {
  if (!/\b(?:review|audit|assess|analy[sz]e|checklist|procedure|steps?)\b/i.test(content))
    return "none";
  if (/\b(?:commit|rewrite|refactor|implement|edit files?)\b/i.test(content))
    return "low";
  return /\b(?:checklist|steps?|methodology|criteria|traceability)\b/i.test(content)
    ? "high"
    : "medium";
};
const contextEfficiency = (bytes: number) =>
  bytes <= 8_000
    ? "compact"
    : bytes <= 32_000
      ? "bounded"
      : bytes <= DEFAULT_SKILL_POLICY.maxContextBytes
        ? "large"
        : "too-large";

export async function evaluateSkillCandidate(
  input: CurationInput,
  semanticEvaluator?: SemanticCurationEvaluator,
): Promise<SkillCandidateEvaluation> {
  const candidate = SkillsShCandidateSchema.parse(input.candidate);
  const audit = SkillsShAuditResultSchema.parse(
    input.audit ?? { available: false, reason: "No external audit metadata supplied." },
  );
  const entry = candidate.files.find((file) => file.path === "SKILL.md");
  const content = textOf(candidate);
  const entryContent = entry?.contents ?? "";
  const parsed = parseSkillMarkdown(entryContent);
  const files = filesForReview(candidate);
  const review: SkillReview = reviewSkill(files, DEFAULT_SKILL_POLICY, parsed.unresolved);
  const assumptions = detectToolAssumptions(content);
  const estimatedInjectionBytes = candidate.files
    .filter((file) => file.path === "SKILL.md" || file.path.startsWith("references/"))
    .slice(0, DEFAULT_SKILL_POLICY.maxReferenceFilesPerLoad + 1)
    .reduce((total, file) => total + Buffer.byteLength(file.contents, "utf8"), 0);
  const existing = input.existingCandidates ?? [];
  const duplicateDetected = existing.some(
    (item) => item.candidateChecksum === candidate.normalizedContentChecksum,
  );
  const nearDuplicateDetected = existing.some(
    (item) =>
      item.candidateChecksum !== candidate.normalizedContentChecksum &&
      overlap(content, item.content) >= 0.75,
  );
  const externalLinksDetected = (content.match(/https?:\/\//gi) ?? []).length;
  const toolIncompatible = assumptions.some((item) => item.essential);
  const subagentDependent = assumptions.some(
    (item) => item.category === "agent-or-subagent" && item.essential,
  );
  const mutationOriented =
    assumptions.some(
      (item) => item.category === "filesystem-write" && item.essential,
    );
  let roleFit = asRoleFit(
    content,
    input.targetCapability,
    input.targetReviewer,
  );
  let procedureFit = asProcedureFit(content);
  let architectureCompatibility = subagentDependent
    ? "incompatible"
    : mutationOriented
      ? "boundary-compatible"
      : "compatible";
  const toolAssumptionCompatibility = toolIncompatible
    ? "incompatible"
    : assumptions.length
      ? "read-only-compatible"
      : "compatible";
  const context = contextEfficiency(estimatedInjectionBytes);
  const overlapAssessment = duplicateDetected
    ? "duplicate"
    : nearDuplicateDetected
      ? "high"
      : existing.length
        ? "low"
        : "low";
  const unsafeFindings = review.findings.filter(
    (finding) => finding.severity === "high" || finding.severity === "critical",
  );
  const localSecurityAssessment = unsafeFindings.length > 0
    ? "fail"
    : "pass";
  const externalStatus = auditStatus(audit);
  const reasons: string[] = [];
  if (localSecurityAssessment === "fail")
    reasons.push("Local static review found an approval-blocking unsafe instruction.");
  if (subagentDependent)
    reasons.push("The core procedure depends on subagent orchestration outside this reviewer architecture.");
  if (mutationOriented)
    reasons.push("The procedure is mutation-oriented and is a poor fit for a read-only reviewer.");
  if (toolIncompatible)
    reasons.push("The candidate requires a tool that this reviewer does not possess; no permission is granted.");
  if (roleFit === "none")
    reasons.push("The candidate does not show strong target-reviewer-specific procedure fit.");
  if (procedureFit === "none" || procedureFit === "low")
    reasons.push("The candidate provides limited reusable review methodology.");
  if (duplicateDetected) reasons.push("An exact candidate checksum already exists in the evaluation corpus.");
  if (nearDuplicateDetected) reasons.push("The candidate substantially overlaps another evaluated procedure.");
  if (context === "too-large") reasons.push("The estimated reviewer injection footprint exceeds the context policy.");
  if (externalStatus === "fail") reasons.push("An external audit reports a failure; this advisory result requires human attention.");
  if (externalStatus === "warn") reasons.push("An external audit reports a warning; the result is advisory only.");
  if (externalStatus === "unavailable") reasons.push("No external audit metadata is available; local review remains authoritative.");

  const hardReject =
    localSecurityAssessment === "fail" ||
    subagentDependent ||
    mutationOriented ||
    toolIncompatible ||
    roleFit === "none" ||
    procedureFit === "none" ||
    duplicateDetected ||
    nearDuplicateDetected;
  const deterministicDefect =
    hardReject ||
    parsed.unresolved.length > 0 ||
    context === "too-large" ||
    externalStatus === "fail" ||
    externalStatus === "warn";
  let semanticEvaluationUsed = false;
  if (!deterministicDefect && semanticEvaluator) {
    const semantic = await semanticEvaluator({
      targetReviewer: input.targetReviewer,
      targetCapability: input.targetCapability,
      boundedContent: content.slice(0, DEFAULT_SKILL_POLICY.maxContextBytes),
    });
    semanticEvaluationUsed = true;
    roleFit = semantic.roleFit;
    procedureFit = semantic.procedureFit;
    architectureCompatibility = semantic.architectureCompatibility;
    reasons.push(...(semantic.reasons ?? []));
  }
  const needsHuman =
    context === "too-large" ||
    externalStatus === "fail" ||
    externalStatus === "warn" ||
    parsed.unresolved.length > 0;
  const disposition = hardReject
    ? "REJECT"
    : needsHuman
      ? "NEEDS_HUMAN_REVIEW"
      : roleFit === "strong" && procedureFit === "high" && architectureCompatibility !== "incompatible" && toolAssumptionCompatibility !== "incompatible"
        ? "SHORTLIST"
        : "NEEDS_HUMAN_REVIEW";
  const recommendation = disposition === "SHORTLIST"
    ? "RECOMMEND"
    : disposition === "REJECT"
      ? "DO_NOT_USE"
      : "OPTIONAL";
  if (!reasons.length) reasons.push("Candidate passed deterministic curation checks and adds focused review procedure.");
  return SkillCandidateEvaluationSchema.parse({
    schemaVersion: 1,
    policyVersion: CURATION_POLICY_VERSION,
    skillId: candidate.descriptor.externalSkillId,
    sourceId: candidate.descriptor.sourceId,
    externalSkillId: candidate.descriptor.externalSkillId,
    canonicalSourceRef: candidate.descriptor.canonicalSourceRef,
    targetReviewer: input.targetReviewer,
    targetCapability: CurationCapabilitySchema.parse(input.targetCapability),
    candidateChecksum: candidate.normalizedContentChecksum,
    retrievedContentChecksum: candidate.retrievedContentChecksum,
    source: candidate.descriptor.source,
    displayName: candidate.descriptor.name,
    installs:
      typeof candidate.descriptor.metadata?.installs === "number"
        ? candidate.descriptor.metadata.installs
        : undefined,
    contentBytes: Buffer.byteLength(content, "utf8"),
    estimatedInjectionBytes,
    roleFit: CurationDimensionSchema.parse(roleFit),
    procedureFit: ProcedureFitSchema.parse(procedureFit),
    architectureCompatibility: ArchitectureCompatibilitySchema.parse(architectureCompatibility),
    toolAssumptionCompatibility: ToolCompatibilitySchema.parse(toolAssumptionCompatibility),
    contextEfficiency: ContextEfficiencySchema.parse(context),
    overlapAssessment: OverlapAssessmentSchema.parse(overlapAssessment),
    nearDuplicateDetected,
    localSecurityAssessment,
    externalAuditStatus: ExternalAuditStatusSchema.parse(externalStatus),
    externalAudit: audit,
    metadataReadiness: parsed.unresolved.length === 0 ? "COMPLETE" : "INCOMPLETE",
    licenseEvidenceStatus: "MISSING",
    coverageKeys: input.coverageKeys,
    toolAssumptions: assumptions,
    deterministicChecks: {
      metadataValid: parsed.unresolved.length === 0,
      exactChecksumKnown: /^[a-f0-9]{64}$/.test(candidate.normalizedContentChecksum),
      duplicateDetected,
      nearDuplicateDetected,
      unsafeFindingCount: unsafeFindings.length,
      externalLinksDetected,
    },
    reasons,
    recommendedDisposition: disposition,
    recommendation,
    semanticEvaluationUsed,
    evaluatedAt: input.now ?? new Date().toISOString(),
  });
}
