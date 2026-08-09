# Agent Skill Portfolio Discovery — 2026-08-09

## Executive summary

- 9 agents analyzed: **9**
- Current approved external skills: **3** (module-boundaries-fb20497b5c35, acceptance-criteria-80493e317476, supabase-rls-1e36b217c969)
- Professional coverage areas identified: **43**
- Deterministic/prompt/approved-skill covered: **19**
- Partial coverage areas: **16**
- Gaps before discovery: **8 missing / 16 partial**
- skills.sh searches performed: **24**
- Detail candidates fetched: **69**
- Candidates evaluated: **69**
- Reused existing evaluations: **69**
- Rejected: **48**
- Strong candidates: **0**
- Human-review candidates: **21**
- No-suitable-candidate gaps: **11**
- Newly staged candidates: **20**
- Approved count unchanged: **3**
- Assigned count unchanged: **3**

This report is discovery and curation only. No newly discovered skill was approved, assigned, executed, rewritten, or used to change agent responsibilities or the runtime resolver. Popularity is advisory, and license evidence remains a separate human approval concern.

Availability: **AVAILABLE**. Source issues: planner/gustavogutierrez/engineering-skills/technical-planner: SKILLS_SH_CONTENT_INVALID; test-quality-reviewer/rolandwonglonam/rw-research-skill/rw-evidence-map: SKILLS_SH_CONTENT_INVALID.

## Human-review portfolio table

| Agent | Existing approved skills | Strong new candidates | Complementary candidates | Remaining gaps | Internal skill recommended? |
|---|---|---|---|---|---|
| Lead | none | — | arabelatso/skills-4-se/ambiguity-detector, fr-e-d/gaai-framework/ambiguity-detector, bendourthe/devai-hub/ambiguity-detector, bewatermyfriend7/skill-project/requirements-review, dauquangthanh/hanoi-rainbow/requirement-review, aliyun/alibabacloud-aiops-skills/alibabacloud-dts-task-query | requirements-ambiguity, requirements-completeness | No |
| Planner | none | — | — | data-modeling, technical-risk-planning | No |
| Design | none | — | thulr/informed-skills/ux-audit | responsive-design, form-ux | No |
| Implementation | none | — | — | server-client-boundaries, forms-validation, supabase-implementation, maintainable-performance | No |
| Architecture Reviewer | module-boundaries-fb20497b5c35 | — | tome-kota/agent-skill-catalog/software-design-review-router, udecode/plate/maintainability-reviewer, bradyhazell/brady-plugins/review-maintainability | architecture-tradeoffs, evolution-maintainability | Yes |
| Contract Auditor | acceptance-criteria-80493e317476 | — | nahisaho/codegraphmcpserver/traceability-auditor, 45ck/hci-review-skill/consistency-audit, hyhmrright/brooks-lint/brooks-harness | requirements-traceability-review, cross-stage-consistency | Yes |
| Code / Integration Reviewer | none | — | anyproto/anytype-ts/typescript-code-review | react-review, nextjs-review, maintainability-review | Yes |
| Security Reviewer | supabase-rls-1e36b217c969 | — | owasp/secure-agent-playbook/web-security-review, crtvrffnrt/skills/pentest-authentication-authorization-review | web-security, auth-security, storage-upload-security | Yes |
| Test / Quality Reviewer | none | — | melodic-software/claude-code-plugins/test-strategy-planning, djankies/claude-configs/reviewing-test-quality, quality-max/free-qa-skills/test-quality-review, brandondees/code-quality-atlas/reviewing-test-quality, freedomportal/ccgs-technica-edition/test-evidence-review | test-strategy, meaningful-assertions, playwright-quality, traceability-evidence | Yes |

## Lead

**Current role/capabilities:** Generation agent for clarification and an approved structured Brief. Capabilities: requirements.clarify, requirements.brief. Tasks: clarify-requirements, create-requirements-spec. Tools: openai-generation. Context: ORIGINAL_PROMPT, SUPPLIED_FILES_METADATA, CLARIFICATION_SESSION, PROJECT_BRIEF. Read-only: false.

**Current approved skills:** None

| Coverage area | Current coverage | Gap | Candidate | Recommendation |
|---|---|---|---|---|
| requirements-elicitation | PROMPT_COVERED | A reusable professional elicitation procedure is not approved. | — | No discovery required |
| requirements-ambiguity | PARTIALLY_COVERED | The Factory enforces clarification boundaries but lacks a complete ambiguity analysis method. | arabelatso/skills-4-se/ambiguity-detector, fr-e-d/gaai-framework/ambiguity-detector, bendourthe/devai-hub/ambiguity-detector | USEFUL_COMPLEMENT, USEFUL_COMPLEMENT, USEFUL_COMPLEMENT |
| requirements-completeness | PARTIALLY_COVERED | Typed completeness gates exist, but professional completeness heuristics are missing. | bewatermyfriend7/skill-project/requirements-review, dauquangthanh/hanoi-rainbow/requirement-review, aliyun/alibabacloud-aiops-skills/alibabacloud-dts-task-query | USEFUL_COMPLEMENT, USEFUL_COMPLEMENT, USEFUL_COMPLEMENT |
| intent-to-brief | DETERMINISTICALLY_COVERED | Covered by current Factory behavior. | — | No discovery required |
| non-invention | PROMPT_COVERED | A focused elicitation skill could add judgment without changing the policy. | — | No discovery required |

**Recommended portfolio additions:** arabelatso/skills-4-se/ambiguity-detector (USEFUL_COMPLEMENT), fr-e-d/gaai-framework/ambiguity-detector (USEFUL_COMPLEMENT), bendourthe/devai-hub/ambiguity-detector (USEFUL_COMPLEMENT), bewatermyfriend7/skill-project/requirements-review (USEFUL_COMPLEMENT), dauquangthanh/hanoi-rainbow/requirement-review (USEFUL_COMPLEMENT), aliyun/alibabacloud-aiops-skills/alibabacloud-dts-task-query (USEFUL_COMPLEMENT)

**Rejected/not suitable notable candidates:** None recorded.

**Remaining uncovered gaps:** requirements-ambiguity, requirements-completeness

**Internal-skill candidates:** None identified.

## Planner

**Current role/capabilities:** Generation agent for technical architecture, content planning, and asset planning. Capabilities: planning.architecture, planning.content, planning.assets. Tasks: create-technical-architecture, plan-content, plan-assets. Tools: openai-generation, context7-read. Context: PROJECT_BRIEF, CLARIFICATION_SESSION, PLANNING_PACKAGE, PREVIOUS_FINDINGS. Read-only: false.

**Current approved skills:** None

| Coverage area | Current coverage | Gap | Candidate | Recommendation |
|---|---|---|---|---|
| software-planning | PROMPT_COVERED | A focused planning procedure is not approved. | — | No discovery required |
| nextjs-architecture | PROMPT_COVERED | Current guidance is internal and not an external procedure. | — | No discovery required |
| data-modeling | PARTIALLY_COVERED | The contract captures plans, but a professional modeling method is missing. | j4flmao/agent-skills/data-modeling, ratacat/claude-skills/data-systems-architecture, e-t-y-b/etyb-skills/database-architect | REJECTED, REJECTED, REJECTED |
| auth-storage-architecture | PROMPT_COVERED | No focused external procedure is approved. | — | No discovery required |
| technical-risk-planning | PARTIALLY_COVERED | Risk identification is present in artifacts but not a dedicated procedure. | ragnarok22/agent-skills/dependency-risk-audit, s3nex-com/sdlc-skills-library/technical-risk-management | REJECTED, REJECTED |
| requirements-traceability | PROMPT_COVERED | A traceability skill may complement existing contracts. | — | No discovery required |

