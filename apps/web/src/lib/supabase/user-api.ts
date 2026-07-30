import "server-only";
import { supabasePublicConfig } from "./config";

export async function userRpc(accessToken: string, name: string, body: Record<string, unknown>) {
  const { url, publishableKey } = supabasePublicConfig();
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { apikey: publishableKey, authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Supabase RPC ${name} failed (${response.status})`);
  const text = await response.text();
  return text ? (JSON.parse(text) as unknown) : null;
}
