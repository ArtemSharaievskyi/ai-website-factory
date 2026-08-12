import { NextResponse } from "next/server";
import { z } from "zod";
import { WorkbenchRequestSchema, WORKBENCH_REQUEST_BYTES } from "@/runtime/workbench/contracts";
import { WorkbenchActionError } from "@/runtime/workbench/application";
import { getProductionWorkbench } from "@/runtime/workbench/production";

export const runtime = "nodejs";

const safeMessage = (error: unknown) => {
  if (error instanceof WorkbenchActionError) return error.message.replace(`${error.code}: `, "");
  if (error instanceof z.ZodError) return "The request could not be validated.";
  if (error instanceof Error && /^(INITIAL_REQUEST_|TRIAL_ENTRY_|LEAD_|WORKFLOW_|BRIEF_|PERSISTENCE_|IDEMPOTENCY_|CLARIFICATION_)/.test(error.message)) return "The workflow rejected this request. The project was not changed.";
  return "We couldn't process this request. The project was not changed.";
};

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > WORKBENCH_REQUEST_BYTES + 8192) return NextResponse.json({ ok: false, error: "The request is too large." }, { status: 413 });
  try {
    const body: unknown = await request.json();
    const parsed = WorkbenchRequestSchema.parse(body);
    const result = await getProductionWorkbench().handle(parsed);
    return NextResponse.json({ ok: true, data: result }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof WorkbenchActionError && error.code === "PROJECT_NOT_FOUND" ? 404 : error instanceof z.ZodError ? 400 : 409;
    return NextResponse.json({ ok: false, error: safeMessage(error) }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