**Recommended portfolio additions:** None yet.

**Rejected/not suitable notable candidates:** j4flmao/agent-skills/data-modeling: Local static review found an approval-blocking unsafe instruction.; ratacat/claude-skills/data-systems-architecture: Local static review found an approval-blocking unsafe instruction.; e-t-y-b/etyb-skills/database-architect: Local static review found an approval-blocking unsafe instruction.; ragnarok22/agent-skills/dependency-risk-audit: Local static review found an approval-blocking unsafe instruction.; s3nex-com/sdlc-skills-library/technical-risk-management: Local static review found an approval-blocking unsafe instruction.

**Remaining uncovered gaps:** data-modeling, technical-risk-planning

**Internal-skill candidates:** None identified.

## Design

**Current role/capabilities:** Generation agent for design directions and selected design contracts. Capabilities: design.directions, design.selection. Tasks: create-design-directions. Tools: openai-generation. Context: PROJECT_BRIEF, PLANNING_PACKAGE, SELECTED_DESIGN, SUPPLIED_FILES_METADATA, PREVIOUS_FINDINGS. Read-only: false.

**Current approved skills:** None

| Coverage area | Current coverage | Gap | Candidate | Recommendation |
|---|---|---|---|---|
| web-ux | PROMPT_COVERED | A professional UX procedure is not approved. | — | No discovery required |
| responsive-design | PARTIALLY_COVERED | Responsive behavior is contract-aware but lacks a focused method. | canatufkansu/claude-skills/responsive-mobile-first, akillness/oh-my-skills/responsive-design, akillness/jeo-skills/responsive-design | REJECTED, REJECTED, REJECTED |
| design-systems | PROMPT_COVERED | No external design-system procedure is approved. | — | No discovery required |
| form-ux | PARTIALLY_COVERED | Form interaction guidance is not a standalone procedure. | bbeierle12/skill-mcp-claude/form-accessibility, bbeierle12/skill-mcp-claude/forms-router, thulr/informed-skills/ux-audit | REJECTED, REJECTED, USEFUL_COMPLEMENT |
| purposeful-motion | PROMPT_COVERED | No external motion procedure is approved. | — | No discovery required |

**Recommended portfolio additions:** thulr/informed-skills/ux-audit (USEFUL_COMPLEMENT)

**Rejected/not suitable notable candidates:** canatufkansu/claude-skills/responsive-mobile-first: The candidate provides limited reusable review methodology.; akillness/oh-my-skills/responsive-design: Local static review found an approval-blocking unsafe instruction.; akillness/jeo-skills/responsive-design: Local static review found an approval-blocking unsafe instruction.; bbeierle12/skill-mcp-claude/form-accessibility: Local static review found an approval-blocking unsafe instruction.; bbeierle12/skill-mcp-claude/forms-router: Local static review found an approval-blocking unsafe instruction.

**Remaining uncovered gaps:** responsive-design, form-ux

**Internal-skill candidates:** None identified.

## Implementation

**Current role/capabilities:** Implementation agent for bounded source changes, backend work, and tests. Capabilities: implementation.code, implementation.backend. Tasks: prepare-workspace, implement-project-foundation, implement-page, implement-form, implement-server-action, implement-route-handler, implement-database-schema, implement-rls-policy, implement-authentication, implement-storage, write-unit-tests, write-integration-tests, write-e2e-tests, repair-targeted-failure. Tools: openai-generation, context7-read, shadcn-registry-read, codebase-memory-read. Context: TASK_SLICE, PROJECT_BRIEF, PLANNING_PACKAGE, SELECTED_DESIGN, CODEBASE_CONTEXT, VALIDATION_DIAGNOSTIC, PREVIOUS_FINDINGS. Read-only: false.

**Current approved skills:** None

| Coverage area | Current coverage | Gap | Candidate | Recommendation |
|---|---|---|---|---|
| deterministic-change-safety | DETERMINISTICALLY_COVERED | Covered by current Factory behavior. | — | No discovery required |
| nextjs-implementation | PROMPT_COVERED | A focused implementation procedure is not approved. | — | No discovery required |
| react-typescript | PROMPT_COVERED | No external focused procedure is approved. | — | No discovery required |
| server-client-boundaries | PARTIALLY_COVERED | Internal policies exist; a bounded procedure could add implementation judgment. | jacob-balslev/skills/client-server-boundary, giuseppe-trisciuoglio/developer-kit/nextjs-code-review, gohypergiant/agent-skills/accelint-nextjs-best-practices | REJECTED, REJECTED, REJECTED |
| forms-validation | PARTIALLY_COVERED | Validation is deterministic, but form design and error-flow procedure is missing. | ovachiever/droid-tings/react-hook-form-zod, secondsky/claude-skills/react-hook-form-zod, jackspace/claudeskillz/react-hook-form-zod | REJECTED, REJECTED, REJECTED |
| supabase-implementation | PARTIALLY_COVERED | Multiple backend surfaces lack a single focused implementation method. | jst-well-dan/skill-box/supabase-postgres-best-practices, openai/plugins/supabase-postgres-best-practices, poletron/custom-rules/supabase-auth | REJECTED, REJECTED, REJECTED |
| maintainable-performance | PARTIALLY_COVERED | Incremental execution is enforced, but performance/maintainability procedure is missing. | jgamaraalv/ts-dev-kit/react-best-practices, vudovn/antigravity-kit/nextjs-react-expert, dokhacgiakhoa/antigravity-ide/nextjs-react-expert | REJECTED, REJECTED, REJECTED |
| test-aware-implementation | PROMPT_COVERED | A focused test-aware implementation skill is not approved. | — | No discovery required |

**Recommended portfolio additions:** None yet.

**Rejected/not suitable notable candidates:** jacob-balslev/skills/client-server-boundary: Local static review found an approval-blocking unsafe instruction.; giuseppe-trisciuoglio/developer-kit/nextjs-code-review: Local static review found an approval-blocking unsafe instruction.; gohypergiant/agent-skills/accelint-nextjs-best-practices: Local static review found an approval-blocking unsafe instruction.; ovachiever/droid-tings/react-hook-form-zod: Local static review found an approval-blocking unsafe instruction.; secondsky/claude-skills/react-hook-form-zod: Local static review found an approval-blocking unsafe instruction.; jackspace/claudeskillz/react-hook-form-zod: Local static review found an approval-blocking unsafe instruction.; jst-well-dan/skill-box/supabase-postgres-best-practices: Local static review found an approval-blocking unsafe instruction.; openai/plugins/supabase-postgres-best-practices: Local static review found an approval-blocking unsafe instruction.; poletron/custom-rules/supabase-auth: Local static review found an approval-blocking unsafe instruction.; jgamaraalv/ts-dev-kit/react-best-practices: Local static review found an approval-blocking unsafe instruction.; vudovn/antigravity-kit/nextjs-react-expert: Local static review found an approval-blocking unsafe instruction.; dokhacgiakhoa/antigravity-ide/nextjs-react-expert: Local static review found an approval-blocking unsafe instruction.

