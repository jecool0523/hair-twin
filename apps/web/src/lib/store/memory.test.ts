import { describe, expect, it } from "vitest";
import { InMemoryStore } from "./memory";
import type { StoredAsset } from "./types";

function asset(id: string, expiresAt?: string, saved = false): StoredAsset {
  return {
    id,
    kind: "source",
    sessionId: "s1",
    mime: "image/png",
    width: 1,
    height: 1,
    bytes: Buffer.from([0]),
    createdAt: new Date().toISOString(),
    expiresAt,
    saved,
  };
}

describe("InMemoryStore retention", () => {
  it("sweeps unsaved expired assets but keeps saved ones", async () => {
    const store = new InMemoryStore();
    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    await store.putAsset(asset("expired", past, false));
    await store.putAsset(asset("saved", past, true));
    await store.putAsset(asset("fresh", future, false));

    const removed = await store.sweepExpired();
    expect(removed).toBe(1);
    expect(await store.getAsset("expired")).toBeUndefined();
    expect(await store.getAsset("saved")).toBeDefined();
    expect(await store.getAsset("fresh")).toBeDefined();
  });

  it("markAssetSaved clears expiry", async () => {
    const store = new InMemoryStore();
    await store.putAsset(asset("a", new Date(Date.now() - 1).toISOString()));
    await store.markAssetSaved("a", true);
    const removed = await store.sweepExpired();
    expect(removed).toBe(0);
    expect(await store.getAsset("a")).toBeDefined();
  });

  it("media tokens expire", async () => {
    const store = new InMemoryStore();
    await store.putAsset(asset("a"));
    const t = await store.issueMediaToken("a", -1);
    expect(await store.resolveMediaToken(t.token)).toBeUndefined();
    const t2 = await store.issueMediaToken("a", 60_000);
    expect(await store.resolveMediaToken(t2.token)).toBe("a");
  });
});
