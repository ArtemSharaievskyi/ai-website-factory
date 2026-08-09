# External skill curation policy

The Factory uses policy version `external-skill-curation-v1` for administrative discovery of skills.sh candidates. Curation discovers, fetches, statically reviews, evaluates, and optionally stages candidates. It does not approve skills, assign `allowedSkillIds`, inject runtime context, or execute candidate content.

## Evaluation dimensions

Each evaluation is bound to the `skills.sh` source, external skill ID, canonical source reference, retrieved checksum, normalized candidate checksum, target reviewer, target capability, and this policy version. The bounded dimensions are:

- role fit and procedural fit;
- compatibility with the central Orchestrator, TaskGraph, read-only review boundaries, bounded context, and immutable checksum state;
- explicit tool assumptions and whether the useful procedure remains read-only without them;
- estimated injection footprint and context efficiency;
- exact and near-duplicate overlap;
- local static security review and advisory external audit metadata.

Deterministic checks run first. A malformed, unsafe, duplicate, mutation-oriented, essential-tool-dependent, or second-orchestrator candidate does not receive semantic evaluation. An optional semantic evaluator may clarify role, procedure, or architecture fit only for candidates that pass deterministic gates. Its output is advisory and has no approval authority.

## Unsafe versus incompatible

Unsafe content attempts authority escalation, secret access or exfiltration, automatic execution, destructive mutation, or permission expansion. It fails local security review. Incompatible content may be legitimate for another workflow but depend fundamentally on shell, GitHub, browser execution, filesystem writes, uncontrolled network fetching, or subagent orchestration. Incompatibility is recorded separately and does not grant the reviewer any missing permission.

## Popularity, source identity, and audits

Install counts and maintainer/framework signals are metadata only. Popularity is not trust, role fit, or approval. The documented skills.sh audit endpoint is retrieved through the controlled source adapter when available. PASS, WARN, FAIL, and absence are recorded as advisory source metadata. A PASS never approves a skill; a FAIL is surfaced and routes the candidate to human review; absence does not fail an otherwise locally safe candidate.

## Context and reviewer boundaries

The resolver may select zero, one, or multiple complementary procedures for a review task. Candidates are measured against the shared bounded injection policy and are never silently truncated; selection uses explicit coverage, project surfaces, overlap/conflict rules, and deterministic priority/ID ordering without a fixed maximum or top-K quota. A reviewer skill must remain a reviewer procedure: architecture, contracts, integration, security, and test-quality responsibilities remain separate. No curation candidate may become a tool, executor, subagent framework, orchestrator, mutable state store, or alternative change-proposal model.

## Lifecycle and human boundary

Only `SHORTLIST` and `NEEDS_HUMAN_REVIEW` candidates may be staged. `REJECT` candidates are not staged. Staging means `under-review`; it is not approval and cannot be loaded by runtime. Human approval is a separate explicit action requiring exact checksum, license evidence for external content, project-owned provenance for internal content, narrowed role/task/tool permissions, and the existing Approved Skills Registry approval path. Phase 4D4 explicitly approves one external and 13 internal artifacts and assigns them across all nine portfolios. The three deferred external candidates remain unapproved and unassigned; no approval is implied for any other discovered or staged candidate.

Evaluation records are persisted separately under the admin curation output and are never overwritten across candidate checksums. If the external content changes, the prior record is stale and cannot be reused for the new candidate.
