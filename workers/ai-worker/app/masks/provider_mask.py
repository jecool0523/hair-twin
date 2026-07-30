"""Convert Hair Twin's byte-per-cell edit grid to an OpenAI PNG mask.

The domain convention is 1 = editable hair. The Images edit API convention is
transparent = editable, so editable pixels receive alpha 0 and protected pixels
alpha 255. Nearest-neighbour expansion deliberately preserves binary edges.
"""
from __future__ import annotations

import struct
import zlib


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_GRID_PIXELS = 1_048_576
MAX_OUTPUT_PIXELS = 16_777_216


def _chunk(kind: bytes, data: bytes) -> bytes:
    body = kind + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))


def hair_edit_grid_to_png(
    grid: bytes,
    grid_width: int,
    grid_height: int,
    output_width: int,
    output_height: int,
) -> bytes:
    if grid_width <= 0 or grid_height <= 0 or output_width <= 0 or output_height <= 0:
        raise ValueError("mask dimensions must be positive")
    if grid_width > 1024 or grid_height > 1024 or grid_width * grid_height > MAX_GRID_PIXELS:
        raise ValueError("mask grid dimensions exceed limits")
    if output_width > 4096 or output_height > 4096 or output_width * output_height > MAX_OUTPUT_PIXELS:
        raise ValueError("output dimensions exceed limits")
    if len(grid) != grid_width * grid_height:
        raise ValueError("mask grid length does not match dimensions")
    if any(value not in (0, 1) for value in grid):
        raise ValueError("mask grid must be binary")
    if not any(grid):
        raise ValueError("mask has no editable pixels")
    if all(grid):
        raise ValueError("mask cannot make the entire image editable")

    scanlines = bytearray()
    for y in range(output_height):
        source_y = min(grid_height - 1, y * grid_height // output_height)
        scanlines.append(0)
        for x in range(output_width):
            source_x = min(grid_width - 1, x * grid_width // output_width)
            editable = grid[source_y * grid_width + source_x] == 1
            scanlines.extend((255, 255, 255, 0 if editable else 255))

    ihdr = struct.pack(">IIBBBBB", output_width, output_height, 8, 6, 0, 0, 0)
    return b"".join(
        (
            PNG_SIGNATURE,
            _chunk(b"IHDR", ihdr),
            _chunk(b"IDAT", zlib.compress(bytes(scanlines), 9)),
            _chunk(b"IEND", b""),
        )
    )


def png_dimensions(data: bytes) -> tuple[int, int]:
    if len(data) < 24 or not data.startswith(PNG_SIGNATURE):
        raise ValueError("not a PNG")
    return struct.unpack(">II", data[16:24])


def storage_grid_png_to_bytes(data: bytes, width: int, height: int) -> bytes:
    if width <= 0 or height <= 0 or width > 1024 or height > 1024 or width * height > MAX_GRID_PIXELS:
        raise ValueError("stored grid PNG dimensions exceed limits")
    if png_dimensions(data) != (width, height):
        raise ValueError("stored grid PNG dimensions do not match metadata")
    offset = 8
    compressed = bytearray()
    while offset + 12 <= len(data):
        length = struct.unpack(">I", data[offset : offset + 4])[0]
        kind = data[offset + 4 : offset + 8]
        if offset + 12 + length > len(data):
            raise ValueError("stored grid PNG contains a truncated chunk")
        chunk = data[offset + 8 : offset + 8 + length]
        if kind == b"IDAT":
            compressed.extend(chunk)
        offset += 12 + length
    stride = width * 4
    expected = (stride + 1) * height
    decoder = zlib.decompressobj()
    raw = decoder.decompress(bytes(compressed), expected + 1)
    if len(raw) > expected or decoder.unconsumed_tail or not decoder.eof or decoder.unused_data:
        raise ValueError("stored grid PNG payload is invalid or oversized")
    raw += decoder.flush()
    if len(raw) != expected:
        raise ValueError("stored grid PNG payload length is invalid")
    grid = bytearray()
    for y in range(height):
        row = y * (stride + 1)
        if raw[row] != 0:
            raise ValueError("stored grid PNG filter is unsupported")
        for x in range(width):
            pixel = row + 1 + x * 4
            red, green, blue, alpha = raw[pixel : pixel + 4]
            if red != green or red != blue or alpha != 255:
                raise ValueError("stored grid PNG is not lossless grid encoding")
            grid.append(red)
    return bytes(grid)
