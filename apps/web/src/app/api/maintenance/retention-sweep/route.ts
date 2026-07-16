import { NextResponse } from "next/server";
import { guard, ok } from "@/lib/http";
import { runRetentionSweep } from "@/lib/services/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retention sweep — the ACTUAL deletion path for expired media.
 *
 * Recording an `expires_at` is a promise, not a deletion. This endpoint keeps
 * that promise: it removes unsaved source images, masks, region maps, and
 * candidates whose expiry has passed, and records an audit event.
 *
 * Trigger it on a schedule (Vercel Cron / Supabase pg_cron / any scheduler).
 * It is authenticated with a shared secret so it cannot be invoked or probed
 * anonymously:
 *
 *   Authorization: Bearer $RETENTION_SWEEP_TOKEN
 *
 * If RETENTION_SWEEP_TOKEN is unset the route refuses to run rather than
 * defaulting to open — an unauthenticated deletion endpoint is worse than no
 * endpoint.
 */
export async function POST(req: Request) {
  return guard(async () => {
    const expected = process.env.RETENTION_SWEEP_TOKEN;
    if (!expected) {
      return NextResponse.json(
        { error: "retention sweep is not configured" },
        { status: 503 },
      );
    }
    const auth = req.headers.get("authorization") ?? "";
    const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    // Constant-time-ish compare: reject on length first, then char-by-char.
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const result = await runRetentionSweep();
    return ok(result);
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
