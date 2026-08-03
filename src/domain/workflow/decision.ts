import { z } from "zod";
import { DocumentBaseSchema, IsoDateTimeSchema, NonEmptyStringSchema, UuidSchema } from "../shared/schemas";

export const DecisionRecordSchema = z.object({ id: UuidSchema, timestamp: IsoDateTimeSchema, actorType: z.enum(["user", "system", "agent"]), actorIdentifier: NonEmptyStringSchema, category: NonEmptyStringSchema, decision: NonEmptyStringSchema, rationale: NonEmptyStringSchema, affectedDocuments: z.array(NonEmptyStringSchema), requirementChange: z.boolean(), userApprovalRequired: z.boolean(), userApprovalStatus: z.enum(["not-required", "pending", "approved", "rejected"]), supersedesDecisionId: UuidSchema.optional() }).strict().superRefine((record, context) => {
  if (record.requirementChange && !record.userApprovalRequired) context.addIssue({ code: "custom", path: ["userApprovalRequired"], message: "Requirement changes require user approval" });
  if (record.requirementChange && record.userApprovalStatus !== "approved" && record.userApprovalStatus !== "rejected") context.addIssue({ code: "custom", path: ["userApprovalStatus"], message: "Requirement changes cannot be accepted while approval is pending" });
});
export const DecisionsDocumentSchema = DocumentBaseSchema.extend({ documentType: z.literal("decisions"), decisions: z.array(DecisionRecordSchema) }).strict();
export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;
