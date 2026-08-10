# Factory self-review evidence reconciliation â€” 2026-08-10

## Result

Phase 5.3 reconciled exactly 10 invalid Run 3 records. The six Design evidence sets have deterministic line-reference candidates, but the preserved Run 3 machine artifacts do not include their semantic finding bodies. The four remaining records also lack safe complete evidence sets. No successor was promoted and no targeted GPT call was made. The original 31 validated findings remain unchanged.

**Phase 5 status:** COMPLETE_FINDINGS_READY
**Next:** Phase 6 â€” Controlled Factory Corrections (not started)
**Source Run 3:** 950bc148572f7b8ff1079dbcb2fab1b7c4c58886c63f5bf6ea1537344392054d
**Review target:** 96d9ebc25c09fe1fb83338e8c7a1fa989fc3d9f4
**Evidence manifest:** 427863061b650425431f5538b130e513e049a931eb44c29ed12c0dad36a38c08

## Reconciliation table

| Original finding | Reviewer | Original evidence problem | Deterministic repair | Targeted review? | Final outcome | Final evidence |
|---|---|---|---|---|---|---|
| contract-audit-001 | contract-auditor | PATH_FORMAT_INVALID | src/agents/design/service.ts:validateInput â†’ src/agents/design/service.ts:107; src/agents/design/contracts.ts:DesignAgentInputSchema â†’ src/agents/design/contracts.ts:9 | no | REJECTED_UNSUPPORTED | src/agents/design/service.ts:validateInput â†’ src/agents/design/service.ts:107; src/agents/design/contracts.ts:DesignAgentInputSchema â†’ src/agents/design/contracts.ts:9 |
| contract-audit-002 | contract-auditor | PATH_FORMAT_INVALID | src/agents/design/deterministic.ts:buildDesignDirectionSet â†’ src/agents/design/deterministic.ts:22; src/agents/design/design.test.ts:accepts a text wordmark without a logo file and preserves its policy â†’ src/agents/design/design.test.ts:32; src/agents/design/design.test.ts:does not treat explicit no-logo fixture facts as supplied branding â†’ src/agents/design/design.test.ts:30 | no | REJECTED_UNSUPPORTED | src/agents/design/deterministic.ts:buildDesignDirectionSet â†’ src/agents/design/deterministic.ts:22; src/agents/design/design.test.ts:accepts a text wordmark without a logo file and preserves its policy â†’ src/agents/design/design.test.ts:32; src/agents/design/design.test.ts:does not treat explicit no-logo fixture facts as supplied branding â†’ src/agents/design/design.test.ts:30 |
| contract-audit-003 | contract-auditor | PATH_FORMAT_INVALID | src/agents/design/deterministic.ts:directionReference â†’ src/agents/design/deterministic.ts:11; src/agents/design/deterministic.ts:buildDesignDirectionSet â†’ src/agents/design/deterministic.ts:22; src/agents/design/contracts.ts:DesignAgentInputSchema â†’ src/agents/design/contracts.ts:9 | no | REJECTED_UNSUPPORTED | src/agents/design/deterministic.ts:directionReference â†’ src/agents/design/deterministic.ts:11; src/agents/design/deterministic.ts:buildDesignDirectionSet â†’ src/agents/design/deterministic.ts:22; src/agents/design/contracts.ts:DesignAgentInputSchema â†’ src/agents/design/contracts.ts:9 |
| contract-audit-004 | contract-auditor | PATH_FORMAT_INVALID | src/agents/design/contracts.ts:DesignAgentInputSchema â†’ src/agents/design/contracts.ts:9; src/agents/design/service.ts:validateInput â†’ src/agents/design/service.ts:107; src/agents/design/deterministic.ts:buildDesignDirectionSet â†’ src/agents/design/deterministic.ts:22 | no | REJECTED_UNSUPPORTED | src/agents/design/contracts.ts:DesignAgentInputSchema â†’ src/agents/design/contracts.ts:9; src/agents/design/service.ts:validateInput â†’ src/agents/design/service.ts:107; src/agents/design/deterministic.ts:buildDesignDirectionSet â†’ src/agents/design/deterministic.ts:22 |
| contract-audit-005 | contract-auditor | PATH_FORMAT_INVALID | src/agents/design/contracts.ts:DesignAgentInputSchema â†’ src/agents/design/contracts.ts:9; src/agents/design/service.ts:validateInput â†’ src/agents/design/service.ts:107 | no | REJECTED_UNSUPPORTED | src/agents/design/contracts.ts:DesignAgentInputSchema â†’ src/agents/design/contracts.ts:9; src/agents/design/service.ts:validateInput â†’ src/agents/design/service.ts:107 |
| contract-audit-006 | contract-auditor | PATH_FORMAT_INVALID | src/agents/design/contracts.ts:DesignAgentInputSchema â†’ src/agents/design/contracts.ts:9; src/agents/design/service.ts:DesignAgentService â†’ src/agents/design/service.ts:61 | no | REJECTED_UNSUPPORTED | src/agents/design/contracts.ts:DesignAgentInputSchema â†’ src/agents/design/contracts.ts:9; src/agents/design/service.ts:DesignAgentService â†’ src/agents/design/service.ts:61 |
| cross-type-overlapping-exclusive-scopes-unchecked | contract-auditor | PATH_FORMAT_INVALID, EVIDENCE_NOT_IN_SCOPE_PACK | src/agents/reviewers/contracts/deterministic.ts:53-54 â†’ src/agents/reviewers/contracts/deterministic.ts:53-54 | no | REJECTED_OUT_OF_SCOPE | src/agents/reviewers/contracts/deterministic.ts:53-54 â†’ src/agents/reviewers/contracts/deterministic.ts:53-54 |
| code-review-workflow-state-not-enforced | code-integration-reviewer | PATH_FORMAT_INVALID | none | no | REJECTED_UNSUPPORTED | none; semantic payload not retained |
| source-evidence-not-bound-to-current-source | code-integration-reviewer | PATH_FORMAT_INVALID | src/agents/reviewers/code-integration/contracts.ts#SourceManifestEntrySchema â†’ src/agents/reviewers/code-integration/contracts.ts:12; src/agents/reviewers/code-integration/contracts.ts#SourceSliceSchema â†’ src/agents/reviewers/code-integration/contracts.ts:13 | no | REJECTED_UNSUPPORTED | src/agents/reviewers/code-integration/contracts.ts#SourceManifestEntrySchema â†’ src/agents/reviewers/code-integration/contracts.ts:12; src/agents/reviewers/code-integration/contracts.ts#SourceSliceSchema â†’ src/agents/reviewers/code-integration/contracts.ts:13 |
| implementation-summaries-not-connected-to-source-or-task-ownership | code-integration-reviewer | PATH_FORMAT_INVALID | src/agents/reviewers/code-integration/contracts.ts#ImplementationTaskSummarySchema â†’ src/agents/reviewers/code-integration/contracts.ts:15 | no | REJECTED_UNSUPPORTED | src/agents/reviewers/code-integration/contracts.ts#ImplementationTaskSummarySchema â†’ src/agents/reviewers/code-integration/contracts.ts:15 |