**Remaining uncovered gaps:** server-client-boundaries, forms-validation, supabase-implementation, maintainable-performance

**Internal-skill candidates:** None identified.

## Architecture Reviewer

**Current role/capabilities:** Read-only architecture quality reviewer. Capabilities: review.architecture. Tasks: review-architecture. Tools: openai-generation. Context: PROJECT_BRIEF, PLANNING_PACKAGE, PREVIOUS_FINDINGS. Read-only: true.

**Current approved skills:** module-boundaries-fb20497b5c35

| Coverage area | Current coverage | Gap | Candidate | Recommendation |
|---|---|---|---|---|
| module-boundaries | APPROVED_SKILL_COVERED | Covered by current Factory behavior. | — | No discovery required |
| architecture-tradeoffs | PARTIALLY_COVERED | Existing skill coverage is narrower than overall architecture quality. | tome-kota/agent-skill-catalog/software-design-review-router, gracefullight/stock-checker/oma-architecture | USEFUL_COMPLEMENT, REJECTED |
| evolution-maintainability | MISSING | No approved procedure covers evolution risk without duplicating module-boundaries. | udecode/plate/maintainability-reviewer, bradyhazell/brady-plugins/review-maintainability, openai/openai-agents-python/maintainer-review | USEFUL_COMPLEMENT, USEFUL_COMPLEMENT, REJECTED |

**Recommended portfolio additions:** tome-kota/agent-skill-catalog/software-design-review-router (USEFUL_COMPLEMENT), udecode/plate/maintainability-reviewer (USEFUL_COMPLEMENT), bradyhazell/brady-plugins/review-maintainability (USEFUL_COMPLEMENT)

**Rejected/not suitable notable candidates:** pjt222/development-guides/review-software-architecture: Local static review found an approval-blocking unsafe instruction.; gracefullight/stock-checker/oma-architecture: Local static review found an approval-blocking unsafe instruction.; openai/openai-agents-python/maintainer-review: Local static review found an approval-blocking unsafe instruction.

**Remaining uncovered gaps:** architecture-tradeoffs, evolution-maintainability

**Internal-skill candidates:** evolution-maintainability

## Contract Auditor

**Current role/capabilities:** Read-only cross-artifact contract and traceability auditor. Capabilities: review.contracts. Tasks: review-contracts. Tools: openai-generation. Context: PROJECT_BRIEF, PLANNING_PACKAGE, PREVIOUS_FINDINGS. Read-only: true.

**Current approved skills:** acceptance-criteria-80493e317476

| Coverage area | Current coverage | Gap | Candidate | Recommendation |
|---|---|---|---|---|
| acceptance-criteria | APPROVED_SKILL_COVERED | Covered by current Factory behavior. | — | No discovery required |
| requirements-traceability-review | PARTIALLY_COVERED | Acceptance criteria does not cover all cross-stage traceability. | terraphim/terraphim-skills/requirements-traceability, nahisaho/musubi/traceability-auditor, nahisaho/codegraphmcpserver/traceability-auditor | REJECTED, REJECTED, USEFUL_COMPLEMENT |
| cross-stage-consistency | MISSING | No focused external procedure is approved. | alimanjotho/open-reviewer/cross-section-consistency, 45ck/hci-review-skill/consistency-audit, hyhmrright/brooks-lint/brooks-harness | REJECTED, USEFUL_COMPLEMENT, USEFUL_COMPLEMENT |

**Recommended portfolio additions:** nahisaho/codegraphmcpserver/traceability-auditor (USEFUL_COMPLEMENT), 45ck/hci-review-skill/consistency-audit (USEFUL_COMPLEMENT), hyhmrright/brooks-lint/brooks-harness (USEFUL_COMPLEMENT)

**Rejected/not suitable notable candidates:** terraphim/terraphim-skills/requirements-traceability: Local static review found an approval-blocking unsafe instruction.; nahisaho/musubi/traceability-auditor: The candidate requires a tool that this reviewer does not possess; no permission is granted.; alimanjotho/open-reviewer/cross-section-consistency: The candidate provides limited reusable review methodology.

**Remaining uncovered gaps:** requirements-traceability-review, cross-stage-consistency

**Internal-skill candidates:** cross-stage-consistency

## Code / Integration Reviewer

**Current role/capabilities:** Read-only semantic code and integration reviewer after deterministic gates. Capabilities: review.integration. Tasks: review-code-integration. Tools: openai-generation. Context: PROJECT_BRIEF, PLANNING_PACKAGE, SELECTED_DESIGN, TASK_SLICE, CODEBASE_CONTEXT, PREVIOUS_FINDINGS. Read-only: true.

**Current approved skills:** None

| Coverage area | Current coverage | Gap | Candidate | Recommendation |
|---|---|---|---|---|
| deterministic-structural-gates | DETERMINISTICALLY_COVERED | Covered by current Factory behavior. | — | No discovery required |
| react-review | MISSING | The reviewer has no approved review-oriented procedure. | cognitedata/builder-skills/flows-code-review, existential-birds/beagle/react-flow-code-review, skills.volces.com/react-flow-code-review | REJECTED, REJECTED, REJECTED |
| nextjs-review | MISSING | The reviewer needs review procedure distinct from implementation guidance. | wsimmonds/claude-nextjs-skills/nextjs-server-client-components, alpoxdev/hypercore/nextjs-architecture | REJECTED, REJECTED |
| maintainability-review | PARTIALLY_COVERED | Role policy exists, but no focused checklist is approved. | anyproto/anytype-ts/typescript-code-review, exploration-labs/typescript-code-review/typescript-code-review, cr0wg4n/dev-skills/ts-code-review | USEFUL_COMPLEMENT, REJECTED, REJECTED |

**Recommended portfolio additions:** anyproto/anytype-ts/typescript-code-review (USEFUL_COMPLEMENT)

**Rejected/not suitable notable candidates:** cognitedata/builder-skills/flows-code-review: Local static review found an approval-blocking unsafe instruction.; existential-birds/beagle/react-flow-code-review: Local static review found an approval-blocking unsafe instruction.; skills.volces.com/react-flow-code-review: Local static review found an approval-blocking unsafe instruction.; wsimmonds/claude-nextjs-skills/nextjs-server-client-components: Local static review found an approval-blocking unsafe instruction.; borghei/claude-skills/senior-frontend: Local static review found an approval-blocking unsafe instruction.; alpoxdev/hypercore/nextjs-architecture: Local static review found an approval-blocking unsafe instruction.; exploration-labs/typescript-code-review/typescript-code-review: Local static review found an approval-blocking unsafe instruction.; cr0wg4n/dev-skills/ts-code-review: Local static review found an approval-blocking unsafe instruction.

**Remaining uncovered gaps:** react-review, nextjs-review, maintainability-review

**Internal-skill candidates:** react-review, nextjs-review

## Security Reviewer

**Current role/capabilities:** Read-only contextual application security reviewer. Capabilities: review.security. Tasks: review-security. Tools: openai-generation. Context: PROJECT_BRIEF, PLANNING_PACKAGE, SELECTED_DESIGN, TASK_SLICE, CODEBASE_CONTEXT, PREVIOUS_FINDINGS. Read-only: true.

**Current approved skills:** supabase-rls-1e36b217c969

