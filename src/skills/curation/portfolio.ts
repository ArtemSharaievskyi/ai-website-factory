import { z } from "zod";
import { agentCatalog, type AgentCapabilityId } from "@/agents/catalog";
import type { AgentContextCategory } from "@/domain/agents/schema";
import type { CurationReviewer, SkillCandidateEvaluation } from "./contracts";

export const CoverageStateSchema = z.enum([
  "DETERMINISTICALLY_COVERED",
  "PROMPT_COVERED",
  "APPROVED_SKILL_COVERED",
  "PARTIALLY_COVERED",
  "MISSING",
  "NOT_APPLICABLE",
]);
export type CoverageState = z.infer<typeof CoverageStateSchema>;

export type CoverageArea = {
  key: string;
  responsibility: string;
  state: CoverageState;
  evidence: string[];
  gap: string;
  discoveryQuery?: string;
};

export type AgentResponsibilityProfile = {
  agentId: CurationReviewer;
  role: string;
  capabilities: readonly string[];
  taskTypes: readonly string[];
  tools: readonly string[];
  contextCategories: readonly AgentContextCategory[];
  readOnly: boolean;
  responsibilities: readonly string[];
  approvedSkills: readonly string[];
  coverage: readonly CoverageArea[];
};

const area = (
  key: string,
  responsibility: string,
  state: CoverageState,
  evidence: string[],
  gap: string,
  discoveryQuery?: string,
): CoverageArea => ({ key, responsibility, state, evidence, gap, discoveryQuery });

