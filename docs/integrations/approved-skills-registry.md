# Approved Skills Registry

External skills are untrusted supply-chain inputs. The Factory uses a local, filesystem-backed registry with this lifecycle:

`explicit local import → isolated staging → manifest/checksums → static review → manual approval → immutable approved copy → bounded load`

The canonical layout is `skills/staging/`, `skills/approved/`, `skills/rejected/`, and `skills/registry/`. Staging and rejected payloads are ignored by Git; approved content is committed only when its license permits it. The Phase 4B2 registry contains exactly three approved external skills, each bound to its recorded candidate checksum; no other candidate is approved.

The registry never calls skills.sh, downloads Git repositories, invokes `npx skills add`, installs packages, executes scripts, exposes a public filesystem route, or runs agents. Registry metadata and audit events are small JSON/JSONL records; skill files remain local and are verified by SHA-256 manifests. No database migration is required for this local single-user foundation.

The dedicated skills.sh adapter now provides bounded official HTTPS JSON discovery/import into this same STAGING lifecycle. Discovery preserves provenance and never approves or assigns a skill; approved immutable copies remain local and do not require skills.sh at runtime.
