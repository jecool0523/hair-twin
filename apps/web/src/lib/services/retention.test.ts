/**
 * Retention must actually delete, not just record an expiry.
 * This is the privacy promise the consent copy makes to the customer.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { getStore } from "../store";
import { runRetentionSweep } from "./retention";
import {
  createGenerationJob,
  recordConsent,
  startSession,
  storeSourceImage,
} from "./consultation";
import { CONSENT_WORDING_VERSION } from "../config";
import { asActive, captureInput } from "@/test/fixtures";

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
    const contract = asActive(await store.getMaskContract(up.maskContractId));
    const maskId = contract.maskAssetIds.hair_edit!;
    const regionId = contract.regionMapAssetId;

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

  it("tombstones a job-referenced contract instead of deleting it, and audits", async () => {
    const { session, up } = await capture(false);
    const store = getStore();
    const job = await createGenerationJob(session.id, {
      styleId: "layered-c-curl",
      candidateCount: 1,
      maskContractId: up.maskContractId,
    });
    expect(job).toBeDefined();

    const contract = asActive(await store.getMaskContract(up.maskContractId));
    const maskAssetId = contract.maskAssetIds.hair_edit!;

    const later = new Date(Date.now() + 72 * 60 * 60 * 1000);
    const result = await runRetentionSweep(later);

    // The bytes are gone...
    expect(await store.getAsset(maskAssetId)).toBeUndefined();
    expect(await store.getAsset(contract.regionMapAssetId)).toBeUndefined();
    // ...but the contract survives as a tombstone, because the job needs it.
    const tomb = await store.getMaskContract(up.maskContractId);
    expect(tomb).toBeDefined();
    expect(tomb!.status).toBe("purged");
    // The tombstone carries NONE of the sensitive fields anymore.
    expect("coverage" in tomb!).toBe(false);
    expect("maskAssetIds" in tomb!).toBe(false);
    expect("regionMapAssetId" in tomb!).toBe(false);
    if (tomb!.status === "purged") expect(tomb!.purgedAt).toBeTruthy();
    expect(result.purgedContracts).toBe(1);

    // The audit contract: retention leaves evidence it ran, per session.
    const events = await store.listAudit(session.id);
    const purgeEvent = events.find((e) => e.action === "mask_contract_purged");
    expect(purgeEvent).toBeDefined();
    expect(purgeEvent!.detail).toMatchObject({
      maskContractId: up.maskContractId,
    });

    // A second sweep does not re-purge or re-audit the same tombstone.
    const again = await runRetentionSweep(later);
    expect(again.purgedContracts).toBe(0);
    expect(
      (await store.listAudit(session.id)).filter(
        (e) => e.action === "mask_contract_purged",
      ),
    ).toHaveLength(1);
  });
});
