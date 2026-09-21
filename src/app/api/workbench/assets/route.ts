import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ProjectAssetCategorySchema } from "@/domain/assets/project";
import { AssetIntakeError, type AssetIntakeErrorCategory, type AssetIntakeErrorCode } from "@/runtime/assets/service";
import { getProductionAssetIntake } from "@/runtime/workbench/production";
import { safeOperationFingerprint } from "@/runtime/workbench/operation-ledger";

export const runtime = "nodejs";

const ProjectIdSchema = z.string().uuid();
const publicAsset = (asset: Awaited<ReturnType<ReturnType<typeof getProductionAssetIntake>["list"]>>[number]) => ({ assetId: asset.assetId, projectId: asset.projectId, projectVersion: asset.projectVersion, category: asset.category, source: asset.source, safeDisplayName: asset.safeDisplayName, mediaType: asset.mediaType, byteSize: asset.byteSize, sha256: asset.sha256, status: asset.status, version: asset.version, currentness: asset.currentness, ...(asset.rejectionReason ? { rejectionReason: asset.rejectionReason } : {}) });
type AssetOperation = "LIST_PROJECT_ASSETS" | "UPLOAD_PROJECT_ASSET" | "REMOVE_PROJECT_ASSET";
type AssetFailureBoundary = "REQUEST" | "PROJECT_ACCESS" | "PERSISTENCE" | "STORAGE" | "INTERNAL";
type AssetFailure = { code: string; message: string; category: AssetIntakeErrorCategory; recoverable: boolean; boundary: AssetFailureBoundary };
const ASSET_SAFE_MESSAGES: Record<AssetIntakeErrorCode, string> = {
  ASSET_REQUEST_INVALID: "The asset request is invalid.",
  ASSET_REQUEST_TOO_LARGE: "The upload request is too large.",
  ASSET_CATEGORY_INVALID: "Choose a supported asset category.",
  ASSET_PROJECT_NOT_FOUND: "The project was not found.",
  ASSET_VERSION_STALE: "The project asset version is stale.",
  ASSET_FILE_REQUIRED: "Choose a file to upload.",
  ASSET_TYPE_NOT_ALLOWED: "Only PNG, JPEG, WebP, and PDF files are accepted.",
  ASSET_MIME_MISMATCH: "The declared file type is invalid.",
  ASSET_EXTENSION_MISMATCH: "The file extension does not match the declared media type.",
  ASSET_SIZE_LIMIT: "The file exceeds the allowed size for its type.",
  ASSET_PROJECT_SIZE_LIMIT: "The project asset storage limit would be exceeded.",
  ASSET_SIGNATURE_INVALID: "The file signature does not match the declared type.",
  ASSET_NOT_FOUND: "The asset was not found in this project.",
  ASSET_STORAGE_FAILED: "The Factory could not persist the file.",
  ASSET_METADATA_PERSIST_FAILED: "The asset metadata could not be saved.",
  ASSET_INTERNAL_ERROR: "The asset operation could not be completed.",
};

const safeErrorClass = (error: unknown) => {
  const name = error instanceof Error ? error.name : "UnknownError";
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : "UnknownError";
};

const safeErrorCode = (error: unknown) => {
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[A-Z][A-Z0-9_]+$/.test(error.code)) return error.code;
  if (error instanceof Error) {
    const candidate = error.message.split(":", 1)[0];
    if (/^[A-Z][A-Z0-9_]+$/.test(candidate)) return candidate;
  }
  return undefined;
};

const safeCauseClasses = (error: unknown) => {
  const classes: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    classes.push(safeErrorClass(current));
    current = "cause" in current ? current.cause : undefined;
  }
  return classes;
};

const safeAggregateCauses = (error: unknown) => {
  if (!(error instanceof AggregateError)) return undefined;
  return error.errors.slice(0, 4).map((cause) => ({
    errorClass: safeErrorClass(cause),
    errorCode: safeErrorCode(cause),
    causeClasses: safeCauseClasses(cause),
  }));
};

