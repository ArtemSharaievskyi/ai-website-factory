import { describe, expect, it } from "vitest";
import { resolveVeloFixClarification } from "./clarification-resolver";
import { VELOFIX_WERKSTATT_PROMPT } from "./spec";

const question = (requirementKey: string, category = "content") => ({ requirementKey, category }) as never;

describe("VeloFix clarification resolver", () => {
  it.each([
    ["localization.languages", "German"],
    ["services.list", "Bicycle repairs"],
    ["contact.informationTreatment", "No contact details supplied"],
    ["imagery.placeholders", "Placeholders only"],
    ["appointmentForm.notifications", "No real email"],
    ["appointmentForm.emailDelivery", "No real email"],
    ["validationRules", "Client and server validation"],
    ["appointmentFormValidation", "Client and server validation"],
    ["appointment_form_validation", "Client and server validation"],
    ["serverValidationRules", "Client and server validation"],
    ["appointmentEmailDelivery", "No real email"],
    ["notificationEmail", "No real email"],
    ["appointmentForm.submissionDestination", "No real database persistence"],
    ["appointmentSubmissionDestination", "Local/mock smoke submission"],
    ["appointmentForm.submissionHandling", "Local/mock smoke submission"],
    ["appointmentSubmissionHandling", "Local/mock smoke submission"],
    ["submissionHandling", "Local/mock smoke submission"],
    ["appointmentRequestHandling", "Local/mock smoke submission"],
    ["submissionDelivery", "Local/mock smoke submission"],
    ["appointmentRequest.delivery", "No real database persistence"],
    ["customerData.storage", "No real database persistence"],
    ["customer_data", "customer data"],
    ["appointmentDataPersistence", "No real database persistence"],
    ["appointmentForm.persistence", "No real database persistence"],
    ["appointmentStorage", "No real database persistence"],
    ["appointmentForm.validation", "Client and server validation"],
    ["dataPersistence", "No real database persistence"],
    ["services.detail", "Bicycle repairs"],
    ["primary-action", "Request an appointment"],
    ["primary_action", "Request an appointment"],
    ["acceptance-criteria", "Local navigation"],
    ["buildEnvironment", "successful production build"],
    ["brand.visualDirection", "No supplied logo"],
  ])("resolves %s from canonical fixture facts", (key, expected) => {
    expect(resolveVeloFixClarification(question(key)).answer).toContain(expected);
  });

  it("exposes exactly the four required VeloFix form fields", () => {
    const fields = ["Name", "E-Mail", "Fahrradtyp", "Beschreibung des Problems"];
    const answer = resolveVeloFixClarification(question("appointmentForm.fields")).answer ?? "";
    expect(answer.split(", ")).toEqual(fields.map((field) => `${field} (required)`));
    expect(answer).not.toContain("Telefon");
    expect(answer).not.toContain("Adresse");
  });

  it("resolves snake-case form field facts without inventing fields", () => {
    expect(resolveVeloFixClarification(question("appointment_form_fields")).answer).toContain("Name (required)");
  });

  it("keeps the canonical prompt aligned with the typed form facts", () => {
    expect(VELOFIX_WERKSTATT_PROMPT).toContain("Name (required), E-Mail (required), Fahrradtyp (required), and Beschreibung des Problems (required)");
  });

  it("uses stable requirement keys rather than question wording", () => {
    expect(resolveVeloFixClarification(question("localization.languages", "localization"))).toMatchObject({ intent: "language", answer: "German" });
  });

  it.each(["appointmentForm.privacy"])("keeps missing fixture facts unresolved: %s", (key) => {
    expect(resolveVeloFixClarification(question(key))).toMatchObject({ safeReason: "FIXTURE_FACT_MISSING" });
  });

  it("does not invent answers for unknown requirements", () => {
    expect(resolveVeloFixClarification(question("openingHours.value"))).toMatchObject({ safeReason: "UNSUPPORTED_REQUIREMENT_KEY" });
  });
});
