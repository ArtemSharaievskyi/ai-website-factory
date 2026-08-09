import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  SkillsShSourceAdapter,
  type SkillsShSourceAdapter as SkillsShSourceAdapterType,
} from "@/integrations/skills-sh/adapter";
import { SkillsShError } from "@/integrations/skills-sh/errors";
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
import { discoveryTargets } from "./portfolio";
import { evaluateSkillCandidate } from "./evaluator";
import {
  renderCurationReport,
  type CurationAvailability,
} from "./report";
import { SkillCurationEvaluationStore } from "./store";

export const CURATION_TARGETS = discoveryTargets.map((target) => ({
  reviewer: target.agentId as CurationReviewer,
  capability: target.capability as CurationCapability,
  query: target.query,
  coverageKey: target.coverageKey,
}));

export const CURATION_LIMITS = {
  maxSearchRequests: 50,
  maxDetailFetches: 80,
  maxEvaluations: 80,
  maxCandidatesPerSearch: 3,
} as const;

export type CurationSessionOptions = {
  adapter?: SkillsShSourceAdapterType;
  registry?: SkillRegistry;
  evaluationStore: SkillCurationEvaluationStore;
  reportPath: string;
  now?: string;
};

const classifyAvailability = (error: unknown): CurationAvailability => {
  if (!(error instanceof SkillsShError)) return "NETWORK_ERROR";
  switch (error.code) {
    case "SKILLS_SH_AUTH_REQUIRED":
      return "AUTH_REQUIRED";
    case "SKILLS_SH_AUTH_INVALID":
      return "AUTH_INVALID";
    case "SKILLS_SH_ACCESS_FORBIDDEN":
      return "ACCESS_FORBIDDEN";
    case "SKILLS_SH_RATE_LIMITED":
      return "RATE_LIMITED";
    case "SKILLS_SH_NETWORK_FAILED":
      return "NETWORK_ERROR";
    case "SKILLS_SH_REQUEST_TIMEOUT":
      return "TIMEOUT";
    case "SKILLS_SH_API_CONTRACT_MISMATCH":
    case "SKILLS_SH_RESPONSE_INVALID":
      return "API_ERROR";
    default:
      return "UNAVAILABLE";
  }
};

const sourceIssue = (prefix: string, availability: CurationAvailability, error: unknown) => {
  const code = error instanceof SkillsShError ? error.code : availability;
  const path = error instanceof SkillsShError ? error.details?.path : undefined;
  return prefix + ": " + code + (path ? " path=" + String(path) : "");
};
const isFatalSourceError = (error: unknown) =>
  error instanceof SkillsShError &&
  [
    "SKILLS_SH_AUTH_REQUIRED",
    "SKILLS_SH_AUTH_INVALID",
    "SKILLS_SH_ACCESS_FORBIDDEN",
    "SKILLS_SH_RATE_LIMITED",
    "SKILLS_SH_NETWORK_FAILED",
    "SKILLS_SH_REQUEST_TIMEOUT",
    "SKILLS_SH_SOURCE_UNAVAILABLE",
  ].includes(error.code);