const failure = (error: unknown): AssetFailure => {
  if (error instanceof AssetIntakeError) {
    const boundary: AssetFailureBoundary = error.code === "ASSET_PROJECT_NOT_FOUND" || error.code === "ASSET_NOT_FOUND"
      ? "PROJECT_ACCESS"
      : error.category === "VALIDATION" ? "REQUEST"
        : error.category === "STORAGE" ? "STORAGE"
          : error.category === "PERSISTENCE" ? "PERSISTENCE"
            : "INTERNAL";
    return { code: error.code, message: ASSET_SAFE_MESSAGES[error.code], category: error.category, recoverable: error.recoverable, boundary };
  }
  if (error instanceof z.ZodError) return { code: "ASSET_REQUEST_INVALID", message: "The asset request is invalid.", category: "VALIDATION", recoverable: false, boundary: "REQUEST" };
  return { code: "ASSET_INTERNAL_ERROR", message: "The asset operation could not be completed.", category: "INTERNAL", recoverable: false, boundary: "INTERNAL" };
};

const statusFor = (result: AssetFailure) => {
  if (result.code === "ASSET_PROJECT_NOT_FOUND" || result.code === "ASSET_NOT_FOUND") return 404;
  if (result.code === "ASSET_REQUEST_TOO_LARGE" || result.code === "ASSET_SIZE_LIMIT" || result.code === "ASSET_PROJECT_SIZE_LIMIT") return 413;
  if (result.code === "ASSET_VERSION_STALE") return 409;
  if (result.category === "STORAGE" || result.category === "PERSISTENCE") return 503;
  if (result.category === "INTERNAL") return 500;
  return 400;
};

const failureResponse = (error: unknown, operation: AssetOperation) => {
  const result = failure(error);
  const correlationId = randomUUID();
  console.error(`[asset-diagnostic] ${JSON.stringify({
    correlationId,
    operation,
    code: result.code,
    category: result.category,
    recoverable: result.recoverable,
    boundary: result.boundary,
    errorClass: safeErrorClass(error),
    errorCode: safeErrorCode(error),
    causeClasses: safeCauseClasses(error),
    aggregateCauses: safeAggregateCauses(error),
    safeErrorFingerprint: safeOperationFingerprint(error, "PREFLIGHT"),
    ...(operation === "LIST_PROJECT_ASSETS" ? { mutationReached: false } : {}),
  })}`);
  return NextResponse.json({
    ok: false,
    error: { code: result.code, message: result.message },
    correlationId,
    operation,
    category: result.category,
    boundary: result.boundary,
    reasonCode: result.code,
    safeErrorFingerprint: safeOperationFingerprint(error, "PREFLIGHT"),
    ...(operation === "LIST_PROJECT_ASSETS" ? { mutationReached: false } : {}),
    recoverable: result.recoverable,
  }, { status: statusFor(result), headers: { "Cache-Control": "no-store" } });
};

export async function GET(request: Request) {
  try {
    const projectId = ProjectIdSchema.parse(new URL(request.url).searchParams.get("projectId"));
    const assets = await getProductionAssetIntake().list(projectId);
    return NextResponse.json({ ok: true, assets: assets.map(publicAsset) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failureResponse(error, "LIST_PROJECT_ASSETS");
  }
}

export async function POST(request: Request) {
  try {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > 20 * 1024 * 1024 + 8192) throw new AssetIntakeError("ASSET_REQUEST_TOO_LARGE", "The upload request is too large.");
    const form = await request.formData();
    const projectId = ProjectIdSchema.parse(form.get("projectId"));
    const categoryResult = ProjectAssetCategorySchema.safeParse(form.get("category"));
    if (!categoryResult.success) throw new AssetIntakeError("ASSET_CATEGORY_INVALID", "Choose a supported asset category.");
    const category = categoryResult.data;
    const replaceAssetId = form.get("replaceAssetId");
    const file = form.get("file");
    if (!(file instanceof File)) throw new AssetIntakeError("ASSET_FILE_REQUIRED", "Choose a file to upload.");
    const result = await getProductionAssetIntake().upload({ projectId, category, filename: file.name, mediaType: file.type, bytes: new Uint8Array(await file.arrayBuffer()), ...(typeof replaceAssetId === "string" && replaceAssetId ? { replaceAssetId: ProjectIdSchema.parse(replaceAssetId) } : {}) });
    return NextResponse.json({ ok: true, asset: publicAsset(result.asset), deduplicated: result.deduplicated }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failureResponse(error, "UPLOAD_PROJECT_ASSET");
  }
}

export async function DELETE(request: Request) {
  try {
    const body = z.object({ projectId: ProjectIdSchema, assetId: ProjectIdSchema }).strict().parse(await request.json());
    const asset = await getProductionAssetIntake().remove(body.projectId, body.assetId);
    return NextResponse.json({ ok: true, asset: publicAsset(asset) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failureResponse(error, "REMOVE_PROJECT_ASSET");
  }
}
