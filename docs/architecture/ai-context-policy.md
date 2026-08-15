# AI context policy

Role prompts are versioned (`lead.v1`, `planner.v1`, `design.v1`, `implementation.v1`, `orchestrator-planning.v1`) and share an immutable no-invention policy.

Canonical user and project requirements are authoritative and lossless. The context authority class `CANONICAL_REQUIREMENT` covers the InitialProjectRequest, clarification answers, Project Brief and approved requirement set, selected Design Direction, accepted dependency and database decisions, and approved ChangeProposal decisions. These documents are checksum-bound, included in full, and are never passed through snippet reducers, summary-only replacement, relevance ranking, or token-budget eviction.

`SUPPORTING_TECHNICAL` context remains bounded. Implementation context continues to be assembled by the existing bounded `TaskContextAssembler`; source files, logs, diagnostics, Context7 documentation, skills, Codebase Memory, historical evidence, and design-reference discovery may use scoped selection, slices, skeletons, and bounded diagnostics with provenance.

The shared `ContextAssembler` enforces the distinction. If the complete canonical set plus the provider-safe budget cannot fit, assembly/provider preparation returns a typed capacity failure with safe metadata; it never silently truncates or summarizes requirements. Prompt telemetry records byte counts, checksums, and reduction metrics only, never raw canonical text or private reasoning.
