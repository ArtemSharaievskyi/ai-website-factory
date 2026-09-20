---
name: taste-frontend-direction
description: Use dial-driven visual variance, motion intensity, and density to make Factory design directions intentional rather than generic.
version: 1.0.0
source-type: internal
provenance: ai-website-factory-project-owned
targets: design
capabilities: design.directions
coverage-keys: design-taste, visual-variance, visual-density
context-range: 4-8 KB
---

# Taste Frontend Direction

## Purpose

Use the Factory-owned normalized guidance from Taste Skill v2 experimental to
make visual choices explicit. The dials are a reasoning aid for Design, not a
replacement for the approved brief, brand, content, accessibility contract,
or user selection.

## Steps

1. Infer a bounded starting point for `DESIGN_VARIANCE`, `MOTION_INTENSITY`,
   and `VISUAL_DENSITY` from the approved requirements; do not silently invent
   a product personality.
2. Translate those dials into concrete layout rhythm, type scale, contrast,
   border/radius language, image treatment, interaction emphasis, and content
   density decisions.
3. Compare the direction against the anti-slop and accessibility checks. Remove
   decorative patterns that do not clarify hierarchy or support a user task.
4. Carry the chosen values and rationale into the typed Design contract so the
   Frontend agent can implement them without guessing.

## Decision rules

- Variance is purposeful asymmetry and hierarchy, not visual noise.
- Motion intensity never overrides reduced-motion, keyboard, performance, or
  comprehension requirements.
- Density follows the task and content; do not turn every region into a card
  grid or dashboard.

## Quality checks

- The direction can be described without generic adjectives alone.
- The dials lead to observable token or composition choices.
- The direction includes quiet, empty, loading, error, and narrow viewport
  behavior where those states are in scope.

## Non-goals and authority

This context does not call a browser, shell, network, or provider, install
packages, mutate source, approve a direction, or grant workflow authority.
Design and explicit user approval remain authoritative.