// This map is intentionally small and evidence-oriented. It records current
// Factory behavior, not a future skill wishlist.
export const agentResponsibilityProfiles: readonly AgentResponsibilityProfile[] = [
  {
    agentId: "lead",
    role: "Generation agent for clarification and an approved structured Brief.",
    capabilities: ["requirements.clarify", "requirements.brief"],
    taskTypes: ["clarify-requirements", "create-requirements-spec"],
    tools: ["openai-generation"],
    contextCategories: ["ORIGINAL_PROMPT", "SUPPLIED_FILES_METADATA", "CLARIFICATION_SESSION", "PROJECT_BRIEF"],
    readOnly: false,
    responsibilities: ["elicit missing user and business requirements", "detect ambiguity and contradictions", "preserve facts without invention", "transform clarified intent into the typed Brief"],
    approvedSkills: [],
    coverage: [
      area("requirements-elicitation", "requirements elicitation", "PROMPT_COVERED", ["src/agents/lead/clarification-policy.ts", "src/integrations/openai/prompts.ts"], "A reusable professional elicitation procedure is not approved.", "requirements elicitation"),
      area("requirements-ambiguity", "ambiguity and contradiction detection", "PARTIALLY_COVERED", ["src/agents/lead/deterministic.ts", "src/agents/lead/clarification-policy.ts"], "The Factory enforces clarification boundaries but lacks a complete ambiguity analysis method.", "requirements ambiguity detection"),
      area("requirements-completeness", "requirements completeness", "PARTIALLY_COVERED", ["src/domain/brief/schema.ts", "docs/contracts/clarification-workflow.md"], "Typed completeness gates exist, but professional completeness heuristics are missing.", "requirements completeness review"),
      area("intent-to-brief", "user intent to structured Brief", "DETERMINISTICALLY_COVERED", ["src/agents/lead/contracts.ts", "src/domain/brief/schema.ts"], "", undefined),
      area("non-invention", "non-invention of business facts", "PROMPT_COVERED", ["src/integrations/openai/prompts.ts", "docs/operations/no-invention-policy.md"], "A focused elicitation skill could add judgment without changing the policy.", "requirements elicitation non invention"),
    ],
  },
  {
    agentId: "planner",
    role: "Generation agent for technical architecture, content planning, and asset planning.",
    capabilities: ["planning.architecture", "planning.content", "planning.assets"],
    taskTypes: ["create-technical-architecture", "plan-content", "plan-assets"],
    tools: ["openai-generation", "context7-read"],
    contextCategories: ["PROJECT_BRIEF", "CLARIFICATION_SESSION", "PLANNING_PACKAGE", "PREVIOUS_FINDINGS"],
    readOnly: false,
    responsibilities: ["decompose approved requirements into architecture", "plan data, auth, storage, API and Server Action boundaries", "plan content and assets", "preserve requirement-to-task traceability and technical risks"],
    approvedSkills: [],
    coverage: [
      area("software-planning", "software architecture planning", "PROMPT_COVERED", ["docs/architecture/planner-architect-agent.md", "src/agents/planner/service.ts"], "A focused planning procedure is not approved.", "software architecture planning"),
      area("nextjs-architecture", "Next.js application decomposition", "PROMPT_COVERED", ["docs/architecture/technical-architecture-planning.md", "docs/architecture/fixed-stack.md"], "Current guidance is internal and not an external procedure.", "Next.js architecture planning"),
      area("data-modeling", "data modeling and persistence planning", "PARTIALLY_COVERED", ["src/agents/planner/contracts.ts", "docs/architecture/backend-implementation.md"], "The contract captures plans, but a professional modeling method is missing.", "PostgreSQL data modeling planning"),
      area("auth-storage-architecture", "auth and storage architecture", "PROMPT_COVERED", ["docs/architecture/authentication-implementation.md", "docs/architecture/backend-implementation.md"], "No focused external procedure is approved.", "Supabase auth storage architecture"),
      area("technical-risk-planning", "technical risk and dependency planning", "PARTIALLY_COVERED", ["src/agents/planner/memory.ts", "src/domain/implementation/schema.ts"], "Risk identification is present in artifacts but not a dedicated procedure.", "technical risk dependency planning"),
      area("requirements-traceability", "requirement to implementation traceability", "PROMPT_COVERED", ["docs/contracts/requirement-traceability.md", "src/agents/planner/contracts.ts"], "A traceability skill may complement existing contracts.", "requirements implementation traceability planning"),
    ],
  },
  {
    agentId: "design",
    role: "Generation agent for design directions and selected design contracts.",
    capabilities: ["design.directions", "design.selection"],
    taskTypes: ["create-design-directions"],
    tools: ["openai-generation", "fontpair-read", "design-quality-validation", "design-source-discovery"],
    contextCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "SELECTED_DESIGN", "SUPPLIED_FILES_METADATA", "PREVIOUS_FINDINGS"],
    readOnly: false,
    responsibilities: ["create materially distinct web design directions", "define hierarchy, rhythm, typography and component composition", "specify responsive and accessible interaction behavior", "select a coherent visual direction without writing production code"],
    approvedSkills: [],
    coverage: [
      area("web-ux", "web UX and information hierarchy", "PROMPT_COVERED", ["docs/architecture/design-agent.md", "docs/architecture/design-anti-template-policy.md"], "A professional UX procedure is not approved.", "web UX information hierarchy"),
      area("responsive-design", "responsive and mobile-first design", "PARTIALLY_COVERED", ["docs/architecture/design-directions.md", "src/agents/design/contracts.ts"], "Responsive behavior is contract-aware but lacks a focused method.", "responsive web design mobile first"),
      area("design-systems", "design systems, spacing, typography and composition", "PROMPT_COVERED", ["docs/architecture/design-selection.md", "src/agents/design/deterministic.ts"], "No external design-system procedure is approved.", "web design system typography spacing"),
      area("form-ux", "form UX and accessible interaction", "PARTIALLY_COVERED", ["docs/architecture/design-agent.md", "src/domain/assets/schema.ts"], "Form interaction guidance is not a standalone procedure.", "accessible form UX"),
      area("purposeful-motion", "purposeful motion and anti-template quality", "PROMPT_COVERED", ["docs/architecture/design-anti-template-policy.md", "docs/architecture/design-selection.md"], "No external motion procedure is approved.", "purposeful motion web interaction design"),
    ],
  },
  {
    agentId: "implementation",
    role: "Implementation agent for bounded source changes, backend work, and tests.",
    capabilities: ["implementation.code", "implementation.backend"],
    taskTypes: ["prepare-workspace", "implement-project-foundation", "implement-page", "implement-form", "implement-server-action", "implement-route-handler", "implement-database-schema", "implement-rls-policy", "implement-authentication", "implement-storage", "write-unit-tests", "write-integration-tests", "write-e2e-tests", "repair-targeted-failure"],
    tools: ["openai-generation", "context7-read", "shadcn-registry-read", "codebase-memory-read", "controlled-edit"],
    contextCategories: ["TASK_SLICE", "PROJECT_BRIEF", "PLANNING_PACKAGE", "SELECTED_DESIGN", "CODEBASE_CONTEXT", "VALIDATION_DIAGNOSTIC", "PREVIOUS_FINDINGS"],
    readOnly: false,
    responsibilities: ["execute one authorized task in staging", "apply typed proposals with bounded filesystem authority", "implement frontend, backend, auth, storage and persistence slices", "produce test changes and repair targeted validation failures"],
    approvedSkills: [],
    coverage: [
      area("deterministic-change-safety", "scoped file and checksum-safe change application", "DETERMINISTICALLY_COVERED", ["src/agents/implementation/applier.ts", "src/agents/implementation/validators.ts"], "", undefined),
      area("nextjs-implementation", "Next.js App Router implementation", "PROMPT_COVERED", ["docs/architecture/implementation-agent.md", "src/integrations/openai/prompts.ts"], "A focused implementation procedure is not approved.", "Next.js App Router implementation best practices"),
      area("react-typescript", "React and TypeScript implementation quality", "PROMPT_COVERED", ["src/agents/implementation/contracts.ts", "docs/architecture/fixed-stack.md"], "No external focused procedure is approved.", "React TypeScript implementation best practices"),
      area("server-client-boundaries", "Server/Client Components, Actions and handlers", "PARTIALLY_COVERED", ["docs/architecture/server-client-boundaries.md", "docs/architecture/server-actions-policy.md"], "Internal policies exist; a bounded procedure could add implementation judgment.", "Next.js server client boundary review implementation"),
      area("forms-validation", "forms and schema validation", "PARTIALLY_COVERED", ["src/agents/implementation/validators.ts", "docs/architecture/implementation-agent.md"], "Validation is deterministic, but form design and error-flow procedure is missing.", "React forms Zod validation"),
      area("supabase-implementation", "Supabase/Postgres/auth/storage implementation", "PARTIALLY_COVERED", ["src/agents/implementation/backend.ts", "docs/architecture/backend-implementation.md"], "Multiple backend surfaces lack a single focused implementation method.", "Supabase Postgres auth storage implementation"),
      area("maintainable-performance", "maintainability and performance discipline", "PARTIALLY_COVERED", ["src/agents/implementation/policy.ts", "docs/architecture/implementation-roadmap.md"], "Incremental execution is enforced, but performance/maintainability procedure is missing.", "React Next.js performance maintainable code"),
      area("test-aware-implementation", "test-aware implementation", "PROMPT_COVERED", ["src/agents/implementation/test-artifacts.test.ts", "docs/contracts/quality-gates.md"], "A focused test-aware implementation skill is not approved.", "test aware implementation React"),
    ],
  },
  {
    agentId: "architecture-reviewer",
    role: "Read-only architecture quality reviewer.",
    capabilities: ["review.architecture"],
    taskTypes: ["review-architecture"],
    tools: ["openai-generation"],
    contextCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "PREVIOUS_FINDINGS"],
    readOnly: true,
    responsibilities: ["review architecture quality, boundaries, cohesion, coupling, and evolution risk"],
    approvedSkills: ["module-boundaries-fb20497b5c35"],
    coverage: [
      area("module-boundaries", "module boundaries and dependency direction", "APPROVED_SKILL_COVERED", ["module-boundaries-fb20497b5c35", "src/agents/reviewers/architecture/service.ts"], "", undefined),
      area("architecture-tradeoffs", "architecture trade-offs and decomposition", "PARTIALLY_COVERED", ["src/agents/reviewers/architecture/deterministic.ts", "docs/architecture/architecture-reviewer.md"], "Existing skill coverage is narrower than overall architecture quality.", "software architecture tradeoffs review"),
      area("evolution-maintainability", "architectural evolution and maintainability", "MISSING", ["docs/architecture/architecture-reviewer.md"], "No approved procedure covers evolution risk without duplicating module-boundaries.", "architecture evolution maintainability review"),
    ],
  },
  {
    agentId: "contract-auditor",
    role: "Read-only cross-artifact contract and traceability auditor.",
    capabilities: ["review.contracts"],
    taskTypes: ["review-contracts"],
    tools: ["openai-generation"],
    contextCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "PREVIOUS_FINDINGS"],
    readOnly: true,
    responsibilities: ["audit information preservation, ownership, references, capabilities, dependencies, and validation trace across Brief, Planning, Design and TaskGraph"],
    approvedSkills: ["acceptance-criteria-80493e317476"],
    coverage: [
      area("acceptance-criteria", "acceptance criteria and verifiability", "APPROVED_SKILL_COVERED", ["acceptance-criteria-80493e317476", "src/agents/reviewers/contracts/service.ts"], "", undefined),
      area("requirements-traceability-review", "requirements to task and validation traceability", "PARTIALLY_COVERED", ["docs/contracts/requirement-traceability.md", "src/agents/reviewers/contracts/deterministic.ts"], "Acceptance criteria does not cover all cross-stage traceability.", "requirements traceability audit"),
      area("cross-stage-consistency", "cross-stage information preservation and schema consistency", "MISSING", ["docs/architecture/contract-auditor.md"], "No focused external procedure is approved.", "cross stage contract consistency audit"),
    ],
  },
  {
    agentId: "code-integration-reviewer",
    role: "Read-only semantic code and integration reviewer after deterministic gates.",
    capabilities: ["review.integration"],
    taskTypes: ["review-code-integration"],
    tools: ["openai-generation"],
    contextCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "SELECTED_DESIGN", "TASK_SLICE", "CODEBASE_CONTEXT", "PREVIOUS_FINDINGS"],
    readOnly: true,
    responsibilities: ["review bounded source semantics, component/data flow, integration correctness, and server/client boundaries without mutating code"],
    approvedSkills: [],
    coverage: [
      area("deterministic-structural-gates", "lint, typecheck and structural evidence", "DETERMINISTICALLY_COVERED", ["src/agents/reviewers/code-integration/deterministic.ts", "src/runtime/validation"], "", undefined),
      area("react-review", "React and component/data-flow review", "MISSING", ["docs/architecture/code-integration-reviewer.md"], "The reviewer has no approved review-oriented procedure.", "React code review component data flow"),
      area("nextjs-review", "Next.js integration and server/client review", "MISSING", ["docs/architecture/code-integration-reviewer.md"], "The reviewer needs review procedure distinct from implementation guidance.", "Next.js code integration review server client"),
      area("maintainability-review", "source-of-truth and maintainability review", "PARTIALLY_COVERED", ["src/agents/reviewers/code-integration/service.ts"], "Role policy exists, but no focused checklist is approved.", "TypeScript maintainability code review"),
    ],
  },
  {
    agentId: "security-reviewer",
    role: "Read-only contextual application security reviewer.",
    capabilities: ["review.security"],
    taskTypes: ["review-security"],
    tools: ["openai-generation"],
    contextCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "SELECTED_DESIGN", "TASK_SLICE", "CODEBASE_CONTEXT", "PREVIOUS_FINDINGS"],
    readOnly: true,
    responsibilities: ["review trust boundaries, input handling, authn/authz, secrets, database/RLS, storage, admin, error, and external-input behavior"],
    approvedSkills: ["supabase-rls-1e36b217c969"],
    coverage: [
      area("rls-security", "Supabase RLS and user-scoped database security", "APPROVED_SKILL_COVERED", ["supabase-rls-1e36b217c969", "src/agents/reviewers/security/deterministic.ts"], "", undefined),
      area("web-security", "general web application security and trust boundaries", "MISSING", ["docs/architecture/security-reviewer.md"], "RLS is not general application security coverage.", "web application security review"),
      area("auth-security", "authentication, authorization and secrets boundaries", "PARTIALLY_COVERED", ["src/agents/reviewers/security/service.ts", "docs/architecture/authentication-implementation.md"], "Internal policy exists but no focused security procedure is approved.", "web authentication authorization security review"),
      area("storage-upload-security", "storage, uploads and external API trust", "MISSING", ["docs/architecture/security-reviewer.md"], "No approved focused procedure covers these surfaces.", "Supabase storage upload security review"),
    ],
  },
  {
    agentId: "test-quality-reviewer",
    role: "Read-only semantic test and quality evidence reviewer after deterministic gates.",
    capabilities: ["review.test-quality"],
    taskTypes: ["review-test-quality"],
    tools: ["openai-generation"],
    contextCategories: ["PROJECT_BRIEF", "PLANNING_PACKAGE", "SELECTED_DESIGN", "TASK_SLICE", "VALIDATION_DIAGNOSTIC", "PREVIOUS_FINDINGS"],
    readOnly: true,
    responsibilities: ["judge whether tests meaningfully validate approved behavior, including happy/error paths, regression quality, and requirement-to-evidence mapping"],
    approvedSkills: [],
    coverage: [
      area("deterministic-quality-gates", "test command and diagnostic evidence", "DETERMINISTICALLY_COVERED", ["src/agents/reviewers/test-quality/deterministic.ts", "src/runtime/validation/test-diagnostics.ts"], "", undefined),
      area("test-strategy", "requirement-based test strategy and behavioral coverage", "MISSING", ["docs/architecture/test-quality-reviewer.md"], "No approved review/strategy procedure exists.", "test strategy requirement based testing"),
      area("meaningful-assertions", "meaningful assertions and fragility", "MISSING", ["src/agents/reviewers/test-quality/service.ts"], "No focused review procedure is approved.", "meaningful assertions test quality review"),
      area("playwright-quality", "Playwright and integration-test quality", "PARTIALLY_COVERED", ["docs/operations/playwright-functional-qa.md", "src/runtime/qa"], "Execution policy exists, but review methodology is missing.", "Playwright integration test quality review"),
      area("traceability-evidence", "requirement to test evidence mapping", "PARTIALLY_COVERED", ["docs/contracts/requirement-traceability.md", "src/agents/reviewers/test-quality/contracts.ts"], "Traceability is present but not a dedicated testing method.", "requirements to test evidence mapping"),
    ],
  },
] as const;

