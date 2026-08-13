import { z } from "zod";
import { LocaleSchema } from "@/domain/shared/schemas";

/** The Factory/operator conversation is intentionally English in this phase. */
export const OperatorLanguageSchema = z.literal("en");
export const SiteLanguageSchema = LocaleSchema;

export const FACTORY_OPERATOR_LANGUAGE = "en" as const;
export type OperatorLanguage = z.infer<typeof OperatorLanguageSchema>;
export type SiteLanguage = z.infer<typeof SiteLanguageSchema>;
