import { z } from "zod";
import { LocaleSchema } from "@/domain/shared/schemas";

/** English remains the current default; canonical operator language may be any supported locale. */
export const OperatorLanguageSchema = LocaleSchema;
export const SiteLanguageSchema = LocaleSchema;
export const SiteLanguageDecisionSchema = z.union([z.literal("UNRESOLVED"), SiteLanguageSchema]);

export const FACTORY_OPERATOR_LANGUAGE = "en" as const;
export type OperatorLanguage = z.infer<typeof OperatorLanguageSchema>;
export type SiteLanguage = z.infer<typeof SiteLanguageSchema>;
export type SiteLanguageDecision = z.infer<typeof SiteLanguageDecisionSchema>;

const LANGUAGE_ALIASES: Record<string, string> = {
  deutsch: "de",
  german: "de",
  english: "en",
  ukrainian: "uk",
  russian: "ru",
};

export function normalizeSiteLanguage(value: string | undefined): SiteLanguageDecision {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "UNRESOLVED";
  const alias = LANGUAGE_ALIASES[normalized];
  if (alias) return alias;
  const locale = normalized.match(/^[a-z]{2}(?:-[a-z]{2})?$/i)?.[0];
  if (!locale) return "UNRESOLVED";
  return locale.length === 5 ? `${locale.slice(0, 2)}-${locale.slice(3).toUpperCase()}` : locale;
}

export function inferSiteLanguageFromPrompt(prompt: string): SiteLanguageDecision {
  const match = prompt.match(/(?:website|webseite|site|website content|customer website)[^\n.]{0,60}?(?:in|auf|language|sprache)\s+(english|german|deutsch|ukrainian|russian|[a-z]{2}(?:-[A-Z]{2})?)/i)
    ?? prompt.match(/\b(english|german|deutsch|ukrainian|russian)\s+(?:website|webseite|site)\b/i)
    ?? prompt.match(/\b(?:language|languages|sprache|sprachen|locale|default locale)\s*[:=]\s*([^\n,;.]+)/i);
  return normalizeSiteLanguage(match?.[1]);
}