| Coverage area | Current coverage | Gap | Candidate | Recommendation |
|---|---|---|---|---|
| rls-security | APPROVED_SKILL_COVERED | Covered by current Factory behavior. | — | No discovery required |
| web-security | MISSING | RLS is not general application security coverage. | owasp/secure-agent-playbook/web-security-review, ahmedhamadto/software-forge/web-app-security-audit, shipshitdev/library/security-audit | USEFUL_COMPLEMENT, REJECTED, REJECTED |
| auth-security | PARTIALLY_COVERED | Internal policy exists but no focused security procedure is approved. | smithery.ai/reviewing-authentication-and-authorization-security, crtvrffnrt/skills/pentest-authentication-authorization-review, cosai-oasis/project-codeguard/software-security | REJECTED, USEFUL_COMPLEMENT, REJECTED |
| storage-upload-security | MISSING | No approved focused procedure covers these surfaces. | smithery.ai/supabase-storage, devfellowship/skills/supabase-upload, nzaidev/ai-security-skills/review-data-security | REJECTED, REJECTED, REJECTED |

**Recommended portfolio additions:** owasp/secure-agent-playbook/web-security-review (USEFUL_COMPLEMENT), crtvrffnrt/skills/pentest-authentication-authorization-review (USEFUL_COMPLEMENT)

**Rejected/not suitable notable candidates:** ahmedhamadto/software-forge/web-app-security-audit: Local static review found an approval-blocking unsafe instruction.; shipshitdev/library/security-audit: Local static review found an approval-blocking unsafe instruction.; smithery.ai/reviewing-authentication-and-authorization-security: The candidate requires a tool that this reviewer does not possess; no permission is granted.; cosai-oasis/project-codeguard/software-security: Local static review found an approval-blocking unsafe instruction.; smithery.ai/supabase-storage: The candidate provides limited reusable review methodology.; devfellowship/skills/supabase-upload: Local static review found an approval-blocking unsafe instruction.; nzaidev/ai-security-skills/review-data-security: Local static review found an approval-blocking unsafe instruction.

**Remaining uncovered gaps:** web-security, auth-security, storage-upload-security

**Internal-skill candidates:** web-security, storage-upload-security

## Test / Quality Reviewer

**Current role/capabilities:** Read-only semantic test and quality evidence reviewer after deterministic gates. Capabilities: review.test-quality. Tasks: review-test-quality. Tools: openai-generation. Context: PROJECT_BRIEF, PLANNING_PACKAGE, SELECTED_DESIGN, TASK_SLICE, VALIDATION_DIAGNOSTIC, PREVIOUS_FINDINGS. Read-only: true.

**Current approved skills:** None

| Coverage area | Current coverage | Gap | Candidate | Recommendation |
|---|---|---|---|---|
| deterministic-quality-gates | DETERMINISTICALLY_COVERED | Covered by current Factory behavior. | — | No discovery required |
| test-strategy | MISSING | No approved review/strategy procedure exists. | wojons/skills/testing-level-selector, melodic-software/claude-code-plugins/test-strategy-planning, cosmicstack-labs/mercury-agent-skills/test-strategy | REJECTED, USEFUL_COMPLEMENT, REJECTED |
| meaningful-assertions | MISSING | No focused review procedure is approved. | djankies/claude-configs/reviewing-test-quality, quality-max/free-qa-skills/test-quality-review, brandondees/code-quality-atlas/reviewing-test-quality | USEFUL_COMPLEMENT, USEFUL_COMPLEMENT, USEFUL_COMPLEMENT |
| playwright-quality | PARTIALLY_COVERED | Execution policy exists, but review methodology is missing. | alirezarezvani/claude-skills/review, borghei/claude-skills/playwright-pro | REJECTED, REJECTED |
| traceability-evidence | PARTIALLY_COVERED | Traceability is present but not a dedicated testing method. | freedomportal/ccgs-technica-edition/test-evidence-review, kw12121212/auto-spec-driven/spec-driven-resync-code-mapping | USEFUL_COMPLEMENT, REJECTED |

**Recommended portfolio additions:** melodic-software/claude-code-plugins/test-strategy-planning (USEFUL_COMPLEMENT), djankies/claude-configs/reviewing-test-quality (USEFUL_COMPLEMENT), quality-max/free-qa-skills/test-quality-review (USEFUL_COMPLEMENT), brandondees/code-quality-atlas/reviewing-test-quality (USEFUL_COMPLEMENT), freedomportal/ccgs-technica-edition/test-evidence-review (USEFUL_COMPLEMENT)

**Rejected/not suitable notable candidates:** wojons/skills/testing-level-selector: Local static review found an approval-blocking unsafe instruction.; cosmicstack-labs/mercury-agent-skills/test-strategy: The candidate provides limited reusable review methodology.; alirezarezvani/claude-skills/review: Local static review found an approval-blocking unsafe instruction.; borghei/claude-skills/playwright-pro: Local static review found an approval-blocking unsafe instruction.; kw12121212/auto-spec-driven/spec-driven-resync-code-mapping: Local static review found an approval-blocking unsafe instruction.

**Remaining uncovered gaps:** test-strategy, meaningful-assertions, playwright-quality, traceability-evidence

**Internal-skill candidates:** test-strategy, meaningful-assertions

## Global candidate table

