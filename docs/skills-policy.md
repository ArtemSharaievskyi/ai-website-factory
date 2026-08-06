# Skills policy

skills.sh may later supply approved professional procedures and reusable skills. It does not replace the Orchestrator. Agents may not install arbitrary skills. Imported skills must be reviewed, versioned, approved, and restricted to specific roles. Skills and scripts are part of the trust boundary and require dependency and behavior review before approval.

The Approved Skills Registry foundation is implemented, but the approved registry is intentionally empty. Skills are imported only from an explicit local path, staged in an isolated Factory-owned directory, statically reviewed, manually approved, checksum-bound, and loaded through bounded server-side APIs. No skills.sh network call, `npx skills add`, package installation, script execution, or automatic approval is used.

The Orchestrator consumes only an approved registry snapshot and attaches selected skill IDs after role, task type, tool, approval, and context-budget filtering. Graph creation also works with zero approved skills.

Implementation execution loads only skill IDs already assigned to the task. Revoked, superseded, staging, or unapproved skills are rejected; scripts are never executed.
