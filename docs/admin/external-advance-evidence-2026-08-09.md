# Phase 4D2 External Advance Evidence — 2026-08-09

Evidence-only completion for the four Phase 4D1 `EXTERNAL_ADVANCE` candidates. No approval, assignment, allowlist, or skill-content mutation occurred.

## License and policy

| Candidate | Canonical source | License | Scope | Policy status | Blocker |
|---|---|---|---|---|---|
| fr-e-d/gaai-framework/ambiguity-detector | https://github.com/Fr-e-d/GAAI-framework | Elastic-2.0 | repository | LICENSE_POLICY_REVIEW_REQUIRED | license policy compatibility requires explicit Factory review |
| bradyhazell/brady-plugins/review-maintainability | https://github.com/BradyHazell/brady-plugins | MIT | repository | LICENSE_ALLOWED_FOR_FACTORY_USE |  |
| owasp/secure-agent-playbook/web-security-review | https://github.com/OWASP/secure-agent-playbook | CC-BY-4.0 | repository | LICENSE_POLICY_REVIEW_REQUIRED | license policy compatibility requires explicit Factory review |
| djankies/claude-configs/reviewing-test-quality | https://github.com/djankies/claude-configs | MIT | repository-inherited-no-narrower-local-evidence | LICENSE_SCOPE_REVIEW_REQUIRED | license scope requires explicit Factory review |

## Metadata, tools, security, and readiness

| Candidate | Purpose | Steps | Security | Tools | Overlap | Readiness |
|---|---|---|---|---|---|---|
| fr-e-d/gaai-framework/ambiguity-detector | COMPLETE (frontmatter-description) | 10 references | PASS | OPTIONAL_ONLY | JUSTIFIED | LICENSE_POLICY_REVIEW_REQUIRED |
| bradyhazell/brady-plugins/review-maintainability | COMPLETE (frontmatter-description) | 3 references | PASS | COMPATIBLE | JUSTIFIED | APPROVAL_ELIGIBLE |
| owasp/secure-agent-playbook/web-security-review | COMPLETE (frontmatter-description) | 1 references | PASS | COMPATIBLE | JUSTIFIED | LICENSE_POLICY_REVIEW_REQUIRED |
| djankies/claude-configs/reviewing-test-quality | COMPLETE (frontmatter-description) | 6 references | PASS | COMPATIBLE | JUSTIFIED | LICENSE_SCOPE_REVIEW_REQUIRED |

## Candidate evidence

### fr-e-d/gaai-framework/ambiguity-detector

- Target: lead (requirements.clarify)
- Exact candidate checksum: `421b7a8270a82b26ce7a2bfa2172d1833880a6accedcc1ab28249df5e7e1a0e6`
- Staged skill ID: `ambiguity-detector-9f8de8233fb3`; staged content source: local checksum-bound registry content
- Provenance: https://github.com/Fr-e-d/GAAI-framework; source commit `eb148cd6f21fd0d1f7a16691f4af66c469e9947be41a7f9b471464b1fc49811f`
- License evidence: Elastic-2.0, CANONICAL_SOURCE_LICENSE, supplied by HUMAN; policy version `external-skill-curation-v1`
- Purpose evidence: COMPLETE; steps evidence: 10 exact local references
- Tool compatibility: OPTIONAL_ONLY; source assumptions: python
- Static security: PASS; external audit: PASS advisory
- Currentness: CURRENT; upstream network checked: no
- Final approval readiness: **LICENSE_POLICY_REVIEW_REQUIRED**
- Blockers: license policy compatibility requires explicit Factory review

### bradyhazell/brady-plugins/review-maintainability

- Target: architecture-reviewer (review.architecture)
- Exact candidate checksum: `4d178cfce7746577253c9addcb2648ceb1c5d3237ff32357a0b382df019ca7f9`
- Staged skill ID: `review-maintainability-d9faf7cb9775`; staged content source: local checksum-bound registry content
- Provenance: https://github.com/BradyHazell/brady-plugins; source commit `51138c77d91fad5bf31f9d693b91e1d74a194245c79399f660bb5dfa504d6089`
- License evidence: MIT, CANONICAL_SOURCE_LICENSE, supplied by HUMAN; policy version `external-skill-curation-v1`
- Purpose evidence: COMPLETE; steps evidence: 3 exact local references
- Tool compatibility: COMPATIBLE; source assumptions: none
- Static security: PASS; external audit: PASS advisory
- Currentness: CURRENT; upstream network checked: no
- Final approval readiness: **APPROVAL_ELIGIBLE**
- Blockers: none

### owasp/secure-agent-playbook/web-security-review

- Target: security-reviewer (review.security)
- Exact candidate checksum: `8b280a3ab13567cadde2c114fffe5c5a00dd2841c229114abf14ddf0880e8012`
- Staged skill ID: `web-security-review-cb64887a561c`; staged content source: local checksum-bound registry content
- Provenance: https://github.com/OWASP/secure-agent-playbook; source commit `70d7b6f3c17951e3d94b1a25d31dce1f7170d43a11fe016e4a9b403c7a044b90`
- License evidence: CC-BY-4.0, CANONICAL_SOURCE_LICENSE, supplied by HUMAN; policy version `external-skill-curation-v1`
- Purpose evidence: COMPLETE; steps evidence: 1 exact local references
- Tool compatibility: COMPATIBLE; source assumptions: none
- Static security: PASS; external audit: PASS advisory
- Currentness: CURRENT; upstream network checked: no
- Final approval readiness: **LICENSE_POLICY_REVIEW_REQUIRED**
- Blockers: license policy compatibility requires explicit Factory review

### djankies/claude-configs/reviewing-test-quality

- Target: test-quality-reviewer (review.test-quality)
- Exact candidate checksum: `7678ee0541450cce390b5a8b5bdacc93d2878451c087969856ccb250b4f38a08`
- Staged skill ID: `reviewing-test-quality-1251b8187af0`; staged content source: local checksum-bound registry content
- Provenance: https://github.com/djankies/claude-configs; source commit `b98d3ce2406cdb89a532e5c9f0bfc7de8713b445a799153aa53b070e51ccc46a`
- License evidence: MIT, CANONICAL_SOURCE_LICENSE, supplied by HUMAN; policy version `external-skill-curation-v1`
- Purpose evidence: COMPLETE; steps evidence: 6 exact local references
- Tool compatibility: COMPATIBLE; source assumptions: none
- Static security: PASS; external audit: PASS advisory
- Currentness: CURRENT; upstream network checked: no
- Final approval readiness: **LICENSE_SCOPE_REVIEW_REQUIRED**
- Blockers: license scope requires explicit Factory review

## Invariants

- Phase 4D1 remains historical: all four remain classified `EXTERNAL_ADVANCE` in the prior plan.
- Approved external skills: 3; assigned external skills: 3.
- Approved internal skills: 0; assigned internal skills: 0.
- skills.sh searches: 0; GitHub requests: 0; external content execution: none.
- The staged skill content was not replaced or rewritten.