The missing semantic payload is recorded as an artifact-integrity limitation, not as a claim that the model observations were false. The rejected records remain historical and are excluded from Phase 6 correction input.

## Final counts

| Metric | Count |
|---|---:|
| AI-produced semantic records in Run 3 | 41 (31 valid + 10 invalid IDs) |
| Original validated / correction-ready | 31 |
| Reconciled valid successors | 0 |
| Rejected unsupported | 9 |
| Rejected out of scope | 1 |
| Rejected hallucinated reference | 0 |
| Remaining unresolved invalid | 0 |

### Per reviewer

| Reviewer | Original valid | Original invalid | Reconciled valid | Rejected | Final correction-ready |
|---|---:|---:|---:|---:|---:|
| Architecture | 11 | 0 | 0 | 0 | 11 |
| Contract | 2 | 7 | 0 | 7 | 2 |
| Code / Integration | 2 | 3 | 0 | 3 | 2 |
| Security | 8 | 0 | 0 | 0 | 8 |
| Test / Quality | 8 | 0 | 0 | 0 | 8 |

### Final master findings

The following table is the authoritative correction-ready set. It contains only the immutable original 31; REFERENCE_REPAIRED and TARGETED_REVIEW rows are absent because no invalid semantic payload was safely promotable.

| ID | Reviewer | Severity | Subsystem | Finding | Evidence | Validation source | Phase 6 priority |
|---|---|---|---|---|---|---|---|
| finding-0590fb313e72090696f0 | security-reviewer | ERROR | security | The deterministic authentication artifact always returns null, so an authentication-required task can produce no usable authenticated identity. | src/agents/implementation/provider.ts:25, src/agents/implementation/backend.ts:31 | ORIGINAL | HIGH_PRIORITY |
| finding-0e21399a0a91b82a05dc | contract-auditor | ERROR | contracts | The architecture reviewerâ€™s canonical evidence set exposes only a subset of approved Brief fields, so material requirements cannot be cited or semantically audited at the architecture boundary. | src/agents/reviewers/architecture/deterministic.ts:12-24, src/agents/reviewers/architecture/service.ts:225-260 | ORIGINAL | HIGH_PRIORITY |
| finding-0ec8a840d7bf928fec42 | test-quality-reviewer | WARNING | tests | Implementation proposal validation is tested, while the atomic file-application failure and recovery behavior has no supplied test evidence. | src/agents/implementation/applier.ts:15-33, src/agents/implementation/backend.test.ts:8-21 | ORIGINAL | NORMAL_PRIORITY |
| finding-1540c99220f633245955 | architecture-reviewer | WARNING | architecture | DesignAgentService keeps workflow and idempotency state in process-local Maps despite having persistence repositories and memory synchronization ports. | src/agents/design/service.ts:34-50, src/agents/design/service.ts:200-260 | ORIGINAL | NORMAL_PRIORITY |
| finding-191200ccc58b25e3fd0c | test-quality-reviewer | WARNING | tests | Opt-in integration smoke scripts do not provide executed runtime evidence. | scripts/ai-smoke.ts:1-14, scripts/context7-smoke.ts:1-17, scripts/codebase-memory-smoke.ts:1-18, scripts/generated-runtime-smoke.ts:1-31 | ORIGINAL | NORMAL_PRIORITY |
| finding-20662816cdabed08871f | architecture-reviewer | WARNING | architecture | Context7 dependency eligibility is governed by multiple independently maintained lists. | src/integrations/context7/policy.ts:3-13, src/integrations/context7/service.ts:9-18, src/integrations/context7/contracts.ts:17-20 | ORIGINAL | NORMAL_PRIORITY |
| finding-233d7f1502c96cf535e1 | security-reviewer | CRITICAL | security | The generated RLS policy allows every authenticated user to select every row. | src/agents/implementation/provider.ts:22, src/agents/implementation/backend.ts:29, src/agents/implementation/backend.test.ts:17 | ORIGINAL | BLOCKING_FOR_PHASE_6 |
| finding-2484a19307c1536e12e7 | architecture-reviewer | INFO | architecture | The Architecture Reviewer contract requires an approved Brief and accepted PlanningPackage, but the supplied evidence pack contains architecture documentation only and no project-specific Brief or PlanningPackage. | docs/architecture/architecture-reviewer.md:8-12, AGENTS.md:1-29 | ORIGINAL | INFORMATIONAL |
| finding-24cb4b563e9b341a84fd | architecture-reviewer | ERROR | architecture | The OpenAI provider can be constructed with an empty model identifier. | src/integrations/openai/config.ts:4-12, src/integrations/openai/production.ts:1-7, src/integrations/openai/client.ts:22-32 | ORIGINAL | HIGH_PRIORITY |
| finding-3ea29b90bbf550eecdb3 | architecture-reviewer | WARNING | architecture | Configured concurrency limits do not necessarily bound active external work after timeout. | src/integrations/codebase-memory/service.ts:38-41, src/integrations/context7/service.ts:30-39, src/integrations/openai/client.ts:24-32 | ORIGINAL | NORMAL_PRIORITY |
| finding-3ee5bcff808135a21217 | architecture-reviewer | WARNING | architecture | Reviewer skill portfolio claims are inconsistent: the repository rules describe complete portfolio activation across all nine agents, while the Architecture Reviewer definition explicitly declares no skills. | AGENTS.md:20-20, docs/architecture/agent-architecture.md:35-35, docs/architecture/architecture-reviewer.md:20-22 | ORIGINAL | NORMAL_PRIORITY |
| finding-4970556ab704416b2bf8 | test-quality-reviewer | ERROR | tests | Release-critical browser behavior has no execution evidence. | package.json:1-64, scripts/factory-e2e-smoke.ts:1-36 | ORIGINAL | HIGH_PRIORITY |
| finding-4bba2d52b86f240393fc | architecture-reviewer | WARNING | architecture | The deterministic design provider uses module-global mutable generationSalt and a module-load now value, coupling otherwise independent requests through shared runtime state. | src/agents/design/deterministic.ts:6-8 | ORIGINAL | NORMAL_PRIORITY |
| finding-517e635c9c23995687d8 | code-integration-reviewer | WARNING | implementation | Real factory E2E failures after runtime creation can leave the runtime unclosed. | scripts/factory-e2e-smoke.ts:15-35 | ORIGINAL | NORMAL_PRIORITY |
| finding-51d38dcb2b668ff33332 | test-quality-reviewer | ERROR | tests | Reviewer services are identified and cataloged, but their review execution and output-contract behavior are not meaningfully verified. | src/agents/catalog.test.ts:5-74, src/agents/catalog.ts:82-129, src/agents/design/service.ts:132-260 | ORIGINAL | HIGH_PRIORITY |
| finding-5f4cd4a958172b921dfd | architecture-reviewer | WARNING | architecture | Several architecture documents mix current-state and planned-state descriptions without an explicit supersession marker, making repository boundaries and implemented capability difficult to determine. | docs/architecture/product-specification.md:3-16, docs/architecture/implementation-roadmap.md:7-23, docs/architecture/repository-structure.md:51-53, docs/architecture/agent-architecture.md:1-12 | ORIGINAL | NORMAL_PRIORITY |
| finding-601d85f09cdb45d46400 | test-quality-reviewer | WARNING | tests | Backend smoke evidence validates proposal acceptance rather than runtime backend behavior. | scripts/backend-smoke.ts:1-23 | ORIGINAL | NORMAL_PRIORITY |
| finding-7586dd5bd4661d954bf4 | security-reviewer | ERROR | security | The generated schema has no ownership column, while the RLS validator only checks that RLS is enabled and rejects broad true predicates; this does not establish row-level ownership authorization. | src/agents/implementation/provider.ts:22, src/agents/implementation/backend.ts:29 | ORIGINAL | BLOCKING_FOR_PHASE_6 |
| finding-865697184809f419d1b7 | security-reviewer | WARNING | security | The supplied RLS implementation example allows every authenticated user to select all rows via auth.uid() is not null. Whether this is an authorization defect is contract-dependent because no ownership or audience policy is included in the supplied evidence. | src/agents/implementation/backend.ts:1-40, src/agents/implementation/provider.ts:1-32 | ORIGINAL | BLOCKING_FOR_PHASE_6 |
| finding-9106112c9ba65e4be7ed | architecture-reviewer | WARNING | architecture | Query index selection can be ambiguous when more than one workspace path exists for the same project version. | src/integrations/codebase-memory/service.ts:35-41, src/integrations/codebase-memory/contracts.ts:7-26, src/integrations/codebase-memory/policy.ts:25-28 | ORIGINAL | NORMAL_PRIORITY |
| finding-b227589f057cc3fa00ac | security-reviewer | ERROR | security | The storage artifact only validates a caller-supplied type prefix and numeric size; it does not perform an upload or establish bucket, object ownership, access, or signed-URL controls. | src/agents/implementation/provider.ts:1-32, src/agents/implementation/backend.ts:1-40 | ORIGINAL | HIGH_PRIORITY |
| finding-b385146a5a20fb3e4f1b | contract-auditor | CRITICAL | contracts | The downstream input schemas accept multiple canonical artifacts with independently valid checksums but do not themselves bind those artifacts to the same project and version; checksum validation proves document integrity, not cross-artifact identity. | src/agents/reviewers/contracts/contracts.ts:11-16, src/agents/reviewers/contracts/deterministic.ts:24-28, src/agents/reviewers/code-integration/contracts.ts:12-16, src/agents/reviewers/code-integration/deterministic.ts:5-16, src/agents/reviewers/code-integration/service.ts:65-83 | ORIGINAL | BLOCKING_FOR_PHASE_6 |
| finding-bf13a0c6f16bf4702e9e | test-quality-reviewer | WARNING | tests | Several design gate and contract failure paths are implemented but lack direct quality evidence. | src/agents/design/contracts.ts:1-24, src/agents/design/service.ts:68-130, src/agents/design/design.test.ts:24-42 | ORIGINAL | NORMAL_PRIORITY |
| finding-c200a7f61e715bc94be1 | security-reviewer | ERROR | security | The authentication implementation is only a stub: getAuthenticatedUser() always returns null, so no authenticated principal or session verification is established. | src/agents/implementation/provider.ts:1-32, src/agents/implementation/backend.ts:1-40 | ORIGINAL | HIGH_PRIORITY |
| finding-c94e4c6dd19f957eeb40 | code-integration-reviewer | ERROR | implementation | Database configuration failures bypass the scripts' safe error-propagation path. | scripts/db-common.mjs:18-26, scripts/db-migrate.mjs:8-9, scripts/db-status.mjs:2-2, scripts/db-verify.mjs:3-3, scripts/db-smoke.ts:18-18 | ORIGINAL | BLOCKING_FOR_PHASE_6 |
| finding-cec06a12d17a2b103135 | test-quality-reviewer | ERROR | tests | Persistence and migration assertions are defined but not evidenced as executed. | scripts/db-smoke.ts:1-41, scripts/db-verify.mjs:1-22, scripts/db-migrate.mjs:1-26 | ORIGINAL | HIGH_PRIORITY |
| finding-e055bfdcbad92c9b36eb | security-reviewer | ERROR | security | Authorization is not enforced as a mandatory runtime boundary. The validator only checks for authorization patterns conditionally, while the deterministic Server Action and Route Handler contain input validation but no authentication or authorization checks. | src/agents/implementation/backend.ts:1-40, src/agents/implementation/provider.ts:1-32 | ORIGINAL | BLOCKING_FOR_PHASE_6 |
| finding-eb166a34da7872c62d77 | security-reviewer | WARNING | security | The generated storage implementation only checks MIME type and size; no bucket access policy or user-scoped object authorization is evidenced. | src/agents/implementation/provider.ts:28, src/agents/implementation/backend.ts:34 | ORIGINAL | BLOCKING_FOR_PHASE_6 |
| finding-efa4502938176a741e32 | architecture-reviewer | ERROR | architecture | Design persistence is split across database and filesystem paths, while the injected DecisionRepository is unused by DesignMemoryAdapter. | src/agents/design/memory.ts:7-12, src/agents/design/server.ts:7, src/agents/design/service.ts:4-9 | ORIGINAL | HIGH_PRIORITY |
| finding-f13df5392f71f7cf58df | architecture-reviewer | WARNING | architecture | Project Memory defines metadata but the service stores indexes, cache, and idempotency state only in process memory. | src/integrations/codebase-memory/service.ts:13-41, src/integrations/codebase-memory/metadata.ts:1-5 | ORIGINAL | NORMAL_PRIORITY |
| finding-f27b5098995ae5bb44c9 | test-quality-reviewer | ERROR | tests | No test artifacts or recorded test results are included in the review evidence. | package.json:1-64 | ORIGINAL | HIGH_PRIORITY |

