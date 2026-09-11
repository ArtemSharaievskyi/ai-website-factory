# Agent architecture

> Status: CURRENT_ARCHITECTURE
> Authority: This document describes the current typed agent architecture. `src/agents/catalog.ts`, typed domain contracts, and runtime validators enforce behavior; this Markdown is descriptive and not runtime authority.

Production provider calls are server-only adapters behind the existing role ports; deterministic providers remain available for offline tests. Prompt text and prompt versions remain owned by `src/integrations/openai/prompts.ts`; the catalog records that ownership and the provider adapter owns transport and normalization.

The current typed flow is:

`user/workflow requirement -> capability -> AgentDefinition -> bounded context/tools/approved skills -> typed result`

The catalog currently contains the foundation definitions, one deterministic pre-implementation Security Threat Model Agent, and fifteen deterministic post-implementation reviewers. The historical Phase 4D4 skill portfolio remains scoped to the nine skill-managed foundation agents; the lightweight reviewers intentionally have no approved procedural skills.

| Agent | Role | Current capabilities | Write authority |
| --- | --- | --- | --- |
| Lead | generation | `requirements.clarify`, `requirements.brief` | requirements and workflow documents through its service |
| Planner | generation | `planning.architecture`, `planning.content`, `planning.assets` | planning package through its service |
| Design | generation | `design.directions`, `design.selection` | design documents and selection through its service |
| Implementation | implementation | `implementation.code`, `implementation.backend`, `implementation.seo` | one reservation-owned implementation task at a time; SEO remains bounded to the existing Implementation Agent |
| Architecture Reviewer | review | `review.architecture` | read-only review result; module boundaries, maintainability, and architecture tradeoffs |
| Contract Auditor | review | `review.contracts` | read-only review result; acceptance criteria and shared traceability |
| Code / Integration Reviewer | review | `review.integration` | read-only review result; React/Next integration |
| Security Threat Model Agent | review | `review.security-threat-model` | read-only, deterministic pre-implementation threat model after approved Architecture |
| Security Reviewer | review | `review.security` | read-only review result; Supabase RLS and auth/storage when relevant |
| Test / Quality Reviewer | review | `review.test-quality` | read-only review result; shared traceability and behavioral test quality |
| Browser QA Agent | review | `review.browser-qa` | read-only browser/runtime evidence review |
| Security Test Agent | review | `review.security-test` | read-only bounded non-destructive security probes against an authorized test boundary |
| German Web Compliance Agent | review | `review.german-web-compliance` | read-only, capability-driven German legal/currentness and implementation evidence review |
| Exploratory QA Agent | review | `review.exploratory-qa` | read-only bounded edge-case and recovery evidence review |
| UX Critic Agent | review | `review.ux-critic` | read-only independent clarity, friction, recovery, and mobile critique |
| Product Critic Agent | review | `review.product-critic` | read-only Brief, audience, outcome, and scope critique |
| Architecture Critic Agent | review | `review.architecture-critic` | read-only independent architecture challenge before implementation and against the implementation snapshot |
| Accessibility Review Agent | review | `review.accessibility` | read-only WCAG-oriented evidence review |
| Performance Review Agent | review | `review.performance` | read-only build, bundle, rendering, and layout evidence review |
| Visual Regression Agent | review | `review.visual-regression` | read-only approved-Design comparison |
| Release Readiness Agent | review | `review.release-readiness` | read-only typed evidence aggregator |
| SEO Review Agent | review | `review.seo` | conditional read-only public/indexability review |
| Content Quality Agent | review | `review.content-quality` | conditional read-only provenance and placeholder review |
| Dependency Guardian Agent | review | `review.dependencies` | conditional read-only dependency-delta review |
| Documentation Agent | review | `review.documentation` | conditional, path-bounded documentation-only mutation when explicitly authorized |

The role boundaries are:

1. **Lead Agent** communicates with the user, extracts requirements, asks every unresolved question, creates the final brief, and requests approval. It does not write production code.
2. **Planner / Architect Agent** creates product, UX, technical, content, and asset plans within the fixed stack. It does not add infrastructure without requirements.
3. **Design Agent** prepares exactly three structured visual directions, may later use approved Magic Patterns integration, does not design backend architecture, and waits for selection before production implementation.
4. **Implementation Agent** executes one READY implementation task at a time in a reservation-owned staging workspace using bounded context, approved skills, and task-specific internal filesystem capabilities. It applies deterministic structured proposals only; full autonomous generation remains future work.
5. **Architecture Reviewer** reviews an approved Brief and accepted PlanningPackage before Design. It combines deterministic prechecks with bounded AI architectural reasoning, returns an evidence-backed `ReviewResult`, and cannot modify project artifacts.
6. **Contract Auditor** reviews the final Brief → Planning → approved Architecture Review → selected Design → TaskGraph chain before implementation. It checks traceability, ownership, capabilities, executors, dependencies, and mandatory quality responsibilities; it does not re-review architecture taste or mutate any artifact.

The workflow gates are `Planning Acceptance -> ARCHITECTURE_REVIEW -> Design -> Design Selection -> Orchestrator/TaskGraph -> CONTRACT_AUDIT -> approved Architecture Critic and Security Threat Model -> START_IMPLEMENTATION`, followed by `CODE_INTEGRATION_REVIEW -> SECURITY_REVIEW -> bounded SecurityTest/ExploratoryQA -> GermanWebCompliance/SEO/critics -> VALIDATING -> TEST_QUALITY_REVIEW -> release qualification`. An approved Architecture Review unlocks Design; an approved current Contract Audit, checksum-consistent with all upstream artifacts, plus the pre-implementation assurance gates, unlocks implementation; current Code / Integration, Security, deterministic quality, legal, SEO, critic, and Test / Quality approvals are required before release. Reviewers return findings and correction targets; orchestration owns transitions and remediation.

