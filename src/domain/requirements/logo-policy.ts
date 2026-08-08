import type { RequirementSpecification } from "./schema";

export type LogoMode = "USER_SUPPLIED_LOGO" | "TEXT_WORDMARK" | "NO_LOGO";
export type LogoPolicy = { mode: LogoMode; wordmarkText?: string };

const explicitNoLogo = /\b(?:no|without|none|not)\b[^.\n]*(?:logo|brand mark|brandmark)|no supplied logo|logo was not supplied|do not generate (?:a )?logo/i;
const explicitWordmark = /\b(?:text\s+wordmark|word\s*mark|text\s+logo|typographic\s+wordmark)\b/i;
const meaningfulBrandFact = /\b(?:logo|brand|brandmark|palette|typography|layout)\b/i;

export function resolveLogoPolicy(requirements: RequirementSpecification): LogoPolicy {
  if (requirements.suppliedLogoLocation.status === "provided") return { mode: "USER_SUPPLIED_LOGO" };
  const statements = [...requirements.logoMetadata, ...requirements.brandFacts];
  const text = statements.join("; ");
  if (explicitWordmark.test(text)) return requirements.projectTitle ? { mode: "TEXT_WORDMARK", wordmarkText: requirements.projectTitle } : { mode: "TEXT_WORDMARK" };
  if (explicitNoLogo.test(text)) return { mode: "NO_LOGO" };
  if (requirements.brandFacts.some((fact) => meaningfulBrandFact.test(fact))) return { mode: "USER_SUPPLIED_LOGO" };
  return { mode: "NO_LOGO" };
}
