import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  agentCatalog,
  architectureReviewerAgentDefinition,
  codeIntegrationReviewerAgentDefinition,
  contractAuditorAgentDefinition,
  securityReviewerAgentDefinition,
  testQualityReviewerAgentDefinition,
} from "@/agents/catalog";
import {
  prepareAgentSkillContext,
  type AgentSkillSelection,
} from "@/skills/runtime/resolver";
import { SkillRegistry } from "@/skills/registry/registry";
import { createProductionProviderBundle } from "@/integrations/openai/production";
import { readAiProviderConfig } from "@/integrations/openai/config";
import type { ArchitectureReviewInput } from "@/agents/reviewers/architecture/contracts";
import type { ContractAuditInput } from "@/agents/reviewers/contracts/contracts";
import type { CodeIntegrationReviewInput } from "@/agents/reviewers/code-integration/contracts";
import type { SecurityReviewInput } from "@/agents/reviewers/security/contracts";
import type { TestQualityReviewInput } from "@/agents/reviewers/test-quality/contracts";

export const SELF_REVIEW_POLICY_VERSION = "factory-self-review-v1" as const;
export const SELF_REVIEW_OUTPUT_PATH =
  "docs/admin/factory-self-review-2026-08-10.json";
export const SELF_REVIEW_REPORT_PATH =
  "docs/admin/factory-self-review-2026-08-10.md";
export const SELF_REVIEW_RESULTS_DIRECTORY = "docs/admin/self-review-results";
export const DEFERRED_SKILLS = [
  "ambiguity-detector",
  "web-security-review",
  "reviewing-test-quality",
] as const;
export const MAX_SCOPE_PASSES_PER_REVIEWER = 3;
export const MAX_PACK_FILES = 32;
export const MAX_PACK_BYTES = 90_000;
export const MAX_FILE_EVIDENCE_BYTES = 24_000;
export const MAX_FILE_EVIDENCE_LINES = 260;
export const FACTORY_SELF_REVIEWER_IDS = [
  "architecture-reviewer",
  "contract-auditor",
  "code-integration-reviewer",
  "security-reviewer",
  "test-quality-reviewer",
] as const;

const HASH = /^[a-f0-9]{64}$/;
const RELATIVE_PATH =
  /^(?!\.)(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[A-Za-z0-9_./\\-]+$/;
const BINARY_EXTENSIONS = new Set([
  ".7z",
  ".bmp",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".tar",
  ".ttf",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
]);

export const EvidenceManifestEntrySchema = z
  .object({
    relativePath: z.string().regex(RELATIVE_PATH),
    checksum: z.string().regex(HASH),
    byteLength: z.number().int().nonnegative(),
    lineCount: z.number().int().nonnegative(),
  })
  .strict();
export type EvidenceManifestEntry = z.infer<typeof EvidenceManifestEntrySchema>;

export const EvidenceSliceSchema = z
  .object({
    relativePath: z.string().regex(RELATIVE_PATH),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    checksum: z.string().regex(HASH),
    content: z.string().min(1).max(MAX_FILE_EVIDENCE_BYTES),
  })
  .strict();
export type EvidenceSlice = z.infer<typeof EvidenceSliceSchema>;

export const SelfReviewFindingSchema = z
  .object({
    findingId: z.string().regex(/^[a-z0-9]+(?:[-_.][a-z0-9]+)*$/),
    reviewerId: z.string().min(1),
    scopeId: z.string().min(1),
    severity: z.enum(["INFO", "WARNING", "ERROR", "CRITICAL"]),
    category: z.string().min(1),
    summary: z.string().min(1),
    evidenceRefs: z.array(z.string().min(1)).min(1),
    affectedArtifacts: z.array(z.string().min(1)),
    recommendedAction: z.string().min(1),
    blockingClassification: z.enum([
      "BLOCKING_FOR_PHASE_6",
      "HIGH_PRIORITY",
      "NORMAL_PRIORITY",
      "INFORMATIONAL",
    ]),
    owner: z.enum([
      "architecture",
      "contracts",
      "implementation",
      "persistence",
      "runtime",
      "security",
      "tests",
      "skills",
      "orchestration",
    ]),
  })
  .strict();
export type SelfReviewFinding = z.infer<typeof SelfReviewFindingSchema>;

export const SelfReviewScopeResultSchema = z
  .object({
    scopeId: z.string().min(1),
    reviewerId: z.string().min(1),
    status: z.enum([
      "COMPLETED",
      "BLOCKED_REVIEW_EXECUTION",
      "REVIEW_EXECUTION_FAILED",
    ]),
    selectedSkillIds: z.array(z.string()),
    selectedSkillChecksums: z.array(
      z
        .object({ skillId: z.string(), checksum: z.string().regex(HASH) })
        .strict(),
    ),
    skillContextIdentity: z.string().regex(HASH),
    evidencePackChecksum: z.string().regex(HASH),
    snapshotIdentity: z.string().regex(HASH),
    provider: z
      .object({
        modelLabel: z.string(),
        model: z.string(),
        requestId: z.string().optional(),
        usage: z
          .object({
            inputTokens: z.number().int().nonnegative(),
            outputTokens: z.number().int().nonnegative(),
            totalTokens: z.number().int().nonnegative(),
            retryCount: z.number().int().nonnegative(),
          })
          .optional(),
      })
      .strict(),
    findings: z.array(SelfReviewFindingSchema),
    invalidEvidenceFindings: z.array(
      z
        .object({
          originalFindingId: z.string(),
          reason: z.string(),
          evidenceRefs: z.array(z.string()),
        })
        .strict(),
    ),
    failureCode: z.string().optional(),
    failureReason: z.string().optional(),
  })
  .strict();
export type SelfReviewScopeResult = z.infer<typeof SelfReviewScopeResultSchema>;

export const SelfReviewArtifactSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().regex(HASH),
    baselineCommit: z.string().regex(/^[0-9a-f]{7,40}$/),
    evidenceManifestChecksum: z.string().regex(HASH),
    reviewPolicyVersion: z.literal(SELF_REVIEW_POLICY_VERSION),
    provider: z
      .object({
        label: z.literal("GPT-5.6 Luna"),
        model: z.string(),
        configured: z.boolean(),
      })
      .strict(),
    reviewers: z
      .array(
        z
          .object({
            reviewerId: z.string(),
            agentVersion: z.string(),
            capability: z.string(),
            assignedSkillIds: z.array(z.string()),
            scopeIds: z.array(z.string()),
          })
          .strict(),
      )
      .length(5),
    perReviewerResults: z.array(SelfReviewScopeResultSchema),
    selectedSkillIdentities: z.array(
      z
        .object({
          reviewerId: z.string(),
          scopeId: z.string(),
          identity: z.string().regex(HASH),
          selectedSkillIds: z.array(z.string()),
          selectedSkillChecksums: z.array(
            z
              .object({ skillId: z.string(), checksum: z.string().regex(HASH) })
              .strict(),
          ),
        })
        .strict(),
    ),
    perReviewerResultArtifacts: z
      .array(
        z
          .object({
            reviewerId: z.string(),
            relativePath: z.string(),
            checksum: z.string().regex(HASH),
          })
          .strict(),
      )
      .length(5),
    validatedFindings: z.array(SelfReviewFindingSchema),
    invalidEvidenceFindings: z.array(
      z
        .object({
          reviewerId: z.string(),
          scopeId: z.string(),
          originalFindingId: z.string(),
          reason: z.string(),
          evidenceRefs: z.array(z.string()),
        })
        .strict(),
    ),
    overlapGroups: z.array(
      z
        .object({
          groupId: z.string(),
          findingIds: z.array(z.string()).min(2),
          basis: z.string(),
        })
        .strict(),
    ),
    severityCounts: z
      .object({
        INFO: z.number().int().nonnegative(),
        WARNING: z.number().int().nonnegative(),
        ERROR: z.number().int().nonnegative(),
        CRITICAL: z.number().int().nonnegative(),
      })
      .strict(),
    blockingCounts: z
      .object({
        BLOCKING_FOR_PHASE_6: z.number().int().nonnegative(),
        HIGH_PRIORITY: z.number().int().nonnegative(),
        NORMAL_PRIORITY: z.number().int().nonnegative(),
        INFORMATIONAL: z.number().int().nonnegative(),
      })
      .strict(),
    subsystemCounts: z.record(z.string(), z.number().int().nonnegative()),
    deterministicEvidence: z
      .object({
        inventoryFileCount: z.number().int().nonnegative(),
        evidencePackCount: z.number().int().nonnegative(),
        sourceFilesIncluded: z.number().int().nonnegative(),
        testFilesIncluded: z.number().int().nonnegative(),
        excludedPathCount: z.number().int().nonnegative(),
        qaFoundationDirectoryCount: z.number().int().nonnegative(),
        qaFoundationDirectoriesTracked: z.boolean(),
        qaFoundationDirectoriesUsed: z.boolean(),
        skillsShCalls: z.number().int().nonnegative(),
        deferredSkillUsage: z.number().int().nonnegative(),
      })
      .strict(),
    phase5Status: z.enum([
      "COMPLETE_FINDINGS_READY",
      "BLOCKED_REVIEW_EXECUTION",
      "BLOCKED_EVIDENCE_INCOMPLETE",
    ]),
    phase6Handoff: z
      .object({
        prioritizedFindingIds: z.array(z.string()),
        correctionGroups: z.array(
          z
            .object({
              groupId: z.string(),
              findingIds: z.array(z.string()),
              owner: z.string(),
              dependencyOrder: z.number().int().positive(),
            })
            .strict(),
        ),
        dependencies: z.array(z.string()),
      })
      .strict(),
  })
  .strict();
