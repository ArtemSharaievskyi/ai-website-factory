# Server Actions policy

Server Actions are preferred when accepted architecture selects them. Generated actions must use server placement, validate input with Zod, authorize protected mutations, avoid client ownership trust, return safe errors, and never expose service-role keys or raw database errors. Unplanned actions are rejected.
