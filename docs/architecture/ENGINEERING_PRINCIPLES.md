# Engineering principles

These principles guide Factory domain and workflow changes:

- Each mutable concept has one canonical authority.
- AI may propose typed changes; deterministic host code applies them.
- Invalid states should be difficult or impossible to represent.
- History records provenance; it is never current state.
- Preservation comes from immutable patch semantics, not candidate rehydration.
- Validation is pure and must not mutate authoritative state.
- Failures fail closed and leave current state unchanged.
- Real customer projects are acceptance state, not debugging harnesses.
- Repeated adjacent defects signal a redesign or rebuild, not another semantic patch.
- Execution records facts; independent certification derives truth from authoritative state.
