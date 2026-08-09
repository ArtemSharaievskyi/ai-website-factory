# External Skill Curation Report

Generated: 2026-08-09T15:47:29.579Z

Policy version: `external-skill-curation-v1`

This is an administrative discovery/evaluation report. External content remains untrusted. The subsequent Phase 4B2 action approved and assigned exactly the three candidates listed in the checksum-bound decision table; no other candidate was approved, assigned, executed, or rewritten. External audit results remain advisory metadata only.

Availability state: **AVAILABLE**



## Session summary

- Live search queries: 5
- Search queries attempted: `software architecture review module boundaries`, `requirements traceability acceptance criteria API contract`, `React Next.js TypeScript code integration review`, `Next.js Supabase PostgreSQL RLS authorization security review`, `Playwright Vitest webapp test strategy quality review`
- Detail candidates fetched: 24
- Source retrieval issues: 1 (security-reviewer/leonaaardob/lb-supabase-skill/supabase: SKILLS_SH_RESPONSE_TOO_LARGE)
- Evaluations persisted: 24
- Shortlisted: 0
- Rejected: 17
- Needing human review: 7
- External skills staged: 7
- External skills approved: **3**
- Active assigned external skills: **3**

## Human decision table

| Reviewer | Candidate skill | Source | Primary value / main concern | Tool assumptions | Security status | Context cost | Recommendation |
|---|---|---|---|---|---|---:|---|
| Architecture Reviewer | review-software-architecture | pjt222/development-guides | Local static review found an approval-blocking unsafe instruction. | shell, git, github, python | PASS | 11930 bytes | DO_NOT_USE |
| Architecture Reviewer | ob-architect | ontoledgy/ol_ai_context_library | Local static review found an approval-blocking unsafe instruction. | none detected | PASS | 15438 bytes | DO_NOT_USE |
| Architecture Reviewer | review-and-simplify-changes | lleewwiiss/codex-agents | The candidate requires a tool that this reviewer does not possess; no permission is granted. | agent-or-subagent, git, github | PASS | 10414 bytes | DO_NOT_USE |
| Architecture Reviewer | module-boundaries | codybrom/clairvoyance | Candidate passed deterministic curation checks and adds focused review procedure. | none detected | PASS | 5959 bytes | OPTIONAL |
| Architecture Reviewer | setup-module-boundaries | milad-alizadeh/argo | Local static review found an approval-blocking unsafe instruction. | shell, git, github, playwright-or-browser | WARN | 9123 bytes | DO_NOT_USE |
| Contract Auditor | prd | andresnator/agents-orchestrator | Candidate passed deterministic curation checks and adds focused review procedure. | none detected | PASS | 5494 bytes | OPTIONAL |
| Contract Auditor | acceptance-criteria | masanao-ohba/claude-manifests | The candidate provides limited reusable review methodology. | none detected | PASS | 4469 bytes | OPTIONAL |
| Contract Auditor | lcs-tosrs | mdhb2/lean-coding-skills | Local static review found an approval-blocking unsafe instruction. | none detected | WARN | 8949 bytes | DO_NOT_USE |
| Contract Auditor | acceptance-criteria | billschumacher/claude_stuff | The candidate provides limited reusable review methodology. | none detected | UNAVAILABLE (advisory source) | 4111 bytes | DO_NOT_USE |
| Contract Auditor | requirements-ears | brunofaust/claude-all | The candidate provides limited reusable review methodology. | git | PASS | 5125 bytes | OPTIONAL |
| Code / Integration Reviewer | nextjs-react-typescript | mindrally/skills | The candidate provides limited reusable review methodology. | none detected | WARN | 1883 bytes | DO_NOT_USE |
| Code / Integration Reviewer | senior-frontend | borghei/claude-skills | Local static review found an approval-blocking unsafe instruction. | shell, playwright-or-browser, python, network-fetch, package-install | WARN | 77080 bytes | DO_NOT_USE |
| Code / Integration Reviewer | frontend-developer | sickn33/agentic-awesome-skills | The candidate provides limited reusable review methodology. | git, github, playwright-or-browser | WARN | 7631 bytes | OPTIONAL |
| Code / Integration Reviewer | typescript-code-review | jpoutrin/product-forge | Local static review found an approval-blocking unsafe instruction. | network-fetch | PASS | 10985 bytes | DO_NOT_USE |
| Code / Integration Reviewer | nextjs-react-conventions | diamondt/skills | Local static review found an approval-blocking unsafe instruction. | git, network-fetch | PASS | 10083 bytes | DO_NOT_USE |
| Security Reviewer | supabase-expert | yuniorglez/gemini-elite-core | Local static review found an approval-blocking unsafe instruction. | shell, git, github, network-fetch | PASS | 12116 bytes | DO_NOT_USE |
| Security Reviewer | supabase-expert | diegosouzapw/awesome-omni-skill | Local static review found an approval-blocking unsafe instruction. | shell, github, network-fetch | WARN | 44476 bytes | DO_NOT_USE |
| Security Reviewer | supabase-rls | sarmakska/slipstream | Candidate passed deterministic curation checks and adds focused review procedure. | none detected | PASS | 887 bytes | OPTIONAL |
| Security Reviewer | security-review-nextjs-supabase | dapasa/skillforge | Local static review found an approval-blocking unsafe instruction. | shell, git, github, playwright-or-browser, network-fetch | WARN | 44493 bytes | DO_NOT_USE |
| Test / Quality Reviewer | testing-qa | sickn33/antigravity-awesome-skills | The candidate provides limited reusable review methodology. | playwright-or-browser, python | WARN | 5189 bytes | OPTIONAL |
| Test / Quality Reviewer | testing-strategy | pixel-process-ug/superkit-agents | Local static review found an approval-blocking unsafe instruction. | shell, github, playwright-or-browser, python | PASS | 8734 bytes | DO_NOT_USE |
| Test / Quality Reviewer | webapp-testing | vamseeachanta/workspace-hub | Local static review found an approval-blocking unsafe instruction. | shell, playwright-or-browser, python, package-install | WARN | 2657 bytes | DO_NOT_USE |
| Test / Quality Reviewer | testing-patterns | 4444j99/a-i--skills | Local static review found an approval-blocking unsafe instruction. | shell, git, github, playwright-or-browser, network-fetch | PASS | 36427 bytes | DO_NOT_USE |
| Test / Quality Reviewer | webapp testing | frankxai/ai-and-web3 | Local static review found an approval-blocking unsafe instruction. | shell, playwright-or-browser | PASS | 6947 bytes | DO_NOT_USE |

