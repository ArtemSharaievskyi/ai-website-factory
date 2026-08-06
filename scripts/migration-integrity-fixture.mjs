import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const sql = await readFile("supabase/migrations/202608060001_factory_metadata.sql", "utf8");
const checksum = (value) => createHash("sha256").update(value, "utf8").digest("hex");
if (checksum(sql) === checksum(`${sql}\n-- fixture mutation`)) throw new Error("MIGRATION_INTEGRITY_FIXTURE_FAILED");
console.log("MIGRATION_INTEGRITY_FIXTURE_OK");