| External skill ID | Source | Checksum | Target agent | Coverage keys | Normalized size | Security | Tool assumptions | Overlap | License evidence | Metadata | Recommendation |
|---|---|---|---|---|---:|---|---|---|---|---|---|
| arabelatso/skills-4-se/ambiguity-detector | arabelatso/skills-4-se | 97a4b4b0aab7b1fbe2876ce4947cc3b8ff673cd56938cecd8cf9c47bfe79cf99 | Lead | requirements-ambiguity | 33583 | PASS | compatible | low | MISSING | INCOMPLETE | USEFUL_COMPLEMENT |
| fr-e-d/gaai-framework/ambiguity-detector | fr-e-d/gaai-framework | 421b7a8270a82b26ce7a2bfa2172d1833880a6accedcc1ab28249df5e7e1a0e6 | Lead | requirements-ambiguity | 18273 | PASS | read-only-compatible | low | MISSING | INCOMPLETE | USEFUL_COMPLEMENT |
| bendourthe/devai-hub/ambiguity-detector | bendourthe/devai-hub | 2836130c234fa3bd86d8768720e2d604e0ea9432f954b0439cc3905c696dfdf6 | Lead | requirements-ambiguity | 23113 | PASS | read-only-compatible | low | MISSING | INCOMPLETE | USEFUL_COMPLEMENT |
| bewatermyfriend7/skill-project/requirements-review | bewatermyfriend7/skill-project | 211f16e3d782614fd84d02ae6f10e1a62cb3a787e00ae590d2af13d694cf59ae | Lead | requirements-completeness | 1102 | PASS | compatible | low | MISSING | INCOMPLETE | USEFUL_COMPLEMENT |
| dauquangthanh/hanoi-rainbow/requirement-review | dauquangthanh/hanoi-rainbow | 3422b7bdd82c844322cc8f7042cf7d056dd3a5653d085043e9efaec4b5b368f7 | Lead | requirements-completeness | 67002 | PASS | read-only-compatible | low | MISSING | INCOMPLETE | USEFUL_COMPLEMENT |
| aliyun/alibabacloud-aiops-skills/alibabacloud-dts-task-query | aliyun/alibabacloud-aiops-skills | 1301b829d1595c2687206134b825718251655173112c6bda9b815b6bbd5d2659 | Lead | requirements-completeness | 13642 | PASS | read-only-compatible | low | MISSING | INCOMPLETE | USEFUL_COMPLEMENT |
| j4flmao/agent-skills/data-modeling | j4flmao/agent-skills | 08b6820778dbeb3ba2a2e21b0161b867c37071ea3f6597171c3c398f1c5f877d | Planner | data-modeling | 539172 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| ratacat/claude-skills/data-systems-architecture | ratacat/claude-skills | 899a534d478c57718e12fabb4d559efeeaf65638c4e7a22c01a0a9e898690f26 | Planner | data-modeling | 5400 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| e-t-y-b/etyb-skills/database-architect | e-t-y-b/etyb-skills | f8f886d0376eecfd24058faafe29c8e9fc40f704beaf53e49dbb13e2ff5a6454 | Planner | data-modeling | 276774 | FAIL | incompatible | low | MISSING | INCOMPLETE | REJECTED |
| ragnarok22/agent-skills/dependency-risk-audit | ragnarok22/agent-skills | 3891f25a39ae72094ffc6d27835d6752456bc37ed974720c537678a0a611e805 | Planner | technical-risk-planning | 4560 | FAIL | incompatible | low | MISSING | INCOMPLETE | REJECTED |
| s3nex-com/sdlc-skills-library/technical-risk-management | s3nex-com/sdlc-skills-library | a6805393dc146d15864639f556ae79ca59622e7a7d38861d32f69c913d36e836 | Planner | technical-risk-planning | 35882 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| canatufkansu/claude-skills/responsive-mobile-first | canatufkansu/claude-skills | 2d154fcb5e45cd2be0572dc4a2fa3698e98352b0515adfa9e9edb6efbba2977b | Design | responsive-design | 8266 | PASS | compatible | low | MISSING | INCOMPLETE | REJECTED |
| akillness/oh-my-skills/responsive-design | akillness/oh-my-skills | 4a9161756734ab560e91b5b4803f1e04842deac109174c71ae04a9169ee8176c | Design | responsive-design | 17999 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| akillness/jeo-skills/responsive-design | akillness/jeo-skills | ae53865c8a0552311a2102078f143daa2465f937e31f3b69160ff8738ab0b6d7 | Design | responsive-design | 17999 | FAIL | read-only-compatible | high | MISSING | INCOMPLETE | REJECTED |
| bbeierle12/skill-mcp-claude/form-accessibility | bbeierle12/skill-mcp-claude | e92c6ab18caaa191219364ffd06498781941bad94ce140ef1b3a5fabfa64b21e | Design | form-ux | 13345 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| bbeierle12/skill-mcp-claude/forms-router | bbeierle12/skill-mcp-claude | eb83dfd2941b7cdb7614cce22d8b1f5c29f7b8c8af496e5c45d52188537ffcf9 | Design | form-ux | 51480 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| thulr/informed-skills/ux-audit | thulr/informed-skills | c0256ce0c905965df930fb8191dc7690a816ac52184a3f6104e3a035f791f83f | Design | form-ux | 21352 | PASS | read-only-compatible | low | MISSING | INCOMPLETE | USEFUL_COMPLEMENT |
| jacob-balslev/skills/client-server-boundary | jacob-balslev/skills | e6db1e3f641e17dd90910eb114eb49c35460508424550b57c7d1ba43064c60b7 | Implementation | server-client-boundaries | 37012 | FAIL | incompatible | low | MISSING | INCOMPLETE | REJECTED |
| giuseppe-trisciuoglio/developer-kit/nextjs-code-review | giuseppe-trisciuoglio/developer-kit | 7130ce311d4285325fead89597648ea6e75433ed8727ed3c5ba071728c45e1c0 | Implementation | server-client-boundaries | 28327 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| gohypergiant/agent-skills/accelint-nextjs-best-practices | gohypergiant/agent-skills | 9cc2da20a3c73a5445f9ba0f612747570045610016ec60caeb84964e68cb3c2b | Implementation | server-client-boundaries | 43711 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| ovachiever/droid-tings/react-hook-form-zod | ovachiever/droid-tings | f7edd25532cd958d7971c8afa09274efbcc5c5db27dc56f8ae11c210c6d328d3 | Implementation | forms-validation | 93039 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| secondsky/claude-skills/react-hook-form-zod | secondsky/claude-skills | a3941cda43047d2c898cc7ab3b10622ccabae9046c918f0584a8ddba6b35e1f2 | Implementation | forms-validation | 74078 | FAIL | read-only-compatible | high | MISSING | INCOMPLETE | REJECTED |
| jackspace/claudeskillz/react-hook-form-zod | jackspace/claudeskillz | 6fac72a3c13794d99cb49afbd3c0d2fd7f4f857d9d4f8f18677ec4f0fb49a2ad | Implementation | forms-validation | 38918 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| jst-well-dan/skill-box/supabase-postgres-best-practices | jst-well-dan/skill-box | 762ac79b0708e824b88d25131cbaf7a372ce0ad6ef510f0e393b51954401184d | Implementation | supabase-implementation | 15319 | FAIL | incompatible | low | MISSING | INCOMPLETE | REJECTED |
| openai/plugins/supabase-postgres-best-practices | openai/plugins | 89ba68dfec725dff1685ee6504a4089686c9e5656d9c333da6ae4c815e1aac10 | Implementation | supabase-implementation | 15318 | FAIL | incompatible | high | MISSING | INCOMPLETE | REJECTED |
| poletron/custom-rules/supabase-auth | poletron/custom-rules | 0299ca330f5ac6ead7b4470397d3ffac71e0d753a0fc5778f93ed7fbb929b0bb | Implementation | supabase-implementation | 5353 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| jgamaraalv/ts-dev-kit/react-best-practices | jgamaraalv/ts-dev-kit | 3320a8fa2ad4ff89faa2987f00b72c9dab96b624de0d3694ced03c9e7602b952 | Implementation | maintainable-performance | 48607 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| vudovn/antigravity-kit/nextjs-react-expert | vudovn/antigravity-kit | 483398ac6549e4efe8a7faa6242e91494748650786eec5cd9e172468443f390d | Implementation | maintainable-performance | 10500 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| dokhacgiakhoa/antigravity-ide/nextjs-react-expert | dokhacgiakhoa/antigravity-ide | 8089ed1f6069761ecee7437c35369afd85537688548110bd1bcac40e651c67cd | Implementation | maintainable-performance | 6864 | FAIL | read-only-compatible | high | MISSING | INCOMPLETE | REJECTED |
| pjt222/development-guides/review-software-architecture | pjt222/development-guides | 80450d9dd75f875c634ae8a7e0daadea54f863afee812dfaec3f35938cc2d7f4 | Architecture Reviewer | unmapped | 11930 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| tome-kota/agent-skill-catalog/software-design-review-router | tome-kota/agent-skill-catalog | 2ae0bdbda83a95cb5c365292874e149963a5d683975e4266e4ef31807ca0845d | Architecture Reviewer | architecture-tradeoffs | 51098 | PASS | read-only-compatible | low | MISSING | INCOMPLETE | USEFUL_COMPLEMENT |
| gracefullight/stock-checker/oma-architecture | gracefullight/stock-checker | c40282a83a740e9898af83fbcd1e6060a4c82725b1a61cf25bb091c590995936 | Architecture Reviewer | architecture-tradeoffs | 8474 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| udecode/plate/maintainability-reviewer | udecode/plate | 9a52700e12fee1a4c52ec377c095c7d2be58595ac859df6920de4b38686a37cd | Architecture Reviewer | evolution-maintainability | 3906 | PASS | read-only-compatible | low | MISSING | INCOMPLETE | USEFUL_COMPLEMENT |
| bradyhazell/brady-plugins/review-maintainability | bradyhazell/brady-plugins | 4d178cfce7746577253c9addcb2648ceb1c5d3237ff32357a0b382df019ca7f9 | Architecture Reviewer | evolution-maintainability | 2056 | PASS | compatible | low | MISSING | INCOMPLETE | USEFUL_COMPLEMENT |
| openai/openai-agents-python/maintainer-review | openai/openai-agents-python | 9d8ff1553dfd7e5d78561bfde442242e1f15479200245b812a421d565fc67c72 | Architecture Reviewer | evolution-maintainability | 52019 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| terraphim/terraphim-skills/requirements-traceability | terraphim/terraphim-skills | d98903887a317796e749cc1ec6ce2934983eac50d888138a41135fd27e4ce8ef | Contract Auditor | requirements-traceability-review | 5557 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| nahisaho/musubi/traceability-auditor | nahisaho/musubi | c04a0e5b3f094ec2f6b3a7dcef60dd745e66118c4b6c9a76af8d880dcc9e3236 | Contract Auditor | requirements-traceability-review | 12004 | PASS | incompatible | low | MISSING | INCOMPLETE | REJECTED |
| nahisaho/codegraphmcpserver/traceability-auditor | nahisaho/codegraphmcpserver | 06ac9d4788a8797a1cb25f5c68abcda69757c093839a9ca6a50555d6b943dc68 | Contract Auditor | requirements-traceability-review | 12014 | PASS | read-only-compatible | low | MISSING | INCOMPLETE | USEFUL_COMPLEMENT |
| alimanjotho/open-reviewer/cross-section-consistency | alimanjotho/open-reviewer | dfebf054b957c58815d4b7505a1882ac376d9d65b301e07d560c18c9488062ba | Contract Auditor | cross-stage-consistency | 265 | PASS | compatible | low | MISSING | INCOMPLETE | REJECTED |
| 45ck/hci-review-skill/consistency-audit | 45ck/hci-review-skill | 6c58e1cef30659fb4040d93ba4084314799b9cd5eafcebf3f72712e392cf241c | Contract Auditor | cross-stage-consistency | 1496 | PASS | compatible | low | MISSING | INCOMPLETE | USEFUL_COMPLEMENT |
| hyhmrright/brooks-lint/brooks-harness | hyhmrright/brooks-lint | 22874b3c2546d8b7826a952e049cbf5956d037c7eb62e7272e122d7f15b94ccd | Contract Auditor | cross-stage-consistency | 7369 | PASS | read-only-compatible | low | MISSING | INCOMPLETE | USEFUL_COMPLEMENT |
| cognitedata/builder-skills/flows-code-review | cognitedata/builder-skills | 54d1b1eba29e9e1f426d5bef8c2a9aeed8ebc0d993d7ca6d1da81eed29432a9c | Code / Integration Reviewer | react-review | 19370 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| existential-birds/beagle/react-flow-code-review | existential-birds/beagle | 5c9bbd296c68d0e6170cc4c3aececa200dc4f59aa46b3ebe11525da07c6fdf62 | Code / Integration Reviewer | react-review | 6729 | FAIL | compatible | low | MISSING | INCOMPLETE | REJECTED |
| skills.volces.com/react-flow-code-review | skills.volces.com | 0e7054cf2f0c0fd53155324e28c0cbc1bc1fbb697505323ff2099e5ab5731ae2 | Code / Integration Reviewer | react-review | 6728 | FAIL | compatible | high | MISSING | INCOMPLETE | REJECTED |
| wsimmonds/claude-nextjs-skills/nextjs-server-client-components | wsimmonds/claude-nextjs-skills | 947f5f299032949c97cfea09337c308b0a339d3d7e8a259a21b7756af9eec792 | Code / Integration Reviewer | nextjs-review | 23964 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| borghei/claude-skills/senior-frontend | borghei/claude-skills | 96f731dfaa2dda2728a057bacb04e4fd9bae4e49752835886909dd3739751ae6 | Code / Integration Reviewer | unmapped | 77080 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| alpoxdev/hypercore/nextjs-architecture | alpoxdev/hypercore | a04526365b2a02b018a42ffd6accdef810c948792bcaf0244f188d9fa486a6c1 | Code / Integration Reviewer | nextjs-review | 50096 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| anyproto/anytype-ts/typescript-code-review | anyproto/anytype-ts | 93a905f92c8962ded53021de9c7f3ee124f781bca6e7f44013863576e42cd224 | Code / Integration Reviewer | maintainability-review | 9904 | PASS | compatible | low | MISSING | INCOMPLETE | USEFUL_COMPLEMENT |
| exploration-labs/typescript-code-review/typescript-code-review | exploration-labs/typescript-code-review | e891d4854c6f595568b57ff9f71a524e8da77af097853f654654e0a7c1cc30b8 | Code / Integration Reviewer | maintainability-review | 73061 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| cr0wg4n/dev-skills/ts-code-review | cr0wg4n/dev-skills | 97e4ad314da874930fb6b49030a68ae8cd3e6ec081a73dc1360572ba5bc1cf75 | Code / Integration Reviewer | maintainability-review | 4816 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| owasp/secure-agent-playbook/web-security-review | owasp/secure-agent-playbook | 8b280a3ab13567cadde2c114fffe5c5a00dd2841c229114abf14ddf0880e8012 | Security Reviewer | web-security | 2696 | PASS | compatible | low | MISSING | INCOMPLETE | USEFUL_COMPLEMENT |
| ahmedhamadto/software-forge/web-app-security-audit | ahmedhamadto/software-forge | 5f2379d53288aa64e8d4774542f6b555324730133c0d3b94b2afac87d1cb8708 | Security Reviewer | web-security | 20340 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| shipshitdev/library/security-audit | shipshitdev/library | bc0dfe730f480beadbea3a9535c43bd71fe55748ac45c39007a51733d020770c | Security Reviewer | web-security | 4904 | FAIL | compatible | low | MISSING | INCOMPLETE | REJECTED |
| smithery.ai/reviewing-authentication-and-authorization-security | smithery.ai | 5da812d65bccaccf3d30f4ffd7048a9b6369f29795665538eee6b44a8f318f9d | Security Reviewer | auth-security | 8066 | PASS | incompatible | low | MISSING | INCOMPLETE | REJECTED |
| crtvrffnrt/skills/pentest-authentication-authorization-review | crtvrffnrt/skills | c7f043d7eb72a10df43e65848135bd4e1f82479dd9e5de04028d9a30fe89167a | Security Reviewer | auth-security | 2401 | PASS | compatible | low | MISSING | INCOMPLETE | USEFUL_COMPLEMENT |
| cosai-oasis/project-codeguard/software-security | cosai-oasis/project-codeguard | 75ea7dc09aa632b100e0d103418cdb3661ad128120f77ea4694c8543b6f1333f | Security Reviewer | auth-security | 9677 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| smithery.ai/supabase-storage | smithery.ai | d748a47f303fb34f54cc2685562964c512f099664948279e8a50b36768d2cf98 | Security Reviewer | storage-upload-security | 5893 | PASS | compatible | low | MISSING | INCOMPLETE | REJECTED |
| devfellowship/skills/supabase-upload | devfellowship/skills | 973e678e8725e18d27c452ac89c11d314e6e209bcd9712069c82419c7965ea41 | Security Reviewer | storage-upload-security | 4471 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| nzaidev/ai-security-skills/review-data-security | nzaidev/ai-security-skills | cbf3f4e17b88abf4d3c35b2c85c07d4297bc64560da7354ef469ffce6289a472 | Security Reviewer | storage-upload-security | 11581 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| wojons/skills/testing-level-selector | wojons/skills | 0fa4c491a27eba774a236bf57e00ff89abfbc61b34ac4a1eb4897f8a1a0cddf8 | Test / Quality Reviewer | test-strategy | 4245 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| melodic-software/claude-code-plugins/test-strategy-planning | melodic-software/claude-code-plugins | e515844c490051b6bede8b107bcd90507bd22e69930a0c8d6cd4f3797a5b2023 | Test / Quality Reviewer | test-strategy | 8542 | PASS | read-only-compatible | low | MISSING | INCOMPLETE | USEFUL_COMPLEMENT |
| cosmicstack-labs/mercury-agent-skills/test-strategy | cosmicstack-labs/mercury-agent-skills | eb6ab4a6cb70625948ee7f58fad4ca69efa3d5e1f367c71c30a85f03a206dd68 | Test / Quality Reviewer | test-strategy | 1704 | PASS | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| djankies/claude-configs/reviewing-test-quality | djankies/claude-configs | 7678ee0541450cce390b5a8b5bdacc93d2878451c087969856ccb250b4f38a08 | Test / Quality Reviewer | meaningful-assertions | 1961 | PASS | compatible | low | MISSING | INCOMPLETE | USEFUL_COMPLEMENT |
| quality-max/free-qa-skills/test-quality-review | quality-max/free-qa-skills | 135e36724e9cdd8ca20ccf183b0fe8259f6cc48bb1b3885a6b0f02daaf16f7e4 | Test / Quality Reviewer | meaningful-assertions | 2596 | PASS | read-only-compatible | low | MISSING | INCOMPLETE | USEFUL_COMPLEMENT |
| brandondees/code-quality-atlas/reviewing-test-quality | brandondees/code-quality-atlas | 0e1d07a5e076d293425fb436a7eb876d6e0d017db39b178c81f9970cbb43b9e8 | Test / Quality Reviewer | meaningful-assertions | 6646 | PASS | read-only-compatible | low | MISSING | INCOMPLETE | USEFUL_COMPLEMENT |
| alirezarezvani/claude-skills/review | alirezarezvani/claude-skills | 19df6603409642a94c74648e244fd3646cb8510de668851c202f9d45afef6760 | Test / Quality Reviewer | playwright-quality | 3091 | FAIL | read-only-compatible | low | MISSING | INCOMPLETE | REJECTED |
| borghei/claude-skills/playwright-pro | borghei/claude-skills | 86d536d7f84dcf3ff9f0ce29e1f782a4f4bb0c9ca4d709bc3f1d452454bc40c1 | Test / Quality Reviewer | playwright-quality | 29074 | FAIL | incompatible | low | MISSING | INCOMPLETE | REJECTED |
| freedomportal/ccgs-technica-edition/test-evidence-review | freedomportal/ccgs-technica-edition | 4f8252a9559e99740692666ec7603bbb53998b2b8ffe81dfde8553f31c769123 | Test / Quality Reviewer | traceability-evidence | 8978 | PASS | compatible | low | MISSING | INCOMPLETE | USEFUL_COMPLEMENT |
| kw12121212/auto-spec-driven/spec-driven-resync-code-mapping | kw12121212/auto-spec-driven | a215e18b485458fb966bcc384ebcd4b9a333f7bec9e01289169bee51ea91336c | Test / Quality Reviewer | traceability-evidence | 7734 | FAIL | compatible | low | MISSING | INCOMPLETE | REJECTED |