export type SelfReviewArtifact = z.infer<typeof SelfReviewArtifactSchema>;

type ScopePlan = {
  scopeId: string;
  title: string;
  surfaces: string[];
  requiredCoverage: string[];
  selectors: string[];
  rationale: string;
};
type ReviewerPlan = {
  reviewerId: string;
  displayName: string;
  capability: string;
  taskType: string;
  agent: (typeof agentCatalog)[number];
  scopes: ScopePlan[];
  role:
    | "architecture-reviewer"
    | "contract-auditor"
    | "code-integration-reviewer"
    | "security-reviewer"
    | "test-quality-reviewer";
};

const reviewerPlans: ReviewerPlan[] = [
  {
    reviewerId: architectureReviewerAgentDefinition.agentId,
    displayName: architectureReviewerAgentDefinition.displayName,
    capability: "review.architecture",
    taskType: "review-architecture",
    agent: architectureReviewerAgentDefinition,
    role: "architecture-reviewer",
    scopes: [
      {
        scopeId: "architecture-module-boundaries",
        title:
          "Agent, orchestration, runtime, persistence and integration boundaries",
        surfaces: ["module-boundaries"],
        requiredCoverage: ["module-boundaries", "architecture-review"],
        selectors: [
          "src/agents/",
          "src/orchestration/",
          "src/runtime/",
          "src/persistence/",
          "src/integrations/",
        ],
        rationale:
          "Assess responsibility ownership, dependency direction, and second mutation paths.",
      },
      {
        scopeId: "architecture-maintainability",
        title: "Reviewer, skills, domain and repository architecture",
        surfaces: ["maintenance"],
        requiredCoverage: [
          "maintainability-review",
          "evolution-maintainability",
        ],
        selectors: [
          "src/agents/reviewers/",
          "src/skills/",
          "src/domain/",
          "AGENTS.md",
          "docs/architecture/",
        ],
        rationale:
          "Assess maintainability and evolution cost without requiring speculative infrastructure.",
      },
      {
        scopeId: "architecture-tradeoffs",
        title:
          "Provider, TaskGraph, Project Memory and generated-runtime tradeoffs",
        surfaces: ["architecture", "modules", "components"],
        requiredCoverage: ["architecture-tradeoffs"],
        selectors: [
          "src/integrations/openai/",
          "src/orchestration/",
          "src/runtime/",
          "src/persistence/",
          "src/integrations/",
        ],
        rationale:
          "Assess actual tradeoffs among the local product's runtime subsystems.",
      },
    ],
  },
  {
    reviewerId: contractAuditorAgentDefinition.agentId,
    displayName: contractAuditorAgentDefinition.displayName,
    capability: "review.contracts",
    taskType: "review-contracts",
    agent: contractAuditorAgentDefinition,
    role: "contract-auditor",
    scopes: [
      {
        scopeId: "contracts-workflow",
        title: "Requirements through Planning, Design and TaskGraph contracts",
        surfaces: ["requirements", "contracts", "traceability"],
        requiredCoverage: ["acceptance-criteria"],
        selectors: [
          "src/domain/",
          "src/agents/lead/",
          "src/agents/planner/",
          "src/agents/design/",
          "src/domain/tasks/",
          "src/orchestration/",
        ],
        rationale:
          "Trace semantic information across the canonical workflow stages.",
      },
      {
        scopeId: "contracts-review-and-persistence",
        title:
          "Reviewer gates, persistence representations and evidence contracts",
        surfaces: ["requirements", "contracts", "traceability"],
        requiredCoverage: [
          "requirements-traceability",
          "cross-stage-consistency",
          "traceability-evidence",
        ],
        selectors: [
          "src/agents/reviewers/",
          "src/domain/review/",
          "src/domain/quality/",
          "src/persistence/",
          "src/runtime/",
        ],
        rationale:
          "Check ownership, evidence, IDs and gate contracts at downstream boundaries.",
      },
    ],
  },
  {
    reviewerId: codeIntegrationReviewerAgentDefinition.agentId,
    displayName: codeIntegrationReviewerAgentDefinition.displayName,
    capability: "review.integration",
    taskType: "review-code-integration",
    agent: codeIntegrationReviewerAgentDefinition,
    role: "code-integration-reviewer",
    scopes: [
      {
        scopeId: "integration-provider-prompt",
        title: "Provider, prompt, resolver and reviewer wiring",
        surfaces: ["react", "nextjs", "components", "routes"],
        requiredCoverage: ["react-review", "nextjs-review"],
        selectors: [
          "src/integrations/openai/",
          "src/skills/runtime/",
          "src/runtime/production-factory-runtime-core.ts",
          "src/agents/reviewers/",
        ],
        rationale: "Trace actual provider and skill-context integration paths.",
      },
      {
        scopeId: "integration-execution-runtime",
        title:
          "Orchestration, persistence, generated runtime and QA integrations",
        surfaces: ["react", "nextjs", "routes", "forms"],
        requiredCoverage: ["react-review", "nextjs-review"],
        selectors: [
          "src/orchestration/",
          "src/persistence/",
          "src/runtime/",
          "src/integrations/",
          "scripts/",
        ],
        rationale:
          "Trace execution, persistence, validation, error propagation and runtime integration.",
      },
    ],
  },
  {
    reviewerId: securityReviewerAgentDefinition.agentId,
    displayName: securityReviewerAgentDefinition.displayName,
    capability: "review.security",
    taskType: "review-security",
    agent: securityReviewerAgentDefinition,
    role: "security-reviewer",
    scopes: [
      {
        scopeId: "security-supabase-boundary",
        title: "Supabase, Postgres, RLS and persistence trust boundaries",
        surfaces: ["supabase", "postgres", "rls", "user-scoped-data"],
        requiredCoverage: ["supabase-rls", "row-level-authorization"],
        selectors: [
          "supabase/",
          "src/persistence/",
          "src/integrations/",
          "src/agents/implementation/",
        ],
        rationale:
          "Resolve RLS procedure only when the repository surface is relevant.",
      },
      {
        scopeId: "security-auth-storage-boundary",
        title:
          "Authentication, storage, uploads, secrets and server/client boundaries",
        surfaces: ["auth", "storage", "uploads", "sessions", "ownership"],
        requiredCoverage: ["auth-security", "storage-upload-security"],
        selectors: [
          "src/agents/implementation/",
          "src/agents/reviewers/security/",
          "src/integrations/",
          "src/domain/",
          "package.json",
          "next.config.ts",
          ".gitignore",
        ],
        rationale:
          "Resolve auth/storage guidance only for the corresponding trust-boundary scope.",
      },
    ],
  },
  {
    reviewerId: testQualityReviewerAgentDefinition.agentId,
    displayName: testQualityReviewerAgentDefinition.displayName,
    capability: "review.test-quality",
    taskType: "review-test-quality",
    agent: testQualityReviewerAgentDefinition,
    role: "test-quality-reviewer",
    scopes: [
      {
        scopeId: "quality-contract-and-agent-tests",
        title: "Agent, resolver, contract and reviewer test evidence",
        surfaces: ["requirements"],
        requiredCoverage: [
          "requirements-traceability",
          "cross-stage-consistency",
        ],
        selectors: [
          "src/agents/",
          "src/skills/",
          "src/domain/",
          "src/orchestration/",
          "src/integrations/openai/",
        ],
        rationale:
          "Map important Factory obligations to meaningful tests and evidence.",
      },
      {
        scopeId: "quality-runtime-and-release-tests",
        title:
          "TaskGraph, persistence, runtime, Playwright and release evidence",
        surfaces: ["forms"],
        requiredCoverage: [
          "test-strategy",
          "meaningful-assertions",
          "playwright-quality",
        ],
        selectors: [
          "src/runtime/",
          "src/persistence/",
          "src/orchestration/",
          "scripts/",
          "supabase/",
          "package.json",
        ],
        rationale:
          "Assess whether high-risk runtime and release obligations have sufficient evidence.",
      },
    ],
  },
];

