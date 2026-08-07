# Runtime Environment Security

Runtime processes receive a minimal environment: platform path/temp variables and explicitly approved non-secret server-only values. Factory credentials and connection secrets, including OpenAI, database, Supabase service-role, registry, and npm token variables, are stripped before spawning npm.

Private registry configuration, alternate package managers, and lifecycle install hooks are rejected by workspace policy.
