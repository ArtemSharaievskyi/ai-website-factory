---
name: responsive-form-ux-design
description: Specify responsive layouts and usable form interaction states as part of a design direction, without implementing code.
version: 1.0.0
source-type: internal
provenance: ai-website-factory-project-owned
targets: design
capabilities: design.directions, design.selection
coverage-keys: responsive-design, form-ux
context-range: 5–8 KB
---

# Responsive and Form UX Design Contract

## Purpose

Use this procedure when a design direction contains responsive layout or form
interaction decisions. Produce a clear design contract that Implementation can
realize without guessing at hierarchy or state behavior.

## Inputs and evidence

- Brief, planning package, and selected or candidate design direction;
- content priority, page structure, workflows, and form contracts;
- fixed design-tool and anti-template boundaries.

## Steps

1. Identify content priority, interaction goals, layout invariants, and the
   smallest viewport that must remain usable.
2. Define mobile, intermediate, and wide behavior: grouping, hierarchy,
   density, typography, navigation, and touch-target intent.
3. Specify form field grouping, labels, help, required/optional clarity,
   progressive disclosure, and validation feedback placement.
4. Define loading, empty, error, retry, and success states, including recovery
   paths and navigation behavior.
5. Record accessibility-aware interaction intent and purposeful motion only
   where it clarifies state or hierarchy.

## Decision rules

- Preserve content priority across viewport transitions; do not merely shrink.
- Use progressive disclosure when it reduces cognitive load without hiding a
  necessary decision.
- Every submitted form has a visible pending, success, and failure outcome.
- Accessibility-aware intent belongs in the design contract, not a new audit
  gate or implementation code.

## Quality checks

- Layout transitions and invariants are stated for three viewport bands.
- Form states include field-level and form-level recovery intent.
- Labels, help, required state, and error association are distinguishable.
- The direction is implementable without React or CSS code.

## Non-goals and authority

This procedure does not write React/CSS, run accessibility tools, audit an
implemented website, call a browser, mutate source, or change workflow state.
It grants no design-tool, shell, network, or approval authority.
