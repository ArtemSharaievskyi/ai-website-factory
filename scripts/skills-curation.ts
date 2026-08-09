import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadFactoryCliEnv } from "./cli-env";
import { runCurationSession } from "@/skills/curation/session";
import { SkillCurationEvaluationStore } from "@/skills/curation/store";
import { SkillRegistry } from "@/skills/registry/registry";
import { createPortfolioSnapshot } from "@/skills/curation/portfolio";

const root = process.cwd();
const reportPath = path.join(
  root,
  "docs",
  "admin",
  "agent-skill-portfolio-discovery-2026-08-09.md",
);
const snapshotPath = path.join(
  root,
  "docs",
  "admin",
  "skill-curation",
  "agent-skill-portfolio-discovery-2026-08-09.json",
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
  await mkdir(path.dirname(snapshotPath), { recursive: true });
  await writeFile(snapshotPath, `${JSON.stringify(createPortfolioSnapshot(result.evaluations, new Date().toISOString()), null, 2)}\n`, { flag: "w", mode: 0o600 });
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
      reusedEvaluations: result.reusedEvaluations,
      sourceIssues: result.sourceIssues.length,
      approved: 0,
      reportPath: result.reportPath,
      snapshotPath,
    }),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Curation failed.");
  process.exitCode = 1;
});
