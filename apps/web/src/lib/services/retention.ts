/**
 * Retention enforcement.
 *
 * The product promises that anything the customer did not consent to save is
 * actually deleted — not merely stamped with an expiry. This module is that
 * promise's implementation against the ACTIVE store.
 *
 * Tombstone rule (mirrors migration 20260718103000): expired mask contracts
 * still referenced by a generation job keep a minimal record with `purgedAt`
 * after their bytes are destroyed, so the job can prove which contract it used;
 * unreferenced ones are deleted outright.
 *
 * Audit contract: every tombstoned contract emits a `mask_contract_purged`
 * audit event on its session, carrying the sweep timestamp. This is the
 * evidence trail a privacy review will ask for ("show me retention ran").
 *
 * STILL NOT DONE (do not claim otherwise): no scheduler invokes this, and with
 * only the in-memory store it clears process memory — SupabaseStore does not
 * exist yet, so no Postgres rows or Storage objects are deleted anywhere
 * remote. See docs/privacy/privacy-notes.md.
 */
import "server-only";
import { getStore } from "../store";
import { audit } from "./audit";

export interface RetentionSweepResult {
  removedAssets: number;
  deletedContracts: number;
  purgedContracts: number;
  sweptAt: string;
}

export async function runRetentionSweep(
  now: Date = new Date(),
): Promise<RetentionSweepResult> {
  const store = getStore();
  const result = await store.sweepExpired(now);

  for (const purged of result.purgedContracts) {
    await audit(purged.sessionId, "mask_contract_purged", "retention-sweep", {
      maskContractId: purged.id,
      sweptAt: now.toISOString(),
    });
  }

  return {
    removedAssets: result.removedAssets,
    deletedContracts: result.deletedContracts,
    purgedContracts: result.purgedContracts.length,
    sweptAt: now.toISOString(),
  };
}
