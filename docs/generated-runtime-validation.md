# Generated Project Runtime Validation

Generated projects are validated only from a mutable staging workspace beneath the configured generated-project root. The validator checks `package.json`, `package-lock.json`, required scripts, npm-only package metadata, and lifecycle-script safety before invoking the fixed command sequence: `npm ci`, lint, typecheck, tests, and build.

Each command produces a bounded, redacted result and a corresponding quality check. Validation stops at the first failure, records a safe repair category, and never accepts caller-provided executable or argument strings.

The real generated-project smoke test is opt-in: `ALLOW_GENERATED_RUNTIME_SMOKE=true npm run generated:runtime-smoke`.

Functional QA may start only after this report is passed and its package/lockfile checksums remain current.

Full execution routes runtime validation tasks to these fixed operations and reruns only invalidated gates after targeted repair.
# Production composition

In `REAL_E2E`, `GeneratedRuntimeValidator` is composed with the real `NodeRuntimeProcessRunner`; test compositions inject their fake runner explicitly.
