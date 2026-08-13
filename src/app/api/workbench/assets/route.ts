import { NextResponse } from "next/server";
import { z } from "zod";
import { ProjectAssetCategorySchema } from "@/domain/assets/project";
import { AssetIntakeError } from "@/runtime/assets/service";
import { getProductionAssetIntake } from "@/runtime/workbench/production";

export const runtime = "nodejs";

const ProjectIdSchema = z.string().uuid();
const publicAsset = (asset: Awaited<ReturnType<ReturnType<typeof getProductionAssetIntake>["list"]>>[number]) => ({ assetId: asset.assetId, projectId: asset.projectId, projectVersion: asset.projectVersion, category: asset.category, source: asset.source, safeDisplayName: asset.safeDisplayName, mediaType: asset.mediaType, byteSize: asset.byteSize, sha256: asset.sha256, status: asset.status, version: asset.version, currentness: asset.currentness, ...(asset.rejectionReason ? { rejectionReason: asset.rejectionReason } : {}) });
const failure = (error: unknown) => {
  if (error instanceof AssetIntakeError) return { code: error.code, message: error.message.replace(`${error.code}: `, "") };
  if (error instanceof z.ZodError) return { code: "ASSET_REQUEST_INVALID", message: "The asset request is invalid." };
  return { code: "ASSET_REQUEST_FAILED", message: "The asset request could not be completed." };
};

export async function GET(request: Request) {
  try {
    const projectId = ProjectIdSchema.parse(new URL(request.url).searchParams.get("projectId"));
    const assets = await getProductionAssetIntake().list(projectId);
    return NextResponse.json({ ok: true, assets: assets.map(publicAsset) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const result = failure(error);
    return NextResponse.json({ ok: false, error: result }, { status: result.code === "ASSET_PROJECT_NOT_FOUND" ? 404 : 400, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  try {
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > 20 * 1024 * 1024 + 8192) return NextResponse.json({ ok: false, error: { code: "ASSET_REQUEST_TOO_LARGE", message: "The upload request is too large." } }, { status: 413 });
    const form = await request.formData();
    const projectId = ProjectIdSchema.parse(form.get("projectId"));
    const category = ProjectAssetCategorySchema.parse(form.get("category"));
    const replaceAssetId = form.get("replaceAssetId");
    const file = form.get("file");
    if (!(file instanceof File)) throw new AssetIntakeError("ASSET_FILE_REQUIRED", "Choose a file to upload.");
    const result = await getProductionAssetIntake().upload({ projectId, category, filename: file.name, mediaType: file.type, bytes: new Uint8Array(await file.arrayBuffer()), ...(typeof replaceAssetId === "string" && replaceAssetId ? { replaceAssetId: ProjectIdSchema.parse(replaceAssetId) } : {}) });
    return NextResponse.json({ ok: true, asset: publicAsset(result.asset), deduplicated: result.deduplicated }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const result = failure(error);
    return NextResponse.json({ ok: false, error: result }, { status: result.code === "ASSET_PROJECT_NOT_FOUND" ? 404 : result.code === "ASSET_SIZE_LIMIT" || result.code === "ASSET_PROJECT_SIZE_LIMIT" ? 413 : 400, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = z.object({ projectId: ProjectIdSchema, assetId: ProjectIdSchema }).strict().parse(await request.json());
    const asset = await getProductionAssetIntake().remove(body.projectId, body.assetId);
    return NextResponse.json({ ok: true, asset: publicAsset(asset) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const result = failure(error);
    return NextResponse.json({ ok: false, error: result }, { status: result.code === "ASSET_NOT_FOUND" || result.code === "ASSET_PROJECT_NOT_FOUND" ? 404 : 400, headers: { "Cache-Control": "no-store" } });
  }
}
