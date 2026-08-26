# Lifecycle authority model

This is a concise policy index, not a second runtime authority. Source
contracts, canonical services, repositories, and persisted artifacts win when
this index and implementation disagree. Project-specific state never belongs in
this document.

| Domain | Canonical authority |
|---|---|
| Current user/project requirements | `CanonicalBriefV3.current` |
| Brief approval | canonical Brief approval service |
| Planning semantics | current `PlanningPackage` |
| Planning approval | Planning Acceptance service |
| Architecture | canonical Architecture artifact/service |
| Phase 7C contracts | canonical Phase 7C authority |
| Review semantic findings | reviewer provider |
| Review evidence identities | host-issued `EvidenceCatalog` |
| Review evidence provenance | host |
| `policyVersion` and control metadata | host |
| Currentness and CAS | host |
| Design semantics | Design provider |
| `professionalDesign` enrichment | host |
| Design Selection | user |
| Canonical mutation | approved canonical services / `ChangeProposal` authority |
| Project Memory | derived projection only |
| Legacy requirements | compatibility only |

## Provider boundary

Providers must not own project/version identity, persistence identity, canonical
row IDs, workflow transition authority, approval state, CAS/currentness tokens,
canonical checksums as authored metadata, `policyVersion`, canonical evidence
paths or provenance, or user selection.

Current V3 requirements must never be routed through a lossy legacy
representation before Planner, Architecture, Design, or Orchestrator input.