Recommendation labels are curation advice only. They are not registry approval states.

## Candidate details

### review-software-architecture — Architecture Reviewer

- External ID: `pjt222/development-guides/review-software-architecture`
- Source: pjt222/development-guides
- Canonical source reference: https://www.skills.sh/pjt222/development-guides/review-software-architecture
- Candidate checksum: `80450d9dd75f875c634ae8a7e0daadea54f863afee812dfaec3f35938cc2d7f4`
- Retrieved content checksum: `e716dee390c8338ab64b15e9280c3809e5d4ae6edc28807b961a43f0ae60d5b2`
- Disposition: **REJECT**
- Recommendation: **DO_NOT_USE**
- Role fit / procedure fit: strong / low
- Architecture compatibility: compatible
- Tool assumptions: shell (incidental), git (incidental), github (incidental), python (incidental)
- Context cost: 11930 bytes (bounded); total candidate text 11939 bytes
- Overlap: low
- Local security: FAIL (3 approval-blocking findings)
- External audit: PASS
- Staged skill ID: none

Reasons:
- Local static review found an approval-blocking unsafe instruction.
- The candidate provides limited reusable review methodology.

### ob-architect — Architecture Reviewer

- External ID: `ontoledgy/ol_ai_context_library/ob-architect`
- Source: ontoledgy/ol_ai_context_library
- Canonical source reference: https://www.skills.sh/ontoledgy/ol_ai_context_library/ob-architect
- Candidate checksum: `67e9439c291835097a07be9c3c094f256b18eccdbf5d1c04b89bf3e38af80af7`
- Retrieved content checksum: `cc6180442b35a9b089f3016d01a47270ad7a0cef4acf90cee84cd9170849410b`
- Disposition: **REJECT**
- Recommendation: **DO_NOT_USE**
- Role fit / procedure fit: strong / high
- Architecture compatibility: compatible
- Tool assumptions: none detected
- Context cost: 15438 bytes (bounded); total candidate text 15521 bytes
- Overlap: low
- Local security: FAIL (1 approval-blocking findings)
- External audit: PASS
- Staged skill ID: none

Reasons:
- Local static review found an approval-blocking unsafe instruction.

### review-and-simplify-changes — Architecture Reviewer

