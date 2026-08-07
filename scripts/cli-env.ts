import path from "node:path";
import { loadEnvConfig } from "@next/env";

/** Load project server environment using Next.js precedence without exposing values. */
export function loadFactoryCliEnv(projectRoot = path.resolve(__dirname, "..")) {
  loadEnvConfig(projectRoot, false, { info: () => undefined, error: () => undefined });
}
