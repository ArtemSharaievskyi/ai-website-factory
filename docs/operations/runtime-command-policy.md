# Runtime Command Policy

Only these immutable specifications are executable:

- `npm ci`
- `npm run lint`
- `npm run typecheck`
- `npm test -- --run`
- `npm run build`

The runner resolves npm to `npm.cmd` on Windows and uses `shell: false`. There is no generic shell or arbitrary command API. Unsupported tasks fail closed.