- External ID: `lleewwiiss/codex-agents/review-and-simplify-changes`
- Source: lleewwiiss/codex-agents
- Canonical source reference: https://www.skills.sh/lleewwiiss/codex-agents/review-and-simplify-changes
- Candidate checksum: `b7d749579c296e8dd607968115246e7b5574c99fac67dd98cfed9ee7e92b7841`
- Retrieved content checksum: `585454d8d468734abc47815b28a91b4f85f45444688337749b940a20397365be`
- Disposition: **REJECT**
- Recommendation: **DO_NOT_USE**
- Role fit / procedure fit: strong / low
- Architecture compatibility: compatible
- Tool assumptions: agent-or-subagent (incidental), git (essential), github (incidental)
- Context cost: 10414 bytes (bounded); total candidate text 11070 bytes
- Overlap: low
- Local security: PASS (0 approval-blocking findings)
- External audit: PASS
- Staged skill ID: none

Reasons:
- The candidate requires a tool that this reviewer does not possess; no permission is granted.
- The candidate provides limited reusable review methodology.

### module-boundaries — Architecture Reviewer

- External ID: `codybrom/clairvoyance/module-boundaries`
- Source: codybrom/clairvoyance
- Canonical source reference: https://www.skills.sh/codybrom/clairvoyance/module-boundaries
- Candidate checksum: `5ff94ca54b67326d7c377a33d2e61d108887a96729c2c3ff228b4f3a6ff3c5ff`
- Retrieved content checksum: `f3f1687ecbd0068de0bd3ca40a745ac8f00f5a5bf39ce7b5b47156641574b7fb`
- Disposition: **NEEDS_HUMAN_REVIEW**
- Recommendation: **OPTIONAL**
- Role fit / procedure fit: strong / medium
- Architecture compatibility: compatible
- Tool assumptions: none detected
- Context cost: 5959 bytes (compact); total candidate text 5968 bytes
- Overlap: low
- Local security: PASS (0 approval-blocking findings)
- External audit: PASS
- Staged skill ID: module-boundaries-fb20497b5c35

Reasons:
- Candidate passed deterministic curation checks and adds focused review procedure.

### setup-module-boundaries — Architecture Reviewer

- External ID: `milad-alizadeh/argo/setup-module-boundaries`
- Source: milad-alizadeh/argo
- Canonical source reference: https://www.skills.sh/site/milad-alizadeh.argo/setup-module-boundaries
- Candidate checksum: `75a6fb8e01233b410fd7dc43f51f171915c28b8683dac524e79eb9b46675676e`
- Retrieved content checksum: `1c2c8fb242f9220ffe1261131b4da2568432e9012d69e147de10c4195d93d6e2`
- Disposition: **REJECT**
- Recommendation: **DO_NOT_USE**
- Role fit / procedure fit: strong / low
- Architecture compatibility: compatible
- Tool assumptions: shell (incidental), git (incidental), github (incidental), playwright-or-browser (incidental)
- Context cost: 9123 bytes (bounded); total candidate text 14943 bytes
- Overlap: low
- Local security: FAIL (2 approval-blocking findings)
- External audit: WARN
- Staged skill ID: none

Reasons:
- Local static review found an approval-blocking unsafe instruction.
- The candidate provides limited reusable review methodology.
- An external audit reports a warning; the result is advisory only.

### prd — Contract Auditor

- External ID: `andresnator/agents-orchestrator/prd`
- Source: andresnator/agents-orchestrator
- Canonical source reference: https://www.skills.sh/andresnator/agents-orchestrator/prd
- Candidate checksum: `f8743a1b82970674f8a25d7c6121d594e20aa904994f7772b0aba9441f8873f8`
- Retrieved content checksum: `f49480283c418a5e814d3ec8069fcd5223cfa70cb3849dc6fc13f786344fb933`
- Disposition: **NEEDS_HUMAN_REVIEW**
- Recommendation: **OPTIONAL**
- Role fit / procedure fit: strong / high
- Architecture compatibility: compatible
- Tool assumptions: none detected
- Context cost: 5494 bytes (compact); total candidate text 9773 bytes
- Overlap: low
- Local security: PASS (0 approval-blocking findings)
- External audit: PASS
- Staged skill ID: prd-46ce9266c41c

Reasons:
- Candidate passed deterministic curation checks and adds focused review procedure.

### acceptance-criteria — Contract Auditor

