# Generated Runtime Smoke Test

The smoke test is opt-in and uses a disposable local fixture. It is not part of normal Factory CI and does not run customer code, customer migrations, Docker, or deployment. Without `ALLOW_GENERATED_RUNTIME_SMOKE=true` it prints `REAL_GENERATED_RUNTIME_SMOKE_PENDING` and exits nonzero.

The real Factory smoke runs the same bounded npm sequence only after deterministic preflight passes.
