import type { RequirementSpecification } from "./schema";

/** Normalize display text only for comparison; typed fields remain authoritative. */
export const normalizeRequirementText = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase().replace(/[\s._-]+/g, " ").trim();

/**
 * This classifier is deliberately semantic and bounded. It is used to resolve
 * a user's target when a legacy V1 exclusion and a V2 requirement use different
 * language, never as the source of current authority.
 */
export const isSimulationProhibitionRequirement = (value: string) => {
  const normalized = value.normalize("NFKC").toLocaleLowerCase();
  const success = /(?:erfolg|success|submission|submit|\u00fcbermittlung|uebermittlung|\u00fcbertragung|uebertragung|vort\u00e4usch|vortaeusch|fake|simulat|\u0443\u0441\u043f\u0435\u0448|\u0443\u0441\u043f\u0435\u0445|\u043e\u0442\u043f\u0440\u0430\u0432|\u0438\u043c\u0438\u0442\u0430\u0446|\u0441\u0438\u043c\u0443\u043b|\u0443\u0441\u043f\u0456\u0448|\u0443\u0441\u043f\u0456\u0445|\u043f\u0435\u0440\u0435\u0434\u0430\u0447|\u0432\u0456\u0434\u043f\u0440\u0430\u0432)/i.test(normalized);
  const prohibition = /(?:kein(?:e)?|nicht|no|not|do not|don't|forbid|prohibit|verbot|\u0437\u0430\u043f\u0440\u0435\u0449|\u043d\u0435\u043b\u044c\u0437\u044f|\u043d\u0435 \u043c\u043e\u0436\u043d\u0430|\u043d\u0435 \u0441\u0438\u043c\u0443\u043b|\u043d\u0435 \u0456\u043c\u0456\u0442)/i.test(normalized);
  return success && prohibition;
};

export type RequirementDimension =
  | "FORM_SUCCESS_SIMULATION"
  | "FORM_TRANSMISSION"
  | "ANALYTICS"
  | "ASSET_REPLACEMENT"
  | "ROUTE_POLICY"
  | "GENERIC";

export const requirementDimensionForText = (value: string): RequirementDimension => {
  if (isSimulationProhibitionRequirement(value)) return "FORM_SUCCESS_SIMULATION";
  if (/(?:analytics|tracking|telemetry|conversion tracking|analyse|\u0430\u043d\u0430\u043b\u0438\u0442|\u0430\u043d\u0430\u043b\u0456\u0442)/i.test(value)) return "ANALYTICS";
  if (/(?:replace|replacement|generate|create|redraw|ersetz|generier|neu erstellen|logo|marke|wordmark|\u043b\u043e\u0433\u043e\u0442\u0438\u043f)/i.test(value)) return "ASSET_REPLACEMENT";
  if (/(?:single[- ]page|one[- ]page|nur eine seite|nur eine route|\u043e\u0434\u043d\u0430 \u0441\u0442\u0440|\u043e\u0434\u043d\u0430 \u0441\u0442\u043e\u0440\u0456\u043d)/i.test(value)) return "ROUTE_POLICY";
  if (/(?:email|api|transmission|\u00fcbertragung|uebertragung|\u00fcbermittlung|uebermittlung|\u043f\u0435\u0440\u0435\u0434\u0430\u0447|\u0432\u0456\u0434\u043f\u0440\u0430\u0432|\u043e\u0442\u043f\u0440\u0430\u0432)/i.test(value)) return "FORM_TRANSMISSION";
  return "GENERIC";
};

/**
 * Canonical downstream authority. Revision history is retained on the stored
 * document, but it is not part of the current effective requirement payload.
 */
export function getEffectiveBriefRequirements(brief: RequirementSpecification): RequirementSpecification {
  const current = structuredClone(brief);
  delete current.requirementHistory;
  return current;
}

export function getHistoricalBriefRequirements(brief: RequirementSpecification) {
  return brief.requirementHistory ?? [];
}
