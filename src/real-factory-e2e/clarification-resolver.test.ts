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
    ["appointmentForm.submissionDestination", "No real database persistence"],
    ["appointmentRequest.delivery", "No real database persistence"],
    ["customerData.storage", "No real database persistence"],
    ["services.detail", "Bicycle repairs"],
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
