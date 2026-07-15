import { badRequest, guard, ok } from "@/lib/http";
import { sourceImageSchema } from "@/lib/validation/schemas";
import { storeSourceImage } from "@/lib/services/consultation";

export const runtime = "nodejs";

// Capture data URLs can be a few MB. Allow a generous but bounded body.
export const maxDuration = 30;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return guard(async () => {
    const { id } = await params;
    const input = sourceImageSchema.parse(await req.json());
    const result = await storeSourceImage(id, input);
    if (!result)
      return badRequest(
        "촬영 동의가 없거나 세션을 찾을 수 없습니다. 동의 후 다시 시도하세요.",
      );
    return ok({
      sourceImageId: result.ref.id,
      sourceUrl: `/api/media/${result.token}`,
      expiresAt: result.ref.expiresAt,
    });
  });
}