## HUMAN DECISION REQUIRED

### A. Strong recommended external candidates
- None

### B. Useful complementary candidates
- arabelatso/skills-4-se/ambiguity-detector → Lead (requirements-ambiguity)
- fr-e-d/gaai-framework/ambiguity-detector → Lead (requirements-ambiguity)
- bendourthe/devai-hub/ambiguity-detector → Lead (requirements-ambiguity)
- bewatermyfriend7/skill-project/requirements-review → Lead (requirements-completeness)
- dauquangthanh/hanoi-rainbow/requirement-review → Lead (requirements-completeness)
- aliyun/alibabacloud-aiops-skills/alibabacloud-dts-task-query → Lead (requirements-completeness)
- thulr/informed-skills/ux-audit → Design (form-ux)
- tome-kota/agent-skill-catalog/software-design-review-router → Architecture Reviewer (architecture-tradeoffs)
- udecode/plate/maintainability-reviewer → Architecture Reviewer (evolution-maintainability)
- bradyhazell/brady-plugins/review-maintainability → Architecture Reviewer (evolution-maintainability)
- nahisaho/codegraphmcpserver/traceability-auditor → Contract Auditor (requirements-traceability-review)
- 45ck/hci-review-skill/consistency-audit → Contract Auditor (cross-stage-consistency)
- hyhmrright/brooks-lint/brooks-harness → Contract Auditor (cross-stage-consistency)
- anyproto/anytype-ts/typescript-code-review → Code / Integration Reviewer (maintainability-review)
- owasp/secure-agent-playbook/web-security-review → Security Reviewer (web-security)
- crtvrffnrt/skills/pentest-authentication-authorization-review → Security Reviewer (auth-security)
- melodic-software/claude-code-plugins/test-strategy-planning → Test / Quality Reviewer (test-strategy)
- djankies/claude-configs/reviewing-test-quality → Test / Quality Reviewer (meaningful-assertions)
- quality-max/free-qa-skills/test-quality-review → Test / Quality Reviewer (meaningful-assertions)
- brandondees/code-quality-atlas/reviewing-test-quality → Test / Quality Reviewer (meaningful-assertions)
- freedomportal/ccgs-technica-edition/test-evidence-review → Test / Quality Reviewer (traceability-evidence)

