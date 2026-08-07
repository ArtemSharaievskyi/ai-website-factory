import type { ClarificationQuestion } from "../domain/requirements/schema";

export type VeloFixSmokeFacts = {
  businessName: "VeloFix Werkstatt";
  language: "German";
  service: "Bicycle repairs";
  audience: "Local bicycle owners";
  pages: "home, services, appointment";
  imagery: "Placeholders only";
  logo: "No supplied logo";
  contact: "No contact details supplied; do not invent them";
  excludedClaims: "No address, opening hours, prices, staff, testimonials, or customer data";
  formValidation: "Client and server validation";
  noExternalDatabase: "No real database persistence";
  noRealEmail: "No real email";
  formFields: readonly [{ name: "Name"; required: true }, { name: "E-Mail"; required: true }, { name: "Fahrradtyp"; required: true }, { name: "Beschreibung des Problems"; required: true }];
};

export const VELOFIX_SMOKE_FACTS: VeloFixSmokeFacts = {
  businessName: "VeloFix Werkstatt",
  language: "German",
  service: "Bicycle repairs",
  audience: "Local bicycle owners",
  pages: "home, services, appointment",
  imagery: "Placeholders only",
  logo: "No supplied logo",
  contact: "No contact details supplied; do not invent them",
  excludedClaims: "No address, opening hours, prices, staff, testimonials, or customer data",
  formValidation: "Client and server validation",
  noExternalDatabase: "No real database persistence",
  noRealEmail: "No real email",
  formFields: [
    { name: "Name", required: true },
    { name: "E-Mail", required: true },
    { name: "Fahrradtyp", required: true },
    { name: "Beschreibung des Problems", required: true },
  ],
};

export type ClarificationResolution = { answer: string; intent: string } | { answer?: undefined; intent: string; safeReason: "FIXTURE_FACT_MISSING" | "UNSUPPORTED_REQUIREMENT_KEY" };

export function resolveVeloFixClarification(question: Pick<ClarificationQuestion, "requirementKey" | "category">, facts = VELOFIX_SMOKE_FACTS): ClarificationResolution {
  switch (question.requirementKey) {
    case "localization.languages": return { answer: facts.language, intent: "language" };
    case "services.list": return { answer: facts.service, intent: "service-list" };
    case "contact.informationTreatment": return { answer: facts.contact, intent: "contact-information-treatment" };
    case "imagery.placeholders": return { answer: facts.imagery, intent: "placeholder-imagery" };
    case "appointmentForm.notifications": return { answer: facts.noRealEmail, intent: "form-notifications" };
    case "appointmentForm.submissionDestination": return { answer: `${facts.noExternalDatabase}; ${facts.noRealEmail}.`, intent: "form-submission-destination" };
    case "appointmentRequest.delivery": return { answer: `${facts.noExternalDatabase}; ${facts.noRealEmail}.`, intent: "form-submission-destination" };
    case "customerData.storage": return { answer: `${facts.noExternalDatabase}; customer data must not be retained.`, intent: "customer-data-storage" };
    case "services.detail": return { answer: facts.service, intent: "service-list" };
    case "appointmentForm.fields": return { answer: facts.formFields.map((field) => `${field.name} (required)`).join(", "), intent: "form-fields" };
    case "appointmentForm.privacy": return { intent: "form-privacy", safeReason: "FIXTURE_FACT_MISSING" };
    case "brand.visualDirection": return { answer: `${facts.logo}; do not generate a logo.`, intent: "logo-treatment" };
    default: return { intent: question.requirementKey ?? question.category, safeReason: "UNSUPPORTED_REQUIREMENT_KEY" };
  }
}
