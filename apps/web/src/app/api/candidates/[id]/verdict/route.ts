import { badRequest, guard, ok } from "@/lib/http";
import { decisionSchema } from "@/lib/validation/schemas";
import {
  setStylistVerdict,
  VerdictNotAllowedError,
} from "@/lib/services/consultation";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return guard(async () => {
    const { id } = await params;
    const body = await req.json();
    const input = decisionSchema.parse({ ...body, candidateId: id });
    try {
      const candidate = await setStylistVerdict(id, input.verdict);
      if (!candidate) return badRequest("후보를 찾을 수 없습니다.");
      return ok({
        candidateId: candidate.id,
        verdict: candidate.stylistVerdict,
      });
    } catch (err) {
      // Policy rule 3: hard-fail / regenerate can never be approved.
      if (err instanceof VerdictNotAllowedError) {
        return badRequest(err.message);
      }
      throw err;
    }
  });
}
