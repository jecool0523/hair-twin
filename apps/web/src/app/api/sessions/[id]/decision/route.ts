import { badRequest, guard, ok } from "@/lib/http";
import { saveDecisionSchema } from "@/lib/validation/schemas";
import {
  finalizeDecision,
  VerdictNotAllowedError,
} from "@/lib/services/consultation";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return guard(async () => {
    const { id } = await params;
    const input = saveDecisionSchema.parse(await req.json());
    try {
      const session = await finalizeDecision(
        id,
        input.action,
        input.candidateIds,
      );
      if (!session) return badRequest("세션을 찾을 수 없습니다.");
      return ok({ stage: session.stage });
    } catch (err) {
      // Only stylist-approved candidates may be persisted.
      if (err instanceof VerdictNotAllowedError) {
        return badRequest(err.message);
      }
      if (err instanceof Error && err.message.includes("consent")) {
        return badRequest(
          "이미지 저장 동의가 없어 저장할 수 없습니다. 폐기만 가능합니다.",
        );
      }
      throw err;
    }
  });
}
