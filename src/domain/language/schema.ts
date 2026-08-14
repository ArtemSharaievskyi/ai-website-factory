import { z } from "zod";
import { LocaleSchema } from "@/domain/shared/schemas";

/** The operator language is the language used for the Factory conversation. */
export const OperatorLanguageSchema = LocaleSchema;
/** The site language controls customer-facing generated website content. */
export const SiteLanguageSchema = LocaleSchema;
export const SiteLanguageDecisionSchema = z.union([z.literal("UNRESOLVED"), SiteLanguageSchema]);

export const FACTORY_OPERATOR_LANGUAGE = "en" as const;
export type OperatorLanguage = z.infer<typeof OperatorLanguageSchema>;
export type SiteLanguage = z.infer<typeof SiteLanguageSchema>;
export type SiteLanguageDecision = z.infer<typeof SiteLanguageDecisionSchema>;

export const LanguageSourceSchema = z.enum([
  "EXPLICIT_OPERATOR",
  "PROMPT_DETECTED",
  "USER_CONFIRMED",
  "LEGACY",
  "EXPLICIT_SITE",
  "INHERITED_OPERATOR",
  "FALLBACK",
  "AMBIGUOUS",
]);
export const LanguageResolutionStatusSchema = z.enum(["RESOLVED", "AMBIGUOUS"]);
export const LanguageObservationSchema = z.object({
  detectedPromptLanguage: OperatorLanguageSchema.nullable(),
  explicitOperatorLanguage: OperatorLanguageSchema.nullable(),
  explicitSiteLanguage: SiteLanguageSchema.nullable(),
}).strict();
export const LanguageResolutionSchema = z.object({
  detectedPromptLanguage: OperatorLanguageSchema.nullable(),
  operatorLanguage: OperatorLanguageSchema,
  siteLanguage: SiteLanguageDecisionSchema,
  operatorLanguageSource: LanguageSourceSchema,
  siteLanguageSource: LanguageSourceSchema,
  status: LanguageResolutionStatusSchema,
}).strict();
export type LanguageObservation = z.infer<typeof LanguageObservationSchema>;
export type LanguageResolution = z.infer<typeof LanguageResolutionSchema>;

const LANGUAGE_ALIASES: Record<string, string> = {
  deutsch: "de",
  german: "de",
  english: "en",
  englisch: "en",
  ukrainian: "uk",
  ukrainisch: "uk",
  russian: "ru",
  russisch: "ru",
  "\u0440\u0443\u0441\u0441\u043a\u0438\u0439": "ru",
  "\u0440\u0443\u0441\u0441\u043a\u043e\u043c": "ru",
  "\u0443\u043a\u0440\u0430\u0438\u043d\u0441\u043a\u0438\u0439": "uk",
  "\u0443\u043a\u0440\u0430\u0457\u043d\u0441\u044c\u043a\u0438\u0439": "uk",
  "\u0443\u043a\u0440\u0430\u0457\u043d\u0441\u044c\u043a\u043e\u044e": "uk",
  "\u043d\u0435\u043c\u0435\u0446\u043a\u0438\u0439": "de",
  "\u043d\u0435\u043c\u0435\u0446\u043a\u043e\u043c": "de",
  "\u043d\u0456\u043c\u0435\u0446\u044c\u043a\u0438\u0439": "de",
  "\u043d\u0456\u043c\u0435\u0446\u044c\u043a\u043e\u044e": "de",
};

