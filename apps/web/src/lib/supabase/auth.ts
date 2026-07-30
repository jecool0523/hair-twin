import "server-only";
import { cookies } from "next/headers";
import { AUTH_COOKIE, REFRESH_COOKIE, supabasePublicConfig } from "./config";

export interface UserSession {
  accessToken: string;
  userId: string;
  email: string;
}

export interface AuthContext extends UserSession {
  salonId: string;
  role: "owner" | "admin" | "stylist";
}

export class AuthenticationRequired extends Error {}
export class MembershipRequired extends Error {}

async function authFetch(path: string, accessToken: string) {
  const { url, publishableKey } = supabasePublicConfig();
  return fetch(`${url}${path}`, {
    headers: { apikey: publishableKey, authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
}

export async function resolveUserSession(): Promise<UserSession> {
  const jar = await cookies();
  const accessToken = jar.get(AUTH_COOKIE)?.value;
  if (!accessToken) throw new AuthenticationRequired("authentication required");
  const response = await authFetch("/auth/v1/user", accessToken);
  if (!response.ok) throw new AuthenticationRequired("session expired");
  const user = (await response.json()) as { id?: string; email?: string };
  if (!user.id || !user.email) throw new AuthenticationRequired("invalid auth user");
  return { accessToken, userId: user.id, email: user.email };
}

export async function resolveAuthContext(): Promise<AuthContext> {
  const session = await resolveUserSession();
  const response = await authFetch(
    `/rest/v1/salon_memberships?select=salon_id,role&profile_id=eq.${encodeURIComponent(session.userId)}&order=created_at.asc&limit=1`,
    session.accessToken,
  );
  if (!response.ok) throw new MembershipRequired("membership lookup failed");
  const rows = (await response.json()) as Array<{ salon_id?: string; role?: AuthContext["role"] }>;
  const membership = rows[0];
  if (!membership?.salon_id || !membership.role) throw new MembershipRequired("salon membership required");
  return { ...session, salonId: membership.salon_id, role: membership.role };
}

export const authCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export function clearAuthCookies(response: { cookies: { set: Function } }) {
  response.cookies.set(AUTH_COOKIE, "", { ...authCookieOptions, maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, "", { ...authCookieOptions, maxAge: 0 });
}
