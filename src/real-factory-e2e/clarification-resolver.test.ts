import { describe, expect, it } from "vitest";
import { resolveVeloFixClarification } from "./clarification-resolver";

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

  it("uses stable requirement keys rather than question wording", () => {
    expect(resolveVeloFixClarification(question("localization.languages", "localization"))).toMatchObject({ intent: "language", answer: "German" });
  });

  it.each(["appointmentForm.fields", "appointmentForm.privacy"])("keeps missing fixture facts unresolved: %s", (key) => {
    expect(resolveVeloFixClarification(question(key))).toMatchObject({ safeReason: "FIXTURE_FACT_MISSING" });
  });

  it("does not invent answers for unknown requirements", () => {
    expect(resolveVeloFixClarification(question("openingHours.value"))).toMatchObject({ safeReason: "UNSUPPORTED_REQUIREMENT_KEY" });
  });
});