## Phase 6 handoff preview

The handoff contains validated finding IDs only. Every group requires current-HEAD applicability verification because the review target is 96d9ebc25c09fe1fb83338e8c7a1fa989fc3d9f4 and the current HEAD contains later self-review infrastructure changes. No correction tasks or ChangeProposals were created.

| Group | Finding IDs | Highest severity | Subsystem | Likely correction owner | Dependencies |
|---|---|---|---|---|---|
| phase6-trust-boundaries-and-authorization | finding-0590fb313e72090696f0, finding-233d7f1502c96cf535e1, finding-7586dd5bd4661d954bf4, finding-865697184809f419d1b7, finding-b227589f057cc3fa00ac, finding-c200a7f61e715bc94be1, finding-e055bfdcbad92c9b36eb, finding-eb166a34da7872c62d77 | CRITICAL | authentication, storage, Supabase/RLS and server-client boundaries | security-reviewer / security capability | verify current-head applicability; confirm current contract and identity bindings |
| phase6-cross-artifact-contract-identity | finding-0e21399a0a91b82a05dc, finding-2484a19307c1536e12e7, finding-9106112c9ba65e4be7ed, finding-b385146a5a20fb3e4f1b, finding-bf13a0c6f16bf4702e9e, finding-f27b5098995ae5bb44c9 | CRITICAL | canonical artifacts, reviewer contracts and traceability | contract-auditor / contracts capability | verify current-head applicability; resolve upstream artifact identity before downstream corrections |
| phase6-runtime-and-provider-integration | finding-517e635c9c23995687d8, finding-c94e4c6dd19f957eeb40 | ERROR | provider, orchestration, persistence and generated-runtime integration | code-integration-reviewer / integration capability | verify current-head applicability; apply contract-boundary decisions first |
| phase6-quality-and-release-evidence | finding-0ec8a840d7bf928fec42, finding-191200ccc58b25e3fd0c, finding-4970556ab704416b2bf8, finding-51d38dcb2b668ff33332, finding-601d85f09cdb45d46400, finding-bf13a0c6f16bf4702e9e, finding-cec06a12d17a2b103135, finding-f27b5098995ae5bb44c9 | ERROR | deterministic gates, behavioral tests and release evidence | test-quality-reviewer / test-quality capability | verify current-head applicability; correct contract and integration prerequisites first |
| phase6-architecture-ownership-and-maintainability | finding-1540c99220f633245955, finding-20662816cdabed08871f, finding-2484a19307c1536e12e7, finding-24cb4b563e9b341a84fd, finding-3ea29b90bbf550eecdb3, finding-3ee5bcff808135a21217, finding-4bba2d52b86f240393fc, finding-5f4cd4a958172b921dfd, finding-9106112c9ba65e4be7ed, finding-efa4502938176a741e32, finding-f13df5392f71f7cf58df | ERROR | agent, orchestration, runtime, persistence and integration ownership | architecture-reviewer / architecture capability | verify current-head applicability; establish cross-artifact identity and trust boundaries first |

