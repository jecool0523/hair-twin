import { guard, notFound } from "@/lib/http";
import { getStore } from "@/lib/store";
import { audit } from "@/lib/services/audit";

export const runtime = "nodejs";

/**
 * Serve private image bytes via a short-lived token (signed-URL analog).
 * There is no public bucket and no stable public URL; tokens expire quickly
 * (RETENTION.mediaTokenMs). Expired/unknown tokens 404.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  return guard(async () => {
    const { token } = await params;
    const store = getStore();
    const assetId = await store.resolveMediaToken(token);
    if (!assetId) return notFound("만료되었거나 잘못된 이미지 토큰입니다.");
    const asset = await store.getAsset(assetId);
    if (!asset) return notFound("이미지를 찾을 수 없습니다.");

    // Audit viewing of stored media (system-design §9).
    await audit(asset.sessionId, "candidate_viewed", "viewer", {
      assetId,
      kind: asset.kind,
    });

    return new Response(new Uint8Array(asset.bytes), {
      status: 200,
      headers: {
        "Content-Type": asset.mime,
        "Cache-Control": "private, no-store",
        "Content-Length": String(asset.bytes.length),
      },
    });
  });
}
