# Server/client boundaries

Static checks reject service-role or secret environment access in client modules, Node-only APIs in browser code, unsafe server imports, secrets in JSX, and incorrectly placed Server Actions. Public Supabase clients still respect RLS; server privilege is never serialized.
