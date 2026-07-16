/**
 * Retention enforcement.
 *
 * The product promises that anything the customer did not consent to save is
 * actually deleted — not merely stamped with an expiry. This module is that
 * promise's implementation, and it is deliberately store-agnostic so it works
 * against the in-memory store today and a Supabase-backed one later.
 */
import "server-only";
import { getStore } from "../store";

export interface RetentionSweepResult {
  removedAssets: number;
  sweptAt: string;
}

/**
 * Delete unsaved, expired media (source images, masks, region maps,
 * candidates). Saved items — the ones with explicit consent — are untouched.
 */
export async function runRetentionSweep(
  now: Date = new Date(),
): Promise<RetentionSweepResult> {
  const store = getStore();
  const removedAssets = await store.sweepExpired(now);
  return { removedAssets, sweptAt: now.toISOString() };
}
