# Turbopack filesystem-boundary regression

The opt-in regression exercises the complete production application import
graph, including the `SkillRegistry`, `WorkspaceManager`, Project Memory,
workspace synchronization, and production execution adapters. It creates a
disposable fixture, physically copies the installed dependency tree, creates a
synthetic `.factory/tools/codebase-memory-mcp/v0.11.0` subtree, and applies an
ACL denial to that fixture-owned directory. The fixture is removed during
cleanup.

Run from the repository root in PowerShell:

```powershell
$env:TURBOPACK_SKILL_REGISTRY_REGRESSION = "1"
npm.cmd run test:turbopack-skill-registry
Remove-Item Env:TURBOPACK_SKILL_REGISTRY_REGRESSION
```

The regression requires Windows `icacls`. Its output contains two controls:

- the focused registry check proves a readable build, a negative control from
  the pre-repair registry source, and the repaired build;
- the full application check proves a readable build and the A/B/C/D denied
  access matrix: the committed pre-repair boundary fails with a Turbopack
  traversal diagnostic, the repaired boundary passes, reverting it fails again,
  and restoring the repaired boundary passes again.

The full matrix uses actual source files from the repository and the real
application import graph. It does not use a stubbed workspace or a reduced
module-only replacement. The fixture has no junctions or reparse points, and
the denied subtree is synthetic and contains no secrets or customer data.

The runtime portion separately checks registry enumeration, approved loading,
manifest/checksum validation, and symlink containment. If the execution
identity cannot create the synthetic symlink, the result is explicitly
`UNSUPPORTED_SYMLINK_SETUP`; it is not reported as a passing containment test.
No provider, database, customer project, or external network access is used.
