import { badRequest, guard, ok } from "@/lib/http";
import { retryJob } from "@/lib/services/consultation";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return guard(async () => {
    const { id } = await params;
    const job = await retryJob(id);
    if (!job) return badRequest("작업을 찾을 수 없습니다.");
    return ok({ jobId: job.id, status: job.status, attempts: job.attempts });
  });
}