### C. Needs manual inspection
- arabelatso/skills-4-se/ambiguity-detector
- fr-e-d/gaai-framework/ambiguity-detector
- bendourthe/devai-hub/ambiguity-detector
- bewatermyfriend7/skill-project/requirements-review
- dauquangthanh/hanoi-rainbow/requirement-review
- aliyun/alibabacloud-aiops-skills/alibabacloud-dts-task-query
- thulr/informed-skills/ux-audit
- tome-kota/agent-skill-catalog/software-design-review-router
- udecode/plate/maintainability-reviewer
- bradyhazell/brady-plugins/review-maintainability
- nahisaho/codegraphmcpserver/traceability-auditor
- 45ck/hci-review-skill/consistency-audit
- hyhmrright/brooks-lint/brooks-harness
- anyproto/anytype-ts/typescript-code-review
- owasp/secure-agent-playbook/web-security-review
- crtvrffnrt/skills/pentest-authentication-authorization-review
- melodic-software/claude-code-plugins/test-strategy-planning
- djankies/claude-configs/reviewing-test-quality
- quality-max/free-qa-skills/test-quality-review
- brandondees/code-quality-atlas/reviewing-test-quality
- freedomportal/ccgs-technica-edition/test-evidence-review

### D. No suitable external candidate — internal skill recommended
- data-modeling: The contract captures plans, but a professional modeling method is missing.
- technical-risk-planning: Risk identification is present in artifacts but not a dedicated procedure.
- responsive-design: Responsive behavior is contract-aware but lacks a focused method.
- server-client-boundaries: Internal policies exist; a bounded procedure could add implementation judgment.
- forms-validation: Validation is deterministic, but form design and error-flow procedure is missing.
- supabase-implementation: Multiple backend surfaces lack a single focused implementation method.
- maintainable-performance: Incremental execution is enforced, but performance/maintainability procedure is missing.
- react-review: The reviewer has no approved review-oriented procedure.
- nextjs-review: The reviewer needs review procedure distinct from implementation guidance.
- storage-upload-security: No approved focused procedure covers these surfaces.
- playwright-quality: Execution policy exists, but review methodology is missing.

