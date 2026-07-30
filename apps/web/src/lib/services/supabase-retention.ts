import "server-only";

type RetentionKind = "source" | "mask" | "generated";
interface ClaimedObject {
  kind: RetentionKind;
  id: string;
  storage_path: string;
  claim_token: string;
  salon_id: string;
  session_id: string;
}

const BUCKETS: Record<RetentionKind, string> = {
  source: "source-images-private",
  mask: "masks-private",
  generated: "generated-assets-private",
};

export interface RemoteRetentionResult {
  claimed: number;
  deleted: number;
  releasedForRetry: number;
  failures: number;
}

async function rpc(
  fetcher: typeof fetch,
  url: string,
  secret: string,
  name: string,
  body: Record<string, unknown>,
) {
  const response = await fetcher(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      apikey: secret,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`retention RPC ${name} failed (${response.status})`);
  return response.json() as Promise<unknown>;
}

export async function runSupabaseRetentionSweep(
  fetcher: typeof fetch = fetch,
): Promise<RemoteRetentionResult> {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("Supabase retention is not configured");

  const raw = await rpc(fetcher, url, secret, "retention_claim_expired_objects", { p_limit: 100 });
  if (!Array.isArray(raw)) throw new Error("retention claim returned an invalid response");
  const claimed = raw as ClaimedObject[];
  const result: RemoteRetentionResult = {
    claimed: claimed.length,
    deleted: 0,
    releasedForRetry: 0,
    failures: 0,
  };

  for (const item of claimed) {
    const bucket = BUCKETS[item.kind];
    const parts = typeof item.storage_path === "string" ? item.storage_path.split("/") : [];
    if (!bucket || !item.id || !item.claim_token || !item.salon_id || !item.session_id || parts.length < 3 || parts.some((part) => !part || part === "." || part === ".." || part.includes("\\")) || parts[0] !== item.salon_id || parts[1] !== item.session_id) {
      result.failures++;
      continue;
    }
    const path = parts
      .map((part) => encodeURIComponent(part))
      .join("/");
    try {
      const deleted = await fetcher(`${url}/storage/v1/object/${bucket}/${path}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${secret}`, apikey: secret },
        cache: "no-store",
      });
      if (!deleted.ok && deleted.status !== 404) throw new Error(`Storage delete failed (${deleted.status})`);
      const finalized = await rpc(fetcher, url, secret, "retention_finalize_object", {
        p_kind: item.kind,
        p_id: item.id,
        p_claim_token: item.claim_token,
      });
      if (finalized !== true) throw new Error("retention claim became stale");
      result.deleted++;
    } catch {
      result.failures++;
      try {
        const released = await rpc(fetcher, url, secret, "retention_release_object", {
          p_kind: item.kind,
          p_id: item.id,
          p_claim_token: item.claim_token,
        });
        if (released === true) result.releasedForRetry++;
      } catch {
        // The 15-minute lease still makes a failed release retryable.
      }
    }
  }
  return result;
}
