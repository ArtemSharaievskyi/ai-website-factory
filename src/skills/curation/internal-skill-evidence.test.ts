import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseSkillMarkdown } from "@/skills/registry/parser";
import { SkillRegistry } from "@/skills/registry/registry";
import { SkillSourceTypeSchema } from "@/skills/registry/contracts";
import {
  canonicalInternalSkillChecksum,
  InternalSkillEvidenceArtifactSchema,
} from "./internal-skill-evidence";

const root = process.cwd();
const planPath = path.join(
  root,
  "docs",
  "admin",
  "skill-curation",
  "agent-skill-portfolio-plan-2026-08-09.json",
);
const artifactPath = path.join(
  root,
  "docs",
  "admin",
  "skill-curation",
  "internal-skill-evidence-2026-08-09.json",
);
const internalRoot = path.join(root, "skills", "internal");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((temporaryRoot) =>
      rm(temporaryRoot, { recursive: true, force: true }),
    ),
  );
});

async function portfolio() {
  const plan = JSON.parse(await readFile(planPath, "utf8")) as {
    proposedInternalSkills: Array<Record<string, unknown>>;
  };
  const artifact = InternalSkillEvidenceArtifactSchema.parse(
    JSON.parse(await readFile(artifactPath, "utf8")),
  );
  return { specs: plan.proposedInternalSkills, artifact };
}

