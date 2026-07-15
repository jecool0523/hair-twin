import { guard, notFound, ok } from "@/lib/http";
import { buildSessionView } from "@/lib/services/views";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return guard(async () => {
    const { id } = await params;
    const view = await buildSessionView(id);
    if (!view) return notFound("세션을 찾을 수 없습니다.");
    return ok(view);
  });
}
