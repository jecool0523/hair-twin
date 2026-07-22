/**
 * MaskContractRecord <-> Supabase row mapping.
 *
 * This is the bridge between the app's aggregate (one MaskContractRecord that
 * owns its masks) and the relational shape (one `mask_contracts` row + N
 * `mask_assets` rows). It is a PURE mapping — no client, no I/O — written now so
 * the app and DB contracts can be proven equivalent BEFORE SupabaseStore is
 * built on top of it (CTO decision: schema parity first).
 *
 * The mapping must be lossless in both directions; see mask-contract-mapping.test.ts.
 *
 * Field-name differences between the two sides are mechanical (camelCase vs
 * snake_case) and are handled here. Two things are genuinely structural rather
 * than cosmetic, and are resolved as follows:
 *
 *   * `coverage` is a Record<MaskName, number> on the aggregate, but lives
 *     NORMALISED on each mask_assets row in the DB (one ratio next to the mask
 *     it describes). Reassembly rebuilds the map. region_map carries no
 *     coverage, so its column is NULL rather than a fake 0.
 *   * `maskAssetIds` + `regionMapAssetId` are the aggregate's pointers; in the
 *     DB the direction is inverted — each mask row points at its contract. The
 *     region map is simply the row whose kind is 'region_map'.
 *
 * A PURGED contract (tombstone) is a first-class case, not a degraded active
 * one: the DB row has `purged_at` set and NO `mask_assets` rows at all (bytes
 * destroyed by retention). `fromRows` reconstructs it WITHOUT requiring any mask
 * asset — the DB is the authoritative contract, and it says a tombstone has no
 * coverage/maskAssetIds/regionMapAssetId. `toRows` emits zero asset rows for a
 * tombstone, so a round-trip cannot resurrect deleted material.
 *
 * `salonId` is NOT on MaskContractRecord today (the in-memory store is
 * single-tenant dev scaffolding), so it is supplied to `toRows` explicitly. When
 * Auth lands, it comes from the authenticated membership — never from a client.
 */
import type { MaskName } from "../domain/masks";
import type {
  ActiveMaskContract,
  MaskContractRecord,
  PurgedMaskContract,
} from "./types";

/** Mask kinds as stored in the DB enum: the 7 masks plus the region map. */
export type MaskKind = MaskName | "region_map";

/** A `public.mask_contracts` row. */
export interface MaskContractRow {
  id: string;
  salon_id: string;
  session_id: string;
  source_image_id: string;
  version: string;
  attempt: number;
  expansion_radius: number;
  width: number;
  height: number;
  saved: boolean;
  expires_at: string | null;
  purged_at: string | null;
  created_at: string;
}

/** A `public.mask_assets` row. */
export interface MaskAssetRow {
  id: string;
  mask_contract_id: string;
  salon_id: string;
  session_id: string;
  source_image_id: string;
  kind: MaskKind;
  storage_path: string;
  /** NULL for region_map, which has no coverage ratio. */
  coverage: number | null;
  width: number;
  height: number;
  saved: boolean;
  expires_at: string | null;
}

export interface MaskContractRows {
  contract: MaskContractRow;
  assets: MaskAssetRow[];
}

/**
 * Where an asset's bytes live in the private bucket.
 * `<salon_id>/<session_id>/<contract_id>/<kind>.bin` — the salon prefix is what
 * the storage RLS policies authorise on (20260715120300_storage.sql).
 */
export function maskStoragePath(opts: {
  salonId: string;
  sessionId: string;
  contractId: string;
  kind: MaskKind;
}): string {
  return `${opts.salonId}/${opts.sessionId}/${opts.contractId}/${opts.kind}.bin`;
}

export function toRows(
  record: MaskContractRecord,
  salonId: string,
): MaskContractRows {
  const contract: MaskContractRow = {
    id: record.id,
    salon_id: salonId,
    session_id: record.sessionId,
    source_image_id: record.sourceImageId,
    version: record.version,
    attempt: record.attempt,
    expansion_radius: record.expansionRadius,
    width: record.width,
    height: record.height,
    // A purged tombstone is never "saved" and its expiry is moot; the DB row
    // keeps the columns, but the aggregate no longer carries them.
    saved: record.status === "active" ? record.saved : false,
    expires_at: record.status === "active" ? (record.expiresAt ?? null) : null,
    purged_at: record.status === "purged" ? record.purgedAt : null,
    created_at: record.createdAt,
  };

  // A tombstone has no bytes and therefore no asset rows. Emitting any would
  // both violate the DB's reject-masks-on-purged trigger and pretend the
  // destroyed material still exists.
  if (record.status === "purged") {
    return { contract, assets: [] };
  }

  const common = {
    mask_contract_id: record.id,
    salon_id: salonId,
    session_id: record.sessionId,
    source_image_id: record.sourceImageId,
    width: record.width,
    height: record.height,
    saved: record.saved,
    expires_at: record.expiresAt ?? null,
  };

  const assets: MaskAssetRow[] = Object.entries(record.maskAssetIds).map(
    ([kind, assetId]) => ({
      ...common,
      id: assetId,
      kind: kind as MaskKind,
      storage_path: maskStoragePath({
        salonId,
        sessionId: record.sessionId,
        contractId: record.id,
        kind: kind as MaskKind,
      }),
      // Coverage is per-mask and authoritative; undefined would be a bug, but
      // null is the honest representation of "this kind has no ratio".
      coverage: record.coverage[kind] ?? null,
    }),
  );

  assets.push({
    ...common,
    id: record.regionMapAssetId,
    kind: "region_map",
    storage_path: maskStoragePath({
      salonId,
      sessionId: record.sessionId,
      contractId: record.id,
      kind: "region_map",
    }),
    coverage: null, // a region map is a label grid, not a ratio
  });

  return { contract, assets };
}

export function fromRows(rows: MaskContractRows): MaskContractRecord {
  const { contract, assets } = rows;

  const common = {
    id: contract.id,
    sessionId: contract.session_id,
    sourceImageId: contract.source_image_id,
    version: contract.version,
    attempt: contract.attempt,
    expansionRadius: contract.expansion_radius,
    width: contract.width,
    height: contract.height,
    createdAt: contract.created_at,
  };

  // The DB is authoritative: purged_at set => tombstone, reconstructed with NO
  // mask assets. This is exactly the row a retention purge leaves behind.
  if (contract.purged_at !== null) {
    const tombstone: PurgedMaskContract = {
      status: "purged",
      ...common,
      purgedAt: contract.purged_at,
    };
    return tombstone;
  }

  const regionMap = assets.find((a) => a.kind === "region_map");
  if (!regionMap) {
    throw new Error(
      `active mask contract ${contract.id} has no region_map asset; it cannot be reconstructed`,
    );
  }

  const maskAssetIds: Record<string, string> = {};
  const coverage: Record<string, number> = {};
  for (const a of assets) {
    if (a.kind === "region_map") continue;
    maskAssetIds[a.kind] = a.id;
    if (a.coverage !== null) coverage[a.kind] = a.coverage;
  }

  const record: ActiveMaskContract = {
    status: "active",
    ...common,
    coverage,
    maskAssetIds,
    regionMapAssetId: regionMap.id,
    saved: contract.saved,
  };
  // expiresAt is optional on the aggregate and nullable in the DB; only set it
  // when present so a round-trip does not turn `undefined` into `null`.
  if (contract.expires_at !== null) record.expiresAt = contract.expires_at;
  return record;
}