- External ID: `masanao-ohba/claude-manifests/acceptance-criteria`
- Source: masanao-ohba/claude-manifests
- Canonical source reference: https://www.skills.sh/masanao-ohba/claude-manifests/acceptance-criteria
- Candidate checksum: `2f522f9ef2d167860e613288395b6777dc2f9cb8fb88d67c255fb83986f579ec`
- Retrieved content checksum: `830c404b46cbd65a49600f9bfc093b6cd201ca91f64e9ce89265837cb5a319f7`
- Disposition: **NEEDS_HUMAN_REVIEW**
- Recommendation: **OPTIONAL**
- Role fit / procedure fit: strong / low
- Architecture compatibility: compatible
- Tool assumptions: none detected
- Context cost: 4469 bytes (compact); total candidate text 4478 bytes
- Overlap: low
- Local security: PASS (0 approval-blocking findings)
- External audit: PASS
- Staged skill ID: acceptance-criteria-80493e317476

Reasons:
- The candidate provides limited reusable review methodology.

### lcs-tosrs — Contract Auditor

- External ID: `mdhb2/lean-coding-skills/lcs-tosrs`
- Source: mdhb2/lean-coding-skills
- Canonical source reference: https://www.skills.sh/mdhb2/lean-coding-skills/lcs-tosrs
- Candidate checksum: `b0d64a3ba3c37ade80e1a932ac05b44dc2ea3da0e64dbd0963cd906ba68b7879`
- Retrieved content checksum: `3277391ddf530476bd1b144594d8921222878efda7fc9d364721089bb470bc13`
- Disposition: **REJECT**
- Recommendation: **DO_NOT_USE**
- Role fit / procedure fit: strong / high
- Architecture compatibility: compatible
- Tool assumptions: none detected
- Context cost: 8949 bytes (bounded); total candidate text 8958 bytes
- Overlap: low
- Local security: FAIL (1 approval-blocking findings)
- External audit: WARN
- Staged skill ID: none

Reasons:
- Local static review found an approval-blocking unsafe instruction.
- An external audit reports a warning; the result is advisory only.

### acceptance-criteria — Contract Auditor

- External ID: `billschumacher/claude_stuff/acceptance-criteria`
- Source: billschumacher/claude_stuff
- Canonical source reference: https://www.skills.sh/billschumacher/claude_stuff/acceptance-criteria
- Candidate checksum: `87f52ac9c6b7183a43ed769e35fe4a1b1ffa4c285b0f9bc170696eb6d2d27d53`
- Retrieved content checksum: `495db53be16d27ab763179947cd00bc2bd78b65316780d70f0231fedc7134e79`
- Disposition: **REJECT**
- Recommendation: **DO_NOT_USE**
- Role fit / procedure fit: strong / none
- Architecture compatibility: compatible
- Tool assumptions: none detected
- Context cost: 4111 bytes (compact); total candidate text 4120 bytes
- Overlap: low
- Local security: PASS (0 approval-blocking findings)
- External audit: UNAVAILABLE (advisory source)
- Staged skill ID: none

Reasons:
- The candidate provides limited reusable review methodology.
- No external audit metadata is available; local review remains authoritative.

### requirements-ears — Contract Auditor

- External ID: `brunofaust/claude-all/requirements-ears`
- Source: brunofaust/claude-all
- Canonical source reference: https://www.skills.sh/brunofaust/claude-all/requirements-ears
- Candidate checksum: `eb41c2a8ea0263772ab55114a2eb1244a433b953374e86b699d7623e924122d4`
- Retrieved content checksum: `317d616e51d593e92a3f7d0dd57a2dadb389486ae258e1e475cd212eed1da786`
- Disposition: **NEEDS_HUMAN_REVIEW**
- Recommendation: **OPTIONAL**
- Role fit / procedure fit: strong / low
- Architecture compatibility: compatible
- Tool assumptions: git (incidental)
- Context cost: 5125 bytes (compact); total candidate text 5134 bytes
- Overlap: low
- Local security: PASS (0 approval-blocking findings)
- External audit: PASS
- Staged skill ID: requirements-ears-9b7398087f3c

Reasons:
- The candidate provides limited reusable review methodology.

### nextjs-react-typescript — Code / Integration Reviewer

