# QA Local Server

The server lifecycle launches only the generated project's `npm run start:test` script with fixed loopback host and assigned port arguments. The runner uses `shell: false`, waits for a local readiness response, runs one browser context sequentially, and always attempts browser/server cleanup. The script cannot deploy, migrate, or contact production.
