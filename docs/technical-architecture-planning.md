# Technical architecture planning

Architecture remains inside Next.js App Router, React, TypeScript, Tailwind, shadcn/ui, Supabase, Zod, npm, and the existing validation/test stack. The planned backend order is Server Actions, Route Handlers, then Supabase services. Auth, Storage, email, database entities, RLS, environment variables, dependencies, security controls, and test categories are included only when justified by approved requirements.

Backend handlers follow this accepted preference order and cannot revise accepted architecture or dependencies.

NestJS, Redis, BullMQ, workers, microservices, automatic CMS/admin infrastructure, and unnecessary realtime or Edge Functions are explicitly rejected. This stage creates logical plans only; it does not generate source or migrations.
