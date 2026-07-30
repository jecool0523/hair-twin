import { NextRequest, NextResponse } from "next/server";

const ACCESS = "hair-twin-access";
const REFRESH = "hair-twin-refresh";

function cookieOptions(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge };
}

function unauthenticated(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "authentication required" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method) && request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "same-origin request required" }, { status: 403 });
  }
  const storeMode = (process.env.HAIR_TWIN_STORE ?? "memory").toLowerCase();
  if (storeMode !== "supabase") {
    if (process.env.NODE_ENV !== "production" && storeMode === "memory") return NextResponse.next();
    return NextResponse.json({ error: "production persistence is not configured" }, { status: 503 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return unauthenticated(request);

  let access = request.cookies.get(ACCESS)?.value;
  const validate = (token: string) =>
    fetch(`${url}/auth/v1/user`, { headers: { apikey: key, authorization: `Bearer ${token}` }, cache: "no-store" });
  if (access && (await validate(access)).ok) return NextResponse.next();

  const refresh = request.cookies.get(REFRESH)?.value;
  if (!refresh) return unauthenticated(request);
  const renewed = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh }),
    cache: "no-store",
  });
  if (!renewed.ok) return unauthenticated(request);
  const tokens = (await renewed.json()) as { access_token: string; refresh_token: string; expires_in: number };
  access = tokens.access_token;
  request.cookies.set(ACCESS, access);
  request.cookies.set(REFRESH, tokens.refresh_token);
  const response = NextResponse.next({ request });
  response.cookies.set(ACCESS, access, cookieOptions(tokens.expires_in));
  response.cookies.set(REFRESH, tokens.refresh_token, cookieOptions(30 * 24 * 60 * 60));
  return response;
}

export const config = {
  matcher: ["/((?!login|api/auth|api/maintenance/retention-sweep|_next/static|_next/image|favicon.ico).*)"],
};
