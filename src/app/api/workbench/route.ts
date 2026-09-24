import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { WorkbenchRequestSchema, WORKBENCH_REQUEST_BYTES } from "@/runtime/workbench/contracts";
import { WorkbenchActionError } from "@/runtime/workbench/application";
import { safeUnknownArrayFieldPaths, workbenchFailureResponse, WorkbenchRequestValidationError, type WorkbenchDiagnosticContext } from "@/runtime/workbench/diagnostics";
import { getProductionWorkbench } from "@/runtime/workbench/production";
import { withWorkbenchOperationContext } from "@/runtime/workbench/operation-context";
import { currentRuntimeProvenance, type WorkbenchResponseMetadata } from "@/runtime/workbench/observability";

export const runtime = "nodejs";

const safeTopLevelFieldNames = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const knownRequestFields = new Set([
    "action", "projectId", "requestText", "languageHint", "operatorLanguage", "answers", "requestId",
    "briefChecksum", "expectedRowVersion", "approvalNote", "projectVersion", "reason", "requirementKeys",
    "assetBindings", "correction", "selectedDirectionId", "mode",
  ]);
  return Object.entries(value as Record<string, unknown>)
    .filter(([key, fieldValue]) => knownRequestFields.has(key) || Array.isArray(fieldValue))
    .map(([key]) => key)
    .filter((key) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key))
    .slice(0, 32)
    .sort();
};

const safeClientByteLength = (value: string | null) => {
  if (!value || !/^\d{1,9}$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

const safeClientSha256 = (value: string | null) => value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;

const safeClientTopLevelFields = (value: string | null) => {
  if (!value || value.length > 512) return undefined;
  const fields = value.split(",");
  if (fields.length > 32 || fields.some((field) => !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field))) return undefined;
  return [...new Set(fields)].sort();
};

export async function POST(request: Request) {
  const correlationId = randomUUID();
  const runtimeProvenance = currentRuntimeProvenance();
  const responseSink: { metadata?: WorkbenchResponseMetadata } = {};
  let diagnosticContext: WorkbenchDiagnosticContext = { correlationId, runtimeProvenance };
  try {
    const rawBody = await request.text();
    const routeBodyByteLength = Buffer.byteLength(rawBody, "utf8");
    const routeBodySha256 = createHash("sha256").update(rawBody, "utf8").digest("hex");
    const clientBodyByteLength = safeClientByteLength(request.headers.get("x-workbench-client-body-bytes"));
    const clientBodySha256 = safeClientSha256(request.headers.get("x-workbench-client-body-sha256"));
    const clientTopLevelFields = safeClientTopLevelFields(request.headers.get("x-workbench-client-top-level-fields"));
    let requestTransport: WorkbenchDiagnosticContext["requestTransport"] = {
      ...(clientBodyByteLength !== undefined ? { clientBodyByteLength } : {}),
      ...(clientBodySha256 ? { clientBodySha256 } : {}),
      ...(clientTopLevelFields ? { clientTopLevelFields } : {}),
      routeBodyByteLength,
      routeBodySha256,
      parsedTopLevelFields: [],
      ...(clientBodyByteLength !== undefined ? { byteLengthMatch: clientBodyByteLength === routeBodyByteLength } : {}),
      ...(clientBodySha256 ? { sha256Match: clientBodySha256 === routeBodySha256 } : {}),
    };
    diagnosticContext = { ...diagnosticContext, requestTransport };
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > WORKBENCH_REQUEST_BYTES + 8192 || routeBodyByteLength > WORKBENCH_REQUEST_BYTES + 8192) throw new WorkbenchActionError("WORKBENCH_REQUEST_TOO_LARGE", "The request is too large.");
    let body: unknown;
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch {
      throw new WorkbenchActionError("WORKBENCH_REQUEST_INVALID", "The request body was not valid JSON.");
    }
    if (typeof body === "object" && body !== null) {
      const candidate = body as Record<string, unknown>;
      requestTransport = { ...requestTransport, parsedTopLevelFields: safeTopLevelFieldNames(body) };
      diagnosticContext = {
        ...diagnosticContext,
        correlationId,
        runtimeProvenance,
        requestTransport,
        ...(typeof candidate.action === "string" ? { action: candidate.action } : {}),
        ...(typeof candidate.projectId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate.projectId) ? { projectId: candidate.projectId } : {}),
      };
    }
    const parsedResult = WorkbenchRequestSchema.safeParse(body);
    if (!parsedResult.success) throw new WorkbenchRequestValidationError(parsedResult.error, safeUnknownArrayFieldPaths(body), typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).action === "string" ? (body as Record<string, unknown>).action as string : undefined);
    const parsed = parsedResult.data;
    diagnosticContext = {
      ...diagnosticContext,
      correlationId,
      runtimeProvenance,
      requestTransport,
      action: parsed.action,
      ...(parsed.action !== "list" && parsed.action !== "create" ? { projectId: parsed.projectId } : {}),
    };
    const result = await withWorkbenchOperationContext({ correlationId, runtimeProvenance, responseSink }, () => getProductionWorkbench().handle(parsed));
    const meta: WorkbenchResponseMetadata = responseSink.metadata ?? { schemaVersion: 1, responseOrigin: "NO_EXECUTION", attemptCreated: false, correlationId, runtimeProvenance };
    return NextResponse.json({ ok: true, data: result, meta }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const failure = workbenchFailureResponse(error, { ...diagnosticContext, responseMetadata: responseSink.metadata });
    return NextResponse.json(failure.response, { status: failure.status, headers: { "Cache-Control": "no-store" } });
  }
}