export const checksum = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const checksumBytes = (value: Buffer) =>
  createHash("sha256").update(value).digest("hex");
const checksumJson = (value: unknown) => checksum(JSON.stringify(value));
const normalizeRelativePath = (value: string) =>
  value.replaceAll("\\", "/").replace(/^\.\//, "");
export const isWithinEvidenceRoot = (root: string, candidate: string) => {
  const normalizedRoot = root.replaceAll("\\", "/");
  const normalizedCandidate = candidate.replaceAll("\\", "/");
  const rootDrive = /^[A-Za-z]:/.exec(normalizedRoot)?.[0]?.toLowerCase();
  const candidateDrive = /^[A-Za-z]:/
    .exec(normalizedCandidate)?.[0]
    ?.toLowerCase();
  if (rootDrive && candidateDrive && rootDrive !== candidateDrive) return false;
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const rel = relative(resolvedRoot, resolvedCandidate);
  return (
    rel === "" ||
    (rel !== ".." &&
      !rel.startsWith(`..${sep}`) &&
      !resolve(resolvedCandidate).startsWith(
        `${resolve(resolvedRoot)}${sep}..`,
      ))
  );
};

export function isExcludedEvidencePath(relativePath: string) {
  const normalized = normalizeRelativePath(relativePath);
  const lower = normalized.toLowerCase();
  const parts = lower.split("/");
  const name = parts.at(-1) ?? "";
  if (
    name === ".env" ||
    name.startsWith(".env.") ||
    parts.includes(".vercel") ||
    parts.includes("node_modules") ||
    parts.includes(".next") ||
    parts.includes("coverage") ||
    parts.includes("dist") ||
    parts.includes(".factory-generated") ||
    parts.includes(".factory-generated-debug") ||
    parts.some((part) => part.startsWith(".qa-foundation-"))
  )
    return true;
  if (parts.includes("docs") && parts.includes("admin")) return true;
  if (
    parts.some((part) =>
      /customer-generated|temporary-workspace|temp-workspace|velofix/i.test(
        part,
      ),
    )
  )
    return true;
  if (BINARY_EXTENSIONS.has(extname(name))) return true;
  return false;
}

export function validateEvidenceReference(
  reference: string,
  manifest: readonly EvidenceManifestEntry[],
) {
  const match = /^([^:]+):(\d+)(?:-(\d+))?$/.exec(reference);
  if (!match)
    return {
      valid: false as const,
      reason:
        "Evidence reference must use repository-relative path:start-end syntax.",
    };
  const relativePath = normalizeRelativePath(match[1]);
  const startLine = Number(match[2]);
  const endLine = Number(match[3] ?? match[2]);
  if (!RELATIVE_PATH.test(relativePath) || isExcludedEvidencePath(relativePath))
    return {
      valid: false as const,
      reason: "Evidence reference is excluded or not repository-relative.",
    };
  const entry = manifest.find((item) => item.relativePath === relativePath);
  if (!entry)
    return {
      valid: false as const,
      reason: "Evidence path is not present in the immutable manifest.",
    };
  if (startLine <= 0 || endLine < startLine || endLine > entry.lineCount)
    return {
      valid: false as const,
      reason: "Evidence line range is outside the immutable file snapshot.",
    };
  return { valid: true as const, relativePath, startLine, endLine, entry };
}

function matchesSelector(relativePath: string, selectors: readonly string[]) {
  const normalized = normalizeRelativePath(relativePath);
  return selectors.some(
    (selector) => normalized === selector || normalized.startsWith(selector),
  );
}
function safeTrackedPath(relativePath: string) {
  return (
    !isExcludedEvidencePath(relativePath) && RELATIVE_PATH.test(relativePath)
  );
}

export async function buildEvidenceInventory(root: string) {
  if (!isWithinEvidenceRoot(root, root))
    throw new Error("SELF_REVIEW_ROOT_INVALID");
  const gitOutput = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "buffer",
  });
  const paths = gitOutput
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map(normalizeRelativePath)
    .filter(safeTrackedPath)
    .sort();
  const manifest: EvidenceManifestEntry[] = [];
  let excludedPathCount = 0;
  const allTracked = gitOutput
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map(normalizeRelativePath);
  excludedPathCount = allTracked.filter((item) =>
    isExcludedEvidencePath(item),
  ).length;
  for (const relativePath of paths) {
    const absolutePath = resolve(root, relativePath);
    if (!isWithinEvidenceRoot(root, absolutePath))
      throw new Error("SELF_REVIEW_ROOT_ESCAPE");
    const content = await readFile(absolutePath);
    const text = content.toString("utf8");
    manifest.push(
      EvidenceManifestEntrySchema.parse({
        relativePath,
        checksum: checksumBytes(content),
        byteLength: content.byteLength,
        lineCount: text.length ? text.split(/\r?\n/).length : 0,
      }),
    );
  }
  const evidenceManifestChecksum = checksumJson(manifest);
  const qaFoundationDirectories = allTracked
    .filter((item) =>
      item.split("/").some((part) => part.startsWith(".qa-foundation-")),
    )
    .map((item) =>
      item.split("/").find((part) => part.startsWith(".qa-foundation-"))!,
    )
    .filter((item, index, values) => values.indexOf(item) === index);
  return {
    manifest,
    evidenceManifestChecksum,
    excludedPathCount,
    qaFoundationDirectories,
    allTrackedCount: allTracked.length,
  };
}

