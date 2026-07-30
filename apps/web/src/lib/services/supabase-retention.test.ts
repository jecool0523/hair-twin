import { afterEach, describe, expect, it, vi } from "vitest";
import { runSupabaseRetentionSweep } from "./supabase-retention";

afterEach(() => vi.unstubAllEnvs());

describe("Supabase remote retention", () => {
  it("finalizes deleted bytes and releases failures for retry", async () => {
    vi.stubEnv("SUPABASE_URL", "http://supabase.local");
    vi.stubEnv("SUPABASE_SECRET_KEY", "server-secret");
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("retention_claim_expired_objects")) {
        return Response.json([
          { kind: "source", id: "source-id", salon_id: "salon", session_id: "session", storage_path: "salon/session/source.png", claim_token: "token" },
          { kind: "mask", id: "mask-id", salon_id: "salon", session_id: "session", storage_path: "salon/session/mask.png", claim_token: "token" },
        ]);
      }
      if (url.includes("masks-private")) return new Response("", { status: 503 });
      if (url.includes("storage/v1/object")) return new Response("", { status: 200 });
      if (url.endsWith("retention_finalize_object")) return Response.json(true);
      if (url.endsWith("retention_release_object")) return Response.json(true);
      return new Response("", { status: 500 });
    }) as unknown as typeof fetch;

    await expect(runSupabaseRetentionSweep(fetcher)).resolves.toEqual({
      claimed: 2,
      deleted: 1,
      releasedForRetry: 1,
      failures: 1,
    });
    expect(calls.some((url) => url.includes("source-images-private/salon/session/source.png"))).toBe(true);
    expect(calls.some((url) => url.endsWith("retention_finalize_object"))).toBe(true);
    expect(calls.some((url) => url.endsWith("retention_release_object"))).toBe(true);
  });
});