export async function runCurationSession(options: CurationSessionOptions) {
  const adapter = options.adapter ?? new SkillsShSourceAdapter();
  const registry = options.registry ?? new SkillRegistry(path.join(process.cwd(), "skills"));
  const evaluations: SkillCandidateEvaluation[] = [];
  const existingCandidates: ExistingCurationCandidate[] = [];
  const seen = new Set<string>();
  let detailCandidatesFetched = 0;
  let stagedExternalSkills = 0;
  let reusedEvaluations = 0;
  let searchRequests = 0;
  let evaluationRequests = 0;
  const stagedIds = new Set<string>();
  const sourceIssues: string[] = [];
  const attemptedQueries: string[] = [];
  let availability: CurationAvailability = "AVAILABLE";
  for (const target of CURATION_TARGETS) {
    if (searchRequests >= CURATION_LIMITS.maxSearchRequests) {
      sourceIssues.push("Administrative search ceiling reached.");
      break;
    }
    attemptedQueries.push(target.query);
    searchRequests += 1;
    let searchResults;
    try {
      searchResults = await adapter.searchSkills(target.query, { limit: 5 });
    } catch (error) {
      availability = classifyAvailability(error);
      sourceIssues.push(sourceIssue(target.reviewer, availability, error));
      break;
    }
    const queryWords = new Set(target.query.toLowerCase().split(/\s+/));
    const selectedResults = [...searchResults]
      .sort((left, right) => {
        const score = (item: typeof left) =>
          [...queryWords].filter((word) => word.length > 3 && `${item.name} ${item.slug} ${item.source}`.toLowerCase().includes(word)).length;
        return score(right) - score(left) || right.installs - left.installs;
      })
      .slice(0, CURATION_LIMITS.maxCandidatesPerSearch);
    for (const result of selectedResults) {
      if (seen.has(result.id)) continue;
      seen.add(result.id);
      if (detailCandidatesFetched >= CURATION_LIMITS.maxDetailFetches) {
        sourceIssues.push("Administrative detail-fetch ceiling reached.");
        break;
      }
      let candidate: SkillsShCandidate;
      try {
        candidate = await adapter.fetchSkillCandidate(result.id);
        detailCandidatesFetched += 1;
      } catch (error) {
        const candidateAvailability = classifyAvailability(error);
        sourceIssues.push(sourceIssue(target.reviewer + "/" + result.id, candidateAvailability, error));
        if (isFatalSourceError(error)) {
          availability = candidateAvailability;
          break;
        }
        continue;
      }
      candidate = {
        ...candidate,
        descriptor: {
          ...candidate.descriptor,
          name: result.name,
          canonicalSourceRef: result.canonicalSourceRef,
          metadata: {
            ...candidate.descriptor.metadata,
            installs: result.installs,
            sourceType: result.sourceType,
            installUrl: result.installUrl,
            url: result.url,
            isDuplicate: result.isDuplicate,
          },
        },
      };
      const current = await options.evaluationStore.getCurrent(
        candidate.descriptor.externalSkillId,
        candidate.normalizedContentChecksum,
      );
      if (current.evaluation) {
        evaluations.push(current.evaluation);
        if (current.evaluation.stagedSkillId && !stagedIds.has(current.evaluation.stagedSkillId)) {
          stagedIds.add(current.evaluation.stagedSkillId);
          stagedExternalSkills += 1;
        }
        existingCandidates.push({
          skillId: current.evaluation.skillId,
          externalSkillId: current.evaluation.externalSkillId,
          candidateChecksum: current.evaluation.candidateChecksum,
          content: candidate.files.map((file) => file.contents).join("\n"),
        });
        reusedEvaluations += 1;
        continue;
      }
      let audit: SkillsShAuditResult;
      try {
        audit = await adapter.getSkillAudit(result.id);
      } catch {
        audit = { available: false, reason: "Audit retrieval failed." };
      }
      if (evaluationRequests >= CURATION_LIMITS.maxEvaluations) {
        sourceIssues.push("Administrative evaluation ceiling reached.");
        break;
      }
      evaluationRequests += 1;
      const evaluation = await evaluateSkillCandidate({
        candidate,
        targetReviewer: target.reviewer,
        targetCapability: target.capability,
        coverageKeys: [target.coverageKey],
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
          if (!stagedIds.has(staged.definition.id)) {
            stagedIds.add(staged.definition.id);
            stagedExternalSkills += 1;
          }
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
    if (availability !== "AVAILABLE") break;
  }
  const report = renderCurationReport({
    generatedAt: options.now ?? new Date().toISOString(),
    availability,
    searchQueries: attemptedQueries,
    detailCandidatesFetched,
    sourceIssues,
    stagedExternalSkills,
    evaluations,
    reusedEvaluations,
  });
  await mkdir(path.dirname(path.resolve(options.reportPath)), { recursive: true });
  await writeFile(options.reportPath, report, { flag: "w", mode: 0o600 });
  return {
    evaluations,
    detailCandidatesFetched,
    stagedExternalSkills,
    reportPath: path.resolve(options.reportPath),
    searchQueries: attemptedQueries,
    availability,
    sourceIssues,
    reusedEvaluations,
    searchRequests,
    evaluationRequests,
  };
}
