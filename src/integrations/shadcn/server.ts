import "server-only";
import type { ShadcnRegistryTransport } from "./contracts";
export * from "./config";
export * from "./service";

// Fixed official source only; callers cannot provide a URL or execute a CLI.
export const officialShadcnTransport: ShadcnRegistryTransport = async ({ componentName, signal }) => {
  const response = await fetch(`https://ui.shadcn.com/r/styles/new-york/${componentName}.json`, { signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Official shadcn Registry returned HTTP ${response.status}.`);
  return response.text();
};
