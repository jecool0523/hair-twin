import { badRequest, guard, ok } from "@/lib/http";
import { preflightMetaSchema } from "@/lib/validation/schemas";
import { storeSourceImage } from "@/lib/services/consultation";
import { ImageRejected, IMAGE_LIMITS } from "@/lib/media/image-probe";
import { MaskRejected } from "@/lib/services/masks";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Capture upload — multipart/form-data ONLY.
 *
 * Parts:
 *   image        (File)   the photo bytes. Format/dimensions are decided by the
 *                         server from the actual bytes; the declared type is
 *                         checked for agreement, never trusted.
 *   regionMap    (File)   raw per-pixel segmentation classes derived from that
 *                         photo in the capture worker. The server re-derives the
 *                         whole mask set + coverage from these bytes.
 *   regionMapWidth/Height (text) grid dims, validated against the byte length.
 *   preflight    (text)   JSON metadata for audit only — never QC input.
 *
 * There is no base64 path. The response carries ids and a short-lived media
 * token; never image bytes, never secrets.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return guard(async () => {
    const { id } = await params;

    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      return badRequest(
        "이미지는 multipart/form-data로 업로드해야 합니다.",
        { expected: "multipart/form-data", received: contentType.split(";")[0] },
      );
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return badRequest("업로드 데이터를 읽지 못했습니다. 다시 시도해 주세요.");
    }

    const image = form.get("image");
    if (!(image instanceof File) || image.size === 0) {
      return badRequest("이미지 파일이 없습니다.");
    }
    // Cheap guard before buffering the whole body into memory.
    if (image.size > IMAGE_LIMITS.maxBytes) {
      return badRequest(
        `이미지가 너무 큽니다. ${Math.floor(IMAGE_LIMITS.maxBytes / 1024 / 1024)}MB 이하로 다시 시도해 주세요.`,
      );
    }

    const regionMap = form.get("regionMap");
    if (!(regionMap instanceof File) || regionMap.size === 0) {
      return badRequest("촬영 분석 데이터가 없습니다. 다시 촬영해 주세요.");
    }

    const preflightRaw = form.get("preflight");
    const preflight = preflightMetaSchema.parse(
      typeof preflightRaw === "string" ? JSON.parse(preflightRaw) : {},
    );

    const rmWidth = Number(form.get("regionMapWidth"));
    const rmHeight = Number(form.get("regionMapHeight"));

    try {
      const result = await storeSourceImage(id, {
        imageBytes: new Uint8Array(await image.arrayBuffer()),
        declaredMime: image.type || undefined,
        regionMapBytes: new Uint8Array(await regionMap.arrayBuffer()),
        regionMapWidth: rmWidth,
        regionMapHeight: rmHeight,
        preflight,
      });
      if (!result) {
        return badRequest(
          "촬영 동의가 없거나 세션을 찾을 수 없습니다. 동의 후 다시 시도하세요.",
        );
      }
      return ok({
        sourceImageId: result.ref.id,
        maskContractId: result.maskContractId,
        sourceUrl: `/api/media/${result.token}`,
        width: result.ref.width,
        height: result.ref.height,
        expiresAt: result.ref.expiresAt,
      });
    } catch (err) {
      // Rejections carry Korean copy safe to show in the capture UI.
      if (err instanceof ImageRejected || err instanceof MaskRejected) {
        return badRequest(err.userMessageKo);
      }
      throw err;
    }
  });
}
