import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFERRED_SKILLS,
  FACTORY_SELF_REVIEWER_IDS,
  EvidenceSliceSchema,
  R2G3EvidencePackSchema,
  R2G3ReviewExecutionRecordSchema,
  R2G3TestExecutionSchema,
  R2G3TraceabilityArtifactSchema,
  EvidenceManifestEntrySchema,
  SelfReviewFindingSchema,
  checksum,
  checksumR2G3CandidateFiles,
  checksumR2G3EvidencePack,
  createR2G3ReviewExecutionRecord,
  getSelfReviewReviewerPlans,
  isExcludedEvidencePath,
  isWithinEvidenceRoot,
  normalizeProviderFindings,
  validateEvidenceReference,
} from "../../scripts/factory-self-review";

const manifest = [
  EvidenceManifestEntrySchema.parse({
    relativePath: "src/example.ts",
    checksum: "a".repeat(64),
    byteLength: 100,
    lineCount: 10,
  }),
  EvidenceManifestEntrySchema.parse({
    relativePath: "src/example.test.ts",
    checksum: "b".repeat(64),
    byteLength: 100,
    lineCount: 20,
  }),
];

describe("factory self-review evidence controls", () => {
  it("1. keeps the repository root inside itself", () =>
    expect(isWithinEvidenceRoot("D:\\factory", "D:\\factory")).toBe(true));
  it("2. rejects a parent directory", () =>
    expect(
      isWithinEvidenceRoot("D:\\factory", "D:\\factory\\..\\outside"),
    ).toBe(false));
  it("3. rejects an absolute path outside the root", () =>
    expect(isWithinEvidenceRoot("D:\\factory", "C:\\outside")).toBe(false));
  it("4. excludes .env", () =>
    expect(isExcludedEvidencePath(".env")).toBe(true));
  it("5. excludes .env.local", () =>
    expect(isExcludedEvidencePath(".env.local")).toBe(true));
  it("6. excludes node_modules", () =>
    expect(isExcludedEvidencePath("node_modules/openai/index.js")).toBe(true));
  it("7. excludes .next", () =>
    expect(isExcludedEvidencePath(".next/types/index.ts")).toBe(true));
  it("8. excludes generated output", () =>
    expect(isExcludedEvidencePath(".factory-generated/src/app/page.tsx")).toBe(
      true,
    ));
  it("9. excludes QA temporary workspaces", () =>
    expect(isExcludedEvidencePath(".qa-foundation-01/workspace/file.ts")).toBe(
      true,
    ));
  it("10. excludes admin reports from semantic evidence", () =>
    expect(
      isExcludedEvidencePath("docs/admin/factory-self-review-2026-08-10.md"),
    ).toBe(true));
  it("11. accepts repository-relative line evidence", () =>
    expect(
      validateEvidenceReference("src/example.ts:2-4", manifest).valid,
    ).toBe(true));
  it("12. rejects a nonexistent evidence path", () =>
    expect(
      validateEvidenceReference("src/missing.ts:1-2", manifest).valid,
    ).toBe(false));
  it("13. rejects an invalid line range", () =>
    expect(
      validateEvidenceReference("src/example.ts:2-11", manifest).valid,
    ).toBe(false));
  it("14. rejects an unbounded evidence reference", () =>
    expect(validateEvidenceReference("src/example.ts", manifest).valid).toBe(
      false,
    ));
  it("15. rejects an excluded evidence reference", () =>
    expect(validateEvidenceReference(".env:1-2", manifest).valid).toBe(false));
  it("16. binds file identity to exact content checksum", () =>
    expect(checksum("before")).not.toBe(checksum("after")));
  it("17. keeps identical content checksums deterministic", () =>
    expect(checksum("same")).toBe(checksum("same")));
  it("18. represents exactly the five existing reviewers", () =>
    expect(getSelfReviewReviewerPlans().map((item) => item.reviewerId)).toEqual(
      [...FACTORY_SELF_REVIEWER_IDS],
    ));
  it("19. does not create a tenth reviewer", () =>
    expect(getSelfReviewReviewerPlans()).toHaveLength(5));
  it("20. uses reviewer agents from the active catalog", async () => {
    const { agentCatalog } = await import("@/agents/catalog");
    expect(
      getSelfReviewReviewerPlans().every((item) =>
        agentCatalog.some((agent) => agent.agentId === item.reviewerId),
      ),
    ).toBe(true);
  });
  it("21. preserves the active Architecture portfolio", () =>
    expect(getSelfReviewReviewerPlans()[0].assignedSkillIds).toEqual([
      "module-boundaries-fb20497b5c35",
      "review-maintainability-d9faf7cb9775",
      "architecture-tradeoff-review",
    ]));
  it("22. preserves the active Contract portfolio", () =>
    expect(getSelfReviewReviewerPlans()[1].assignedSkillIds).toEqual([
      "acceptance-criteria-80493e317476",
      "requirements-evidence-traceability",
    ]));
  it("23. preserves the active Code portfolio", () =>
    expect(getSelfReviewReviewerPlans()[2].assignedSkillIds).toEqual([
      "react-nextjs-integration-review",
    ]));
  it("24. preserves the active Security portfolio", () =>
    expect(getSelfReviewReviewerPlans()[3].assignedSkillIds).toEqual([
      "supabase-rls-1e36b217c969",
      "auth-storage-security-review",
    ]));
  it("25. preserves the active Test portfolio", () =>
    expect(getSelfReviewReviewerPlans()[4].assignedSkillIds).toEqual([
      "requirements-evidence-traceability",
      "behavioral-test-quality-review",
    ]));
  it("26. keeps deferred skills inactive", () =>
    expect(
      getSelfReviewReviewerPlans()
        .flatMap((item) => item.assignedSkillIds)
        .some((id) =>
          DEFERRED_SKILLS.some((deferred) => id.includes(deferred)),
        ),
    ).toBe(false));
  it("27. validates a finding with manifest-bound evidence", () =>
    expect(
      normalizeProviderFindings(
        "code-integration-reviewer",
        "scope",
        {
          findings: [
            {
              findingId: "f1",
              severity: "WARNING",
              category: "MODULE_INTEGRATION_MISMATCH",
              summary: "A bounded integration concern.",
              evidenceRefs: ["src/example.ts:1-2"],
              affectedArtifacts: ["src/example.ts:1-2"],
              recommendedAction: "Review the boundary.",
            },
          ],
        },
        manifest,
      ).validatedFindings,
    ).toHaveLength(1));
  it("28. separates a finding with missing evidence", () =>
    expect(
      normalizeProviderFindings(
        "code-integration-reviewer",
        "scope",
        {
          findings: [
            {
              findingId: "f1",
              severity: "ERROR",
              category: "INCOMPLETE_FLOW",
              summary: "Unsupported claim.",
              evidenceRefs: ["src/missing.ts:1-2"],
              affectedArtifacts: [],
              recommendedAction: "Review.",
            },
          ],
        },
        manifest,
      ).invalidEvidenceFindings,
    ).toHaveLength(1));
  it("29. does not silently include unsupported findings", () =>
    expect(
      normalizeProviderFindings(
        "security-reviewer",
        "scope",
        {
          findings: [
            {
              findingId: "f1",
              severity: "CRITICAL",
              category: "SECRET_EXPOSURE",
              summary: "No trace.",
              evidenceRefs: [],
              affectedArtifacts: [],
              recommendedAction: "Review.",
            },
          ],
        },
        manifest,
      ).validatedFindings,
    ).toHaveLength(0));
  it("30. classifies critical findings as Phase 6 blocking", () =>
    expect(
      normalizeProviderFindings(
        "security-reviewer",
        "scope",
        {
          findings: [
            {
              findingId: "f1",
              severity: "CRITICAL",
              category: "TRUST_BOUNDARY",
              summary: "Trust boundary defect.",
              evidenceRefs: ["src/example.ts:1-2"],
              affectedArtifacts: [],
              recommendedAction: "Correct the boundary.",
            },
          ],
        },
        manifest,
      ).validatedFindings[0].blockingClassification,
    ).toBe("BLOCKING_FOR_PHASE_6"));
  it("31. keeps severity enum enforcement in normalized output", () =>
    expect(
      normalizeProviderFindings(
        "security-reviewer",
        "scope",
        {
          findings: [
            {
              findingId: "f1",
              severity: "SEV-1",
              category: "TRUST_BOUNDARY",
              summary: "Invalid severity.",
              evidenceRefs: ["src/example.ts:1-2"],
              affectedArtifacts: [],
              recommendedAction: "Review.",
            },
          ],
        },
        manifest,
      ).invalidEvidenceFindings,
    ).toHaveLength(1));
  it("32. produces stable finding identities", () => {
    const raw = {
      findings: [
        {
          findingId: "f1",
          severity: "INFO",
          category: "SOURCE_OF_TRUTH",
          summary: "Stable.",
          evidenceRefs: ["src/example.ts:1-2"],
          affectedArtifacts: [],
          recommendedAction: "Review.",
        },
      ],
    };
    expect(
      normalizeProviderFindings("architecture-reviewer", "scope", raw, manifest)
        .validatedFindings[0].findingId,
    ).toBe(
      normalizeProviderFindings("architecture-reviewer", "scope", raw, manifest)
        .validatedFindings[0].findingId,
    );
  });
  it("33. keeps reviewer identity bound to normalized records", () =>
    expect(
      normalizeProviderFindings(
        "contract-auditor",
        "scope",
        {
          findings: [
            {
              findingId: "f1",
              severity: "INFO",
              category: "REFERENCE_NOT_FOUND",
              summary: "Bound.",
              evidenceRefs: ["src/example.ts:1-2"],
              affectedArtifacts: [],
              recommendedAction: "Review.",
            },
          ],
        },
        manifest,
      ).validatedFindings[0].reviewerId,
    ).toBe("contract-auditor"));
  it("34. keeps scope identity bound to normalized records", () =>
    expect(
      normalizeProviderFindings(
        "contract-auditor",
        "scope-a",
        {
          findings: [
            {
              findingId: "f1",
              severity: "INFO",
              category: "REFERENCE_NOT_FOUND",
              summary: "Bound.",
              evidenceRefs: ["src/example.ts:1-2"],
              affectedArtifacts: [],
              recommendedAction: "Review.",
            },
          ],
        },
        manifest,
      ).validatedFindings[0].scopeId,
    ).toBe("scope-a"));
  it("35. rejects evidence above the repository root by path syntax", () =>
    expect(validateEvidenceReference("../outside.ts:1-2", manifest).valid).toBe(
      false,
    ));
  it("36. rejects Windows drive paths in prompts", () =>
    expect(validateEvidenceReference("C:/outside.ts:1-2", manifest).valid).toBe(
      false,
    ));
  it("37. allows test evidence when it is manifest-bound", () =>
    expect(
      validateEvidenceReference("src/example.test.ts:1-20", manifest).valid,
    ).toBe(true));
  it("38. does not expose raw provider requests in the finding schema", () =>
    expect(
      SelfReviewFindingSchema.safeParse({
        findingId: "f",
        reviewerId: "r",
        scopeId: "s",
        severity: "INFO",
        category: "x",
        summary: "x",
        evidenceRefs: ["src/example.ts:1-2"],
        affectedArtifacts: [],
        recommendedAction: "x",
        blockingClassification: "INFORMATIONAL",
        owner: "tests",
        request: "secret",
      }).success,
    ).toBe(false));
  it("39. confirms production preparation is the selected skill path", async () => {
    const source = await readFile("scripts/factory-self-review.ts", "utf8");
    expect(source).toContain("prepareAgentSkillContext");
  });
  it("40. reuses the established standalone environment loader", async () => {
    const source = await readFile("scripts/factory-self-review.ts", "utf8");
    expect(source).toContain("loadFactoryCliEnv");
  });
  it("41. contains no manual SKILL.md prompt concatenation", async () => {
    const source = await readFile("scripts/factory-self-review.ts", "utf8");
    expect(source).not.toContain("skillMarkdown");
  });
  it("42. persists and reloads a complete R2-G3-O1 review identity trace", async () => {
    const candidatePaths = [
      "scripts/factory-self-review.ts",
      "src/operations/factory-self-review.test.ts",
      "src/orchestration/orchestrator/graph.ts",
      "src/orchestration/orchestrator/orchestrator.test.ts",
      "src/orchestration/orchestrator/tools.ts",
      "src/orchestration/tooling/authority.ts",
      "src/orchestration/tooling/registry.ts",
    ];
    const evidenceRanges: Record<string, [number, number]> = {
      "scripts/factory-self-review.ts": [578, 870],
      "src/operations/factory-self-review.test.ts": [348, 575],
      "src/orchestration/orchestrator/orchestrator.test.ts": [31, 34],
      "src/orchestration/orchestrator/graph.ts": [57, 68],
      "src/orchestration/orchestrator/tools.ts": [6, 22],
      "src/orchestration/tooling/authority.ts": [75, 116],
      "src/orchestration/tooling/registry.ts": [154, 180],
    };
    const sources = new Map<string, string>();
    const candidateFiles = [];
    for (const relativePath of candidatePaths) {
      const source = await readFile(relativePath, "utf8");
      sources.set(relativePath, source);
      candidateFiles.push(
        EvidenceManifestEntrySchema.parse({
          relativePath,
          checksum: checksum(source),
          byteLength: Buffer.byteLength(source, "utf8"),
          lineCount: source.split(/\r?\n/).length,
        }),
      );
    }
    const artifactPath = "src/orchestration/orchestrator/graph.ts";
    const testPath = "src/operations/factory-self-review.test.ts";
    const artifactSource = sources.get(artifactPath)!;
    const testSource = sources.get(testPath)!;
    const artifactChecksum = checksum(artifactSource);
    const testSourceChecksum = checksum(testSource);
    const testEvidenceEndLine = 575;
    const candidateChecksum = checksumR2G3CandidateFiles(candidateFiles);
    const testExecution = R2G3TestExecutionSchema.parse({
      testExecutionId: "44444444-4444-4444-8444-444444444444",
      command: "npm exec vitest run src/operations/factory-self-review.test.ts",
      testFile: testPath,
      testName: "factory self-review evidence controls",
      testSourceChecksum,
      status: "PASSED",
      passedCount: 42,
      totalCount: 42,
      startedAt: "2026-08-12T10:00:00.000Z",
      completedAt: "2026-08-12T10:00:01.000Z",
    });
    const slices = candidateFiles.map((entry) => {
      const [startLine, endLine] = evidenceRanges[entry.relativePath];
      const content = sources
        .get(entry.relativePath)!
        .split(/\r?\n/)
        .slice(startLine - 1, endLine)
        .join("\n");
      return EvidenceSliceSchema.parse({
        relativePath: entry.relativePath,
        startLine,
        endLine,
        checksum: entry.checksum,
        content,
      });
    });
    const evidencePackContent = {
      schemaVersion: 1 as const,
      documentType: "r2-g3-o1-evidence-pack" as const,
      evidencePackId: "r2-g3-o1-evidence-pack-2026-08-12",
      candidateId: "r2-g3-o1-candidate-2026-08-12",
      candidateChecksum,
      evidenceManifestChecksum: candidateChecksum,
      requirementId: "R2-G3-O1-REVIEW-IDENTITY-TRACEABILITY" as const,
      artifactId: "task-graph:validate-functional-flow",
      artifactPath,
      artifactChecksum,
      testId: "factory-self-review.test:identity-round-trip",
      testPath,
      testSourceChecksum,
      testExecutionId: testExecution.testExecutionId,
      references: [
        `${artifactPath}:57-68`,
        `${testPath}:348-${testEvidenceEndLine}`,
      ],
      artifactReferences: [`${artifactPath}:57-68`],
      testReferences: [`${testPath}:348-${testEvidenceEndLine}`],
      slices,
      evidenceValid: true as const,
      invalidReferenceCount: 0 as const,
      traceabilityComplete: true as const,
    };
    const evidencePack = R2G3EvidencePackSchema.parse({
      ...evidencePackContent,
      evidencePackChecksum: checksumR2G3EvidencePack(evidencePackContent),
    });
    const finding = SelfReviewFindingSchema.parse({
      findingId: "finding-r2g3-round-trip",
      reviewerId: "test-quality-reviewer",
      scopeId: "r2-g3-o1",
      severity: "INFO",
      category: "REQUIREMENT_NOT_VERIFIED",
      summary: "The persisted identity fields are recoverable.",
      evidenceRefs: [`${testPath}:348-${testEvidenceEndLine}`],
      affectedArtifacts: [`${artifactPath}:57-68`],
      recommendedAction: "Retain the traceability record.",
      blockingClassification: "INFORMATIONAL",
      owner: "tests",
    });
    const reviewExecutionInput = {
      reviewerId: "test-quality-reviewer",
      reviewerVersion: "test-quality-reviewer.v1",
      capability: "test-quality-review",
      policyVersion: "policy.test.v1",
      promptVersion: "prompt.test.v1",
      candidateId: evidencePack.candidateId,
      candidateChecksum,
      evidencePackId: evidencePack.evidencePackId,
      evidencePackChecksum: evidencePack.evidencePackChecksum,
      evidenceManifestChecksum: candidateChecksum,
      requirementId: "R2-G3-O1-REVIEW-IDENTITY-TRACEABILITY" as const,
      artifactId: evidencePack.artifactId,
      artifactChecksum,
      artifactReferences: [`${artifactPath}:57-68`],
      testId: evidencePack.testId,
      testReferences: [`${testPath}:348-${testEvidenceEndLine}`],
      testSourceChecksum,
      testExecution,
      obligationIds: ["R2-G3-O1-REVIEW-IDENTITY-TRACEABILITY"],
      verdict: "APPROVED" as const,
      findings: [finding],
      selectedSkillIds: ["requirements-evidence-traceability"],
      selectedSkillChecksums: [checksum("requirements-evidence-traceability")],
      createdAt: "2026-08-12T10:00:02.000Z",
    };
    const reviewExecution = createR2G3ReviewExecutionRecord(reviewExecutionInput);
    const secondReviewExecution = createR2G3ReviewExecutionRecord({
      ...reviewExecutionInput,
      createdAt: "2026-08-12T10:00:02.001Z",
    });
    expect(secondReviewExecution.reviewExecutionId).not.toBe(
      reviewExecution.reviewExecutionId,
    );
    expect(R2G3ReviewExecutionRecordSchema.parse(reviewExecution)).toEqual(
      reviewExecution,
    );
    const artifact = R2G3TraceabilityArtifactSchema.parse({
      schemaVersion: 1,
      documentType: "r2-g3-o1-review-identity-traceability",
      planId: "r2-g3-o1-review-identity-traceability-plan-test",
      baselineHead: "d4776ace417eb149cc363c5546b0919fea55a90d",
      planCommit: "7f9f543e0f12156ceb551fc68fb5f0bba28c26d8",
      candidateId: evidencePack.candidateId,
      candidateChecksum,
      candidateFiles,
      evidencePack,
      testExecution,
      reviewExecutions: [reviewExecution, secondReviewExecution],
      evidenceValid: true,
      invalidReferenceCount: 0,
      traceabilityComplete: true,
      createdAt: "2026-08-12T10:00:03.000Z",
      updatedAt: "2026-08-12T10:00:03.000Z",
    });
    const directory = await mkdtemp(join(tmpdir(), "r2g3-o1-round-trip-"));
    try {
      const traceabilityPath = join(directory, "traceability.json");
      await writeFile(traceabilityPath, JSON.stringify(artifact, null, 2), "utf8");
      const reloaded = R2G3TraceabilityArtifactSchema.parse(
        JSON.parse(await readFile(traceabilityPath, "utf8")),
      );
      expect(reloaded.reviewExecutions[0].reviewExecutionId).toBe(
        reviewExecution.reviewExecutionId,
      );
      expect(reloaded.reviewExecutions[0].candidateChecksum).toBe(
        candidateChecksum,
      );
      expect(reloaded.reviewExecutions[0].evidencePackChecksum).toBe(
        evidencePack.evidencePackChecksum,
      );
      expect(reloaded.reviewExecutions[0].testExecution.testExecutionId).toBe(
        testExecution.testExecutionId,
      );
      expect(reloaded.testExecution.testExecutionId).toBe(
        reloaded.evidencePack.testExecutionId,
      );
      expect(reloaded.evidencePack.artifactReferences).toEqual([
        `${artifactPath}:57-68`,
      ]);
      expect(reloaded.evidencePack.testReferences).toEqual([
        `${testPath}:348-${testEvidenceEndLine}`,
      ]);
      expect(reloaded.evidencePack.artifactChecksum).toBe(artifactChecksum);
      expect(reloaded.evidencePack.testSourceChecksum).toBe(testSourceChecksum);
      expect(reloaded.reviewExecutions[0].findingIds).toEqual([
        finding.findingId,
      ]);
      expect(reloaded.traceabilityComplete).toBe(true);
      expect(reloaded.reviewExecutions[0].reviewExecutionId).not.toBe(
        reloaded.reviewExecutions[0].reviewerId,
      );
      expect(reloaded.reviewExecutions[1].reviewExecutionId).not.toBe(
        reloaded.reviewExecutions[0].reviewExecutionId,
      );
      expect(reloaded.reviewExecutions[1].evidencePackChecksum).toBe(
        evidencePack.evidencePackChecksum,
      );
      expect(() =>
        R2G3TraceabilityArtifactSchema.parse({
          ...reloaded,
          candidateChecksum: "f".repeat(64),
        }),
      ).toThrow();
      const reboundPackContent = {
        ...reloaded.evidencePack,
        testExecutionId: "55555555-5555-4555-8555-555555555555",
      };
      const {
        evidencePackChecksum: reboundStoredChecksum,
        ...reboundPackWithoutChecksum
      } =
        reboundPackContent;
      expect(reboundStoredChecksum).toBe(reloaded.evidencePack.evidencePackChecksum);
      expect(() =>
        R2G3TraceabilityArtifactSchema.parse({
          ...reloaded,
          evidencePack: {
            ...reboundPackContent,
            evidencePackChecksum: checksumR2G3EvidencePack(
              reboundPackWithoutChecksum,
            ),
          },
        }),
      ).toThrow();
      const reboundReview = {
        ...reloaded.reviewExecutions[0],
        testExecution: {
          ...reloaded.reviewExecutions[0].testExecution,
          testExecutionId: "66666666-6666-4666-8666-666666666666",
        },
      };
      expect(() =>
        R2G3TraceabilityArtifactSchema.parse({
          ...reloaded,
          reviewExecutions: [reboundReview, reloaded.reviewExecutions[1]],
        }),
      ).toThrow();
      const reboundReferences = {
        ...reloaded.reviewExecutions[0],
        artifactReferences: reloaded.evidencePack.testReferences,
      };
      expect(() =>
        R2G3TraceabilityArtifactSchema.parse({
          ...reloaded,
          reviewExecutions: [reboundReferences, reloaded.reviewExecutions[1]],
        }),
      ).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