describe("Phase 4D3 internal skill portfolio", () => {
  it("contains exactly the 13 planned first-party skill files", async () => {
    const { specs, artifact } = await portfolio();
    const expectedIds = specs.map((spec) => String(spec.skillId));
    const entries = await readdir(internalRoot, { withFileTypes: true });
    const actualIds = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(expectedIds).toHaveLength(13);
    expect(new Set(expectedIds).size).toBe(13);
    expect(actualIds).toEqual([...expectedIds].sort());
    expect(artifact.candidates.map((candidate) => candidate.skillId).sort()).toEqual(
      [...expectedIds].sort(),
    );
    for (const skillId of expectedIds)
      await expect(readFile(path.join(internalRoot, skillId, "SKILL.md"), "utf8"))
        .resolves.toBeTruthy();
  });

  it("parses every procedure and binds its authored checksum to normalized content", async () => {
    const { artifact } = await portfolio();
    for (const candidate of artifact.candidates) {
      const content = (await readFile(path.join(root, candidate.contentPath), "utf8"))
        .replace(/\r\n?/g, "\n");
      const parsed = parseSkillMarkdown(content);
      expect(parsed.unresolved).toEqual([]);
      expect(parsed.purpose).toBeTruthy();
      expect(parsed.steps?.length).toBeGreaterThanOrEqual(3);
      expect(candidate.version).toBe("1.0.0");
      expect(candidate.actualBytes).toBe(Buffer.byteLength(content, "utf8"));
      expect(candidate.checksum).toBe(
        canonicalInternalSkillChecksum(candidate.skillId, candidate.version, content),
      );
      expect(
        canonicalInternalSkillChecksum(candidate.skillId, candidate.version, content),
      ).toBe(canonicalInternalSkillChecksum(candidate.skillId, candidate.version, content));
      expect(candidate.checksum).not.toContain("2026-08-09");
    }
  });

  it("preserves exact Phase 4D1 targets, capabilities, and the shared traceability artifact", async () => {
    const { specs, artifact } = await portfolio();
    const candidates = new Map(artifact.candidates.map((candidate) => [candidate.skillId, candidate]));
    for (const spec of specs) {
      const skillId = String(spec.skillId);
      const candidate = candidates.get(skillId);
      expect(candidate).toBeDefined();
      expect(candidate?.targets).toEqual(spec.targetAgents);
      expect(candidate?.capabilities).toEqual(spec.targetCapabilities);
      expect(candidate?.coverageKeys).toEqual(spec.coverageKeys);
      expect(candidate?.targetContextRange).toBe(spec.targetContextSize);
    }
    expect(candidates.get("requirements-evidence-traceability")?.targets).toEqual([
      "contract-auditor",
      "test-quality-reviewer",
    ]);
    expect(
      artifact.candidates.filter(
        (candidate) => candidate.skillId === "requirements-evidence-traceability",
      ),
    ).toHaveLength(1);
  });

  it("records internal provenance, security boundaries, overlap decisions, and lifecycle counts", async () => {
    const { artifact } = await portfolio();
    expect(SkillSourceTypeSchema.parse("internal")).toBe("internal");
    expect(artifact.authoredInternalSkillCount).toBe(13);
    expect(artifact.approvedInternalSkillCount).toBe(0);
    expect(artifact.assignedInternalSkillCount).toBe(0);
    expect(artifact.approvedExternalSkillCount).toBe(3);
    expect(artifact.assignedExternalSkillCount).toBe(3);
    expect(artifact.approvalCalled).toBe(false);
    expect(artifact.assignmentsChanged).toBe(false);
    expect(artifact.semanticReviewUsed).toBe(false);
    expect(artifact.networkCalls).toBe(0);
    expect(artifact.specImplementationNote).toContain("0.1.0");
    expect(artifact.specImplementationNote).toContain("1.0.0");
    for (const candidate of artifact.candidates) {
      expect(candidate.sourceType).toBe("internal");
      expect(candidate.provenance).toBe("ai-website-factory-project-owned");
      expect(candidate.stagedStatus).toBe("under-review");
      expect(candidate.approvalReadiness).toBe("APPROVAL_ELIGIBLE");
      expect(candidate.blockers).toEqual([]);
      expect(candidate.licenseStrategy).toContain("internal-project-owned");
      expect(candidate.contentPath).not.toContain("external");
      const content = await readFile(path.join(root, candidate.contentPath), "utf8");
      expect(content).toMatch(/source-type: internal/);
      expect(content).toMatch(/provenance: ai-website-factory-project-owned/);
      expect(content).not.toMatch(/https?:\/\/|skills\.sh|github\.com/i);
      expect(content).toMatch(/## Non-goals and authority/);
    }
    expect(artifact.overlapAudit.length).toBeGreaterThanOrEqual(7);
    expect(artifact.overlapAudit.every((entry) => entry.status === "JUSTIFIED")).toBe(true);
    expect(artifact.conflictAudit).toHaveLength(13);
    expect(artifact.conflictAudit.every((entry) => entry.status === "PASS")).toBe(true);
  });

  it("keeps role boundaries explicit for implementation and reviewer procedures", async () => {
    const boundaries: Record<string, RegExp[]> = {
      "project-data-model-planning": [/does not write migrations/i, /does not[\s\S]*RLS implementation/i],
      "technical-risk-planning": [/does not[\s\S]*create TaskGraph tasks/i],
      "responsive-form-ux-design": [/does not write React\/CSS/i],
      "nextjs-server-client-implementation": [/task-scoped/i],
      "supabase-application-integration": [/does not[\s\S]*administer\s+Supabase/i, /does not[\s\S]*approval authority/i],
      "maintainable-performance-implementation": [/does not replace Architecture or Code Review/i],
      "architecture-tradeoff-review": [/read-only/i, /does not[\s\S]*write\s+code/i],
      "react-nextjs-integration-review": [/does not write code/i, /read-only ReviewResult/i],
      "auth-storage-security-review": [/does not pentest/i, /read-only/i],
      "behavioral-test-quality-review": [/does not write or run tests/i, /read-only ReviewResult/i],
    };
    for (const [skillId, patterns] of Object.entries(boundaries)) {
      const content = await readFile(path.join(internalRoot, skillId, "SKILL.md"), "utf8");
      for (const pattern of patterns) expect(content).toMatch(pattern);
    }
  });

  it("rejects a duplicate stable internal skill ID in the registry", async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "internal-skill-registry-"));
    const source = path.join(temporaryRoot, "source");
    temporaryRoots.push(temporaryRoot);
    await import("node:fs/promises").then(({ mkdir }) => mkdir(source, { recursive: true }));
    await writeFile(
      path.join(source, "SKILL.md"),
      "# Internal Fixture\nA first-party fixture.\n\n## Purpose\n- Test stable IDs.\n\n## Steps\n- Stage content.\n- Check the ID.\n- Keep it under review.\n",
      "utf8",
    );
    const registry = new SkillRegistry(path.join(temporaryRoot, "registry"));
    await registry.stageLocalImport(source, {
      sourceType: "internal",
      skillId: "internal-fixture",
      version: "1.0.0",
      provenance: "ai-website-factory-project-owned",
    });
    await expect(
      registry.stageLocalImport(source, {
        sourceType: "internal",
        skillId: "internal-external-provenance",
        sourceRepository: "https://example.test/repository",
      }),
    ).rejects.toMatchObject({ code: "SKILL_SOURCE_INVALID" });
    await expect(
      registry.stageLocalImport(source, {
        sourceType: "internal",
        skillId: "internal-fixture",
        version: "1.0.0",
        provenance: "ai-website-factory-project-owned",
      }),
    ).rejects.toMatchObject({ code: "SKILL_IDEMPOTENCY_CONFLICT" });
  });
});