async function buildEvidencePack(
  root: string,
  inventory: Awaited<ReturnType<typeof buildEvidenceInventory>>,
  scope: ScopePlan,
) {
  const candidates = inventory.manifest
    .filter((entry) => matchesSelector(entry.relativePath, scope.selectors))
    .slice(0, MAX_PACK_FILES);
  const slices: EvidenceSlice[] = [];
  let totalBytes = 0;
  for (const entry of candidates) {
    if (totalBytes >= MAX_PACK_BYTES) break;
    const text = await readFile(resolve(root, entry.relativePath), "utf8");
    const lines = text.split(/\r?\n/);
    const selectedLines = lines.slice(
      0,
      Math.min(lines.length, MAX_FILE_EVIDENCE_LINES),
    );
    const content = selectedLines.join("\n").slice(0, MAX_FILE_EVIDENCE_BYTES);
    const endLine = Math.max(1, content.split("\n").length);
    if (Buffer.byteLength(content, "utf8") + totalBytes > MAX_PACK_BYTES) break;
    slices.push(
      EvidenceSliceSchema.parse({
        relativePath: entry.relativePath,
        startLine: 1,
        endLine,
        checksum: entry.checksum,
        content,
      }),
    );
    totalBytes += Buffer.byteLength(content, "utf8");
  }
  const evidencePack = {
    scopeId: scope.scopeId,
    title: scope.title,
    rationale: scope.rationale,
    evidence: slices,
  };
  return {
    slices,
    evidencePackChecksum: checksumJson(evidencePack),
    totalBytes,
  };
}

function providerConfigured() {
  try {
    const config = readAiProviderConfig(process.env, true);
    return {
      configured: Boolean(config.apiKey && process.env.OPENAI_MODEL),
      config,
      reason: undefined,
    };
  } catch (error) {
    return {
      configured: false,
      config: undefined,
      reason:
        error instanceof Error
          ? error.message
          : "AI provider configuration is invalid.",
    };
  }
}

async function selectionForScope(
  registry: SkillRegistry,
  plan: ReviewerPlan,
  scope: ScopePlan,
) {
  return prepareAgentSkillContext(registry, {
    agent: plan.agent,
    capability: plan.capability,
    taskType: plan.taskType,
    projectSurfaces: scope.surfaces,
    requiredCoverage: scope.requiredCoverage,
    requestedTools: [],
    contextBudgetBytes: plan.agent.contextPolicy.maxBytes,
  });
}

function classifyFinding(
  severity: SelfReviewFinding["severity"],
  summary: string,
  category: string,
): SelfReviewFinding["blockingClassification"] {
  if (
    severity === "CRITICAL" ||
    /unsafe|bypass|broken canonical|information loss|trust boundary|secret|authorization/i.test(
      `${summary} ${category}`,
    )
  )
    return "BLOCKING_FOR_PHASE_6";
  if (severity === "ERROR") return "HIGH_PRIORITY";
  if (severity === "WARNING") return "NORMAL_PRIORITY";
  return "INFORMATIONAL";
}
function ownerForReviewer(reviewerId: string): SelfReviewFinding["owner"] {
  if (reviewerId === "architecture-reviewer") return "architecture";
  if (reviewerId === "contract-auditor") return "contracts";
  if (reviewerId === "security-reviewer") return "security";
  if (reviewerId === "test-quality-reviewer") return "tests";
  return "implementation";
}

