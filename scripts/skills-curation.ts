import path from "node:path";
import { loadFactoryCliEnv } from "./cli-env";
import { runCurationSession } from "@/skills/curation/session";
import { SkillCurationEvaluationStore } from "@/skills/curation/store";
import { SkillRegistry } from "@/skills/registry/registry";

const root = process.cwd();
const reportPath = path.join(
  root,
  "docs",
  "admin",
  "external-skill-curation-2026-08-09.md",
);
const evaluationRoot = path.join(
  root,
  "docs",
  "admin",
  "skill-curation",
  "evaluations",
);

loadFactoryCliEnv(root);

async function main() {
  const result = await runCurationSession({
    registry: new SkillRegistry(path.join(root, "skills")),
    evaluationStore: new SkillCurationEvaluationStore(evaluationRoot),
    reportPath,
  });
  console.log(
    JSON.stringify({
      searches: result.searchQueries.length,
      availability: result.availability,
      details: result.detailCandidatesFetched,
      evaluations: result.evaluations.length,
      shortlisted: result.evaluations.filter(
        (evaluation) => evaluation.recommendedDisposition === "SHORTLIST",
      ).length,
      rejected: result.evaluations.filter(
        (evaluation) => evaluation.recommendedDisposition === "REJECT",
      ).length,
      humanReview: result.evaluations.filter(
        (evaluation) => evaluation.recommendedDisposition === "NEEDS_HUMAN_REVIEW",
      ).length,
      staged: result.stagedExternalSkills,
      sourceIssues: result.sourceIssues.length,
      approved: 0,
      reportPath: result.reportPath,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Curation failed.");
  process.exitCode = 1;
});
