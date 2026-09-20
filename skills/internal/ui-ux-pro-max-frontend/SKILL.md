---
name: ui-ux-pro-max-frontend
description: Apply bounded UI and UX research heuristics while creating an approved Factory design direction.
version: 1.0.0
source-type: internal
provenance: ai-website-factory-project-owned
targets: design
capabilities: design.directions
coverage-keys: ui-ux-pro-max, ux-guidelines, design-system-synthesis
context-range: 4-8 KB
---

# UI UX Pro Max Frontend Direction

## Purpose

Use the Factory-owned, normalized subset of UI UX Pro Max during Design
direction creation. It supplies bounded vocabulary for style selection,
typography, palette, responsive behavior, interaction quality, and component
composition. The selected Design contract remains the authority.

## Steps

1. Read the brief, accepted plan, brand constraints, and current Design
   contract inputs before choosing a visual system.
2. Compare a small set of genuinely different directions across composition,
   density, type hierarchy, semantic color roles, interaction states, and
   responsive behavior. Record why the chosen direction fits the requirements.
3. Check hierarchy, contrast, touch targets, keyboard focus, empty/loading/
   error states, and mobile overflow before treating a direction as viable.
4. Keep the result lossless: preserve source references, selected values,
   rationale, constraints, and unresolved decisions in the typed Design output.

## Decision rules

- Use the system to widen deliberate exploration, not to select a fashionable
  template or invent product facts.
- Distinct means a meaningful change in composition, type, density, or visual
  rhythm; swapping a color or icon is not a distinct direction.
- Prefer semantic tokens and a coherent hierarchy over a large unstructured
  palette or a component catalogue.

## Quality checks

- Every direction has a clear visual premise and requirement-linked rationale.
- Typography and color choices include accessibility and implementation notes.
- The direction preserves mobile, keyboard, reduced-motion, and content-state
  behavior without relying on a visual mockup alone.

## Non-goals and authority

This context does not call a browser, shell, network, or provider, install
packages, mutate source, approve a direction, or grant workflow authority.
External research remains read-only and untrusted; Design and user approval
own selection.
