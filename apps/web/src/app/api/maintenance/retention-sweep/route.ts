import { NextResponse } from "next/server";
import { guard, ok } from "@/lib/http";
import { runRetentionSweep } from "@/lib/services/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retention sweep — deletes unsaved media whose expiry has passed.
 *
 * SCOPE, precisely (see docs/privacy/privacy-notes.md):
 *   DONE     manual, authenticated invocation; deletes from the active store.
 *   NOT DONE no scheduler is attached — nothing calls this on a timer yet.
 *   NOT DONE no remote deletion; SupabaseStore does not exist, so this only
 *            clears the in-memory store today.
 *   NOT DONE the sweep itself is not written to audit_events.
 *
 * Once a scheduler exists, point it here (Vercel Cron / Supabase pg_cron).
 * Authenticated with a shared secret so it cannot be invoked or probed
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
