---
name: magic-ui-adaptation
description: Adapt an explicitly selected free Magic UI candidate into the approved Factory Design and dependency boundaries.
version: 1.0.0
source-type: internal
provenance: ai-website-factory-project-owned
targets: implementation
capabilities: implementation.code
coverage-keys: magic-ui-adaptation, component-provenance
context-range: 3-6 KB
---

# Magic UI Adaptation

## Purpose

Use this procedure only when the selected Design contract contains bounded
Magic UI discovery evidence. Magic UI is a read-only inspiration and candidate
source; it is not an installation authority.

## Steps

1. Confirm the candidate is the free, public item named by the selected Design
   contract and preserve its source reference and checksum.
2. Compare the candidate with the approved composition, semantic tokens,
   content, shadcn base, and interaction contract. Reject it when it adds
   decorative complexity or changes the direction.
3. Adapt the smallest component surface into the generated project. Review
   dependencies against the current DependencyPlan and keep Server/Client
   boundaries explicit.
4. Normalize motion, focus, keyboard, reduced-motion, loading, and error
   behavior before implementation evidence is produced.

## Decision rules

- Never copy a premium item, template, block, opaque remote import, or source
  that lacks current free-source evidence.
- Do not install a dependency because a candidate mentions it; host dependency
  authority and the accepted plan decide direct packages.
- Preserve shadcn/ui as the base primitive authority where it already fits.

## Quality checks

- The candidate has explicit Design fit, source provenance, and a task-scoped
  adaptation note.
- The resulting code is local, typed, accessible, responsive, and bounded.
- Any motion has a reduced-motion fallback and no unnecessary client island.

## Non-goals and authority

This context does not call a browser, shell, network, or provider, install
packages, fetch registry content, mutate canonical Design, approve a
component, or grant workflow authority. The existing Design-source adapter is
read-only; the host task and dependency validators own implementation.
