/**
 * Mask contract persistence.
 *
 * TRUST BOUNDARY — read this before changing anything here.
 *
 * The browser runs segmentation (per the approved design: MediaPipe/heuristic in
 * a Web Worker, because that is where the pixels are) and uploads the resulting
 * REGION MAP — raw per-pixel class bytes derived from the actual photo.
 *
 * The server does NOT accept the client's coverage numbers. It re-derives the
 * whole mask set from the uploaded region-map bytes using the same pure domain
 * function the client used (buildMaskSet), and the coverage it computes is the
 * only coverage that ever reaches QC or a provider. A client can influence the
 * segmentation input; it cannot assert a mask summary.
 *
 * When the Python worker takes over segmentation, this module keeps its shape:
 * the region map simply arrives from the worker instead of the browser.
 */
import "server-only";
import {
  MASK_CONTRACT_VERSION,
  RegionClass,
  buildMaskSet,
  type MaskName,
  type RegionMap,
} from "../domain/masks";
import { RETENTION } from "../config";
import { getStore, newId } from "../store";
import type { ActiveMaskContract } from "../store/types";

export class MaskRejected extends Error {
  userMessageKo: string;
  constructor(userMessageKo: string, detail: string) {
    super(detail);
    this.name = "MaskRejected";
    this.userMessageKo = userMessageKo;
  }
}

/** Region maps are coarse grids, not full-resolution images. */
export const REGION_MAP_LIMITS = {
  minSide: 16,
  maxSide: 512,
} as const;

/**
 * Validate raw region-map bytes into a RegionMap.
 * Rejects wrong lengths, impossible dimensions, unknown class values, and maps
 * that are structurally implausible (no hair or no face at all).
 */
export function parseRegionMap(
  bytes: Uint8Array,
  width: number,
  height: number,
): RegionMap {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < REGION_MAP_LIMITS.minSide ||
    height < REGION_MAP_LIMITS.minSide ||
    width > REGION_MAP_LIMITS.maxSide ||
    height > REGION_MAP_LIMITS.maxSide
  ) {
    throw new MaskRejected(
      "촬영 분석 데이터가 올바르지 않습니다. 다시 촬영해 주세요.",
      `region map dims out of range: ${width}x${height}`,
    );
  }
  if (bytes.length !== width * height) {
    throw new MaskRejected(
      "촬영 분석 데이터가 손상되었습니다. 다시 촬영해 주세요.",
      `region map length ${bytes.length} != ${width * height}`,
    );
  }

  const valid = new Set<number>([
    RegionClass.Background,
    RegionClass.Hair,
    RegionClass.Face,
    RegionClass.Body,
    RegionClass.Uncertain,
  ]);
  let hair = 0;
  let face = 0;
  for (let i = 0; i < bytes.length; i++) {
    const v = bytes[i]!;
    if (!valid.has(v)) {
      throw new MaskRejected(
        "촬영 분석 데이터가 올바르지 않습니다. 다시 촬영해 주세요.",
        `invalid region class ${v} at ${i}`,
      );
    }
    if (v === RegionClass.Hair) hair++;
    if (v === RegionClass.Face) face++;
  }

  // A map with no hair or no face cannot produce a usable hair-edit mask; this
  // also rejects the trivial all-zero map a naive client might send.
  if (hair === 0 || face === 0) {
    throw new MaskRejected(
      "머리카락 또는 얼굴 영역을 찾지 못했습니다. 다시 촬영해 주세요.",
      `implausible region map: hair=${hair} face=${face}`,
    );
  }

  return { width, height, data: bytes };
}

export interface PersistMaskContractInput {
  sessionId: string;
  sourceImageId: string;
  regionMap: RegionMap;
  expansionRadius: number;
  attempt: number;
}

/**
 * Derive the full mask set server-side, persist every mask + the region map as
 * private, expiring assets, and record the contract.
 */
