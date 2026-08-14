import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ProjectAssetCategorySchema } from "@/domain/assets/project";
import { AssetIntakeError, type AssetIntakeErrorCategory } from "@/runtime/assets/service";
import { PersistenceError } from "@/persistence/database/errors";
import { getProductionAssetIntake } from "@/runtime/workbench/production";

export const runtime = "nodejs";

const ProjectIdSchema = z.string().uuid();
const publicAsset = (asset: Awaited<ReturnType<ReturnType<typeof getProductionAssetIntake>["list"]>>[number]) => ({ assetId: asset.assetId, projectId: asset.projectId, projectVersion: asset.projectVersion, category: asset.category, source: asset.source, safeDisplayName: asset.safeDisplayName, mediaType: asset.mediaType, byteSize: asset.byteSize, sha256: asset.sha256, status: asset.status, version: asset.version, currentness: asset.currentness, ...(asset.rejectionReason ? { rejectionReason: asset.rejectionReason } : {}) });
type AssetOperation = "LIST_PROJECT_ASSETS" | "UPLOAD_PROJECT_ASSET" | "REMOVE_PROJECT_ASSET";
type AssetFailure = { code: string; message: string; category: AssetIntakeErrorCategory; recoverable: boolean };

const failure = (error: unknown): AssetFailure => {
  if (error instanceof AssetIntakeError) {
    return { code: error.code, message: error.message.replace(error.code + ": ", ""), category: error.category, recoverable: error.recoverable };
  }
  if (error instanceof z.ZodError) return { code: "ASSET_REQUEST_INVALID", message: "The asset request is invalid.", category: "VALIDATION", recoverable: false };
  if (error instanceof PersistenceError) return { code: "ASSET_METADATA_PERSIST_FAILED", message: "The asset metadata could not be saved.", category: "PERSISTENCE", recoverable: true };
  return { code: "ASSET_INTERNAL_ERROR", message: "The asset operation could not be completed.", category: "INTERNAL", recoverable: false };
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
  return NextResponse.json({
    ok: false,
    error: { code: result.code, message: result.message },
    correlationId,
    operation,
    category: result.category,
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