### E. Rejected
- j4flmao/agent-skills/data-modeling: Local static review found an approval-blocking unsafe instruction.
- ratacat/claude-skills/data-systems-architecture: Local static review found an approval-blocking unsafe instruction.
- e-t-y-b/etyb-skills/database-architect: Local static review found an approval-blocking unsafe instruction.
- ragnarok22/agent-skills/dependency-risk-audit: Local static review found an approval-blocking unsafe instruction.
- s3nex-com/sdlc-skills-library/technical-risk-management: Local static review found an approval-blocking unsafe instruction.
- canatufkansu/claude-skills/responsive-mobile-first: The candidate provides limited reusable review methodology.
- akillness/oh-my-skills/responsive-design: Local static review found an approval-blocking unsafe instruction.
- akillness/jeo-skills/responsive-design: Local static review found an approval-blocking unsafe instruction.
- bbeierle12/skill-mcp-claude/form-accessibility: Local static review found an approval-blocking unsafe instruction.
- bbeierle12/skill-mcp-claude/forms-router: Local static review found an approval-blocking unsafe instruction.
- jacob-balslev/skills/client-server-boundary: Local static review found an approval-blocking unsafe instruction.
- giuseppe-trisciuoglio/developer-kit/nextjs-code-review: Local static review found an approval-blocking unsafe instruction.
- gohypergiant/agent-skills/accelint-nextjs-best-practices: Local static review found an approval-blocking unsafe instruction.
- ovachiever/droid-tings/react-hook-form-zod: Local static review found an approval-blocking unsafe instruction.
- secondsky/claude-skills/react-hook-form-zod: Local static review found an approval-blocking unsafe instruction.
- jackspace/claudeskillz/react-hook-form-zod: Local static review found an approval-blocking unsafe instruction.
- jst-well-dan/skill-box/supabase-postgres-best-practices: Local static review found an approval-blocking unsafe instruction.
- openai/plugins/supabase-postgres-best-practices: Local static review found an approval-blocking unsafe instruction.
- poletron/custom-rules/supabase-auth: Local static review found an approval-blocking unsafe instruction.
- jgamaraalv/ts-dev-kit/react-best-practices: Local static review found an approval-blocking unsafe instruction.
- vudovn/antigravity-kit/nextjs-react-expert: Local static review found an approval-blocking unsafe instruction.
- dokhacgiakhoa/antigravity-ide/nextjs-react-expert: Local static review found an approval-blocking unsafe instruction.
- pjt222/development-guides/review-software-architecture: Local static review found an approval-blocking unsafe instruction.
- gracefullight/stock-checker/oma-architecture: Local static review found an approval-blocking unsafe instruction.
- openai/openai-agents-python/maintainer-review: Local static review found an approval-blocking unsafe instruction.
- terraphim/terraphim-skills/requirements-traceability: Local static review found an approval-blocking unsafe instruction.
- nahisaho/musubi/traceability-auditor: The candidate requires a tool that this reviewer does not possess; no permission is granted.
- alimanjotho/open-reviewer/cross-section-consistency: The candidate provides limited reusable review methodology.
- cognitedata/builder-skills/flows-code-review: Local static review found an approval-blocking unsafe instruction.
- existential-birds/beagle/react-flow-code-review: Local static review found an approval-blocking unsafe instruction.
- skills.volces.com/react-flow-code-review: Local static review found an approval-blocking unsafe instruction.
- wsimmonds/claude-nextjs-skills/nextjs-server-client-components: Local static review found an approval-blocking unsafe instruction.
- borghei/claude-skills/senior-frontend: Local static review found an approval-blocking unsafe instruction.
- alpoxdev/hypercore/nextjs-architecture: Local static review found an approval-blocking unsafe instruction.
- exploration-labs/typescript-code-review/typescript-code-review: Local static review found an approval-blocking unsafe instruction.
- cr0wg4n/dev-skills/ts-code-review: Local static review found an approval-blocking unsafe instruction.
- ahmedhamadto/software-forge/web-app-security-audit: Local static review found an approval-blocking unsafe instruction.
- shipshitdev/library/security-audit: Local static review found an approval-blocking unsafe instruction.
- smithery.ai/reviewing-authentication-and-authorization-security: The candidate requires a tool that this reviewer does not possess; no permission is granted.
- cosai-oasis/project-codeguard/software-security: Local static review found an approval-blocking unsafe instruction.
- smithery.ai/supabase-storage: The candidate provides limited reusable review methodology.
- devfellowship/skills/supabase-upload: Local static review found an approval-blocking unsafe instruction.
- nzaidev/ai-security-skills/review-data-security: Local static review found an approval-blocking unsafe instruction.
- wojons/skills/testing-level-selector: Local static review found an approval-blocking unsafe instruction.
- cosmicstack-labs/mercury-agent-skills/test-strategy: The candidate provides limited reusable review methodology.
- alirezarezvani/claude-skills/review: Local static review found an approval-blocking unsafe instruction.
- borghei/claude-skills/playwright-pro: Local static review found an approval-blocking unsafe instruction.
- kw12121212/auto-spec-driven/spec-driven-resync-code-mapping: Local static review found an approval-blocking unsafe instruction.

## Phase invariants and audit

- Existing approved skills remain exactly: module-boundaries, acceptance-criteria, supabase-rls.
- Existing assignments remain exactly 3; all nine catalog definitions retain their existing allowlist field.
- No fixed skill-count quota was introduced; discovery is driven by missing or partial coverage only.
- No runtime selection/resolver redesign, new agent, orchestrator, MCP integration, fallback source, dependency install, external content execution, or production website-generation E2E was performed.
- Live query strings: `requirements ambiguity detection`, `requirements completeness review`, `PostgreSQL data modeling planning`, `technical risk dependency planning`, `responsive web design mobile first`, `accessible form UX`, `Next.js server client boundary review implementation`, `React forms Zod validation`, `Supabase Postgres auth storage implementation`, `React Next.js performance maintainable code`, `software architecture tradeoffs review`, `architecture evolution maintainability review`, `requirements traceability audit`, `cross stage contract consistency audit`, `React code review component data flow`, `Next.js code integration review server client`, `TypeScript maintainability code review`, `web application security review`, `web authentication authorization security review`, `Supabase storage upload security review`, `test strategy requirement based testing`, `meaningful assertions test quality review`, `Playwright integration test quality review`, `requirements to test evidence mapping`
