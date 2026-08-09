import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { SkillCandidateEvaluationSchema, type SkillCandidateEvaluation } from "@/skills/curation/contracts";
import { buildPortfolioPlan, renderPortfolioPlanReport } from "@/skills/curation/portfolio-plan";

const root = process.cwd();
const evaluationRoot = path.join(root, "docs", "admin", "skill-curation", "evaluations");
const reportPath = path.join(root, "docs", "admin", "agent-skill-portfolio-plan-2026-08-09.md");
const planPath = path.join(root, "docs", "admin", "skill-curation", "agent-skill-portfolio-plan-2026-08-09.json");

async function loadEvaluations(): Promise<SkillCandidateEvaluation[]> {
  const names = await readdir(evaluationRoot);
  const records: SkillCandidateEvaluation[] = [];
  for (const name of names.filter((item) => item.endsWith(".json"))) {
    try {
      records.push(SkillCandidateEvaluationSchema.parse(JSON.parse(await readFile(path.join(evaluationRoot, name), "utf8"))));
    } catch {
      // Historical admin files that are not current evaluation records are ignored.
    }
  }
  return records;
}

async function main() {
  const plan = buildPortfolioPlan(await loadEvaluations(), new Date().toISOString());
  await mkdir(path.dirname(reportPath), { recursive: true });
  await mkdir(path.dirname(planPath), { recursive: true });
  await writeFile(reportPath, renderPortfolioPlanReport(plan), { flag: "w", mode: 0o600 });
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, { flag: "w", mode: 0o600 });
  console.log(JSON.stringify({ agents: plan.agents.length, candidates: plan.humanReviewCandidatesConsidered.length, externalAdvance: plan.humanReviewCandidatesConsidered.filter((item) => item.recommendation === "EXTERNAL_ADVANCE").length, externalOptional: plan.humanReviewCandidatesConsidered.filter((item) => item.recommendation === "EXTERNAL_OPTIONAL").length, rejected: plan.humanReviewCandidatesConsidered.filter((item) => item.recommendation.startsWith("REJECT_")).length, preferInternal: plan.humanReviewCandidatesConsidered.filter((item) => item.recommendation === "PREFER_INTERNAL_SKILL").length, proposedInternalSkills: plan.proposedInternalSkills.length, searches: plan.discoverySearches, reportPath, planPath }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Portfolio plan failed.");
  process.exitCode = 1;
});