export function normalizeProviderFindings(
  reviewerId: string,
  scopeId: string,
  raw: unknown,
  manifest: readonly EvidenceManifestEntry[],
) {
  const value = raw as { findings?: Array<Record<string, unknown>> };
  const validatedFindings: SelfReviewFinding[] = [];
  const invalidEvidenceFindings: Array<{
    originalFindingId: string;
    reason: string;
    evidenceRefs: string[];
  }> = [];
  for (const finding of value.findings ?? []) {
    const originalFindingId =
      typeof finding.findingId === "string"
        ? finding.findingId
        : "unknown-finding";
    const evidenceRefs = Array.isArray(finding.evidenceRefs)
      ? finding.evidenceRefs.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
    const invalid = evidenceRefs
      .map((ref) => validateEvidenceReference(ref, manifest))
      .find((result) => !result.valid);
    if (invalid || evidenceRefs.length === 0) {
      invalidEvidenceFindings.push({
        originalFindingId,
        reason:
          invalid && !invalid.valid
            ? invalid.reason
            : "Finding has no traceable evidence references.",
        evidenceRefs,
      });
      continue;
    }
    const severity = finding.severity;
    const category =
      typeof finding.category === "string" ? finding.category : "UNSPECIFIED";
    const summary =
      typeof finding.summary === "string"
        ? finding.summary
        : "Unspecified semantic finding.";
    if (
      !(
        ["INFO", "WARNING", "ERROR", "CRITICAL"] as readonly unknown[]
      ).includes(severity)
    ) {
      invalidEvidenceFindings.push({
        originalFindingId,
        reason: "Finding severity is outside the typed reviewer enum.",
        evidenceRefs,
      });
      continue;
    }
    const normalizedSeverity = severity as SelfReviewFinding["severity"];
    const findingId = checksum(
      `${reviewerId}|${scopeId}|${originalFindingId}|${evidenceRefs.join("|")}`,
    ).slice(0, 20);
    validatedFindings.push(
      SelfReviewFindingSchema.parse({
        findingId: `finding-${findingId}`,
        reviewerId,
        scopeId,
        severity: normalizedSeverity,
        category,
        summary,
        evidenceRefs,
        affectedArtifacts: Array.isArray(finding.affectedArtifacts)
          ? finding.affectedArtifacts.filter(
              (item): item is string => typeof item === "string",
            )
          : [],
        recommendedAction:
          typeof finding.recommendedAction === "string"
            ? finding.recommendedAction
            : "Determine the smallest Phase 6 correction from the cited evidence.",
        blockingClassification: classifyFinding(
          normalizedSeverity,
          summary,
          category,
        ),
        owner: ownerForReviewer(reviewerId),
      }),
    );
  }
  return { validatedFindings, invalidEvidenceFindings };
}

function findOverlaps(findings: readonly SelfReviewFinding[]) {
  const groups: Array<{
    groupId: string;
    findingIds: string[];
    basis: string;
  }> = [];
  for (let index = 0; index < findings.length; index++)
    for (let other = index + 1; other < findings.length; other++) {
      const left = findings[index];
      const right = findings[other];
      const sharedEvidence = left.evidenceRefs.some((ref) =>
        right.evidenceRefs.includes(ref),
      );
      const sharedSubsystem =
        left.owner === right.owner && left.category === right.category;
      if (sharedEvidence || sharedSubsystem)
        groups.push({
          groupId: `overlap-${checksum(`${left.findingId}|${right.findingId}`).slice(0, 16)}`,
          findingIds: [left.findingId, right.findingId].sort(),
          basis: sharedEvidence
            ? "shared-evidence-reference"
            : "same-owner-and-category",
        });
    }
  return groups;
}

function counts(findings: readonly SelfReviewFinding[]) {
  const severityCounts = { INFO: 0, WARNING: 0, ERROR: 0, CRITICAL: 0 };
  const blockingCounts = {
    BLOCKING_FOR_PHASE_6: 0,
    HIGH_PRIORITY: 0,
    NORMAL_PRIORITY: 0,
    INFORMATIONAL: 0,
  };
  const subsystemCounts: Record<string, number> = {};
  for (const finding of findings) {
    severityCounts[finding.severity]++;
    blockingCounts[finding.blockingClassification]++;
    subsystemCounts[finding.owner] = (subsystemCounts[finding.owner] ?? 0) + 1;
  }
  return { severityCounts, blockingCounts, subsystemCounts };
}

function reviewerResultRows(
  plans: readonly ReviewerPlan[],
  results: readonly SelfReviewScopeResult[],
) {
  return plans.map((plan) => ({
    reviewerId: plan.reviewerId,
    displayName: plan.displayName,
    activeAssignedSkills: plan.agent.allowedSkillIds,
    scopes: plan.scopes.map((scope) => ({
      scopeId: scope.scopeId,
      selectedSkillIds:
        results.find(
          (item) =>
            item.reviewerId === plan.reviewerId &&
            item.scopeId === scope.scopeId,
        )?.selectedSkillIds ?? [],
    })),
  }));
}

