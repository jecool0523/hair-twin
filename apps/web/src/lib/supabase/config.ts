import "server-only";

export function supabasePublicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new Error("Supabase public configuration is missing");
  return { url, publishableKey };
}

export const AUTH_COOKIE = "hair-twin-access";
export const REFRESH_COOKIE = "hair-twin-refresh";
