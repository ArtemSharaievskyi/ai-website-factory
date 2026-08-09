import { Context7Error } from "./errors";

export const APPROVED_CONTEXT7_PACKAGES = ["next", "react", "react-dom", "typescript", "tailwindcss", "zod", "react-hook-form", "@supabase/supabase-js", "@supabase/ssr", "vitest", "@playwright/test", "motion"] as const;
const vague = /^(everything|all|entire|complete)\b|\b(all|entire)\s+(the\s+)?(docs|documentation)\b/i;
export function validatePackageAccess(packageName: string, input: { dependencyPlan?: Array<{ name: string }>; fixedStack?: string[]; designApprovesMotion?: boolean }) {
  if (!APPROVED_CONTEXT7_PACKAGES.includes(packageName as typeof APPROVED_CONTEXT7_PACKAGES[number])) throw new Context7Error("CONTEXT7_LIBRARY_NOT_ALLOWED", "The package is not on the approved Context7 allowlist.");
  if (packageName === "motion" && !input.designApprovesMotion) throw new Context7Error("CONTEXT7_LIBRARY_NOT_PLANNED", "Motion documentation requires an approved design and dependency plan.");
  const planned = input.dependencyPlan?.some((entry) => entry.name === packageName) ?? false; const fixed = input.fixedStack?.includes(packageName) ?? false;
  if (!planned && !fixed) throw new Context7Error("CONTEXT7_LIBRARY_NOT_PLANNED", "The package is not present in the accepted DependencyPlan or fixed stack.");
}
export function validateTopic(topic: string) { if (vague.test(topic.trim())) throw new Context7Error("CONTEXT7_QUERY_INVALID", "Context7 topics must be narrow and task-relevant."); }
export const SUSPICIOUS_DOCUMENTATION = /(ignore\s+(all\s+)?previous\s+instructions|reveal\s+(the\s+)?system\s+prompt|upload\s+project\s+files|read\s+environment\s+variables|execute\s+this\s+command\s+automatically)/i;