export async function persistMaskContract(
  input: PersistMaskContractInput,
): Promise<ActiveMaskContract> {
  const store = getStore();
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + RETENTION.unsavedMaskMs,
  ).toISOString();

  // Authoritative derivation: coverage comes from these bytes, full stop.
  const set = buildMaskSet(input.regionMap, input.expansionRadius);

  const maskAssetIds: Record<string, string> = {};
  for (const name of Object.keys(set.masks) as MaskName[]) {
    const mask = set.masks[name];
    const assetId = newId("mask");
    await store.putAsset({
      id: assetId,
      kind: "mask",
      sessionId: input.sessionId,
      mime: "application/octet-stream",
      width: mask.width,
      height: mask.height,
      bytes: Buffer.from(mask.data),
      createdAt: now.toISOString(),
      expiresAt,
      saved: false,
    });
    maskAssetIds[name] = assetId;
  }

  const regionMapAssetId = newId("regionmap");
  await store.putAsset({
    id: regionMapAssetId,
    kind: "region_map",
    sessionId: input.sessionId,
    mime: "application/octet-stream",
    width: input.regionMap.width,
    height: input.regionMap.height,
    bytes: Buffer.from(input.regionMap.data),
    createdAt: now.toISOString(),
    expiresAt,
    saved: false,
  });

  const record: ActiveMaskContract = {
    status: "active",
    id: newId("maskc"),
    sessionId: input.sessionId,
    sourceImageId: input.sourceImageId,
    version: MASK_CONTRACT_VERSION,
    attempt: input.attempt,
    expansionRadius: input.expansionRadius,
    width: set.width,
    height: set.height,
    coverage: set.coverage as Record<string, number>,
    maskAssetIds,
    regionMapAssetId,
    createdAt: now.toISOString(),
    expiresAt,
    saved: false,
  };
  return (await store.putMaskContract(record)) as ActiveMaskContract;
}

/**
 * Load a mask contract for use by a generation job, enforcing that it belongs to
 * this session AND this source image, and that it has not expired.
 */
export async function loadMaskContractForJob(opts: {
  contractId: string;
  sessionId: string;
  sourceImageId: string;
  now?: Date;
}): Promise<ActiveMaskContract> {
  const store = getStore();
  const now = opts.now ?? new Date();
  const contract = await store.getMaskContract(opts.contractId);
  if (!contract) {
    throw new MaskRejected(
      "촬영 분석 데이터를 찾을 수 없습니다. 다시 촬영해 주세요.",
      `mask contract ${opts.contractId} not found`,
    );
  }
  // Cross-linking guard: a mask from another session/source must never be
  // usable, even if its id is guessed or replayed.
  if (
    contract.sessionId !== opts.sessionId ||
    contract.sourceImageId !== opts.sourceImageId
  ) {
    throw new MaskRejected(
      "촬영 분석 데이터가 이 상담과 일치하지 않습니다.",
      `mask contract ${contract.id} belongs to session=${contract.sessionId} source=${contract.sourceImageId}`,
    );
  }
  // A purged contract is a tombstone: its mask bytes were destroyed by
  // retention. Generating against it would mean generating against masks that
  // no longer exist — fail clearly instead. This also narrows the union to
  // ActiveMaskContract for every caller below.
  if (contract.status === "purged") {
    throw new MaskRejected(
      "촬영 분석 데이터가 보존 기간 만료로 파기되었습니다. 다시 촬영해 주세요.",
      `mask contract ${contract.id} was purged at ${contract.purgedAt}`,
    );
  }
  if (
    !contract.saved &&
    contract.expiresAt &&
    new Date(contract.expiresAt).getTime() < now.getTime()
  ) {
    throw new MaskRejected(
      "촬영 분석 데이터가 만료되었습니다. 다시 촬영해 주세요.",
      `mask contract ${contract.id} expired at ${contract.expiresAt}`,
    );
  }
  return contract;
}

/**
 * Retry tuning: build a NEW contract version from the SAME real region map with
 * a tighter expansion radius. The original stays intact for auditability, and
 * the smaller edit region is genuinely derived, not asserted.
 */
export async function deriveRetryContract(
  previous: ActiveMaskContract,
  expansionRadius: number,
  attempt: number,
): Promise<ActiveMaskContract> {
  const store = getStore();
  const regionAsset = await store.getAsset(previous.regionMapAssetId);
  if (!regionAsset) {
    throw new MaskRejected(
      "촬영 분석 데이터가 만료되어 재시도할 수 없습니다. 다시 촬영해 주세요.",
      `region map asset ${previous.regionMapAssetId} missing`,
    );
  }
  const regionMap: RegionMap = {
    width: regionAsset.width,
    height: regionAsset.height,
    data: new Uint8Array(regionAsset.bytes),
  };
  return persistMaskContract({
    sessionId: previous.sessionId,
    sourceImageId: previous.sourceImageId,
    regionMap,
    expansionRadius,
    attempt,
  });
}
