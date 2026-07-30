import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encodeGridPng } from "../media/grid-png";
import { SupabaseStore } from "./supabase";
import type { ActiveMaskContract, StoredAsset } from "./types";
import type { ConsultationSession, SourceImageRef } from "../domain/types";

const run = process.env.RUN_SUPABASE_INTEGRATION === "1" ? describe : describe.skip;

run("SupabaseStore against local Auth/PostgREST/Storage", () => {
  it("uses a real user session, RLS tenant, and private binary storage", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
    const secret = process.env.SUPABASE_SECRET_KEY!;
    const admin = async (path: string, init: RequestInit = {}) => {
      const response = await fetch(`${url}${path}`, {
        ...init,
        headers: { apikey: secret, authorization: `Bearer ${secret}`, "content-type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) },
      });
      if (!response.ok) throw new Error(`admin fixture failed ${path} (${response.status})`);
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    };

    const email = `store-${randomUUID()}@example.test`;
    const password = `Local-${randomUUID()}!`;
    const user = await admin("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) }) as { id: string };
    const organizationId = randomUUID();
    const salonId = randomUUID();
    const otherOrganizationId = randomUUID();
    const otherSalonId = randomUUID();
    try {
      await admin("/rest/v1/organizations", { method: "POST", body: JSON.stringify([
        { id: organizationId, name: "Store Integration Org" },
        { id: otherOrganizationId, name: "Other Org" },
      ]) });
      await admin("/rest/v1/salons", { method: "POST", body: JSON.stringify([
        { id: salonId, organization_id: organizationId, name: "Store Integration Salon" },
        { id: otherSalonId, organization_id: otherOrganizationId, name: "Other Salon" },
      ]) });
      await admin("/rest/v1/profiles", { method: "POST", body: JSON.stringify({ id: user.id, display_name: "Integration Stylist" }) });
      await admin("/rest/v1/salon_memberships", { method: "POST", body: JSON.stringify({ salon_id: salonId, profile_id: user.id, role: "owner" }) });

      const signedIn = await fetch(`${url}/auth/v1/token?grant_type=password`, {
        method: "POST", headers: { apikey: publishable, "content-type": "application/json" }, body: JSON.stringify({ email, password }),
      });
      if (!signedIn.ok) {
        const failure = await signedIn.json().catch(() => ({})) as { error_code?: string; code?: string };
        throw new Error(`local password sign-in failed (${signedIn.status}:${failure.error_code ?? failure.code ?? "unknown"})`);
      }
      const token = (await signedIn.json() as { access_token: string }).access_token;
      const publicSignup = await fetch(`${url}/auth/v1/signup`, {
        method: "POST", headers: { apikey: publishable, "content-type": "application/json" },
        body: JSON.stringify({ email: `blocked-${randomUUID()}@example.test`, password: `Blocked-${randomUUID()}!` }),
      });
      expect(publicSignup.ok).toBe(false);
      const store = new SupabaseStore({ accessToken: token, userId: user.id, email, salonId, role: "owner" });

      const now = new Date();
      const sessionId = randomUUID();
      const session: ConsultationSession = {
        id: sessionId, salonId, stylistId: user.id, customerAlias: "Anonymous",
        stage: "consent", note: { memoKo: "", feasibility: "", estimatedPrice: "", estimatedTime: "", careNotesKo: "", updatedAt: now.toISOString() },
        createdAt: now.toISOString(), updatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3600000).toISOString(),
      };
      await store.createSession(session);

      const sourceId = randomUUID();
      const sourceBytes = encodeGridPng(Buffer.from([0, 1, 1, 0]), 2, 2);
      const sourceAsset: StoredAsset = {
        id: sourceId, kind: "source", sessionId, mime: "image/png", width: 2, height: 2,
        bytes: sourceBytes, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 3600000).toISOString(), saved: false,
      };
      await store.putAsset(sourceAsset);
      const sourceRef: SourceImageRef = { id: sourceId, sessionId, mime: "image/png", width: 2, height: 2, createdAt: now.toISOString(), expiresAt: sourceAsset.expiresAt, saved: false };
      await store.putSourceImage(sourceRef);
      expect((await store.getAsset(sourceId))?.bytes.equals(sourceBytes)).toBe(true);

      const hairMaskId = randomUUID();
      const regionMapId = randomUUID();
      for (const [id, kind, bytes] of [
        [hairMaskId, "mask", Buffer.from([1, 0, 0, 1])],
        [regionMapId, "region_map", Buffer.from([2, 1, 1, 2])],
      ] as const) {
        await store.putAsset({ id, kind, sessionId, mime: "application/octet-stream", width: 2, height: 2, bytes, createdAt: now.toISOString(), expiresAt: sourceAsset.expiresAt, saved: false });
      }
      const contract: ActiveMaskContract = {
        status: "active", id: randomUUID(), sessionId, sourceImageId: sourceId, version: "mask-contract-1", attempt: 1,
        expansionRadius: 6, width: 2, height: 2, coverage: { hair_edit: 0.5 }, maskAssetIds: { hair_edit: hairMaskId },
        regionMapAssetId: regionMapId, createdAt: now.toISOString(), expiresAt: sourceAsset.expiresAt, saved: false,
      };
      await store.putMaskContract(contract);
      expect([...(await store.getAsset(hairMaskId))!.bytes]).toEqual([1, 0, 0, 1]);
      expect((await store.getMaskContract(contract.id))?.id).toBe(contract.id);

      const tokenResult = await store.issueMediaToken(sourceId, 60000);
      expect(await store.resolveMediaToken(tokenResult.token)).toBe(sourceId);

      const otherSource = randomUUID();
      const otherSession = randomUUID();
      await admin("/rest/v1/consultation_sessions", { method: "POST", body: JSON.stringify({ id: otherSession, salon_id: otherSalonId, customer_alias: "Other", expires_at: new Date(now.getTime() + 3600000).toISOString() }) });
      await admin("/rest/v1/source_images", { method: "POST", body: JSON.stringify({ id: otherSource, salon_id: otherSalonId, session_id: otherSession, storage_path: `${otherSalonId}/${otherSession}/other.png`, mime: "image/png", width: 2, height: 2, expires_at: new Date(now.getTime() + 3600000).toISOString() }) });
      expect(await store.getSourceImage(otherSource)).toBeUndefined();
    } finally {
      await admin(`/rest/v1/organizations?id=eq.${organizationId}`, { method: "DELETE" }).catch(() => undefined);
      await admin(`/rest/v1/organizations?id=eq.${otherOrganizationId}`, { method: "DELETE" }).catch(() => undefined);
      await admin(`/auth/v1/admin/users/${user.id}`, { method: "DELETE" }).catch(() => undefined);
    }
  });
});
