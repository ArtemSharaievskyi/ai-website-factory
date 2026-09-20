---
name: design-motion-principles
description: Apply context-aware motion creation and audit principles to Factory frontend work and animation review.
version: 2.1.1
source-type: internal
provenance: ai-website-factory-project-owned
targets: implementation, review
capabilities: implementation.code, review.animation
coverage-keys: motion-frequency-gate, motion-accessibility, motion-create-audit
context-range: 4-8 KB
---

# Design Motion Principles

## Purpose

Use the Factory-owned normalized subset of Design Motion Principles for motion
creation and audit. It combines a frequency gate, context-aware duration
judgment, reduced-motion handling, performance checks, and anti-slop review.
It complements the existing Emil construction and review skills.

## Steps

1. Detect whether the task is creating motion or auditing existing motion, then
   identify the user action, frequency, context, and information hierarchy.
2. Decide whether motion is necessary. If it is, choose the smallest coherent
   vocabulary for state, continuity, causality, feedback, or orientation.
3. Check duration, easing, interruption, layout stability, transform/opacity
   performance, keyboard behavior, and `prefers-reduced-motion` fallback.
4. For audits, report the concrete trigger, severity, rationale, and bounded
   repair guidance; do not manufacture a report artifact outside the task.

## Decision rules

- Keyboard-triggered actions and frequent utility interactions usually need an
  instant or near-instant response.
- Context matters: do not apply one universal duration or animation style.
- Reduced motion is a required behavior, not an optional polish pass.
- Decorative entrance cascades, hover-scale everywhere, pulse indicators,
  stagger spam, and unbounded blur are suspicious until justified.

## Quality checks

- Motion still communicates state and hierarchy when reduced or removed.
- The implementation keeps client JavaScript and layout work proportional.
- Audit findings are evidence-based and remain separate from approval.

## Non-goals and authority

This context does not call a browser, shell, network, or provider, install
packages, edit source, create external audit files, approve a change, or grant
workflow authority. The selected Design contract, host validators, and review
role remain authoritative.