const languageWord = "english|german|deutsch|ukrainian|ukrainisch|russian|russisch|englisch|\\u0440\\u0443\\u0441\\u0441\\u043a\\u0438\\u0439|\\u0440\\u0443\\u0441\\u0441\\u043a\\u043e\\u043c|\\u0443\\u043a\\u0440\\u0430\\u0438\\u043d\\u0441\\u043a\\u0438\\u0439|\\u0443\\u043a\\u0440\\u0430\\u0457\\u043d\\u0441\\u044c\\u043a\\u0438\\u0439|\\u0443\\u043a\\u0440\\u0430\\u0457\\u043d\\u0441\\u044c\\u043a\\u043e\\u044e|\\u043d\\u0435\\u043c\\u0435\\u0446\\u043a\\u0438\\u0439|\\u043d\\u0435\\u043c\\u0435\\u0446\\u043a\\u043e\\u043c|\\u043d\\u0456\\u043c\\u0435\\u0446\\u044c\\u043a\\u0438\\u0439|\\u043d\\u0456\\u043c\\u0435\\u0446\\u044c\\u043a\\u043e\\u044e|\\u0440\\u0443\\u0441\\u0441\\u043a|\\u0443\\u043a\\u0440\\u0430\\u0457\\u043d\\u0441\\u044c\\u043a|\\u043d\\u0456\\u043c\\u0435\\u0446\\u044c|de|en|uk|ru";
const languageFromWord = (value: string | undefined): SiteLanguageDecision => normalizeSiteLanguage(value);

export function normalizeSiteLanguage(value: string | undefined): SiteLanguageDecision {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return "UNRESOLVED";
  const alias = LANGUAGE_ALIASES[normalized];
  if (alias) return alias;
  if (/^(?:\u0440\u0443\u0441\u0441\u043a\u0438\u0439|\u0440\u0443\u0441\u0441\u043a)/.test(normalized)) return "ru";
  if (/^(?:\u0443\u043a\u0440\u0430\u0457\u043d\u0441\u044c\u043a|\u0443\u043a\u0440\u0430\u0438\u043d\u0441\u043a)/.test(normalized)) return "uk";
  if (/^(?:\u043d\u0456\u043c\u0435\u0446\u044c\u043a|\u043d\u0435\u043c\u0435\u0446\u043a)/.test(normalized)) return "de";
  const locale = normalized.match(/^[a-z]{2}(?:-[a-z]{2})?$/i)?.[0];
  if (!locale) return "UNRESOLVED";
  return locale.length === 5 ? `${locale.slice(0, 2)}-${locale.slice(3).toUpperCase()}` : locale;
}

