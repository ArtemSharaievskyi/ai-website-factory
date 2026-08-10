import { existsSync, readFileSync } from "node:fs";
import { Pool } from "pg";

function loadLocalEnv() {
  for (const filename of [".env.local", ".env"]) {
    if (!existsSync(filename)) continue;
    for (const line of readFileSync(filename, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      const value = match[2].replace(/^['"]|['"]$/g, "");
      process.env[match[1]] = value;
    }
  }
}

export function createConfiguredPool() {
  loadLocalEnv();
  if (!process.env.DATABASE_URL) { const error = new Error("DATABASE_CONFIGURATION_MISSING"); error.code = "DATABASE_CONFIGURATION_MISSING"; throw error; }
  const connectionString = new URL(process.env.DATABASE_URL);
  connectionString.searchParams.delete("sslmode");
  connectionString.searchParams.delete("uselibpqcompat");
  return new Pool({ connectionString: connectionString.toString(), ssl: { rejectUnauthorized: false }, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 });
}

export function safeDatabaseCode(error) {
  if (error?.code === "DATABASE_CONFIGURATION_MISSING") return "DATABASE_CONFIGURATION_MISSING";
  if (error?.code === "28P01" || error?.code === "42501") return "DATABASE_PERMISSION_DENIED";
  if (error?.code === "57014" || error?.code === "ETIMEDOUT") return "DATABASE_TIMEOUT";
  if (error?.code === "DEPTH_ZERO_SELF_SIGNED_CERT" || error?.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" || /ssl|certificate/i.test(error?.message ?? "")) return "DATABASE_SSL_FAILED";
  return error?.code ? "DATABASE_CONNECTION_FAILED" : "DATABASE_CONNECTION_FAILED";
}
