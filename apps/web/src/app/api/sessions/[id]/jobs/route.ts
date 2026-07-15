import { badRequest, guard, ok } from "@/lib/http";
import { createJobSchema } from "@/lib/validation/schemas";
import { createGenerationJob } from "@/lib/services/consultation";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return guard(async () => {
    const { id } = await params;
    const input = createJobSchema.parse(await req.json());
    const job = await createGenerationJob(id, input);
    if (!job)
      return badRequest(
        "세션/원본/스타일을 확인할 수 없어 생성 작업을 만들 수 없습니다.",
      );
    return ok({ jobId: job.id, status: job.status });
  });
}
