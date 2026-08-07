# Implementation context

Context is assembled from the task, acceptance criteria, traceability references, selected design references, bounded architecture/content/asset excerpts, only files matching the task read scopes, assigned approved skills, allowed tools, and fixed conventions. Files are sorted deterministically, binary data is excluded, secret-like content is blocked, and byte/file limits are enforced.

The provider receives no original conversation, secrets, unrelated Project Memory, full repository, raw provider history, or hidden reasoning.

When explicitly permitted and relevant, the assembler may attach bounded normalized Context7 excerpts. They are advisory, untrusted reference material and never expand requirements, tools, file scopes, or implementation authority.

When a task explicitly has `shadcn-registry-read`, the assembler may attach a bounded, normalized component reference after relevance, dependency, source-security, and design-adaptation checks. Suggested Registry paths are not write authorization.
