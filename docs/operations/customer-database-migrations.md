# Customer database migrations

Database tasks generate deterministic SQL files only under `supabase/migrations/`. Migration names and checksums trace to the DataModelPlan. Static checks reject destructive SQL, secret literals, RLS disabling, broad grants, unsafe extensions, and external-program execution. Customer migrations are not executed or connected to.
