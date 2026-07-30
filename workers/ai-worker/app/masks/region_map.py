"""Derive the editable-hair grid from the shared semantic region map."""
from __future__ import annotations

MASK_CONTRACT_VERSION = "mask-contract-1"
BACKGROUND, HAIR, FACE, BODY, UNCERTAIN = range(5)


def _dilate(mask: bytes, width: int, height: int, radius: int) -> bytearray:
    output = bytearray(len(mask))
    for y in range(height):
        for x in range(width):
            if not mask[y * width + x]:
                continue
            for dy in range(-radius, radius + 1):
                ny = y + dy
                if 0 <= ny < height:
                    for dx in range(-radius, radius + 1):
                        nx = x + dx
                        if 0 <= nx < width:
                            output[ny * width + nx] = 1
    return output


def _erode(mask: bytes, width: int, height: int, radius: int) -> bytearray:
    output = bytearray(len(mask))
    for y in range(height):
        for x in range(width):
            if not mask[y * width + x]:
                continue
            keep = True
            for dy in range(-radius, radius + 1):
                ny = y + dy
                if not 0 <= ny < height:
                    keep = False
                    break
                for dx in range(-radius, radius + 1):
                    nx = x + dx
                    if not 0 <= nx < width or not mask[ny * width + nx]:
                        keep = False
                        break
                if not keep:
                    break
            output[y * width + x] = int(keep)
    return output


def build_hair_edit_mask(
    region_map: bytes, width: int, height: int, expansion_radius: int = 6
) -> tuple[bytes, float]:
    """Return ``(binary edit grid, coverage)`` using the web-domain formula."""
    if width <= 0 or height <= 0 or len(region_map) != width * height:
        raise ValueError("region map dimensions are invalid")
    if expansion_radius < 0:
        raise ValueError("expansion radius cannot be negative")
    if any(value not in (BACKGROUND, HAIR, FACE, BODY, UNCERTAIN) for value in region_map):
        raise ValueError("region map contains an unknown class")

    hair = bytes(int(value == HAIR) for value in region_map)
    face = bytes(int(value == FACE) for value in region_map)
    dilated = _dilate(hair, width, height, expansion_radius)
    face_core = _erode(face, width, height, 1)
    output = bytearray(width * height)
    for index, value in enumerate(region_map):
        candidate = bool(hair[index] or (dilated[index] and not hair[index]))
        blocked = bool(face_core[index] or value in (BODY, BACKGROUND))
        output[index] = int(candidate and not blocked)
    return bytes(output), sum(output) / len(output)
