# Safe skill import guide

External skills may later be obtained from skills.sh or another reviewed source, but this foundation does not browse or download them. A future operator should first obtain a specific source, verify its license and provenance, and provide the extracted directory explicitly to the server-side import service.

The service must be allowed to finish staging and review before any approval decision. Review the original `SKILL.md`, all findings, commands, scripts, references, license evidence, source commit/tag, and requested permissions. Approve only the smallest file, role, task, and tool set needed. Never use `npx skills add`; agents will not install skills or packages.

Staging is unavailable to loaders. Approval is checksum-bound, version-pinned, and immutable. No external skill is currently approved.
