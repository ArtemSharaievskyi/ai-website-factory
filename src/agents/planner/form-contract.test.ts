import { describe, expect, it } from "vitest";
import { FormPlanSchema, FormFieldIdSchema, FormSubmissionMechanismSchema, isLegacyFormField } from "./contracts";

const form = (fields: unknown[]) => FormPlanSchema.parse({ schemaVersion: 1, documentType: "forms-plan", projectId: "11111111-1111-4111-8111-111111111111", projectVersion: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", forms: [{ id: "appointment-request", route: "/termin", purpose: "Request an appointment", fields, businessValidation: [], consentRequirements: [], submissionMechanism: "server-action", databaseWrite: "No database write", emailBehavior: "No email", successState: "Success", errorState: "Error", rateLimitRequired: false, spamProtectionRequired: false, requirementReferences: ["brief:forms"] }], traceability: [] });

describe("FormPlan field identity contract", () => {
  it("keeps the same English fieldId across localized labels", () => {
    const german = form([{ fieldId: "bikeType", label: "Fahrradtyp", type: "text", required: true, validation: ["Required"] }]);
    const english = form([{ fieldId: "bikeType", label: "Bicycle type", type: "text", required: true, validation: ["Required"] }]);
    const ukrainian = form([{ fieldId: "bikeType", label: "Тип велосипеда", type: "text", required: true, validation: ["Required"] }]);
    expect(german.forms[0].fields[0]).toMatchObject({ fieldId: "bikeType", label: "Fahrradtyp" });
    expect(english.forms[0].fields[0]).toMatchObject({ fieldId: "bikeType", label: "Bicycle type" });
    expect(ukrainian.forms[0].fields[0]).toMatchObject({ fieldId: "bikeType", label: "Тип велосипеда" });
  });
  it("accepts Unicode labels but rejects localized labels as fieldIds", () => {
    expect(() => FormFieldIdSchema.parse("Fahrradtyp")).toThrow();
    expect(() => FormFieldIdSchema.parse("bikeType")).not.toThrow();
    expect(form([{ fieldId: "problemDescription", label: "Beschreibung des Problems", type: "textarea", required: true, validation: ["Required"] }]).forms[0].fields[0]).toMatchObject({ fieldId: "problemDescription" });
  });
  it("rejects duplicate new fieldIds", () => {
    expect(() => form([{ fieldId: "email", label: "E-Mail", type: "email", required: true, validation: ["Required"] }, { fieldId: "email", label: "Alternative E-Mail", type: "email", required: false, validation: [] }])).toThrow(/unique/);
  });
  it("keeps old persisted name-only records readable as legacy", () => {
    const legacy = form([{ name: "Fahrradtyp", type: "text", required: true, validation: ["Required"] }]);
    expect(isLegacyFormField(legacy.forms[0].fields[0])).toBe(true);
  });
  it("models a local simulated form without a server boundary", () => {
    expect(FormSubmissionMechanismSchema.parse("client-only")).toBe("client-only");
    const value = form([{ fieldId: "message", label: "Message", type: "textarea", required: true, validation: ["Required"] }]);
    const clientOnly = FormPlanSchema.parse({ ...value, forms: [{ ...value.forms[0], submissionMechanism: "client-only", databaseWrite: "No database write; local client state only.", emailBehavior: "No email and no external provider.", successState: "Show simulated local success, then reset.", rateLimitRequired: false, spamProtectionRequired: false }] });
    expect(clientOnly.forms[0].submissionMechanism).toBe("client-only");
  });
  it("rejects client-only persistence or transmission claims", () => {
    const value = form([{ fieldId: "message", label: "Message", type: "textarea", required: true, validation: ["Required"] }]);
    expect(() => FormPlanSchema.parse({ ...value, forms: [{ ...value.forms[0], submissionMechanism: "client-only", databaseWrite: "Write to the database" }] })).toThrow(/CLIENT_ONLY_PERSISTENCE_FORBIDDEN/);
    expect(() => FormPlanSchema.parse({ ...value, forms: [{ ...value.forms[0], submissionMechanism: "client-only", emailBehavior: "Send through an external provider" }] })).toThrow(/CLIENT_ONLY_TRANSMISSION_FORBIDDEN/);
  });
  it("preserves checksum semantics when only the label changes", () => {
    const german = form([{ fieldId: "bikeType", label: "Fahrradtyp", type: "text", required: true, validation: ["Required"] }]);
    const english = form([{ fieldId: "bikeType", label: "Bicycle type", type: "text", required: true, validation: ["Required"] }]);
    expect(JSON.stringify(german)).not.toBe(JSON.stringify(english));
    const germanField = german.forms[0].fields[0]; const englishField = english.forms[0].fields[0];
    expect("fieldId" in germanField && "fieldId" in englishField ? germanField.fieldId === englishField.fieldId : false).toBe(true);
  });
});
