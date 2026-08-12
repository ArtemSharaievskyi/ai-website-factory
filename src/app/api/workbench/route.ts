import { NextResponse } from "next/server";
import { WorkbenchRequestSchema, WORKBENCH_REQUEST_BYTES } from "@/runtime/workbench/contracts";
import { WorkbenchActionError } from "@/runtime/workbench/application";
import { workbenchFailureResponse, type WorkbenchDiagnosticContext } from "@/runtime/workbench/diagnostics";
import { getProductionWorkbench } from "@/runtime/workbench/production";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let diagnosticContext: WorkbenchDiagnosticContext = {};
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > WORKBENCH_REQUEST_BYTES + 8192) throw new WorkbenchActionError("WORKBENCH_REQUEST_TOO_LARGE", "The request is too large.");
    const body: unknown = await request.json();
    const parsed = WorkbenchRequestSchema.parse(body);
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
