/**
 * Hair edit mask contract (ai-generation-design §6).
 *
 * The browser (segmentation worker) produces a `RegionMap` of per-pixel class
 * labels. This module turns that into the required mask set and the derived
 * hair-edit mask using the design formula:
 *
 *   hair_edit_mask = hair_current + allowed_expansion
 *                    - face_protect - protected_background - protected_body_core
 *
 * The functions here are pure and operate on typed-array coverage grids so they
 * are unit-testable in Node without a canvas. Encoding masks to PNG for the AI
 * worker happens at the boundary (browser canvas / Python worker).
 */

export const MASK_CONTRACT_VERSION = "mask-contract-1";

/** Per-pixel semantic class from first-pass segmentation. */
export enum RegionClass {
  Background = 0,
  Hair = 1,
  Face = 2, // eyes/brows/nose/mouth/cheeks/jaw/skin
  Body = 3, // neck/shoulders/clothing
  Uncertain = 4, // soft boundary
}

export interface RegionMap {
  width: number;
  height: number;
  /** length === width*height, each value a RegionClass. */
  data: Uint8Array;
}

export type MaskName =
  | "hair_current"
  | "hair_expansion"
  | "face_protect"
  | "body_clothing_protect"
  | "background_protect"
  | "uncertain_boundary"
  | "hair_edit";

/** A binary mask: 1 = pixel belongs to the mask, 0 = not. */
export interface BinaryMask {
  name: MaskName;
  width: number;
  height: number;
  data: Uint8Array;
}

export interface MaskSet {
  version: string;
  width: number;
  height: number;
  masks: Record<MaskName, BinaryMask>;
  /** Coverage ratios (mask pixels / total). Cheap to ship to the server. */
  coverage: Record<MaskName, number>;
}

function emptyMask(name: MaskName, width: number, height: number): BinaryMask {
  return { name, width, height, data: new Uint8Array(width * height) };
}

function coverage(mask: BinaryMask): number {
  let count = 0;
  for (let i = 0; i < mask.data.length; i++) if (mask.data[i]) count++;
  return count / mask.data.length;
}

/**
 * Dilate a binary mask by `radius` cells (square kernel, in-grid). Used to
 * derive the plausible hair-expansion region and to soften blending.
 */
export function dilate(mask: BinaryMask, radius: number): BinaryMask {
  if (radius <= 0) return mask;
  const { width, height, data } = mask;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!data[y * width + x]) continue;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          out[ny * width + nx] = 1;
        }
      }
    }
  }
  return { ...mask, data: out };
}

/** Erode a binary mask by `radius` cells. Used to conservatively protect face. */
export function erode(mask: BinaryMask, radius: number): BinaryMask {
  if (radius <= 0) return mask;
  const { width, height, data } = mask;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!data[y * width + x]) continue;
      let keep = 1;
      for (let dy = -radius; dy <= radius && keep; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) {
          keep = 0;
          break;
        }
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width || !data[ny * width + nx]) {
            keep = 0;
            break;
          }
        }
      }
      out[y * width + x] = keep;
    }
  }
  return { ...mask, data: out };
}

/**
 * Build the full mask set + derived hair-edit mask from a region map.
 *
 * @param expansionRadius grid cells the hair mask may grow into (for longer
 *        styles/bangs). Larger radius => wider edit region => higher QC risk.
 */
export function buildMaskSet(region: RegionMap, expansionRadius = 6): MaskSet {
  const { width, height, data } = region;
  const n = width * height;
  if (data.length !== n) {
    throw new Error(
      `RegionMap data length ${data.length} !== width*height ${n}`,
    );
  }

  const hairCurrent = emptyMask("hair_current", width, height);
  const facePersist = emptyMask("face_protect", width, height);
  const bodyProtect = emptyMask("body_clothing_protect", width, height);
  const bgProtect = emptyMask("background_protect", width, height);
  const uncertain = emptyMask("uncertain_boundary", width, height);

  for (let i = 0; i < n; i++) {
    switch (data[i]) {
      case RegionClass.Hair:
        hairCurrent.data[i] = 1;
        break;
      case RegionClass.Face:
        facePersist.data[i] = 1;
        break;
      case RegionClass.Body:
        bodyProtect.data[i] = 1;
        break;
      case RegionClass.Background:
        bgProtect.data[i] = 1;
        break;
      case RegionClass.Uncertain:
        uncertain.data[i] = 1;
        break;
    }
  }

  // Allowed expansion = dilated hair minus current hair (the "new growth" ring).
  const dilatedHair = dilate(hairCurrent, expansionRadius);
  const hairExpansion = emptyMask("hair_expansion", width, height);
  for (let i = 0; i < n; i++) {
    hairExpansion.data[i] =
      dilatedHair.data[i] && !hairCurrent.data[i] ? 1 : 0;
  }

  // Conservatively eroded face-protect so hair may blend at the hairline, but
  // eyes/brows/nose/mouth stay locked. We keep the full face mask as the
  // protected region and only relax the outer 1-cell rim for the edit mask.
  const faceCore = erode(facePersist, 1);

  // hair_edit = (hair_current ∪ hair_expansion) − face_core − body − background
  const hairEdit = emptyMask("hair_edit", width, height);
  for (let i = 0; i < n; i++) {
    const candidate = hairCurrent.data[i] || hairExpansion.data[i] ? 1 : 0;
    const blocked =
      faceCore.data[i] || bodyProtect.data[i] || bgProtect.data[i];
    hairEdit.data[i] = candidate && !blocked ? 1 : 0;
  }

  const masks: Record<MaskName, BinaryMask> = {
    hair_current: hairCurrent,
    hair_expansion: hairExpansion,
    face_protect: facePersist,
    body_clothing_protect: bodyProtect,
    background_protect: bgProtect,
    uncertain_boundary: uncertain,
    hair_edit: hairEdit,
  };

  const cov = {} as Record<MaskName, number>;
  (Object.keys(masks) as MaskName[]).forEach((k) => {
    cov[k] = coverage(masks[k]);
  });

  return {
    version: MASK_CONTRACT_VERSION,
    width,
    height,
    masks,
    coverage: cov,
  };
}

/**
 * A compact, serialisable summary of a mask set to ship to the generation job.
 * Masks are persisted as raw byte-per-cell grids at this grid resolution. A
 * provider-ready image mask (resized to the source, PNG-encoded, alpha polarity
 * decided) is a conversion nobody performs yet -- see ADR-0006.
 */
export interface MaskSummary {
  version: string;
  hairCurrentCoverage: number;
  hairEditCoverage: number;
  faceProtectCoverage: number;
  backgroundProtectCoverage: number;
  expansionRadius: number;
}

export function summariseMaskSet(
  set: MaskSet,
  expansionRadius: number,
): MaskSummary {
  return {
    version: set.version,
    hairCurrentCoverage: set.coverage.hair_current,
    hairEditCoverage: set.coverage.hair_edit,
    faceProtectCoverage: set.coverage.face_protect,
    backgroundProtectCoverage: set.coverage.background_protect,
    expansionRadius,
  };
}
