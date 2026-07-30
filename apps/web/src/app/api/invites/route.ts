import { NextResponse } from "next/server";
import { guard } from "@/lib/http";
import { getRequestAuth } from "@/lib/store";
import { userRpc } from "@/lib/supabase/user-api";
import { createInviteEmailProvider } from "@/lib/email/invite";
import { readSmallUrlEncodedForm } from "@/lib/request-security";

export async function POST(request: Request) {
  return guard(async () => {
    const form = await readSmallUrlEncodedForm(request);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const role = String(form.get("role") ?? "stylist");
    if (!email.includes("@") || !["admin", "stylist"].includes(role)) {
      return NextResponse.redirect(new URL("/settings/invites?error=invalid", request.url), 303);
    }
    const auth = getRequestAuth();
    const inviteId = await userRpc(auth.accessToken, "create_or_reinvite_salon_invite", {
      p_salon_id: auth.salonId,
      p_email: email,
      p_role: role,
    });
    if (typeof inviteId !== "string") throw new Error("invite RPC returned an invalid id");
    const acceptUrl = new URL(`/invite/accept?id=${encodeURIComponent(inviteId)}`, request.url).toString();
    try {
      await createInviteEmailProvider().send({ email, salonId: auth.salonId, role: role as "admin" | "stylist", acceptUrl });
    } catch (error) {
      await userRpc(auth.accessToken, "revoke_salon_invite", { p_invite_id: inviteId }).catch(() => undefined);
      throw error;
    }
    return NextResponse.redirect(new URL("/settings/invites?sent=1", request.url), 303);
  });
}
