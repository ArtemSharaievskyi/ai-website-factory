# Skill security review

Every local import is scanned without executing any file. The scanner rejects traversal, absolute paths, symlinks, reserved Windows names, credentials, private keys, archives, dependencies, special files, and executable files outside `scripts/`. File count, total bytes, and individual bytes are bounded.

Static review reports rule ID, severity, file, line, explanation, blocker status, and reviewer action. It checks secret access, destructive filesystem operations, privilege escalation, network exfiltration, package installation, destructive Git, Docker host access, prompt injection, unsafe paths, and encoded/dynamically fetched payloads.

Static review does not prove safety. Critical findings block approval. High-risk skills need explicit narrowed roles, tasks, and tools; medium-risk scripts remain metadata-only and require explicit future execution approval. Missing license evidence or unresolved metadata also blocks approval.
