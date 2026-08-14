import { NextResponse } from "next/server";
import { WorkbenchRequestSchema, WORKBENCH_REQUEST_BYTES } from "@/runtime/workbench/contracts";
import { WorkbenchActionError } from "@/runtime/workbench/application";
import { safeUnknownRespondArrayFieldPaths, workbenchFailureResponse, WorkbenchRequestValidationError, type WorkbenchDiagnosticContext } from "@/runtime/workbench/diagnostics";
import { getProductionWorkbench } from "@/runtime/workbench/production";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let diagnosticContext: WorkbenchDiagnosticContext = {};
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > WORKBENCH_REQUEST_BYTES + 8192) throw new WorkbenchActionError("WORKBENCH_REQUEST_TOO_LARGE", "The request is too large.");
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null) {
      const candidate = body as Record<string, unknown>;
      diagnosticContext = {
        ...(typeof candidate.action === "string" ? { action: candidate.action } : {}),
        ...(typeof candidate.projectId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate.projectId) ? { projectId: candidate.projectId } : {}),
      };
    }
    const parsedResult = WorkbenchRequestSchema.safeParse(body);
    if (!parsedResult.success) throw new WorkbenchRequestValidationError(parsedResult.error, safeUnknownRespondArrayFieldPaths(body));
    const parsed = parsedResult.data;
    diagnosticContext = {
      action: parsed.action,
      ...(parsed.action !== "list" && parsed.action !== "create" ? { projectId: parsed.projectId } : {}),
    };
    const result = await getProductionWorkbench().handle(parsed);
    return NextResponse.json({ ok: true, data: result }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const failure = workbenchFailureResponse(error, diagnosticContext);
    return NextResponse.json(failure.response, { status: failure.status, headers: { "Cache-Control": "no-store" } });
  }
}
