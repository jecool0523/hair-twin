import { guard, ok } from "@/lib/http";
import { startSessionSchema } from "@/lib/validation/schemas";
import { startSession } from "@/lib/services/consultation";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return guard(async () => {
    const body = await req.json().catch(() => ({}));
    const input = startSessionSchema.parse(body);
    const session = await startSession(input);
    return ok({ sessionId: session.id, stage: session.stage });
  });
}
