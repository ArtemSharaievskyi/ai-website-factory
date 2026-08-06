import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import path from "node:path";

const directory = path.resolve("supabase/migrations");
const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort();
if (!files.length) throw new Error("No SQL migrations found.");
for (const file of files) {
  const sql = await readFile(path.join(directory, file), "utf8");
  if (/SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|password\s*=/i.test(sql)) throw new Error(`Migration contains a credential-like value: ${file}`);
  if (!sql.includes("enable row level security")) throw new Error(`Migration does not enable RLS: ${file}`);
}
console.log(`Validated ${files.length} migration(s).`);
