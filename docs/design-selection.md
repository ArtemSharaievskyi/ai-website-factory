# Design selection

The user selects one direction with the direction-set checksum, selected-direction checksum, expected project row version, and idempotency key. Selection persists `selected-design.json`, records a DecisionRecord, verifies the current set and direction membership, and transitions `AWAITING_DESIGN_SELECTION` to `READY_FOR_IMPLEMENTATION`.

The Design Agent cannot select on behalf of the user. Repeated identical selection is idempotent; conflicting retries or stale checksums are rejected.
