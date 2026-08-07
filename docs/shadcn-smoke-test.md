# Registry smoke test

Run `npm run shadcn:smoke` only with `ALLOW_REAL_SHADCN_SMOKE=true`. The command uses a synthetic implementation task, one small button reference, temporary cache state, bounded normalization/security checks, and safe metadata output. It never installs a component or writes to a customer workspace. Without explicit opt-in, report `REAL_SHADCN_SMOKE_PENDING`.

The full Factory smoke records shadcn as `not-needed` unless the selected implementation demands it; synthetic transport is never substituted in a real run.
