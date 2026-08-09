# Quality gates

A future generated project is not `PROJECT_READY` until all applicable checks pass:

```text
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit
```

Applicable additions include Supabase migrations and RLS, form and database behavior, auth and authorization, uploads, email, environment validation, secret scanning, Git initialization, and GitHub push. No known error may remain at handoff. Screenshot-based visual review is explicitly not a gate; browser checks are functional.

The current Factory foundation additionally validates its own lint, typecheck, unit test, build, and Docker image/compose configuration.
