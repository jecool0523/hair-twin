/**
 * Retention must actually delete, not just record an expiry.
 * This is the privacy promise the consent copy makes to the customer.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getStore } from "../store";
import { runRetentionSweep } from "./retention";
import {
  recordConsent,
  startSession,
  storeSourceImage,
} from "./consultation";
import { CONSENT_WORDING_VERSION } from "../config";
import { captureInput } from "@/test/fixtures";

beforeAll(() => {
  process.env.HAIR_TWIN_STORE = "memory";
});

async function capture(saveImages: boolean) {
  const s = await startSession({ stylistName: "t", customerAlias: "c" });
  await recordConsent(s.id, {
    captureConsented: true,
    saveImagesConsented: saveImages,
    saveReportConsented: false,
    wordingVersion: CONSENT_WORDING_VERSION,
  });
  const up = await storeSourceImage(s.id, captureInput());
  return { session: s, up: up! };
}

describe("runRetentionSweep", () => {
  it("deletes the source photo, its masks and region map once expired", async () => {
    const { up } = await capture(false);
    const store = getStore();
    const contract = await store.getMaskContract(up.maskContractId);
    const maskId = contract!.maskAssetIds.hair_edit!;
    const regionId = contract!.regionMapAssetId;

    // Everything is present and carries an expiry (never open-ended).
    expect(await store.getAsset(up.ref.id)).toBeDefined();
    expect(await store.getAsset(maskId)).toBeDefined();
    expect(await store.getAsset(regionId)).toBeDefined();
    expect(up.ref.expiresAt).toBeTruthy();

    // Sweep at a time past the retention window.
    const later = new Date(Date.now() + 72 * 60 * 60 * 1000);
    const result = await runRetentionSweep(later);

    expect(result.removedAssets).toBeGreaterThan(0);
    expect(await store.getAsset(up.ref.id)).toBeUndefined();
    expect(await store.getAsset(maskId)).toBeUndefined();
    expect(await store.getAsset(regionId)).toBeUndefined();
    // The contract record goes too, so nothing dangles.
    expect(await store.getMaskContract(up.maskContractId)).toBeUndefined();
  });

  it("leaves saved media alone", async () => {
    const { up } = await capture(true);
    const store = getStore();
    await store.markAssetSaved(up.ref.id, true);

    await runRetentionSweep(new Date(Date.now() + 72 * 60 * 60 * 1000));

    const asset = await store.getAsset(up.ref.id);
    expect(asset).toBeDefined();
    expect(asset!.saved).toBe(true);
  });

  it("does not delete media that has not expired yet", async () => {
    const { up } = await capture(false);
    const store = getStore();
    await runRetentionSweep(new Date()); // now
    expect(await store.getAsset(up.ref.id)).toBeDefined();
  });
});
