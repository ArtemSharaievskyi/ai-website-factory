import type { ClarificationQuestion } from "../domain/requirements/schema";

export type VeloFixSmokeFacts = {
  businessName: "VeloFix Werkstatt";
  language: "German";
  service: "Bicycle repairs";
  audience: "Local bicycle owners";
  primaryAction: "Request an appointment";
  acceptanceCriteria: "Local navigation, appointment form with client and server validation, and a successful production build";
  pages: "home, services, appointment";
  imagery: "Placeholders only";
  logo: "No supplied logo";
  contact: "No contact details supplied; do not invent them";
  excludedClaims: "No address, opening hours, prices, staff, testimonials, or customer data";
  formValidation: "Client and server validation";
  noExternalDatabase: "No real database persistence";
  noRealEmail: "No real email";
  pageContent: "Home introduces VeloFix Werkstatt and bicycle repairs; services explains bicycle repair; appointment explains requesting an appointment and presents the exact appointment form. Placeholder copy may be generated from these supplied facts without unsupported business claims.";
  submissionBehavior: "After valid client and server validation, show a German success message; do not send an email and do not persist the submitted data.";
  validationRuntime: "Client and server validation through the existing Next.js server boundary; hosting and deployment are outside this smoke scenario.";
  validationRules: "All four fields are required and the E-Mail field uses standard email-format validation; no additional length rules are required.";
  routeNames: "`/` titled Startseite, `/leistungen` titled Leistungen, and `/termin` titled Termin vereinbaren.";
  formFields: readonly [{ name: "Name"; required: true }, { name: "E-Mail"; required: true }, { name: "Fahrradtyp"; required: true }, { name: "Beschreibung des Problems"; required: true }];
};

