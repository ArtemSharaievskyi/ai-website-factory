import { createConfiguredPool, safeDatabaseCode } from "./db-common.mjs";
const pool = createConfiguredPool();
try { const result = await pool.query("SELECT filename, checksum, applied_at FROM factory_schema_migrations ORDER BY filename"); for (const row of result.rows) console.log(`${row.filename}: applied (${row.checksum})`); if (!result.rows.length) console.log("No migrations applied."); }
catch (error) { console.error(safeDatabaseCode(error)); process.exitCode = 1; }
finally { await pool.end(); }
