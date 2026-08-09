# Initial Portfolio License Decisions — Phase 4D3.5 — 2026-08-09

This is an engineering portfolio-selection decision for the initial AI Website Factory portfolio. It is not legal advice, a license interpretation engine, an approval action, or an assignment action.

## Decisions

| Candidate | License evidence | Policy status | Scope status | Phase 4D3.5 decision | Readiness | Initial required |
|---|---|---|---|---|---|---|
| bradyhazell/brady-plugins/review-maintainability | MIT / PRESENT | LICENSE_ALLOWED_FOR_FACTORY_USE | LICENSE_SCOPE_ACCEPTED | SELECTED_FOR_PHASE_4D4_APPROVAL | APPROVAL_ELIGIBLE | true |
| fr-e-d/gaai-framework/ambiguity-detector | Elastic-2.0 / PRESENT | LICENSE_POLICY_REVIEW_REQUIRED | LICENSE_SCOPE_ACCEPTED | DEFERRED_FROM_INITIAL_PORTFOLIO | LICENSE_POLICY_REVIEW_REQUIRED | false |
| owasp/secure-agent-playbook/web-security-review | CC-BY-4.0 / PRESENT | LICENSE_POLICY_REVIEW_REQUIRED | LICENSE_SCOPE_ACCEPTED | DEFERRED_FROM_INITIAL_PORTFOLIO | LICENSE_POLICY_REVIEW_REQUIRED | false |
| djankies/claude-configs/reviewing-test-quality | MIT / PRESENT | LICENSE_SCOPE_REVIEW_REQUIRED | LICENSE_SCOPE_REVIEW_REQUIRED | NOT_SELECTED_INITIAL_PORTFOLIO | LICENSE_SCOPE_REVIEW_REQUIRED | false |

No decision asserts that Elastic-2.0 or CC-BY-4.0 is legally forbidden or incompatible. The decisions only defer initial portfolio selection pending Factory policy or scope decisions.

## Initial coverage after deferrals

All 9 agents have sufficient initial coverage. No material initial portfolio gap was identified.

| Agent | Existing approved | Phase 4D4 external | Phase 4D4 internal | Deferred optional external | Coverage |
|---|---|---|---|---|---|
| lead |  |  | lead-requirements-completeness | fr-e-d/gaai-framework/ambiguity-detector | SUFFICIENT_INITIAL_COVERAGE |
| planner |  |  | project-data-model-planning, technical-risk-planning |  | SUFFICIENT_INITIAL_COVERAGE |
| design |  |  | responsive-form-ux-design |  | SUFFICIENT_INITIAL_COVERAGE |
| implementation |  |  | nextjs-server-client-implementation, typed-form-implementation, supabase-application-integration, maintainable-performance-implementation |  | SUFFICIENT_INITIAL_COVERAGE |
| architecture-reviewer | module-boundaries-fb20497b5c35 | bradyhazell/brady-plugins/review-maintainability | architecture-tradeoff-review |  | SUFFICIENT_INITIAL_COVERAGE |
| contract-auditor | acceptance-criteria-80493e317476 |  | requirements-evidence-traceability |  | SUFFICIENT_INITIAL_COVERAGE |
| code-integration-reviewer |  |  | react-nextjs-integration-review |  | SUFFICIENT_INITIAL_COVERAGE |
| security-reviewer | supabase-rls-1e36b217c969 |  | auth-storage-security-review | owasp/secure-agent-playbook/web-security-review | SUFFICIENT_INITIAL_COVERAGE |
| test-quality-reviewer |  |  | requirements-evidence-traceability, behavioral-test-quality-review | djankies/claude-configs/reviewing-test-quality | SUFFICIENT_INITIAL_COVERAGE |

## Phase 4D4 approval preview

- External preview: bradyhazell/brady-plugins/review-maintainability.
- Internal preview: 13 authored internal skills.
- Total preview artifacts: 14.
- This is preview-only. No approval, promotion, assignment, allowlist, or resolver mutation occurred.

## Roadmap

- Phase 4D3: authored internal skills — complete.
- Phase 4D3.5: initial portfolio license decisions — complete.
- Phase 4D4: explicit approval and assignment — next.
- Phase 4D5: final skill portfolio/runtime audit.
- Phase 5: Factory self-review.
- Phase 6: architectural corrections.
- Phase 7: clean website E2E.

## Invariants

- Phase 4D1 EXTERNAL_ADVANCE history remains unchanged.
- Phase 4D2 license evidence, policy statuses, checksums, and candidate records remain unchanged.
- Approved external count remains 3; assigned external count remains 3.
- Approved internal count remains 0; assigned internal count remains 0.
- Deferred candidates remain historical and are not runtime-resolvable or assigned.
- No skills.sh, GitHub, web, npm registry, or external API calls were used.
