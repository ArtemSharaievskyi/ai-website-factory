import { randomUUID } from "node:crypto";
import { z } from "zod";
import { checksumPersistedDocument } from "@/persistence/database/serialization";
import {
  DocumentRepository,
  ProjectRepository,
} from "@/persistence/database/repositories";
import type { PersistenceDatabase } from "@/persistence/database/types";
import {
  TestQualityReviewHistorySchema,
  TestQualityReviewProviderOutputSchema,
  TestQualityReviewRecordSchema,
  TestQualityReviewResultSchema,
  type TestQualityReviewResult,
} from "@/domain/review/schema";
import { testQualityReviewerAgentDefinition } from "@/agents/catalog";
import { TestQualityReviewError } from "./errors";
import {
  TEST_QUALITY_REVIEW_POLICY_VERSION,
  TestQualityReviewInputSchema,
  type TestQualityReviewInput,
} from "./contracts";
import {
  deterministicTestQualityReview,
  DeterministicTestQualityReviewProvider,
} from "./deterministic";
import type { TestQualityReviewProvider } from "./ports";
import type { AgentSkillSelection } from "@/skills/runtime/resolver";
const now = () => new Date().toISOString();
export class TestQualityReviewService {
  private readonly documents: DocumentRepository;
  private readonly projects: ProjectRepository;
  private readonly provider: TestQualityReviewProvider;
  private readonly idempotency = new Map<
    string,
    { inputHash: string; result: TestQualityReviewResult }
  >();
  private readonly correctionCycles = new Map<string, number>();
  private readonly resolveSkills?: (input: TestQualityReviewInput) => Promise<AgentSkillSelection>;
  constructor(
    private readonly database: PersistenceDatabase,
    dependencies: { provider?: TestQualityReviewProvider; resolveSkills?: (input: TestQualityReviewInput) => Promise<AgentSkillSelection> } = {},
  ) {
    this.documents = new DocumentRepository(database);
    this.projects = new ProjectRepository(database);
    this.provider =
      dependencies.provider ?? new DeterministicTestQualityReviewProvider();
    this.resolveSkills = dependencies.resolveSkills;
  }
  getAgentDefinition() {
    return testQualityReviewerAgentDefinition;
  }
  getCorrectionCycle(projectId: string, projectVersion: number) {
    return this.correctionCycles.get(`${projectId}:${projectVersion}`) ?? 0;
  }
  recordCorrectionCycle(projectId: string, projectVersion: number) {
    const key = `${projectId}:${projectVersion}`;
    const count = this.getCorrectionCycle(projectId, projectVersion);
    if (count >= 2)
      throw new TestQualityReviewError(
        "TEST_QUALITY_CORRECTION_EXHAUSTED",
        "The maximum Test / Quality correction cycles have been reached.",
      );
    this.correctionCycles.set(key, count + 1);
  }
  async review(
    rawInput: TestQualityReviewInput,
    signal?: AbortSignal,
  ): Promise<TestQualityReviewResult> {
    let input: TestQualityReviewInput;
    try {
      input = TestQualityReviewInputSchema.parse(rawInput);
    } catch (error) {
      throw new TestQualityReviewError(
        "TEST_QUALITY_INPUT_INVALID",
        "Test Quality Review input failed strict validation.",
        error,
      );
    }
    const project = await this.projects.getWithVersion(input.projectId);
    if (!project || project.project.currentVersion !== input.projectVersion)
      throw new TestQualityReviewError(
        "TEST_QUALITY_PREREQUISITE_FAILED",
        "Test Quality Review requires the current project version.",
      );
    const required =
      input.qualityEvidence.qualityGates.every(
        (gate) => gate.status === "PASSED",
      ) &&
      input.qualityEvidence.unitTests.status === "PASSED" &&
      input.qualityEvidence.functionalScenarios.every(
        (scenario) =>
          scenario.status === "PASSED" || scenario.status === "NOT_REQUIRED",
      );
    if (!required)
      throw new TestQualityReviewError(
        "TEST_QUALITY_PREREQUISITE_FAILED",
        "Required deterministic quality evidence is not current and passing.",
      );
    const qualityEvidenceChecksum = checksumPersistedDocument(
      input.qualityEvidence,
    );
    const skillSelection = this.resolveSkills
      ? await this.resolveSkills(input)
      : { contexts: [], identityChecksum: "none", selectedSkillIds: [], selectedSkillChecksums: [] };
    const inputHash = checksumPersistedDocument({
      projectId: input.projectId,
      projectVersion: input.projectVersion,
      briefChecksum: input.briefChecksum,
      planningChecksum: input.planningChecksum,
      architectureReviewChecksum: input.architectureReviewChecksum,
      designChecksum: input.designChecksum,
      contractAuditChecksum: input.contractAuditChecksum,
      codeIntegrationReviewChecksum: input.codeIntegrationReviewChecksum,
      securityReviewChecksum: input.securityReviewChecksum,
      taskGraphChecksum: input.taskGraphChecksum,
      sourceChecksum: input.sourceChecksum,
      testSourceChecksum: input.testSourceChecksum,
      qualityEvidenceChecksum,
      policyVersion: TEST_QUALITY_REVIEW_POLICY_VERSION,
      promptVersion: this.provider.promptVersion,
      skillContextChecksum: skillSelection.identityChecksum,
    });
    const prior = this.idempotency.get(input.idempotencyKey);
    if (prior) {
      if (prior.inputHash !== inputHash)
        throw new TestQualityReviewError(
          "TEST_QUALITY_IDEMPOTENCY_CONFLICT",
          "Idempotency key was reused with different quality inputs.",
        );
      return prior.result;
    }
    try {
      const deterministic = deterministicTestQualityReview(input);
      const providerResult =
        deterministic.verdict === "APPROVED"
          ? await this.provider.review(input, signal, skillSelection.contexts, skillSelection.identityChecksum)
          : deterministic;
      const result = this.normalize(providerResult, input);
      const record = TestQualityReviewRecordSchema.parse({
        schemaVersion: 1,
        documentType: "test-quality-review",
        projectId: input.projectId,
        projectVersion: input.projectVersion,
        createdAt: now(),
        updatedAt: now(),
        reviewId: randomUUID(),
        reviewerAgentId: testQualityReviewerAgentDefinition.agentId,
        reviewerVersion: testQualityReviewerAgentDefinition.version,
        capability: "review.test-quality",
        policyVersion: TEST_QUALITY_REVIEW_POLICY_VERSION,
        promptVersion: this.provider.promptVersion,
        briefChecksum: input.briefChecksum,
        planningChecksum: input.planningChecksum,
        architectureReviewChecksum: input.architectureReviewChecksum,
        designChecksum: input.designChecksum,
        contractAuditChecksum: input.contractAuditChecksum,
        taskGraphChecksum: input.taskGraphChecksum,
        codeIntegrationReviewChecksum: input.codeIntegrationReviewChecksum,
        securityReviewChecksum: input.securityReviewChecksum,
        sourceChecksum: input.sourceChecksum,
        testSourceChecksum: input.testSourceChecksum,
        qualityEvidenceChecksum,
        resultChecksum: checksumPersistedDocument(result),
        result,
      });
      const priorRecord = await this.documents.get(
        input.projectId,
        input.projectVersion,
        "test-quality-review",
      );
      const priorHistory = await this.documents.get(
        input.projectId,
        input.projectVersion,
        "test-quality-review-history",
      );
      const records = [
        ...(priorHistory?.documentType === "test-quality-review-history"
          ? priorHistory.records
          : []),
        ...(priorRecord?.documentType === "test-quality-review"
          ? [TestQualityReviewRecordSchema.parse(priorRecord)]
          : []),
        record,
      ];
      await this.documents.save(
        TestQualityReviewHistorySchema.parse({
          schemaVersion: 1,
          documentType: "test-quality-review-history",
          projectId: input.projectId,
          projectVersion: input.projectVersion,
          createdAt: records[0]!.createdAt,
          updatedAt: now(),
          records,
        }),
        `test-quality-review-history:${input.idempotencyKey}`,
      );
      await this.documents.save(
        record,
        `test-quality-review:${input.idempotencyKey}`,
      );
      this.idempotency.set(input.idempotencyKey, { inputHash, result });
      return result;
    } catch (error) {
      if (error instanceof TestQualityReviewError) throw error;
      if (error instanceof z.ZodError)
        throw new TestQualityReviewError(
          "TEST_QUALITY_OUTPUT_INVALID",
          "Test Quality Review output failed strict validation.",
          error,
        );
      throw new TestQualityReviewError(
        "TEST_QUALITY_PROVIDER_FAILED",
        "Test Quality Review provider failed safely.",
        error,
      );
    }
  }
  async getCurrentReview(
    projectId: string,
    projectVersion: number,
    sourceChecksum: string,
    testSourceChecksum: string,
    qualityEvidenceChecksum?: string,
  ) {
    const document = await this.documents.get(
      projectId,
      projectVersion,
      "test-quality-review",
    );
    if (!document || document.documentType !== "test-quality-review")
      return null;
    const record = TestQualityReviewRecordSchema.parse(document);
    return record.sourceChecksum === sourceChecksum &&
      record.testSourceChecksum === testSourceChecksum &&
      (!qualityEvidenceChecksum ||
        record.qualityEvidenceChecksum === qualityEvidenceChecksum) &&
      record.result.verdict === "APPROVED"
      ? record
      : null;
  }
  private normalize(
    raw: TestQualityReviewResult,
    input: TestQualityReviewInput,
  ) {
    const parsed = TestQualityReviewProviderOutputSchema.parse(raw);
    const evidence = new Set([
      "brief",
      "planning-package",
      "architecture-review",
      "selected-design",
      "contract-audit",
      "code-integration-review",
      "security-review",
      "task-graph",
      "source",
      "quality-evidence",
      ...input.qualityEvidence.traceEdges,
      ...input.qualityEvidence.unitTests.evidenceRefs,
      ...input.qualityEvidence.functionalScenarios.flatMap(
        (s) => s.evidenceRefs,
      ),
      ...input.taskGraph.tasks.map((t) => t.id),
      ...input.testSourceSlices.map((s) => `source:${s.relativePath}`),
    ]);
    for (const item of parsed.findings)
      for (const ref of [...item.evidenceRefs, ...item.affectedArtifacts])
        if (!evidence.has(ref))
          throw new TestQualityReviewError(
            "TEST_QUALITY_OUTPUT_INVALID",
            `Finding references unavailable evidence: ${ref}.`,
          );
    for (const item of parsed.findings)
      if (
        (item.severity === "ERROR" || item.severity === "CRITICAL") &&
        item.ownerTaskId &&
        !input.taskGraph.tasks.some((task) => task.id === item.ownerTaskId)
      )
        throw new TestQualityReviewError(
          "TEST_QUALITY_OUTPUT_INVALID",
          "Finding owner task is not current TaskGraph ownership.",
        );
    const result = TestQualityReviewResultSchema.parse({
      ...parsed,
      findings: parsed.findings,
    });
    return result.findings.some(
      (item) => item.severity === "ERROR" || item.severity === "CRITICAL",
    ) && result.verdict === "APPROVED"
      ? TestQualityReviewResultSchema.parse({
          ...result,
          verdict: "CHANGES_REQUIRED",
        })
      : result;
  }
}
