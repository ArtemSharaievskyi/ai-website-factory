import { z } from "zod";
import { ProviderFailureDiagnosticSchema, type ProviderFailureDiagnostic } from "@/domain/shared/provider-failure";

export const MAX_BRIEF_REVISION_FAILURE_DIAGNOSTICS = 8;

const BriefRevisionFailureDiagnosticEntrySchema = z.object({
  generation: z.number().int().positive(),
  diagnostic: ProviderFailureDiagnosticSchema,
}).strict();

const BriefRevisionFailureDiagnosticsSchema = z.array(BriefRevisionFailureDiagnosticEntrySchema).max(MAX_BRIEF_REVISION_FAILURE_DIAGNOSTICS);

export type BriefRevisionFailureDiagnosticEntry = z.infer<typeof BriefRevisionFailureDiagnosticEntrySchema>;

export function normalizeBriefRevisionFailureDiagnostics(value: unknown): BriefRevisionFailureDiagnosticEntry[] | null {
  if (value == null) return null;
  const parsed = BriefRevisionFailureDiagnosticsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function appendBriefRevisionFailureDiagnostic(
  existing: readonly BriefRevisionFailureDiagnosticEntry[] | null,
  generation: number,
  diagnostic: ProviderFailureDiagnostic,
): BriefRevisionFailureDiagnosticEntry[] {
  const current = normalizeBriefRevisionFailureDiagnostics(existing) ?? [];
  const next = [
    ...current.filter((entry) => entry.generation !== generation),
    BriefRevisionFailureDiagnosticEntrySchema.parse({ generation, diagnostic }),
  ];
  return next.sort((left, right) => left.generation - right.generation).slice(-MAX_BRIEF_REVISION_FAILURE_DIAGNOSTICS);
}
