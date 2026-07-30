import { NextResponse } from "next/server";
import { resolveUserSession } from "@/lib/supabase/auth";
import { userRpc } from "@/lib/supabase/user-api";
import { readSmallUrlEncodedForm } from "@/lib/request-security";

export async function POST(request: Request) {
  const form = await readSmallUrlEncodedForm(request);
  const inviteId = String(form.get("inviteId") ?? "");
  const session = await resolveUserSession();
  try {
    await userRpc(session.accessToken, "accept_salon_invite", { p_invite_id: inviteId, p_display_name: "" });
    return NextResponse.redirect(new URL("/", request.url), 303);
  } catch {
    return NextResponse.redirect(new URL(`/invite/accept?id=${encodeURIComponent(inviteId)}&error=1`, request.url), 303);
  }
}