- External ID: `mindrally/skills/nextjs-react-typescript`
- Source: mindrally/skills
- Canonical source reference: https://www.skills.sh/mindrally/skills/nextjs-react-typescript
- Candidate checksum: `c2e86e637604e6729cce4353b570fa9be538ddd824a96263722fbe267c1c4f6e`
- Retrieved content checksum: `06ef3d259a7fc71fc3c6d339987697135dc168739e931edef71a0dd0a7263ee7`
- Disposition: **REJECT**
- Recommendation: **DO_NOT_USE**
- Role fit / procedure fit: strong / none
- Architecture compatibility: compatible
- Tool assumptions: none detected
- Context cost: 1883 bytes (compact); total candidate text 1892 bytes
- Overlap: low
- Local security: PASS (0 approval-blocking findings)
- External audit: WARN
- Staged skill ID: none

Reasons:
- The candidate provides limited reusable review methodology.
- An external audit reports a warning; the result is advisory only.

### senior-frontend — Code / Integration Reviewer

- External ID: `borghei/claude-skills/senior-frontend`
- Source: borghei/claude-skills
- Canonical source reference: https://www.skills.sh/borghei/claude-skills/senior-frontend
- Candidate checksum: `96f731dfaa2dda2728a057bacb04e4fd9bae4e49752835886909dd3739751ae6`
- Retrieved content checksum: `0e374f3a1c364db80d6aa91ebe3ed2b1d800165350b1046c88678cf875fecb54`
- Disposition: **REJECT**
- Recommendation: **DO_NOT_USE**
- Role fit / procedure fit: strong / low
- Architecture compatibility: compatible
- Tool assumptions: shell (incidental), playwright-or-browser (incidental), python (incidental), network-fetch (incidental), package-install (incidental)
- Context cost: 77080 bytes (large); total candidate text 127353 bytes
- Overlap: low
- Local security: FAIL (36 approval-blocking findings)
- External audit: WARN
- Staged skill ID: none

Reasons:
- Local static review found an approval-blocking unsafe instruction.
- The candidate provides limited reusable review methodology.
- An external audit reports a warning; the result is advisory only.

### frontend-developer — Code / Integration Reviewer

- External ID: `sickn33/agentic-awesome-skills/frontend-developer`
- Source: sickn33/agentic-awesome-skills
- Canonical source reference: https://www.skills.sh/sickn33/agentic-awesome-skills/frontend-developer
- Candidate checksum: `fb9903b2e51e9718718fc6ce1ffe64eaf0dd0143759f9b243cbdc6877be4c9c2`
- Retrieved content checksum: `78298a0f666ad3e9601929d2c706b1a0dab0262493250b77e4d9a2a5efebc456`
- Disposition: **NEEDS_HUMAN_REVIEW**
- Recommendation: **OPTIONAL**
- Role fit / procedure fit: strong / low
- Architecture compatibility: compatible
- Tool assumptions: git (incidental), github (incidental), playwright-or-browser (incidental)
- Context cost: 7631 bytes (compact); total candidate text 7640 bytes
- Overlap: low
- Local security: PASS (0 approval-blocking findings)
- External audit: WARN
- Staged skill ID: frontend-developer-395a2db8a563

Reasons:
- The candidate provides limited reusable review methodology.
- An external audit reports a warning; the result is advisory only.

### typescript-code-review — Code / Integration Reviewer

- External ID: `jpoutrin/product-forge/typescript-code-review`
- Source: jpoutrin/product-forge
- Canonical source reference: https://www.skills.sh/jpoutrin/product-forge/typescript-code-review
- Candidate checksum: `d8d024e46b7b1abf08e0640e74fdcc1269435cf67fb260519be71c4e03bd4e19`
- Retrieved content checksum: `1a7fda93b0faa864e535d1227e1ed47485668f5ce3f53f123b2622fa70fe238b`
- Disposition: **REJECT**
- Recommendation: **DO_NOT_USE**
- Role fit / procedure fit: strong / high
- Architecture compatibility: compatible
- Tool assumptions: network-fetch (incidental)
- Context cost: 10985 bytes (bounded); total candidate text 10994 bytes
- Overlap: low
- Local security: FAIL (2 approval-blocking findings)
- External audit: PASS
- Staged skill ID: none

Reasons:
- Local static review found an approval-blocking unsafe instruction.

### nextjs-react-conventions — Code / Integration Reviewer

- External ID: `diamondt/skills/nextjs-react-conventions`
- Source: diamondt/skills
- Canonical source reference: https://www.skills.sh/diamondt/skills/nextjs-react-conventions
- Candidate checksum: `9610a06f07c4792aee8362629c19145816ee2ad135d38c0328899205e5872efd`
- Retrieved content checksum: `582acfa029667d860687d1a7f48431d37f72c966eb94e98d60039e6ddc17b12f`
- Disposition: **REJECT**
- Recommendation: **DO_NOT_USE**
- Role fit / procedure fit: strong / low
- Architecture compatibility: compatible
- Tool assumptions: git (incidental), network-fetch (incidental)
- Context cost: 10083 bytes (bounded); total candidate text 11173 bytes
- Overlap: low
- Local security: FAIL (4 approval-blocking findings)
- External audit: PASS
- Staged skill ID: none

