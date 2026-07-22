import { badRequest, guard, ok } from "@/lib/http";
import { consentSchema } from "@/lib/validation/schemas";
import { recordConsent } from "@/lib/services/consultation";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return guard(async () => {
    const { id } = await params;
    const input = consentSchema.parse(await req.json());
    const session = await recordConsent(id, input);
    if (!session) return badRequest("세션을 찾을 수 없습니다.");
    return ok({ stage: session.stage });
  });
}
