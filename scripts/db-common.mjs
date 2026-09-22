import path from "node:path";
import { Pool } from "pg";
import * as nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv.default ?? nextEnv;

function loadDatabaseEnvironment(projectRoot = path.resolve(process.cwd())) {
  loadEnvConfig(projectRoot, false, { info: () => undefined, error: () => undefined });
}

export function createConfiguredPool() {
  loadDatabaseEnvironment();
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