Reasons:
- Local static review found an approval-blocking unsafe instruction.
- The candidate provides limited reusable review methodology.

### supabase-expert — Security Reviewer

- External ID: `yuniorglez/gemini-elite-core/supabase-expert`
- Source: yuniorglez/gemini-elite-core
- Canonical source reference: https://www.skills.sh/yuniorglez/gemini-elite-core/supabase-expert
- Candidate checksum: `311c628ae0ac8678dcdbb54ba2fe7f01b4c93ba98e2cc09d34c83006ed7fab10`
- Retrieved content checksum: `a0a3e4267fd61d6f8b1c4f1b42277ca332b575e2865c091a54a336de687c1299`
- Disposition: **REJECT**
- Recommendation: **DO_NOT_USE**
- Role fit / procedure fit: strong / low
- Architecture compatibility: compatible
- Tool assumptions: shell (incidental), git (incidental), github (incidental), network-fetch (incidental)
- Context cost: 12116 bytes (bounded); total candidate text 12240 bytes
- Overlap: low
- Local security: FAIL (6 approval-blocking findings)
- External audit: PASS
- Staged skill ID: none

Reasons:
- Local static review found an approval-blocking unsafe instruction.
- The candidate provides limited reusable review methodology.

### supabase-expert — Security Reviewer

- External ID: `diegosouzapw/awesome-omni-skill/supabase-expert`
- Source: diegosouzapw/awesome-omni-skill
- Canonical source reference: https://www.skills.sh/diegosouzapw/awesome-omni-skill/supabase-expert
- Candidate checksum: `01e5fed306d5176c23dd2250556737ecfb745652253e70b721cadb8705b74d5d`
- Retrieved content checksum: `768fe598c6317eec8a08cdc68082fa43369974401efc0fc95d06ba5f84cb64c6`
- Disposition: **REJECT**
- Recommendation: **DO_NOT_USE**
- Role fit / procedure fit: strong / low
- Architecture compatibility: compatible
- Tool assumptions: shell (incidental), github (incidental), network-fetch (incidental)
- Context cost: 44476 bytes (large); total candidate text 46355 bytes
- Overlap: low
- Local security: FAIL (41 approval-blocking findings)
- External audit: WARN
- Staged skill ID: none

Reasons:
- Local static review found an approval-blocking unsafe instruction.
- The candidate provides limited reusable review methodology.
- An external audit reports a warning; the result is advisory only.

### supabase-rls — Security Reviewer

- External ID: `sarmakska/slipstream/supabase-rls`
- Source: sarmakska/slipstream
- Canonical source reference: https://www.skills.sh/sarmakska/slipstream/supabase-rls
- Candidate checksum: `87bc57e597d3eb2e6ec8d4c099684cf4685da84ef45076b14083a7fcc7100877`
- Retrieved content checksum: `1032608d95cec1e3b43a9664b847b1b02d8db33d52a80bcebdcb3e96e3ba9bca`
- Disposition: **NEEDS_HUMAN_REVIEW**
- Recommendation: **OPTIONAL**
- Role fit / procedure fit: strong / high
- Architecture compatibility: compatible
- Tool assumptions: none detected
- Context cost: 887 bytes (compact); total candidate text 896 bytes
- Overlap: low
- Local security: PASS (0 approval-blocking findings)
- External audit: PASS
- Staged skill ID: supabase-rls-1e36b217c969

Reasons:
- Candidate passed deterministic curation checks and adds focused review procedure.

### security-review-nextjs-supabase — Security Reviewer

- External ID: `dapasa/skillforge/security-review-nextjs-supabase`
- Source: dapasa/skillforge
- Canonical source reference: https://www.skills.sh/dapasa/skillforge/security-review-nextjs-supabase
- Candidate checksum: `a194a0bad947ea881e200f59470e5aeb40cb1f3741f24a9bc98eec829d1a1f39`
- Retrieved content checksum: `88429ec5d0f1f2d7e708cab92da2f0bd0ed92d49fd3346e4d26c9dabe81baa14`
- Disposition: **REJECT**
- Recommendation: **DO_NOT_USE**
- Role fit / procedure fit: strong / high
- Architecture compatibility: compatible
- Tool assumptions: shell (incidental), git (incidental), github (incidental), playwright-or-browser (incidental), network-fetch (incidental)
- Context cost: 44493 bytes (large); total candidate text 44651 bytes
- Overlap: low
- Local security: FAIL (32 approval-blocking findings)
- External audit: WARN
- Staged skill ID: none