const stripQuotedContent = (prompt: string) => prompt
  .replace(/("[^"\n]*"|'[^'\n]*'|“[^”\n]*”|„[^“\n]*“|«[^»\n]*»|`[^`\n]*`)/g, " ")
  .replace(/\b(?:slogan|tagline|headline|business name|brand name|quote|quoted text)\s*[:=-][^\n.]*/gi, " ");

const explicitOperatorLanguageFromPrompt = (prompt: string): OperatorLanguage | null => {
  const cyrillicDirect = prompt.match(new RegExp(`(?:\u043e\u0442\u0432\u0435\u0447\u0430\u0439|\u0433\u043e\u0432\u043e\u0440\u0438|\u043e\u0431\u0449\u0430\u0439\u0441\u044f|\u043f\u0438\u0448\u0438)[^\\n.!?]{0,35}?(?:\u043d\u0430|\u043f\u043e)\\s+(${languageWord})`, "i"))
    ?? prompt.match(new RegExp(`(?:\u0432\u0456\u0434\u043f\u043e\u0432\u0456\u0434\u0430\u0439|\u0433\u043e\u0432\u043e\u0440\u0438|\u0441\u043f\u0456\u043b\u043a\u0443\u0439\u0441\u044f|\u043f\u0438\u0448\u0438)[^\\n.!?]{0,35}?(?:\u0443|\u043d\u0430)\\s+(${languageWord})`, "i"));
  const direct = prompt.match(new RegExp(`(?:answer|respond|reply|speak|talk|communicate|write|conversation|instructions?)\\b[^\\n.!?]{0,45}?\\b(?:in|auf)\\s+(${languageWord})\\b`, "i"))
    ?? prompt.match(new RegExp(`\\b(?:sprich|antworte|schreib|kommuniziere)\\b[^\\n.!?]{0,35}?\\b(?:auf|in)\\s+(${languageWord})\\b`, "i"))
    ?? prompt.match(new RegExp(`\\b(?:отвечай|говори|общайся|пиши)\\b[^\\n.!?]{0,35}\\b(?:на|по)\\s+(${languageWord})\\b`, "i"))
    ?? prompt.match(new RegExp(`\\b(?:відповідай|говори|спілкуйся|пиши)\\b[^\\n.!?]{0,35}\\b(?:у|на)\\s+(${languageWord})\\b`, "i"));
  const value = languageFromWord(direct?.[1] ?? cyrillicDirect?.[1]);
  return value === "UNRESOLVED" ? null : value;
};

const explicitSiteLanguageFromPrompt = (prompt: string): SiteLanguageDecision => {
  const cyrillicDirect = prompt.match(new RegExp(`(?:\u0441\u0430\u0439\u0442|\u0432\u0435\u0431\u0441\u0430\u0439\u0442)[^\\n.!?]{0,80}(?:\u043d\u0430|\u043c\u043e\u0432\u043e\u044e)\\s+(${languageWord})`, "i"))
    ?? prompt.match(new RegExp(`(?:\u0441\u0430\u0439\u0442|\u0432\u0435\u0431\u0441\u0430\u0439\u0442)\\s+(${languageWord})`, "i"));
  const direct = prompt.match(new RegExp(`(?:website|webseite|web site|site|customer website|website content|seite|сайт|вебсайт)[^\\n.!?]{0,80}\\b(?:in|auf|with|language|sprache|на|мовою)\\s+(${languageWord})\\b`, "i"))
    ?? prompt.match(new RegExp(`\\b(${languageWord})\\b[^\\n.!?]{0,35}\\b(?:website|webseite|web site|site|сайт|вебсайт)\\b`, "i"))
    ?? prompt.match(new RegExp(`\\b(?:site|website|webseite|website language|site language|language|languages|locale|default locale|sprache|sprachen)\\s*[:=]\\s*(${languageWord})\\b`, "i"))
    ?? prompt.match(new RegExp(`\\b(?:create|build|make|design|generate|erstelle|baue|создай|сделай|створи|зроби)\\b[^\\n.!?]{0,90}\\b(?:in|auf|на|у)\\s+(${languageWord})\\s+(?:website|webseite|site|сайт|вебсайт)\\b`, "i"));
  return languageFromWord(direct?.[1] ?? cyrillicDirect?.[1]);
};

const hasAmbiguousSiteIntent = (prompt: string) => /\b(?:multilingual|multi-language|multiple languages|several languages|another language|any language|which language|language undecided|language is undecided|mehrsprach|mehrere sprachen|welche sprache|несколько языков|язык не выбран|декілька мов|яку мову)\b/i.test(prompt)
  || /\b(?:english|german|deutsch|russian|ukrainian)\s+(?:or|oder|или|чи)\s+(?:english|german|deutsch|russian|ukrainian)\b/i.test(prompt);

const detectPromptLanguage = (prompt: string): OperatorLanguage | null => {
  const text = stripQuotedContent(prompt);
  const lower = text.toLowerCase();
  if (["\u043e\u0442\u0432\u0435\u0442\u044c", "\u043e\u0442\u0432\u0435\u0447\u0430\u0439", "\u0433\u043e\u0432\u043e\u0440\u0438", "\u043e\u0431\u0449\u0430\u0439\u0441\u044f", "\u0441\u043e\u0437\u0434\u0430\u0439", "\u0441\u0434\u0435\u043b\u0430\u0439", "\u0440\u0443\u0441\u0441\u043a"].some((marker) => lower.includes(marker)) || /[\u044b\u044d\u0451\u044a]/i.test(text)) return "ru";
  if (["\u0432\u0456\u0434\u043f\u043e\u0432\u0456\u0434\u0430\u0439", "\u0433\u043e\u0432\u043e\u0440\u0438", "\u0441\u043f\u0456\u043b\u043a\u0443\u0439\u0441\u044f", "\u0441\u0442\u0432\u043e\u0440\u0438", "\u0437\u0440\u043e\u0431\u0438", "\u0443\u043a\u0440\u0430\u0457\u043d\u0441\u044c\u043a"].some((marker) => lower.includes(marker)) || /[\u0456\u0457\u0454\u0491]/i.test(text)) return "uk";
  if (/\b(?:f\u00fcr ein|fuer ein|auf deutsch|deutschsprachig)\b/i.test(text)) return "de";
  if (/\b(?:antworte|sprich|erstelle|baue|mach|gestalte|auf deutsch|deutschsprach|webseite|für ein|fuer ein)\b/i.test(text)) return "de";
  if (/\b(?:build|create|make|design|generate|develop|answer|respond|speak|website|landing page|for a|for an|with a)\b/i.test(text)) return "en";
  return null;
};

export function resolveLanguageAuthority(input: {
  prompt: string;
  explicitOperatorLanguage?: string;
  explicitSiteLanguage?: string;
  languageObservation?: Partial<LanguageObservation>;
  legacy?: boolean;
}): LanguageResolution {
  const detected = detectPromptLanguage(input.prompt) ?? input.languageObservation?.detectedPromptLanguage ?? null;
  const promptOperator = input.explicitOperatorLanguage ? normalizeSiteLanguage(input.explicitOperatorLanguage) : "UNRESOLVED";
  const promptExplicitOperator = explicitOperatorLanguageFromPrompt(input.prompt) ?? "UNRESOLVED";
  const observedOperator = normalizeSiteLanguage(input.languageObservation?.explicitOperatorLanguage ?? undefined);
  const operatorLanguage = promptOperator !== "UNRESOLVED"
    ? promptOperator
    : promptExplicitOperator !== "UNRESOLVED"
      ? promptExplicitOperator
      : observedOperator !== "UNRESOLVED"
        ? observedOperator
      : detected ?? FACTORY_OPERATOR_LANGUAGE;
  const operatorLanguageSource = input.legacy
    ? "LEGACY"
    : promptOperator !== "UNRESOLVED" || promptExplicitOperator !== "UNRESOLVED" || observedOperator !== "UNRESOLVED"
      ? "EXPLICIT_OPERATOR"
      : detected
        ? "PROMPT_DETECTED"
        : "FALLBACK";

  const promptSite = input.explicitSiteLanguage ? normalizeSiteLanguage(input.explicitSiteLanguage) : explicitSiteLanguageFromPrompt(input.prompt);
  const observedSite = normalizeSiteLanguage(input.languageObservation?.explicitSiteLanguage ?? undefined);
  const explicitSite = promptSite !== "UNRESOLVED" ? promptSite : observedSite;
  const siteLanguage = explicitSite !== "UNRESOLVED"
    ? explicitSite
    : operatorLanguageSource === "FALLBACK" || hasAmbiguousSiteIntent(input.prompt)
      ? "UNRESOLVED"
      : operatorLanguage;
  const siteLanguageSource = input.legacy
    ? "LEGACY"
    : explicitSite !== "UNRESOLVED"
      ? (input.explicitSiteLanguage ? "EXPLICIT_SITE" : "PROMPT_DETECTED")
      : siteLanguage === "UNRESOLVED"
        ? "AMBIGUOUS"
        : "INHERITED_OPERATOR";
  return LanguageResolutionSchema.parse({
    detectedPromptLanguage: detected,
    operatorLanguage,
    siteLanguage,
    operatorLanguageSource,
    siteLanguageSource,
    status: operatorLanguageSource === "FALLBACK" || siteLanguageSource === "AMBIGUOUS" ? "AMBIGUOUS" : "RESOLVED",
  });
}

/** Compatibility helper retained for existing callers; it reports only explicit site intent. */
export function inferSiteLanguageFromPrompt(prompt: string): SiteLanguageDecision {
  return explicitSiteLanguageFromPrompt(prompt);
}

export function displayLanguageName(language: string): string {
  return ({ en: "English", de: "German", ru: "Russian", uk: "Ukrainian" } as Record<string, string>)[language] ?? language;
}
