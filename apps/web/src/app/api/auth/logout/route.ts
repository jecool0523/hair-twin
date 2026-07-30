import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE, supabasePublicConfig } from "@/lib/supabase/config";
import { clearAuthCookies } from "@/lib/supabase/auth";
import { isSameOriginRequest } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return new NextResponse("Forbidden", { status: 403 });
  const jar = await cookies();
  const token = jar.get(AUTH_COOKIE)?.value;
  if (token) {
    const { url, publishableKey } = supabasePublicConfig();
    await fetch(`${url}/auth/v1/logout`, {
      method: "POST",
      headers: { apikey: publishableKey, authorization: `Bearer ${token}` },
      cache: "no-store",
    }).catch(() => undefined);
  }
  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  clearAuthCookies(response);
  return response;
}
