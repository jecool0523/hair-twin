"""Mask contract (mirror of masks.ts). STUB.

The browser produces the first-pass region map + mask summary today. When the
worker owns full mask PNGs, this module builds the hair_edit mask from a region
map using the same formula:

    hair_edit = (hair_current ∪ hair_expansion)
                - face_core - body - background
"""
from __future__ import annotations

MASK_CONTRACT_VERSION = "mask-contract-1"


def build_hair_edit_mask(region_map, expansion_radius: int = 6):
    """TODO: numpy/opencv implementation. Returns binary mask + coverage.

    Deferred to when the worker is wired (ADR-0003). Kept as an explicit seam so
    the pipeline stage exists in the architecture.
    """
    raise NotImplementedError("worker mask building is not wired yet")