## Permissions and policy

Agent tools are explicit integration IDs; the lightweight layer reuses `playwright-functional-qa` and `generated-runtime-validation` where evidence capture requires them. Agent definitions do not inherit wildcard tools or capabilities. Skills are separate approved procedural context. Phase 4D4 assigns explicit role-appropriate portfolios to the nine skill-managed agents; the portfolio has no fixed one-skill or top-K quota, and the shared traceability procedure remains one artifact with multi-reviewer applicability. The three deferred external candidates remain inactive. `src/agents/catalog.ts` is the sole current assignment authority; this document, curation plans, and admin portfolio snapshots are derived views and never grant runtime eligibility. The dedicated `skills.sh` source adapter is administrative read-only infrastructure documented in [skills.sh source integration](../integrations/skills-sh-source.md); it never approves or assigns skills.

Each definition declares a versioned context policy with allowed categories, item and byte limits, plus an execution policy covering AI-generation permission, retry class, cancellation, concurrency, approval gates, and read-only status. Input and output contracts reference the existing typed agent schemas, while prompt versioning is tracked independently from context and execution policy versions. The Architecture Reviewer receives only the approved Brief, accepted PlanningPackage, fixed architecture policy, and bounded constraints.

The current review capabilities are `review.architecture`, `review.contracts`, `review.integration`, `review.security`, `review.security-threat-model`, `review.security-test`, `review.german-web-compliance`, `review.exploratory-qa`, `review.ux-critic`, `review.product-critic`, `review.architecture-critic`, `review.test-quality`, `review.browser-qa`, `review.accessibility`, `review.performance`, `review.visual-regression`, `review.release-readiness`, `review.seo`, `review.content-quality`, `review.dependencies`, and `review.documentation`.

Skills provide reviewed specialization to roles; they do not replace the Orchestrator. External discovery follows `skills.sh -> bounded fetch -> STAGING -> deterministic validation/static review -> explicit approval -> checksum-bound immutable copy`. At invocation, the resolver evaluates zero, one, or multiple approved candidates by capability, task type, project surface, coverage, overlap/conflict, tool authority, and shared context budget. It uses stable priority/ID ordering and no fixed maximum or top-K quota. Selected checksums form the procedural context identity used for reviewer idempotency/staleness. Agents must not install arbitrary skills, change requirements, invent facts, or broaden infrastructure.
Context7 is a replaceable documentation port at the Planner and Implementation context seams, not an Orchestrator or general MCP layer.

The Phase 7B host tooling boundary is documented in [developer-tooling-capability-layer.md](developer-tooling-capability-layer.md). It derives task capabilities from the current TaskGraph, keeps agent permissions in `AgentDefinition.allowedTools`, and routes only bounded registered operations to trusted existing integrations. It does not grant direct filesystem mutation or unrestricted command authority.

The Code / Integration Reviewer is a read-only semantic gate after implementation structural validation, lint, and typecheck. It receives only bounded source manifests/slices and canonical contract checksums, persists evidence-backed findings, and never writes source or invokes Implementation.

The Test / Quality Reviewer is documented in [test-quality-reviewer.md](test-quality-reviewer.md). It runs after current lint, typecheck, unit-test, build, and Functional QA evidence exists. Its bounded `QualityEvidenceSummary` traces approved requirements to implementation responsibility and executed evidence. Deterministic prerequisites establish currentness and pass/fail facts; semantic review considers meaningful assertions, important flows, success/error outcomes, risk-scaled coverage, and Playwright scenario sufficiency. It does not write tests, run validators, invent requirements, or demand numeric coverage. Corrections route to existing test/QA or implementation ownership, with at most two bounded cycles. Application-source changes stale source-bound quality and semantic reviews; test-only changes preserve unchanged application reviews when checksums prove that boundary.

The lightweight post-implementation layer is implemented under `src/agents/reviewers/lightweight/`. Host-owned activation derives required reviewers from approved project capabilities, materializes a snapshot-bound review TaskGraph, runs deterministic read-only inspections with bounded parallelism, and lets Release Readiness aggregate only same-checksum results and quality gates. The pre-implementation Security Threat Model Agent and conditional Architecture Critic are separate deterministic read-only gates after approved Architecture; their typed results are retained with the implementation TaskGraph. Security probes and exploratory scenarios are target-bounded, timeout/request-budget limited, require staging authorization where applicable, and are non-destructive. German compliance consumes current official-source snapshots, an implementation-derived processing inventory, and technical consent evidence without fabricating legal/business facts. Findings correlate by boundary, route, operation, and invariant before becoming `RepairIncident` inputs for the existing Safe Repair pipeline; legal missing facts and upstream architecture deficiencies use explicit non-repair escalations. No lightweight reviewer owns canonical writes; DocumentationAgent is limited to explicitly authorized `README.md`, `docs/**`, and `.env.example` paths. SEO implementation remains a bounded capability of the existing Implementation Agent and is independently reviewed by SEOReviewAgent.

The shadcn Registry is a replaceable implementation-reference port, not a Design Agent, Orchestrator, installer, or general remote executor.