export const portfolioAgents = new Set(agentResponsibilityProfiles.map((profile) => profile.agentId));
if (portfolioAgents.size !== agentCatalog.length) throw new Error("Agent portfolio must cover every catalog agent.");

export const discoveryTargets = agentResponsibilityProfiles.flatMap((profile) =>
  profile.coverage
    .filter((coverage) => coverage.discoveryQuery && (coverage.state === "MISSING" || coverage.state === "PARTIALLY_COVERED"))
    .map((coverage) => ({
      agentId: profile.agentId,
      capability: profile.capabilities[0] as AgentCapabilityId,
      query: coverage.discoveryQuery!,
      coverageKey: coverage.key,
    })),
);

export function coverageCounts() {
  const all = agentResponsibilityProfiles.flatMap((profile) => profile.coverage);
  return {
    total: all.length,
    covered: all.filter((item) => ["DETERMINISTICALLY_COVERED", "PROMPT_COVERED", "APPROVED_SKILL_COVERED"].includes(item.state)).length,
    partial: all.filter((item) => item.state === "PARTIALLY_COVERED").length,
    missing: all.filter((item) => item.state === "MISSING").length,
    notApplicable: all.filter((item) => item.state === "NOT_APPLICABLE").length,
  };
}

export function createPortfolioSnapshot(evaluations: readonly SkillCandidateEvaluation[], generatedAt: string) {
  return {
    schemaVersion: 1 as const,
    policyVersion: "external-skill-curation-v1" as const,
    generatedAt,
    approvalCalled: false as const,
    assignmentsChanged: false as const,
    agents: agentResponsibilityProfiles.map((profile) => ({
      agent: profile.agentId,
      capabilities: [...profile.capabilities],
      existingApprovedSkillIds: [...profile.approvedSkills],
      coverage: profile.coverage.map((coverage) => {
        const candidates = evaluations.filter((item) => item.targetReviewer === profile.agentId && item.coverageKeys?.includes(coverage.key));
        return {
          area: coverage.key,
          coverageState: coverage.state,
          existingApprovedSkillIds: [...profile.approvedSkills].filter((skill) => coverage.evidence.includes(skill)),
          candidateIds: candidates.map((candidate) => candidate.externalSkillId),
          candidateChecksums: candidates.map((candidate) => candidate.candidateChecksum),
          recommendations: candidates.map((candidate) => candidate.recommendedDisposition),
          blockingReasons: candidates.flatMap((candidate) => candidate.reasons),
        };
      }),
    })),
  };
}