Reasons:
- Local static review found an approval-blocking unsafe instruction.
- An external audit reports a warning; the result is advisory only.

### testing-qa — Test / Quality Reviewer

- External ID: `sickn33/antigravity-awesome-skills/testing-qa`
- Source: sickn33/antigravity-awesome-skills
- Canonical source reference: https://www.skills.sh/sickn33/antigravity-awesome-skills/testing-qa
- Candidate checksum: `565315633daba978b05ce3ff50b339b952049d1d9f758f4d11d12de4690e2661`
- Retrieved content checksum: `77d64561233d0e9ef3ce2bd3b6bb6f7310e70d20c0404a3aac4f3f19d1b21ee1`
- Disposition: **NEEDS_HUMAN_REVIEW**
- Recommendation: **OPTIONAL**
- Role fit / procedure fit: strong / low
- Architecture compatibility: compatible
- Tool assumptions: playwright-or-browser (incidental), python (incidental)
- Context cost: 5189 bytes (compact); total candidate text 5198 bytes
- Overlap: low
- Local security: PASS (0 approval-blocking findings)
- External audit: WARN
- Staged skill ID: testing-qa-42bade14b7bb

Reasons:
- The candidate provides limited reusable review methodology.
- An external audit reports a warning; the result is advisory only.

### testing-strategy — Test / Quality Reviewer

- External ID: `pixel-process-ug/superkit-agents/testing-strategy`
- Source: pixel-process-ug/superkit-agents
- Canonical source reference: https://www.skills.sh/pixel-process-ug/superkit-agents/testing-strategy
- Candidate checksum: `b2e156d4ab7228531848cb230edaa23090c733a1ea3c352171e16c65c0ee6d73`
- Retrieved content checksum: `d66680771ea28d06c04468cbcc01719b3ea3731ec6c05ed2eccbf1b2ff2747ac`
- Disposition: **REJECT**
- Recommendation: **DO_NOT_USE**
- Role fit / procedure fit: strong / low
- Architecture compatibility: compatible
- Tool assumptions: shell (incidental), github (incidental), playwright-or-browser (incidental), python (incidental)
- Context cost: 8734 bytes (bounded); total candidate text 8743 bytes
- Overlap: low
- Local security: FAIL (1 approval-blocking findings)
- External audit: PASS
- Staged skill ID: none

Reasons:
- Local static review found an approval-blocking unsafe instruction.
- The candidate provides limited reusable review methodology.

### webapp-testing — Test / Quality Reviewer

- External ID: `vamseeachanta/workspace-hub/webapp-testing`
- Source: vamseeachanta/workspace-hub
- Canonical source reference: https://www.skills.sh/vamseeachanta/workspace-hub/webapp-testing
- Candidate checksum: `f988153ef382c8304c92578562a061dd57c6c1e2d7ad5b11d8ac57170239c5b0`
- Retrieved content checksum: `32f444905c4a48da44a8328be5c8f1ebdf5f6c8c7885b8189a6694bcbe1810df`
- Disposition: **REJECT**
- Recommendation: **DO_NOT_USE**
- Role fit / procedure fit: strong / high
- Architecture compatibility: compatible
- Tool assumptions: shell (incidental), playwright-or-browser (incidental), python (incidental), package-install (incidental)
- Context cost: 2657 bytes (compact); total candidate text 2666 bytes
- Overlap: low
- Local security: FAIL (1 approval-blocking findings)
- External audit: WARN
- Staged skill ID: none

Reasons:
- Local static review found an approval-blocking unsafe instruction.
- An external audit reports a warning; the result is advisory only.

### testing-patterns — Test / Quality Reviewer

