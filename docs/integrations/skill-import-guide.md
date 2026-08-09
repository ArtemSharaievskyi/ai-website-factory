# Safe skill import guide

External skills may be discovered through the dedicated read-only skills.sh adapter or obtained from an explicit local path. The adapter uses only bounded public HTTPS JSON retrieval and hands content to the existing staging service; it never approves, assigns, executes, or installs anything. Operators must still verify license and provenance before explicit manual approval.

The service must be allowed to finish staging and review before any approval decision. Review the original `SKILL.md`, all findings, commands, scripts, references, license evidence, source commit/tag, and requested permissions. Approve only the smallest file, role, task, and tool set needed. Never use `npx skills add`; agents will not install skills or packages.

Staging is unavailable to loaders. Approval is checksum-bound, version-pinned, and immutable. Phase 4B2 has exactly three approved reviewer procedures; their internal IDs and checksums are documented in [skills-runtime.md](skills-runtime.md).