export const VELOFIX_SMOKE_FACTS: VeloFixSmokeFacts = {
  businessName: "VeloFix Werkstatt",
  language: "German",
  service: "Bicycle repairs",
  audience: "Local bicycle owners",
  primaryAction: "Request an appointment",
  acceptanceCriteria: "Local navigation, appointment form with client and server validation, and a successful production build",
  pages: "home, services, appointment",
  imagery: "Placeholders only",
  logo: "No supplied logo",
  contact: "No contact details supplied; do not invent them",
  excludedClaims: "No address, opening hours, prices, staff, testimonials, or customer data",
  formValidation: "Client and server validation",
  noExternalDatabase: "No real database persistence",
  noRealEmail: "No real email",
  pageContent: "Home introduces VeloFix Werkstatt and bicycle repairs; services explains bicycle repair; appointment explains requesting an appointment and presents the exact appointment form. Placeholder copy may be generated from these supplied facts without unsupported business claims.",
  submissionBehavior: "After valid client and server validation, show a German success message; do not send an email and do not persist the submitted data.",
  validationRuntime: "Client and server validation through the existing Next.js server boundary; hosting and deployment are outside this smoke scenario.",
  validationRules: "All four fields are required and the E-Mail field uses standard email-format validation; no additional length rules are required.",
  routeNames: "`/` titled Startseite, `/leistungen` titled Leistungen, and `/termin` titled Termin vereinbaren.",
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
    case "appointmentForm.emailDelivery": return { answer: facts.noRealEmail, intent: "form-notifications" };
    case "validationRules": return { answer: facts.formValidation, intent: "form-validation" };
    case "appointmentFormValidation":
    case "appointment_form_validation": return { answer: facts.formValidation, intent: "form-validation" };
    case "serverValidationRules": return { answer: facts.formValidation, intent: "form-validation" };
    case "appointmentEmailDelivery": return { answer: facts.noRealEmail, intent: "form-notifications" };
    case "notificationEmail":
    case "appointment-response-and-confirmation": return { answer: facts.noRealEmail, intent: "form-notifications" };
    case "appointmentSubmissionDelivery": return { answer: facts.noRealEmail, intent: "form-notifications" };
    case "appointmentForm.submissionDestination": return { answer: `${facts.noExternalDatabase}; ${facts.noRealEmail}.`, intent: "form-submission-destination" };
    case "appointmentSubmissionDestination": return { answer: `Local/mock smoke submission only; ${facts.noExternalDatabase}; ${facts.noRealEmail}.`, intent: "form-submission-destination" };
    case "appointmentForm.submissionHandling": return { answer: `Local/mock smoke submission only; ${facts.noExternalDatabase}; ${facts.noRealEmail}.`, intent: "form-submission-destination" };
    case "appointmentSubmissionHandling":
    case "appointment-submission-handling": return { answer: `Local/mock smoke submission only; ${facts.noExternalDatabase}; ${facts.noRealEmail}.`, intent: "form-submission-destination" };
    case "submissionHandling": return { answer: `Local/mock smoke submission only; ${facts.noExternalDatabase}; ${facts.noRealEmail}.`, intent: "form-submission-destination" };
    case "appointmentRequestHandling":
    case "submissionDelivery": return { answer: `Local/mock smoke submission only; ${facts.noExternalDatabase}; ${facts.noRealEmail}.`, intent: "form-submission-destination" };
    case "appointmentRequest.delivery": return { answer: `${facts.noExternalDatabase}; ${facts.noRealEmail}.`, intent: "form-submission-destination" };
    case "customerData.storage": return { answer: `${facts.noExternalDatabase}; customer data must not be retained.`, intent: "customer-data-storage" };
    case "customer_data": return { answer: `${facts.excludedClaims}; ${facts.noExternalDatabase}.`, intent: "customer-data-storage" };
    case "appointmentDataPersistence":
    case "appointmentForm.persistence":
    case "appointmentStorage":
    case "submissionStorage":
    case "appointmentPersistence":
    case "dataPersistence": return { answer: `${facts.noExternalDatabase}; local/mock smoke behavior only.`, intent: "customer-data-storage" };
    case "services.detail": return { answer: facts.service, intent: "service-list" };
    case "pageContent": return { answer: facts.pageContent, intent: "page-content" };
    case "forms.appointment.validSubmissionBehavior": return { answer: facts.submissionBehavior, intent: "form-success-behavior" };
    case "database.appointmentStorage": return { answer: facts.noExternalDatabase, intent: "customer-data-storage" };
    case "forms.appointment.validation": return { answer: `${facts.formValidation}; ${facts.validationRuntime}`, intent: "form-validation" };
    case "forms.validationRules": return { answer: facts.validationRules, intent: "form-validation" };
    case "pages.routeNames": return { answer: facts.routeNames, intent: "pages" };
    case "workflow.briefPrerequisite": return { answer: "The finalized Project Brief is explicitly approved in the Brief Approval stage before Planner runs.", intent: "workflow-brief-approval" };
    case "briefApproval": return { answer: "The finalized Project Brief is explicitly approved in the Brief Approval stage before Planner runs.", intent: "workflow-brief-approval" };
    case "workflow.briefApproval": return { answer: "The finalized Project Brief is explicitly approved in the Brief Approval stage before Planner runs.", intent: "workflow-brief-approval" };
    case "projectBriefApproval": return { answer: "The finalized Project Brief is explicitly approved in the Brief Approval stage before Planner runs.", intent: "workflow-brief-approval" };
    case "primary-action":
    case "primaryAction":
    case "primary_action": return { answer: facts.primaryAction, intent: "primary-action" };
    case "acceptance-criteria":
    case "acceptanceCriteria": return { answer: facts.acceptanceCriteria, intent: "acceptance-criteria" };
    case "buildEnvironment": return { answer: facts.acceptanceCriteria, intent: "acceptance-criteria" };
    case "appointmentForm.fields":
    case "appointment_form_fields": return { answer: facts.formFields.map((field) => `${field.name} (required)`).join(", "), intent: "form-fields" };
    case "required_pages": return { answer: facts.pages, intent: "pages" };
    case "appointmentForm.validation": return { answer: facts.formValidation, intent: "form-validation" };
    case "appointmentForm.privacy": return { intent: "form-privacy", safeReason: "FIXTURE_FACT_MISSING" };
    case "brand.visualDirection": return { answer: `${facts.logo}; do not generate a logo.`, intent: "logo-treatment" };
    default: return { intent: question.requirementKey ?? question.category, safeReason: "UNSUPPORTED_REQUIREMENT_KEY" };
  }
}