- External ID: `4444j99/a-i--skills/testing-patterns`
- Source: 4444j99/a-i--skills
- Canonical source reference: https://www.skills.sh/4444j99/a-i--skills/testing-patterns
- Candidate checksum: `39d6e0c865851b6087451f715955d9f087b93d09dbc29a86e7f1ed64f00f06c6`
- Retrieved content checksum: `961864fd708f927403500d20449b083557fc1bcca0bb3e229cb771df06fa1268`
- Disposition: **REJECT**
- Recommendation: **DO_NOT_USE**
- Role fit / procedure fit: strong / high
- Architecture compatibility: compatible
- Tool assumptions: shell (incidental), git (incidental), github (incidental), playwright-or-browser (incidental), network-fetch (incidental)
- Context cost: 36427 bytes (large); total candidate text 36565 bytes
- Overlap: low
- Local security: FAIL (20 approval-blocking findings)
- External audit: PASS
- Staged skill ID: none

Reasons:
- Local static review found an approval-blocking unsafe instruction.

### webapp testing — Test / Quality Reviewer

- External ID: `frankxai/ai-and-web3/webapp-testing`
- Source: frankxai/ai-and-web3
- Canonical source reference: https://www.skills.sh/frankxai/ai-and-web3/webapp-testing
- Candidate checksum: `9673a818e5e47723022997dbdea858fa5e5b40a44a8217f27f6a3b7c050987bb`
- Retrieved content checksum: `4b74a8647358b55db19e5c9414d9c918f36ffa79f41e5d032d42950874aa26aa`
- Disposition: **REJECT**
- Recommendation: **DO_NOT_USE**
- Role fit / procedure fit: strong / medium
- Architecture compatibility: compatible
- Tool assumptions: shell (incidental), playwright-or-browser (essential)
- Context cost: 6947 bytes (compact); total candidate text 6956 bytes
- Overlap: low
- Local security: FAIL (11 approval-blocking findings)
- External audit: PASS
- Staged skill ID: none

Reasons:
- Local static review found an approval-blocking unsafe instruction.
- The candidate requires a tool that this reviewer does not possess; no permission is granted.

## Selected candidate evidence status

On 2026-08-09, the human supplied exact MIT license evidence for the three selected candidates. Each record is bound to the exact candidate checksum, external ID, canonical repository provenance, evidence type `CANONICAL_SOURCE_LICENSE`, `suppliedBy: HUMAN`, and policy `external-skill-curation-v1`. Purpose and steps are indexed from the immutable local staged `SKILL.md`; no skill content was changed. Historical curation recommendations remain unchanged, and this evidence does not request approval.

| Target reviewer | Exact external ID | Candidate checksum | Metadata | License evidence | Local static security | External audit | Upstream | Approval readiness | Blocking reason |
|---|---|---|---|---|---|---|---|---|---|
| Architecture Reviewer | `codybrom/clairvoyance/module-boundaries` | `5ff94ca54b67326d7c377a33d2e61d108887a96729c2c3ff228b4f3a6ff3c5ff` | COMPLETE: frontmatter purpose; ordered procedure steps | MIT, human canonical-source evidence | PASS | PASS | CURRENT | `APPROVED` | promoted immutable copy; assigned to `architecture-reviewer` |
| Contract Auditor | `masanao-ohba/claude-manifests/acceptance-criteria` | `2f522f9ef2d167860e613288395b6777dc2f9cb8fb88d67c255fb83986f579ec` | COMPLETE: frontmatter purpose; sequenced headings/checklist | MIT, human canonical-source evidence | PASS | PASS | CURRENT | `APPROVED` | promoted immutable copy; assigned to `contract-auditor` |
| Security Reviewer | `sarmakska/slipstream/supabase-rls` | `87bc57e597d3eb2e6ec8d4c099684cf4685da84ef45076b14083a7fcc7100877` | COMPLETE: frontmatter purpose; ordered steps | MIT, human canonical-source evidence | PASS | PASS | CURRENT | `APPROVED` | promoted immutable copy; assigned to `security-reviewer` when relevant |

The corrected Security ID is preserved exactly as `sarmakska/slipstream/supabase-rls`; `sarmaks/slipstream/supabase-rls` is not an alias. GitHub URLs are human evidence provenance only; skills.sh remains the sole skill-content source. The three records are now approved through the existing registry mechanism and have immutable local copies. No skill text was rewritten or executed.

## Hard-stop verification

- Approved Skills Registry approval and promotion were called exactly three times for the decision-table candidates.
- Reviewer `allowedSkillIds` assign only the three exact internal IDs; the other six remain empty.
- No external skill content was executed.
- No external links in skill text were followed.
- No dependencies were installed.
- No Skills Agent, Skill Curator Agent, or second orchestrator was created.
- No workflow states were added.
- No production website-generation E2E was run.
