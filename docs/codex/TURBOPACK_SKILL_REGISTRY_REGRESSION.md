# Turbopack Skill Registry Regression

The opt-in regression exercises the real Next/Turbopack compiler boundary with
the production `SkillRegistry` import pattern. It creates a disposable local
fixture, physically copies the installed dependency tree, creates synthetic
registry data, applies an ACL denial to one fixture-owned directory, and
removes the fixture during cleanup.

Run from the repository root in PowerShell:

```powershell
$env:TURBOPACK_SKILL_REGISTRY_REGRESSION = "1"
npm.cmd run test:turbopack-skill-registry
Remove-Item Env:TURBOPACK_SKILL_REGISTRY_REGRESSION
```

The regression requires Windows `icacls`. It reports a readable build, a
negative control using the unannotated source from `HEAD`, a repaired build
using the current source, and synthetic runtime checks for enumeration,
approved loading, manifest/checksum validation, and symlink containment.

`UNSUPPORTED_SYMLINK_SETUP` is an explicit non-pass result when the execution
identity cannot create the synthetic symlink needed for that subcheck. No
provider, database, customer project, or external network access is used.
