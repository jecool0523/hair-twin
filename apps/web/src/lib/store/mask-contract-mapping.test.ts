/**
 * Proof that the DB schema can hold a MaskContractRecord without losing
 * anything — established BEFORE SupabaseStore is written, so the store is built
 * on a shape we already know fits (CTO decision: schema parity first).
 *
 * The record under test is produced by the real capture path
 * (persistMaskContract), not hand-authored, so it carries the real derived
 * coverage floats rather than tidy sample values.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { fromRows, toRows, maskStoragePath } from "./mask-contract-mapping";
import { persistMaskContract } from "../services/masks";
import { recordConsent, startSession, storeSourceImage } from "../services/consultation";
import { CONSENT_WORDING_VERSION } from "../config";
import { getStore } from ".";
import { captureInput, regionMap } from "@/test/fixtures";
import type { MaskContractRecord } from "./types";

const SALON = "aaaaaaaa-1111-1111-1111-111111111111";

beforeAll(() => {
  process.env.HAIR_TWIN_STORE = "memory";
});

async function realContract(): Promise<MaskContractRecord> {
  const s = await startSession({ stylistName: "t", customerAlias: "c" });
  await recordConsent(s.id, {
    captureConsented: true,
    saveImagesConsented: false,
    saveReportConsented: false,
    wordingVersion: CONSENT_WORDING_VERSION,
  });
  const up = await storeSourceImage(s.id, captureInput({ hairRows: 0.31 }));
  return (await getStore().getMaskContract(up!.maskContractId))!;
}

describe("MaskContractRecord <-> DB rows", () => {
  it("round-trips a real derived contract with no loss", async () => {
    const original = await realContract();
    const restored = fromRows(toRows(original, SALON));
    // Every field, including the derived coverage floats.
    expect(restored).toEqual(original);
  });

  it("preserves derived coverage floats exactly (not rounded)", async () => {
    const original = await realContract();
    const restored = fromRows(toRows(original, SALON));

    // Real coverage values are ratios like 0.147222222222222…, which a
    // numeric(6,5) column would silently truncate. The schema uses double
    // precision for exactly this reason (20260716103000).
    for (const [kind, value] of Object.entries(original.coverage)) {
      expect(restored.coverage[kind]).toBe(value);
      expect(Number.isFinite(value)).toBe(true);
    }
    // Guard the test itself: if coverage were all round numbers this would
    // prove nothing.
    const hasFullPrecisionValue = Object.values(original.coverage).some(
      (v) => v !== 0 && String(v).replace("0.", "").length > 6,
    );
    expect(
      hasFullPrecisionValue,
      "fixture must produce at least one high-precision ratio",
    ).toBe(true);
  });

  it("maps every mask kind plus the region map to its own row", async () => {
    const original = await realContract();
    const { assets } = toRows(original, SALON);

    const kinds = assets.map((a) => a.kind).sort();
    expect(kinds).toEqual(
      [
        "background_protect",
        "body_clothing_protect",
        "face_protect",
        "hair_current",
        "hair_edit",
        "hair_expansion",
        "region_map",
        "uncertain_boundary",
      ].sort(),
    );
    // 7 masks + 1 region map, one row each: matches the DB's
    // unique (mask_contract_id, kind).
    expect(assets).toHaveLength(8);
    expect(new Set(kinds).size).toBe(assets.length);
  });

  it("gives the region map a null coverage rather than a fake zero", async () => {
    const original = await realContract();
    const { assets } = toRows(original, SALON);
    const rm = assets.find((a) => a.kind === "region_map")!;
    expect(rm.coverage).toBeNull();
    // A label grid has no ratio; 0 would read as "no hair", which is a lie.
    expect(original.coverage.region_map).toBeUndefined();
  });

  it("pins every row to the contract's salon/session/source", async () => {
    const original = await realContract();
    const { contract, assets } = toRows(original, SALON);
    // The DB enforces this with a 4-column composite FK; the mapper must not
    // hand it rows that disagree.
    for (const a of assets) {
      expect(a.mask_contract_id).toBe(contract.id);
      expect(a.salon_id).toBe(contract.salon_id);
      expect(a.session_id).toBe(contract.session_id);
      expect(a.source_image_id).toBe(contract.source_image_id);
    }
  });

  it("keeps an unsaved contract's expiry, and omits it when absent", async () => {
    const original = await realContract();
    expect(original.saved).toBe(false);
    expect(original.expiresAt).toBeTruthy();

    const rows = toRows(original, SALON);
    // The DB's mask_contracts_unsaved_must_expire check requires this.
    expect(rows.contract.saved).toBe(false);
    expect(rows.contract.expires_at).toBe(original.expiresAt);

    // A saved contract has no expiry, and null must not become "null".
    const saved: MaskContractRecord = { ...original, saved: true };
    delete saved.expiresAt;
    const restored = fromRows(toRows(saved, SALON));
    expect(restored.expiresAt).toBeUndefined();
    expect("expiresAt" in restored).toBe(false);
    expect(restored).toEqual(saved);
  });

  it("stores masks under the salon-prefixed path the storage policies authorise", async () => {
    const original = await realContract();
    const { assets } = toRows(original, SALON);
    for (const a of assets) {
      // storage.objects policies check the FIRST path segment against
      // membership (20260715120300_storage.sql).
      expect(a.storage_path.split("/")[0]).toBe(SALON);
      expect(a.storage_path).toBe(
        maskStoragePath({
          salonId: SALON,
          sessionId: original.sessionId,
          contractId: original.id,
          kind: a.kind,
        }),
      );
    }
    // Paths are unique per row, matching storage_path's UNIQUE column.
    expect(new Set(assets.map((a) => a.storage_path)).size).toBe(assets.length);
  });

  it("refuses to reconstruct a contract whose region map is missing", async () => {
    const original = await realContract();
    const rows = toRows(original, SALON);
    rows.assets = rows.assets.filter((a) => a.kind !== "region_map");
    // Better to fail loudly than to return a contract that cannot be retried.
    expect(() => fromRows(rows)).toThrow(/region_map/);
  });

  it("survives a retry contract (attempt 2) unchanged", async () => {
    const s = await startSession({ stylistName: "t", customerAlias: "c" });
    await recordConsent(s.id, {
      captureConsented: true,
      saveImagesConsented: false,
      saveReportConsented: false,
      wordingVersion: CONSENT_WORDING_VERSION,
    });
    const up = await storeSourceImage(s.id, captureInput());
    const first = (await getStore().getMaskContract(up!.maskContractId))!;

    const retry = await persistMaskContract({
      sessionId: first.sessionId,
      sourceImageId: first.sourceImageId,
      regionMap: regionMap(),
      expansionRadius: 2,
      attempt: 2,
    });

    expect(fromRows(toRows(retry, SALON))).toEqual(retry);
    // Attempt is what keeps the two rows distinct under the DB's
    // unique (source_image_id, attempt, version).
    expect(retry.attempt).toBe(2);
    expect(retry.id).not.toBe(first.id);
    expect(toRows(retry, SALON).contract.attempt).toBe(2);
  });
});
