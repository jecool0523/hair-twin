import { NextResponse } from "next/server";
import { AUTH_COOKIE, REFRESH_COOKIE, supabasePublicConfig } from "@/lib/supabase/config";
import { authCookieOptions } from "@/lib/supabase/auth";
import { isSameOriginRequest, readSmallUrlEncodedForm, safeInternalPath } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return new NextResponse("Forbidden", { status: 403 });
  let form: URLSearchParams;
  try { form = await readSmallUrlEncodedForm(request); } catch { return new NextResponse("Invalid form", { status: 400 }); }
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = safeInternalPath(form.get("next"));
  const { url, publishableKey } = supabasePublicConfig();
  const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publishableKey, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });
  if (!auth.ok) return NextResponse.redirect(new URL("/login?error=invalid", request.url), 303);
  const tokens = (await auth.json()) as { access_token: string; refresh_token: string; expires_in: number };
  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(AUTH_COOKIE, tokens.access_token, { ...authCookieOptions, maxAge: tokens.expires_in });
  response.cookies.set(REFRESH_COOKIE, tokens.refresh_token, { ...authCookieOptions, maxAge: 30 * 24 * 60 * 60 });
  return response;
}
