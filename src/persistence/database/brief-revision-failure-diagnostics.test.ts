import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { MAX_BRIEF_REVISION_FAILURE_DIAGNOSTICS, appendBriefRevisionFailureDiagnostic, normalizeBriefRevisionFailureDiagnostics } from "./brief-revision-failure-diagnostics";
import { ProviderFailureDiagnosticSchema } from "@/domain/shared/provider-failure";

const diagnostic = (generation: number) => ProviderFailureDiagnosticSchema.parse({ version: 1, category: "UNKNOWN", stage: "REQUEST_TRANSPORT", requestAttempted: true, provider: "openai", model: "synthetic-model", errorCode: "AI_OUTPUT_INVALID", schemaName: "brief-v3-revision", sdkErrorClass: "Error", retryabilityHint: false, ...(generation === 1 ? {} : { requestId: `req_${generation}` }) });

describe("bounded Brief Revision failure diagnostics", () => {
  it("retains generation attribution and caps stored entries", () => {
    let entries = null;
    for (let generation = 1; generation <= MAX_BRIEF_REVISION_FAILURE_DIAGNOSTICS + 2; generation += 1) entries = appendBriefRevisionFailureDiagnostic(entries, generation, diagnostic(generation));
    expect(entries).toHaveLength(MAX_BRIEF_REVISION_FAILURE_DIAGNOSTICS);
    expect(entries?.[0]?.generation).toBe(3);
    expect(entries?.at(-1)?.generation).toBe(MAX_BRIEF_REVISION_FAILURE_DIAGNOSTICS + 2);
    expect(normalizeBriefRevisionFailureDiagnostics(JSON.parse(JSON.stringify(entries)))).toEqual(entries);
  });

  it("treats malformed stored metadata as unavailable rather than exposing it", () => {
    expect(normalizeBriefRevisionFailureDiagnostics([{ generation: 1, diagnostic: { message: "SECRET_RAW_PROVIDER_MESSAGE" } }])).toBeNull();
  });

  it("declares an additive JSONB array column in its own idempotent migration", async () => {
    const sql = await readFile(new URL("../../../supabase/migrations/202608170001_brief_revision_failure_diagnostics.sql", import.meta.url), "utf8");
    expect(sql).toMatch(/alter table brief_revision_attempts add column if not exists failure_diagnostics jsonb/i);
    expect(sql).toMatch(/jsonb_typeof\(failure_diagnostics\) = 'array'/i);
    expect(sql).not.toMatch(/\b(drop|truncate|delete|update)\b/i);
  });
});
