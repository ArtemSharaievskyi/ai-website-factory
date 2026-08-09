import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type SkillsShSourceAdapter as SkillsShSourceAdapterType,
} from "@/integrations/skills-sh/adapter";
import { SkillsShError } from "@/integrations/skills-sh/errors";
import { runCurationSession } from "./session";
import { SkillCurationEvaluationStore } from "./store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("curation session source availability", () => {
  it("keeps the API available when one candidate is rejected by a safety limit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "curation-session-"));
    roots.push(root);
    const adapter = {
      searchSkills: async () => [
        {
          id: "owner/repository/oversized",
          slug: "oversized",
          name: "Oversized",
          source: "owner/repository",
          installs: 1,
          sourceType: "github" as const,
          installUrl: null,
          url: "https://skills.sh/owner/repository/oversized",
          sourceId: "skills-sh" as const,
          canonicalSourceRef: "https://skills.sh/owner/repository/oversized",
        },
      ],
      fetchSkillCandidate: async () => {
        throw new SkillsShError(
          "SKILLS_SH_RESPONSE_TOO_LARGE",
          "The skills.sh response is too large.",
        );
      },
    } as unknown as SkillsShSourceAdapterType;
    const result = await runCurationSession({
      adapter,
      evaluationStore: new SkillCurationEvaluationStore(
        path.join(root, "evaluations"),
      ),
      reportPath: path.join(root, "report.md"),
    });
    expect(result.availability).toBe("AVAILABLE");
    expect(result.searchQueries).toHaveLength(5);
    expect(result.sourceIssues[0]).toContain("SKILLS_SH_RESPONSE_TOO_LARGE");
    expect(result.evaluations).toHaveLength(0);
  });
});