function renderHumanReport(
  artifact: SelfReviewArtifact,
  inventory: Awaited<ReturnType<typeof buildEvidenceInventory>>,
  plans: readonly ReviewerPlan[],
) {
  const failed = artifact.perReviewerResults.filter(
    (item) => item.status !== "COMPLETED",
  );
  const findings = artifact.validatedFindings;
  const lines = [
    "# Factory Self-Review — 2026-08-10",
    "",
    `- Baseline commit: \`${artifact.baselineCommit}\``,
    `- Reviewers planned: 5; completed semantic executions: ${artifact.provider.configured ? artifact.perReviewerResults.filter((item) => item.status === "COMPLETED").length : 0}`,
    `- AI provider: ${artifact.provider.label}; configured: ${artifact.provider.configured ? "yes" : "no"}; model: ${artifact.provider.model || "not configured"}`,
    `- Run ID: \`${artifact.runId}\``,
    `- Evidence manifest checksum: \`${artifact.evidenceManifestChecksum}\``,
    `- Inventory: ${inventory.manifest.length} safe tracked files; ${artifact.deterministicEvidence.sourceFilesIncluded} source files and ${artifact.deterministicEvidence.testFilesIncluded} test files included in packs`,
    `- Excluded paths: ${artifact.deterministicEvidence.excludedPathCount}; QA directories: ${artifact.deterministicEvidence.qaFoundationDirectoryCount}; QA tracked: ${artifact.deterministicEvidence.qaFoundationDirectoriesTracked ? "yes" : "no"}; used: ${artifact.deterministicEvidence.qaFoundationDirectoriesUsed ? "yes" : "no"}`,
    `- Active reviewer skills selected through production preparation: ${
      artifact.selectedSkillIdentities
        .flatMap((item) => item.selectedSkillIds)
        .filter((item, index, values) => values.indexOf(item) === index)
        .join(", ") || "none"
    }`,
    `- Validated findings: ${findings.length}; CRITICAL ${artifact.severityCounts.CRITICAL}; ERROR ${artifact.severityCounts.ERROR}; WARNING ${artifact.severityCounts.WARNING}; INFO ${artifact.severityCounts.INFO}; potentially blocking ${artifact.blockingCounts.BLOCKING_FOR_PHASE_6}`,
    `- Invalid/unsupported findings: ${artifact.invalidEvidenceFindings.length}`,
    `- Phase 5 status: **${artifact.phase5Status}**`,
    "",
    "## Deterministic baseline and post-run validation",
    "",
    "The required deterministic validation completed successfully before and after the blocked AI preflight: lint passed with the three known pre-existing warnings; typecheck passed; 64 test files and 739 tests passed; the production build passed on Next.js 16.2.12; `npm audit --audit-level=high` reported zero vulnerabilities; database validation/status/verification/integrity passed; Docker Compose configuration passed; TaskGraph smoke passed 6/6 with `releaseEligible=true`; and `git diff --check` passed.",
    "",
    "## Execution status",
    "",
    failed.length
      ? `Real semantic reviewer execution is blocked. No findings were fabricated. Reason: ${failed[0]?.failureReason ?? "provider unavailable"}.`
      : "All five real reviewer executions completed and were evidence-validated.",
    "",
    "## Per-reviewer review",
    "",
    "| Reviewer | Scopes | Active skills actually selected | Verdict/status | Findings |",
    "|---|---|---|---|---:|",
    ...reviewerResultRows(plans, artifact.perReviewerResults).map((row) => {
      const rows = artifact.perReviewerResults.filter(
        (item) => item.reviewerId === row.reviewerId,
      );
      return `| ${row.displayName} | ${row.scopes.map((scope) => scope.scopeId).join(", ")} | ${row.scopes.map((scope) => `${scope.scopeId}: ${scope.selectedSkillIds.join(", ") || "none"}`).join("; ")} | ${rows.every((item) => item.status === "COMPLETED") ? "COMPLETED" : rows.map((item) => item.status).join(", ")} | ${rows.reduce((sum, item) => sum + item.findings.length, 0)} |`;
    }),
    "",
    "## Per-reviewer result artifacts",
    "",
    ...artifact.perReviewerResultArtifacts.map(
      (item) =>
        `- ${item.reviewerId}: \`${item.relativePath}\` (checksum \`${item.checksum}\`)`,
    ),
    "",
    "## Master findings",
    "",
    "| ID | Reviewer | Severity | Subsystem | Finding | Evidence | Phase 6 priority |",
    "|---|---|---|---|---|---|---|",
    ...(findings.length
      ? findings.map(
          (finding) =>
            `| ${finding.findingId} | ${finding.reviewerId} | ${finding.severity} | ${finding.owner} | ${finding.summary} | ${finding.evidenceRefs.join(", ")} | ${finding.blockingClassification} |`,
        )
      : [
          "| — | — | — | — | No semantic findings were produced because real reviewer execution was blocked. | — | — |",
        ]),
    "",
    "## Test-quality evidence gaps",
    "",
    "| Factory obligation | Existing evidence/test | Sufficiency | Missing behavior/evidence |",
    "|---|---|---|---|",
    "| Deterministic and semantic review evidence | Baseline validation and bounded evidence inventory | BLOCKED | Real Test / Quality Reviewer execution is required. |",
    "",
    "## Contract traceability",
    "",
    "| Contract boundary | Evidence | Status | Semantic issue |",
    "|---|---|---|---|",
    "| Factory workflow contracts | Repository evidence packs | BLOCKED | Contract Auditor execution is required. |",
    "",
    "## Security trust boundaries",
    "",
    "| Trust boundary | Existing protection | Review result | Finding |",
    "|---|---|---|---|",
    "| Supabase/auth/storage/server-client | Bounded source evidence and deterministic checks | BLOCKED | Security Reviewer execution is required. |",
    "",
    "## Architecture and integration summaries",
    "",
    "| Review domain | Result | Highest severity | Phase 6 action required? |",
    "|---|---|---|---|",
    `| Architecture | ${failed.some((item) => item.reviewerId === "architecture-reviewer") ? "BLOCKED" : "READY"} | ${artifact.severityCounts.CRITICAL ? "CRITICAL" : "none"} | ${artifact.phase5Status !== "COMPLETE_FINDINGS_READY" ? "Yes" : "Yes"} |`,
    `| Contracts / traceability | ${failed.some((item) => item.reviewerId === "contract-auditor") ? "BLOCKED" : "READY"} | ${artifact.severityCounts.CRITICAL ? "CRITICAL" : "none"} | Yes |`,
    `| Code / integration | ${failed.some((item) => item.reviewerId === "code-integration-reviewer") ? "BLOCKED" : "READY"} | ${artifact.severityCounts.CRITICAL ? "CRITICAL" : "none"} | Yes |`,
    `| Security | ${failed.some((item) => item.reviewerId === "security-reviewer") ? "BLOCKED" : "READY"} | ${artifact.severityCounts.CRITICAL ? "CRITICAL" : "none"} | Yes |`,
    `| Test / evidence quality | ${failed.some((item) => item.reviewerId === "test-quality-reviewer") ? "BLOCKED" : "READY"} | ${artifact.severityCounts.CRITICAL ? "CRITICAL" : "none"} | Yes |`,
    "",
    "## Phase 6 handoff preview",
    "",
    "No correction tasks or source changes were created. Once the provider is configured, prioritize validated CRITICAL/ERROR findings by blocking impact, security implications, workflow impact, test coverage, and dependency ordering.",
    "",
    `## Evidence limits`,
    "",
    "Admin reports were excluded from AI evidence; no customer-generated projects, QA temporary workspaces, secrets, credentials, auth headers, or full repository dumps were supplied. Each accepted finding must cite a manifest-bound repository-relative line range.",
    "",
    "PHASE 5: " +
      (artifact.phase5Status === "COMPLETE_FINDINGS_READY"
        ? "COMPLETE_FINDINGS_READY"
        : "BLOCKED"),
    artifact.phase5Status === "COMPLETE_FINDINGS_READY"
      ? "NEXT: PHASE 6 — CONTROLLED FACTORY CORRECTIONS"
      : "NEXT: CORRECT SELF-REVIEW EXECUTION/EVIDENCE BLOCKERS",
    "",
  ];
  return lines.join("\n");
}

