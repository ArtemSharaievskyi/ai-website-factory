# Backend implementation handlers

Backend handlers extend the existing one-READY-task Implementation Agent. They derive context and validation requirements, but never call providers directly, write files, execute commands, grant tools, or transition workflow state. The provider proposes operations; the existing proposal validator and atomic applier remain authoritative.

Supported task types are forms, Server Actions, Route Handlers, database schema, RLS, authentication, Storage, and email. Each is accepted only when the corresponding approved plan requires it.
