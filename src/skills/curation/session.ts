import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  SkillsShSourceAdapter,
  type SkillsShSourceAdapter as SkillsShSourceAdapterType,
} from "@/integrations/skills-sh/adapter";
import type {
  SkillsShCandidate,
  SkillsShAuditResult,
} from "@/integrations/skills-sh/contracts";
import { SkillRegistry } from "@/skills/registry/registry";
import {
  CurationCapability,
  CurationReviewer,
  type ExistingCurationCandidate,
  type SkillCandidateEvaluation,
} from "./contracts";
import { evaluateSkillCandidate } from "./evaluator";
import { renderCurationReport } from "./report";
import { SkillCurationEvaluationStore } from "./store";

export const CURATION_TARGETS = [
  {
    reviewer: "architecture-reviewer",
    capability: "review.architecture",
    query: "software architecture review module boundaries",
  },
  {
    reviewer: "contract-auditor",
    capability: "review.contracts",
    query: "requirements traceability acceptance criteria API contract",
  },
  {
    reviewer: "code-integration-reviewer",
    capability: "review.integration",
    query: "React Next.js TypeScript code integration review",
  },
  {
    reviewer: "security-reviewer",
    capability: "review.security",
    query: "Next.js Supabase PostgreSQL RLS authorization security review",
  },
  {
    reviewer: "test-quality-reviewer",
    capability: "review.test-quality",
    query: "Playwright Vitest webapp test strategy quality review",
  },
] as const satisfies ReadonlyArray<{
  reviewer: CurationReviewer;
  capability: CurationCapability;
  query: string;
}>;

export type CurationSessionOptions = {
  adapter?: SkillsShSourceAdapterType;
  registry?: SkillRegistry;
  evaluationStore: SkillCurationEvaluationStore;
  reportPath: string;
  now?: string;
};

export async function runCurationSession(options: CurationSessionOptions) {
  const adapter = options.adapter ?? new SkillsShSourceAdapter();
  const registry = options.registry ?? new SkillRegistry(path.join(process.cwd(), "skills"));
  const evaluations: SkillCandidateEvaluation[] = [];
  const existingCandidates: ExistingCurationCandidate[] = [];
  const seen = new Set<string>();
  let detailCandidatesFetched = 0;
  let stagedExternalSkills = 0;
  const sourceIssues: string[] = [];
  for (const target of CURATION_TARGETS) {
    let searchResults;
    try {
      searchResults = await adapter.searchSkills(target.query, { limit: 5 });
    } catch {
      sourceIssues.push(`${target.reviewer}: search unavailable`);
      continue;
    }
    for (const result of searchResults.slice(0, 5)) {
      if (seen.has(result.id)) continue;
      seen.add(result.id);
      let candidate: SkillsShCandidate;
      try {
        candidate = await adapter.fetchSkillCandidate(result.id);
        detailCandidatesFetched += 1;
      } catch {
        sourceIssues.push(`${target.reviewer}/${result.id}: detail unavailable`);
        continue;
      }
      candidate = {
        ...candidate,
        descriptor: {
          ...candidate.descriptor,
          name: result.name,
          metadata: {
            ...candidate.descriptor.metadata,
            installs: result.installs,
            sourceType: result.sourceType,
          },
        },
      };
      let audit: SkillsShAuditResult;
      try {
        audit = await adapter.getSkillAudit(result.id);
      } catch {
        audit = { available: false, reason: "Audit retrieval failed." };
      }
      const evaluation = await evaluateSkillCandidate({
        candidate,
        targetReviewer: target.reviewer,
        targetCapability: target.capability,
        audit,
        existingCandidates,
        now: options.now,
      });
      if (evaluation.recommendedDisposition !== "REJECT") {
        try {
          const staged = await adapter.stageSkillCandidate(candidate, registry, {
            idempotencyKey: `curation:${candidate.normalizedContentChecksum}`,
            reviewer: "external-skill-curation",
          });
          evaluation.stagedSkillId = staged.definition.id;
          stagedExternalSkills += 1;
        } catch {
          evaluation.reasons.push("Candidate passed curation but could not be staged for human review.");
          evaluation.recommendedDisposition = "NEEDS_HUMAN_REVIEW";
          evaluation.recommendation = "OPTIONAL";
        }
      }
      const persisted = await options.evaluationStore.save(evaluation);
      evaluations.push(persisted);
      existingCandidates.push({
        skillId: evaluation.skillId,
        externalSkillId: evaluation.externalSkillId,
        candidateChecksum: evaluation.candidateChecksum,
        content: candidate.files.map((file) => file.contents).join("\n"),
      });
    }
  }
  const report = renderCurationReport({
    generatedAt: options.now ?? new Date().toISOString(),
    searchQueries: CURATION_TARGETS.map((target) => target.query),
    detailCandidatesFetched,
    sourceIssues,
    stagedExternalSkills,
    evaluations,
  });
  await mkdir(path.dirname(path.resolve(options.reportPath)), { recursive: true });
  await writeFile(options.reportPath, report, { flag: "w", mode: 0o600 });
  return {
    evaluations,
    detailCandidatesFetched,
    stagedExternalSkills,
    reportPath: path.resolve(options.reportPath),
    searchQueries: CURATION_TARGETS.map((target) => target.query),
    sourceIssues,
  };
}