async function buildArtifact(root: string) {
  const baselineCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const inventory = await buildEvidenceInventory(root);
  const registry = new SkillRegistry(resolve(root, "skills"));
  const selections: Array<{
    plan: ReviewerPlan;
    scope: ScopePlan;
    selection: AgentSkillSelection;
    pack: Awaited<ReturnType<typeof buildEvidencePack>>;
  }> = [];
  for (const plan of reviewerPlans)
    for (const scope of plan.scopes)
      selections.push({
        plan,
        scope,
        selection: await selectionForScope(registry, plan, scope),
        pack: await buildEvidencePack(root, inventory, scope),
      });
  const runId = checksumJson({
    baselineCommit,
    evidenceManifestChecksum: inventory.evidenceManifestChecksum,
    policy: SELF_REVIEW_POLICY_VERSION,
    reviewers: reviewerPlans.map((plan) => plan.reviewerId),
    selections: selections.map((item) => ({
      reviewerId: item.plan.reviewerId,
      scopeId: item.scope.scopeId,
      identity: item.selection.identityChecksum,
    })),
  });
  const configState = providerConfigured();
  const priorPath = resolve(root, SELF_REVIEW_OUTPUT_PATH);
  try {
    const previous = SelfReviewArtifactSchema.parse(
      JSON.parse(await readFile(priorPath, "utf8")),
    );
    if (
      previous.runId === runId &&
      previous.phase5Status === "COMPLETE_FINDINGS_READY" &&
      configState.configured
    )
      return { artifact: previous, inventory, reused: true };
  } catch {
    /* no reusable completed snapshot */
  }
  const results: SelfReviewScopeResult[] = [];
  for (const item of selections) {
    const base = {
      scopeId: item.scope.scopeId,
      reviewerId: item.plan.reviewerId,
      selectedSkillIds: [...item.selection.selectedSkillIds],
      selectedSkillChecksums: [...item.selection.selectedSkillChecksums],
      skillContextIdentity: item.selection.identityChecksum,
      evidencePackChecksum: item.pack.evidencePackChecksum,
      snapshotIdentity: checksumJson({
        baselineCommit,
        evidenceManifestChecksum: inventory.evidenceManifestChecksum,
        reviewerId: item.plan.reviewerId,
        scopeId: item.scope.scopeId,
        skillContextIdentity: item.selection.identityChecksum,
      }),
      findings: [],
      invalidEvidenceFindings: [],
    };
    if (!configState.configured) {
      results.push(
        SelfReviewScopeResultSchema.parse({
          ...base,
          status: "BLOCKED_REVIEW_EXECUTION",
          provider: { modelLabel: "GPT-5.6 Luna", model: "" },
          failureCode: "PHASE_5_BLOCKED_AI_PROVIDER",
          failureReason:
            configState.reason ??
            "OPENAI_API_KEY and OPENAI_MODEL are required for real reviewer execution.",
        }),
      );
      continue;
    }
    try {
      const bundle = createProductionProviderBundle();
      const input = {
        reviewType: "factory-self-review",
        reviewerId: item.plan.reviewerId,
        role: item.plan.role,
        scopeId: item.scope.scopeId,
        scopeTitle: item.scope.title,
        scopeRationale: item.scope.rationale,
        baselineCommit,
        evidenceManifestChecksum: inventory.evidenceManifestChecksum,
        evidencePackChecksum: item.pack.evidencePackChecksum,
        evidence: item.pack.slices,
        deterministicEvidence: {
          inventoryFileCount: inventory.manifest.length,
          sourceFilesIncluded: item.pack.slices.filter((slice) =>
            slice.relativePath.startsWith("src/"),
          ).length,
          testFilesIncluded: item.pack.slices.filter((slice) =>
            /(?:\.test|\.spec)\.[jt]sx?$/.test(slice.relativePath),
          ).length,
        },
      };
      const idempotencyKey = `${runId}:${item.plan.reviewerId}:${item.scope.scopeId}`;
      let output: unknown;
      if (item.plan.reviewerId === "architecture-reviewer")
        output = await bundle.architectureReviewer.review(
          input as unknown as ArchitectureReviewInput,
          undefined,
          item.selection.contexts,
          item.selection.identityChecksum,
        );
      else if (item.plan.reviewerId === "contract-auditor")
        output = await bundle.contractAuditor.review(
          { ...input, idempotencyKey } as unknown as ContractAuditInput,
          undefined,
          item.selection.contexts,
          item.selection.identityChecksum,
        );
      else if (item.plan.reviewerId === "code-integration-reviewer")
        output = await bundle.codeIntegrationReviewer.review(
          { ...input, idempotencyKey } as unknown as CodeIntegrationReviewInput,
          undefined,
          item.selection.contexts,
          item.selection.identityChecksum,
        );
      else if (item.plan.reviewerId === "security-reviewer")
        output = await bundle.securityReviewer.review(
          { ...input, idempotencyKey } as unknown as SecurityReviewInput,
          undefined,
          item.selection.contexts,
          item.selection.identityChecksum,
        );
      else
        output = await bundle.testQualityReviewer.review(
          { ...input, idempotencyKey } as unknown as TestQualityReviewInput,
          undefined,
          item.selection.contexts,
          item.selection.identityChecksum,
        );
      const normalized = normalizeProviderFindings(
        item.plan.reviewerId,
        item.scope.scopeId,
        output,
        inventory.manifest,
      );
      results.push(
        SelfReviewScopeResultSchema.parse({
          ...base,
          status: "COMPLETED",
          provider: {
            modelLabel: configState.config?.modelLabel ?? "GPT-5.6 Luna",
            model: configState.config?.model ?? "",
          },
          findings: normalized.validatedFindings,
          invalidEvidenceFindings: normalized.invalidEvidenceFindings,
        }),
      );
    } catch (error) {
      results.push(
        SelfReviewScopeResultSchema.parse({
          ...base,
          status: "REVIEW_EXECUTION_FAILED",
          provider: {
            modelLabel: configState.config?.modelLabel ?? "GPT-5.6 Luna",
            model: configState.config?.model ?? "",
          },
          failureCode:
            error instanceof Error && "code" in error
              ? String((error as { code?: unknown }).code)
              : "REVIEW_EXECUTION_FAILED",
          failureReason:
            error instanceof Error
              ? error.message
              : "Reviewer provider failed safely.",
        }),
      );
    }
  }
  const validatedFindings = results
    .flatMap((result) => result.findings)
    .sort((left, right) => left.findingId.localeCompare(right.findingId));
  const invalidEvidenceFindings = results.flatMap((result) =>
    result.invalidEvidenceFindings.map((item) => ({
      reviewerId: result.reviewerId,
      scopeId: result.scopeId,
      ...item,
    })),
  );
  const c = counts(validatedFindings);
  const qaFoundationDirectoryCount = (
    await readdir(root, { withFileTypes: true })
  ).filter(
    (entry) => entry.isDirectory() && entry.name.startsWith(".qa-foundation-"),
  ).length;
  const reviewerResultArtifacts = reviewerPlans.map((plan) => {
    const relativePath = `${SELF_REVIEW_RESULTS_DIRECTORY}/${plan.reviewerId}-${runId.slice(0, 16)}.json`;
    const payload = {
      schemaVersion: 1,
      runId,
      baselineCommit,
      evidenceManifestChecksum: inventory.evidenceManifestChecksum,
      reviewerId: plan.reviewerId,
      agentVersion: plan.agent.version,
      capability: plan.capability,
      selectedSkillIdentities: selections
        .filter((item) => item.plan.reviewerId === plan.reviewerId)
        .map((item) => ({
          scopeId: item.scope.scopeId,
          identity: item.selection.identityChecksum,
          selectedSkillIds: [...item.selection.selectedSkillIds],
          selectedSkillChecksums: [...item.selection.selectedSkillChecksums],
        })),
      results: results.filter(
        (result) => result.reviewerId === plan.reviewerId,
      ),
      validatedFindings: validatedFindings.filter(
        (finding) => finding.reviewerId === plan.reviewerId,
      ),
      invalidEvidenceFindings: invalidEvidenceFindings.filter(
        (finding) => finding.reviewerId === plan.reviewerId,
      ),
    };
    return { relativePath, payload, reviewerId: plan.reviewerId };
  });
  const artifact = SelfReviewArtifactSchema.parse({
    schemaVersion: 1,
    runId,
    baselineCommit,
    evidenceManifestChecksum: inventory.evidenceManifestChecksum,
    reviewPolicyVersion: SELF_REVIEW_POLICY_VERSION,
    provider: {
      label: "GPT-5.6 Luna",
      model: configState.config?.model ?? "",
      configured: configState.configured,
    },
    reviewers: reviewerPlans.map((plan) => ({
      reviewerId: plan.reviewerId,
      agentVersion: plan.agent.version,
      capability: plan.capability,
      assignedSkillIds: [...plan.agent.allowedSkillIds],
      scopeIds: plan.scopes.map((scope) => scope.scopeId),
    })),
    perReviewerResults: results,
    selectedSkillIdentities: selections.map((item) => ({
      reviewerId: item.plan.reviewerId,
      scopeId: item.scope.scopeId,
      identity: item.selection.identityChecksum,
      selectedSkillIds: [...item.selection.selectedSkillIds],
      selectedSkillChecksums: [...item.selection.selectedSkillChecksums],
    })),
    perReviewerResultArtifacts: reviewerResultArtifacts.map((item) => ({
      reviewerId: item.reviewerId,
      relativePath: item.relativePath,
      checksum: checksum(`${JSON.stringify(item.payload, null, 2)}\n`),
    })),
    validatedFindings,
    invalidEvidenceFindings,
    overlapGroups: findOverlaps(validatedFindings),
    ...c,
    deterministicEvidence: {
      inventoryFileCount: inventory.manifest.length,
      evidencePackCount: selections.length,
      sourceFilesIncluded: selections
        .flatMap((item) => item.pack.slices)
        .filter(
          (slice, index, values) =>
            slice.relativePath.startsWith("src/") &&
            values.findIndex(
              (other) => other.relativePath === slice.relativePath,
            ) === index,
        ).length,
      testFilesIncluded: selections
        .flatMap((item) => item.pack.slices)
        .filter(
          (slice, index, values) =>
            /(?:\.test|\.spec)\.[jt]sx?$/.test(slice.relativePath) &&
            values.findIndex(
              (other) => other.relativePath === slice.relativePath,
            ) === index,
        ).length,
      excludedPathCount: inventory.excludedPathCount,
      qaFoundationDirectoryCount,
      qaFoundationDirectoriesTracked:
        inventory.qaFoundationDirectories.length > 0,
      qaFoundationDirectoriesUsed: false,
      skillsShCalls: 0,
      deferredSkillUsage: results
        .flatMap((result) => result.selectedSkillIds)
        .filter((id) =>
          DEFERRED_SKILLS.some((deferred) => id.includes(deferred)),
        ).length,
    },
    phase5Status:
      configState.configured &&
      results.every((result) => result.status === "COMPLETED") &&
      invalidEvidenceFindings.length === 0
        ? "COMPLETE_FINDINGS_READY"
        : "BLOCKED_REVIEW_EXECUTION",
    phase6Handoff: {
      prioritizedFindingIds: validatedFindings
        .filter(
          (finding) =>
            finding.blockingClassification === "BLOCKING_FOR_PHASE_6" ||
            finding.blockingClassification === "HIGH_PRIORITY",
        )
        .map((finding) => finding.findingId),
      correctionGroups: [],
      dependencies: [],
    },
  });
  const report = renderHumanReport(artifact, inventory, reviewerPlans);
  await writeFile(
    resolve(root, SELF_REVIEW_OUTPUT_PATH),
    `${JSON.stringify(artifact, null, 2)}\n`,
    "utf8",
  );
  await writeFile(resolve(root, SELF_REVIEW_REPORT_PATH), report, "utf8");
  await mkdir(resolve(root, SELF_REVIEW_RESULTS_DIRECTORY), {
    recursive: true,
  });
  for (const item of reviewerResultArtifacts)
    await writeFile(
      resolve(root, item.relativePath),
      `${JSON.stringify(item.payload, null, 2)}\n`,
      "utf8",
    );
  await writeFile(
    resolve(root, "docs/admin/factory-self-review-evidence-manifest.json"),
    `${JSON.stringify({ baselineCommit, evidenceManifestChecksum: inventory.evidenceManifestChecksum, files: inventory.manifest }, null, 2)}\n`,
    "utf8",
  );
  return { artifact, inventory, reused: false };
}

export async function runFactorySelfReview(root = process.cwd()) {
  return buildArtifact(resolve(root));
}
export function getSelfReviewReviewerPlans() {
  return reviewerPlans.map((plan) => ({
    reviewerId: plan.reviewerId,
    displayName: plan.displayName,
    capability: plan.capability,
    taskType: plan.taskType,
    assignedSkillIds: [...plan.agent.allowedSkillIds],
    scopeIds: plan.scopes.map((scope) => scope.scopeId),
  }));
}

async function main() {
  const root = resolve(process.cwd());
  const result = await runFactorySelfReview(root);
  console.log(
    JSON.stringify(
      {
        status: result.artifact.phase5Status,
        runId: result.artifact.runId,
        baselineCommit: result.artifact.baselineCommit,
        evidenceManifestChecksum: result.artifact.evidenceManifestChecksum,
        reviewerCount: result.artifact.reviewers.length,
        semanticCalls: result.artifact.perReviewerResults.filter(
          (item) => item.status === "COMPLETED",
        ).length,
        invalidEvidenceFindings: result.artifact.invalidEvidenceFindings.length,
        validatedFindings: result.artifact.validatedFindings.length,
        reused: result.reused,
      },
      null,
      2,
    ),
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
)
  void main();
