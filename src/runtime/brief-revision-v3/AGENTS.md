# Brief Revision V3 acceptance evidence

- The executor records immutable facts only; `acceptance-verifier.ts` owns independent authoritative reads.
- Verdicts are derived from verified facts; callers do not provide PASS.
- Final evidence is source/run bound and published as one atomic immutable artifact.
- V2 mutation absence requires graph-derived static proof plus real seam instrumentation.
- Synthetic cleanup is ownership-based and independently verified, including `idempotency_records` when applicable.
