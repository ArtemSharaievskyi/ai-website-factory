# Context7 smoke test

The manual command is `npm run context7:smoke`. It refuses without `ALLOW_REAL_CONTEXT7_SMOKE=true`, runs one synthetic narrow Next.js App Router query, uses temporary cache state, and prints only package/version/excerpt metadata. It is never run by tests or build. Without explicit local configuration and opt-in, report `REAL_CONTEXT7_SMOKE_PENDING`.
