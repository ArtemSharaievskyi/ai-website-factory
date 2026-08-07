# RLS policy

RLS output must enable row-level security and express least-privilege policies per operation and role. Private data cannot use blanket `using (true)` or `with check (true)`, ownership must use authenticated identity, and anonymous writes require explicit approval.
