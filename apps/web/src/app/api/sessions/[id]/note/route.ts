import { z } from "zod";
import { badRequest, guard, ok } from "@/lib/http";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";

const noteSchema = z.object({
  memoKo: z.string().max(2000).default(""),
  feasibility: z.enum(["easy", "moderate", "hard", ""]).default(""),
  estimatedPrice: z.string().max(60).default(""),
  estimatedTime: z.string().max(60).default(""),
  careNotesKo: z.string().max(2000).default(""),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return guard(async () => {
    const { id } = await params;
    const input = noteSchema.parse(await req.json());
    const store = getStore();
    const session = await store.getSession(id);
    if (!session) return badRequest("세션을 찾을 수 없습니다.");
    const updated = await store.updateSession(id, {
      note: { ...input, updatedAt: new Date().toISOString() },
    });
    return ok({ note: updated?.note });
  });
}
