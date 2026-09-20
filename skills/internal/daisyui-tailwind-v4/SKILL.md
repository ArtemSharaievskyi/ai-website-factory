---
name: daisyui-tailwind-v4
description: Integrate optional daisyUI 5 with the Factory Tailwind CSS v4 foundation when the accepted plan explicitly selects it.
version: 5.7.42
source-type: internal
provenance: ai-website-factory-project-owned
targets: implementation
capabilities: implementation.code
coverage-keys: daisyui-tailwind-v4, daisyui-theme-tokens
context-range: 3-6 KB
---

# daisyUI Tailwind v4 Integration

## Purpose

Use daisyUI as an optional generated-project design-system layer only when the
host-approved DependencyPlan contains the exact pinned `daisyui` dev
dependency. Keep shadcn/ui, the selected Design contract, and Factory semantic
tokens as higher-level authorities.

## Steps

1. Verify that the plan and Phase 7C dependency approval contain the exact
   host catalog entry for `daisyui` in `devDependencies`; otherwise leave
   daisyUI out of the project.
2. In the generated Tailwind v4 global stylesheet, preserve the existing
   `@import "tailwindcss";` and add `@plugin "daisyui";` only when selected.
3. If themes are needed, enable only the named themes or a custom theme that
   maps to the approved semantic color contract. Do not enable every theme by
   default or let theme variables replace the Design tokens silently.
4. Use daisyUI classes where they reduce implementation risk; keep bespoke
   composition, shadcn primitives, accessibility semantics, and responsive
   behavior explicit. Validate the generated package manifest and build.

## Decision rules

- daisyUI is a devDependency because it is a Tailwind build-time plugin.
- It is opt-in per project; this skill never adds a package or edits a project
  outside the task scope.
- The official Blueprint/MCP service is not required for this integration and
  must not be treated as a free or host-authorized dependency.

## Quality checks

- The plugin appears only in an approved generated project's CSS entrypoint.
- The npm manifest, lockfile, and dependency plan agree on the exact version.
- Semantic color, focus, reduced-motion, and responsive checks still pass.

## Non-goals and authority

This context does not call a browser, shell, network, or provider, install
packages, choose a theme, approve a dependency, mutate canonical planning, or
grant workflow authority. Dependency Authority and the selected Design own
those decisions.
