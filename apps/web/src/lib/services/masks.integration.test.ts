/**
 * Real mask contract wiring: capture -> persisted contract -> job -> provider.
 *
 * These are the guarantees that stop the "fake mask" regression coming back:
 * the numbers a provider sees must be derived from the actual photo, must be
 * the server's, must belong to this session/source, must not be expired, and a
 * retry must genuinely tighten them.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getStore } from "../store";
import {
  createGenerationJob,
  recordConsent,
  retryJob,
  startSession,
  storeSourceImage,
} from "./consultation";
import { processJob } from "./generation-worker";
import {
  loadMaskContractForJob,
  parseRegionMap,
  persistMaskContract,
  MaskRejected,
} from "./masks";
import { CONSENT_WORDING_VERSION } from "../config";
import { MockHairProvider } from "../providers/mock";
import { asActive, captureInput, regionMap } from "@/test/fixtures";
import type { HairGenerationRequest } from "../providers/adapter";

beforeAll(() => {
  process.env.HAIR_TWIN_STORE = "memory";
  delete process.env.HAIR_TWIN_PROVIDER;
});

async function consentedSession() {
  const s = await startSession({ stylistName: "t", customerAlias: "c" });
  await recordConsent(s.id, {
    captureConsented: true,
    saveImagesConsented: true,
    saveReportConsented: false,
    wordingVersion: CONSENT_WORDING_VERSION,
  });
  return s;
}

describe("mask contracts are derived from the real capture", () => {
  it("different inputs produce different contracts reaching the provider", async () => {
    const a = await consentedSession();
    const b = await consentedSession();

    // Two genuinely different photos: much more hair in the second.
    const upA = await storeSourceImage(a.id, captureInput({ hairRows: 0.22 }));
    const upB = await storeSourceImage(b.id, captureInput({ hairRows: 0.55 }));

    const store = getStore();
    const cA = asActive(await store.getMaskContract(upA!.maskContractId));
    const cB = asActive(await store.getMaskContract(upB!.maskContractId));

    // Coverage is derived, so it must differ between the two captures.
    expect(cA.coverage.hair_current).not.toBe(cB.coverage.hair_current);
    expect(cA.coverage.hair_edit).not.toBe(cB.coverage.hair_edit);
    expect(cB.coverage.hair_current!).toBeGreaterThan(cA.coverage.hair_current!);

    // ...and the provider receives those distinct contracts, not a constant.
    const seen: HairGenerationRequest[] = [];
    const spy = vi
      .spyOn(MockHairProvider.prototype, "generate")
      .mockImplementation(async function (this: MockHairProvider, req) {
        seen.push(req);
        return { provider: "mock", model: "m", candidates: [] };
      });
    try {
      const jobA = await createGenerationJob(a.id, {
        styleId: "layered-c-curl",
        candidateCount: 1,
        maskContractId: upA!.maskContractId,
      });
      const jobB = await createGenerationJob(b.id, {
        styleId: "layered-c-curl",
        candidateCount: 1,
        maskContractId: upB!.maskContractId,
      });
      // createGenerationJob already fires the worker; just let it settle.
      await new Promise((r) => setTimeout(r, 50));
      expect(jobA!.id).toBeTruthy();
      expect(jobB!.id).toBeTruthy();
    } finally {
      spy.mockRestore();
    }

    const forA = seen.find((r) => r.masks.contractId === upA!.maskContractId);
    const forB = seen.find((r) => r.masks.contractId === upB!.maskContractId);
    expect(forA, "provider was called with salon A's contract").toBeDefined();
    expect(forB, "provider was called with salon B's contract").toBeDefined();
    expect(forA!.masks.coverage.hair_edit).toBe(cA.coverage.hair_edit);
    expect(forB!.masks.coverage.hair_edit).toBe(cB.coverage.hair_edit);
    // The whole point: distinct photos => distinct contracts at the provider.
    expect(forA!.masks.coverage.hair_edit).not.toBe(
      forB!.masks.coverage.hair_edit,
    );
    // The provider can reach real mask bytes by reference.
    expect(forA!.masks.assetIds.hair_edit).toBeTruthy();
  });

  it("a client-supplied coverage claim is not trusted", async () => {
    const s = await consentedSession();
    const input = captureInput({ hairRows: 0.3 });
    // The client tries to smuggle a summary in. The API type does not accept it,
    // and the server derives coverage from the region-map bytes regardless.
    const smuggled = {
      ...input,
      maskSummary: { hairEditCoverage: 0.99, expansionRadius: 64 },
      coverage: { hair_edit: 0.99 },
    } as Parameters<typeof storeSourceImage>[1];

    const up = await storeSourceImage(s.id, smuggled);
    const contract = asActive(await getStore().getMaskContract(up!.maskContractId));

    // Derived from the real map, nowhere near the asserted 0.99.
    expect(contract.coverage.hair_edit!).toBeLessThan(0.5);
    expect(contract.expansionRadius).toBe(6);

    // And an independent re-derivation from the same bytes agrees.
    const { buildMaskSet } = await import("../domain/masks");
    const expected = buildMaskSet(regionMap({ hairRows: 0.3 }), 6);
    expect(contract.coverage.hair_edit!).toBeCloseTo(
      expected.coverage.hair_edit,
      10,
    );
  });

  it("a mask from another session/source is rejected", async () => {
    const a = await consentedSession();
    const b = await consentedSession();
    const upA = await storeSourceImage(a.id, captureInput());
    const upB = await storeSourceImage(b.id, captureInput());

    // Session B tries to generate against session A's mask contract.
    await expect(
      createGenerationJob(b.id, {
        styleId: "layered-c-curl",
        candidateCount: 1,
        maskContractId: upA!.maskContractId,
      }),
    ).rejects.toThrow(MaskRejected);

    // Same session, but a contract bound to a different source image.
    await expect(
      loadMaskContractForJob({
        contractId: upB!.maskContractId,
        sessionId: b.id,
        sourceImageId: upA!.ref.id,
      }),
    ).rejects.toThrow(MaskRejected);
  });

  it("an expired mask is not used for generation", async () => {
    const s = await consentedSession();
    const up = await storeSourceImage(s.id, captureInput());
    const store = getStore();
    const contract = asActive(await store.getMaskContract(up!.maskContractId));

    // Force the contract past its retention window.
    await store.putMaskContract({
      ...contract,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    await expect(
      loadMaskContractForJob({
        contractId: up!.maskContractId,
        sessionId: s.id,
        sourceImageId: up!.ref.id,
      }),
    ).rejects.toMatchObject({ userMessageKo: expect.stringMatching(/만료/) });

    // A job that somehow references it fails loudly rather than generating
    // against stale masks.
    await expect(
      createGenerationJob(s.id, {
        styleId: "layered-c-curl",
        candidateCount: 1,
        maskContractId: up!.maskContractId,
      }),
    ).rejects.toThrow(MaskRejected);
  });

  it("retry tuning is reflected in a real, newly derived contract", async () => {
    const s = await consentedSession();
    const up = await storeSourceImage(s.id, captureInput({ hairRows: 0.35 }));
    const job = await createGenerationJob(s.id, {
      styleId: "layered-c-curl",
      candidateCount: 2,
      maskContractId: up!.maskContractId,
    });
    await processJob(job!.id, { stepDelayMs: 0 });

    const store = getStore();
    const before = await store.getMaskContract(up!.maskContractId);
    await store.updateJob(job!.id, { status: "failed_retryable" });

    const retried = await retryJob(job!.id);
    expect(retried!.attempts).toBe(2);

    // The job now points at a NEW contract version...
    expect(retried!.maskContractId).not.toBe(up!.maskContractId);
    const after = asActive(await store.getMaskContract(retried!.maskContractId));
    const beforeActive = asActive(before);
    expect(after.attempt).toBe(2);
    // ...with a genuinely tighter expansion ring...
    expect(after.expansionRadius).toBeLessThan(beforeActive.expansionRadius);
    // ...producing a smaller real edit region, derived from the same photo.
    expect(after.coverage.hair_edit!).toBeLessThan(beforeActive.coverage.hair_edit!);
    expect(after.coverage.hair_current!).toBeCloseTo(
      beforeActive.coverage.hair_current!,
      10,
    );
    // The original version survives for auditability.
    expect(before).toBeDefined();
    const versions = await store.listMaskContractsForSource(up!.ref.id);
    expect(versions.length).toBeGreaterThanOrEqual(2);
  });
});

describe("parseRegionMap", () => {
  it("rejects a length that disagrees with the declared grid", () => {
    expect(() => parseRegionMap(new Uint8Array(10), 48, 64)).toThrow(MaskRejected);
  });

  it("rejects unknown region classes", () => {
    const rm = regionMap();
    const bad = new Uint8Array(rm.data);
    bad[0] = 99;
    expect(() => parseRegionMap(bad, rm.width, rm.height)).toThrow(MaskRejected);
  });

  it("rejects an all-zero map with no hair or face", () => {
    expect(() => parseRegionMap(new Uint8Array(48 * 64), 48, 64)).toThrow(
      MaskRejected,
    );
    try {
      parseRegionMap(new Uint8Array(48 * 64), 48, 64);
    } catch (e) {
      expect((e as MaskRejected).userMessageKo).toMatch(/머리카락|얼굴/);
    }
  });

  it("rejects implausible grid dimensions", () => {
    expect(() => parseRegionMap(new Uint8Array(4), 2, 2)).toThrow(MaskRejected);
  });
});

describe("purged contracts fail clearly", () => {
  it("load and job creation both refuse a purged tombstone", async () => {
    const s = await consentedSession();
    const up = await storeSourceImage(s.id, captureInput());
    const store = getStore();
    const active = asActive(await store.getMaskContract(up!.maskContractId));

    // The tombstone the sweep leaves: PURGED variant, carrying NONE of
    // coverage/maskAssetIds/regionMapAssetId. Building it by hand this way is
    // only possible because the type forbids the sensitive fields.
    await store.putMaskContract({
      status: "purged",
      id: active.id,
      sessionId: active.sessionId,
      sourceImageId: active.sourceImageId,
      version: active.version,
      attempt: active.attempt,
      expansionRadius: active.expansionRadius,
      width: active.width,
      height: active.height,
      createdAt: active.createdAt,
      purgedAt: new Date().toISOString(),
    });

    // Loading for generation refuses: the masks no longer exist.
    await expect(
      loadMaskContractForJob({
        contractId: up!.maskContractId,
        sessionId: s.id,
        sourceImageId: up!.ref.id,
      }),
    ).rejects.toMatchObject({ userMessageKo: expect.stringMatching(/파기/) });

    // The real retry/generation entry points refuse too — silently
    // regenerating against missing masks is the failure this prevents.
    // (deriveRetryContract can no longer even be CALLED with a tombstone: it
    //  requires ActiveMaskContract, so that path is a compile-time guarantee.)
    await expect(
      createGenerationJob(s.id, {
        styleId: "layered-c-curl",
        candidateCount: 1,
        maskContractId: up!.maskContractId,
      }),
    ).rejects.toThrow(MaskRejected);
  });
});

describe("mask retention", () => {
  it("sweeping an unreferenced expired contract deletes its bytes and record", async () => {
    const s = await consentedSession();
    const up = await storeSourceImage(s.id, captureInput());
    const store = getStore();
    const contract = asActive(await store.getMaskContract(up!.maskContractId));
    const maskAssetId = contract.maskAssetIds.hair_edit!;
    expect(await store.getAsset(maskAssetId)).toBeDefined();

    // No job references it, so expiry deletes outright (not tombstone).
    await store.putMaskContract({
      ...contract,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await store.sweepExpired();

    expect(await store.getMaskContract(up!.maskContractId)).toBeUndefined();
    expect(await store.getAsset(maskAssetId)).toBeUndefined();
    expect(await store.getAsset(contract.regionMapAssetId)).toBeUndefined();
  });
});