## Contract and provenance audit

- Evidence contract: the production validator accepts only repository-relative path:start-end references; Run 3 accepted the model's unconstrained string schema and later rejected symbol-style references deterministically. This is a producer/validator contract mismatch, not a line-number bug.
- Line semantics: references are 1-based and inclusive, and the original pack uses full-file line positions for its first 260-line excerpt.
- No source, manifest, skill, AgentDefinition, provider, prompt, TaskGraph, or ChangeProposal was changed.
- Original Run 3 artifacts and invalid records are preserved.
- Approved skills remain external 4, internal 13, unique 17, assignment refs 18; deferred skill usage 0; skills.sh calls 0.

## Validation ledger

The repository validation commands are recorded in the final handoff. QA temporary directories were preserved; the final count is 12.

## Completion ledger

1. Baseline commit: 3e4fb08.
2. Reconciliation run: f71ce5fa4c8d5ee3e281c4c3fd2d1183451929e7eb01ab3bf3639d34a388ac29.
3. Source Run 3: 950bc148572f7b8ff1079dbcb2fab1b7c4c58886c63f5bf6ea1537344392054d.
4. Review target: 96d9ebc25c09fe1fb83338e8c7a1fa989fc3d9f4.
5. Evidence manifest: 427863061b650425431f5538b130e513e049a931eb44c29ed12c0dad36a38c08.
6. Original validated findings: 31.
7. Original invalid findings: 10.
8. PATH_NOT_FOUND: 0.
9. PATH_FORMAT_INVALID: 10.
10. Line-range invalid: 0.
11. Scope-pack mismatch: 1.
12. Manifest/checksum mismatch: 0.
13. Hallucinated reference: 0.
14. Other failure classes: 0.
15. Evidence contract mismatch: yes.
16. Contract defect: unconstrained model evidence strings versus path:start-end harness validation.
17. Validator/harness changed: reconciliation guard only; original validator unchanged.
18. Exact fix: immutable manifest/pack validation, safe path normalization, deterministic repair audit, and regression tests.
19. Deterministic repair candidates: 6 findings / 19 reference candidates.
20. Deterministically promoted: 0.
21. VALIDATED_ORIGINAL: 0.
22. VALIDATED_REFERENCE_REPAIRED: 0.
23. Targeted findings required: 0.
24. Targeted calls attempted: 0.
25. Targeted calls successful: 0.
26. Targeted calls failed: 0.
27. VALIDATED_BY_TARGETED_REVIEW: 0.
28. REJECTED_UNSUPPORTED: 9.
29. REJECTED_OUT_OF_SCOPE: 1.
30. REJECTED_HALLUCINATED_REFERENCE: 0.
31. RECONCILIATION_EXECUTION_FAILED: 0.
32. Remaining unresolved invalid: 0.
33. Final validated findings: 31.
34. Final severity counts: CRITICAL 2, ERROR 13, WARNING 15, INFO 1.
35. Architecture: 11 valid / 0 invalid / 0 reconciled / 0 rejected / 11 final.
36. Contract: 2 valid / 7 invalid / 0 reconciled / 7 rejected / 2 final.
37. Code / Integration: 2 valid / 3 invalid / 0 reconciled / 3 rejected / 2 final.
38. Security: 8 valid / 0 invalid / 0 reconciled / 0 rejected / 8 final.
39. Test / Quality: 8 valid / 0 invalid / 0 reconciled / 0 rejected / 8 final.
40. Duplicate/overlap groups: preserved Run 3 overlap groups; no new duplicate successor.
41. Multi-reviewer root-cause groups: five deterministic Phase 6 groups.
42. Final BLOCKING_FOR_PHASE_6: 7.
43. Final HIGH_PRIORITY: 10.
44. Final NORMAL_PRIORITY: 13.
45. Final INFORMATIONAL: 1.
46. Phase 6 correction groups: trust boundaries; cross-artifact contracts; runtime/provider integration; quality/release evidence; architecture ownership.
47. Correction ordering: current-head applicability, contract identity/trust boundaries, integration, quality evidence, architecture cleanup.
48. Rebase warning: included.
49. Original Run 3 artifacts preserved: yes.
50. Original invalid findings preserved: yes.
51. Successor relationships preserved: yes; no successor promoted.
52. Approved external skills: 4.
53. Approved internal skills: 13.
54. Unique approved skills: 17.
55. Assignment refs: 18.
56. Deferred skill usage: 0.
57. skills.sh calls: 0.
58. Production Factory source corrections: 0.
59. Correction TaskGraph tasks: 0.
60. ChangeProposals applied: 0.
61. Website-generation E2E: no.
62. Reconciliation machine artifact: docs/admin/factory-self-review-evidence-reconciliation-2026-08-10.json.
63. Reconciliation human report: docs/admin/factory-self-review-evidence-reconciliation-2026-08-10.md.
64. Final machine artifact: docs/admin/factory-self-review-2026-08-10-final.json.
65. Final human report: docs/admin/factory-self-review-2026-08-10-final.md.
66. Tests added: 31 reconciliation tests in one new test file.
67. Full test result: 65 files / 776 tests passed.
68. Lint: passed with 3 pre-existing warnings.
69. Typecheck: passed.
70. Build: passed.
71. npm audit: 0 high-or-greater vulnerabilities.
72. DB validation: passed, 2 migrations.
73. DB status: both migrations applied.
74. DB verify: passed, 17 tables / 84 constraints / 4 indexes / 17 of 17 RLS.
75. DB integrity: passed.
76. Docker config: passed.
77. TaskGraph smoke: passed, 6 tasks / 0 repairs.
78. git diff --check: passed.
79. Git status before commit: only requested reconciliation files.
80. QA temporary directory count: 12, preserved.
81. Roadmap Phase 5: COMPLETE_FINDINGS_READY.
82. Final Phase 5 status: COMPLETE_FINDINGS_READY.
83. Next phase: Phase 6 â€” Controlled Factory Corrections.
84. Phase 6 was not started.
