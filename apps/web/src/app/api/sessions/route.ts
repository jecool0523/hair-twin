import { guard, ok } from "@/lib/http";
import { startSessionSchema } from "@/lib/validation/schemas";
import { startSession } from "@/lib/services/consultation";
import { NextResponse } from "next/server";
import { readSmallUrlEncodedForm } from "@/lib/request-security";

export const runtime = "nodejs";

export async function POST(req: Request) {
  return guard(async () => {
    const isForm = (req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded");
    const body = isForm ? Object.fromEntries(await readSmallUrlEncodedForm(req)) : await req.json().catch(() => ({}));
    const input = startSessionSchema.parse(body);
    const session = await startSession(input);
    if (isForm) return NextResponse.redirect(new URL(`/consultation/${session.id}`, req.url), 303);
    return ok({ sessionId: session.id, stage: session.stage });
  });
}
