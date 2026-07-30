from __future__ import annotations

import struct
import unittest
import zlib

from app.masks.provider_mask import hair_edit_grid_to_png, png_dimensions, storage_grid_png_to_bytes


def _rgba(png: bytes) -> bytes:
    offset = 8
    compressed = bytearray()
    while offset < len(png):
        length = struct.unpack(">I", png[offset : offset + 4])[0]
        kind = png[offset + 4 : offset + 8]
        data = png[offset + 8 : offset + 8 + length]
        if kind == b"IDAT":
            compressed.extend(data)
        offset += 12 + length
    decoded = zlib.decompress(bytes(compressed))
    return bytes(decoded[index] for index in range(len(decoded)) if index % 9 != 0)


class ProviderMaskTest(unittest.TestCase):
    def test_decodes_lossless_private_storage_grid_png(self):
        # Storage encoding is opaque RGBA: label value in RGB, alpha 255.
        from app.masks.provider_mask import _chunk, PNG_SIGNATURE
        raw = bytes((0, 1, 1, 1, 255, 2, 2, 2, 255))
        png = b"".join((PNG_SIGNATURE, _chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 1, 8, 6, 0, 0, 0)), _chunk(b"IDAT", zlib.compress(raw)), _chunk(b"IEND", b"")))
        self.assertEqual(storage_grid_png_to_bytes(png, 2, 1), bytes((1, 2)))
    def test_resizes_and_inverts_alpha_polarity(self):
        png = hair_edit_grid_to_png(bytes((1, 0, 0, 1)), 2, 2, 2, 2)
        self.assertEqual(png_dimensions(png), (2, 2))
        alpha = _rgba(png)[3::4]
        self.assertEqual(alpha, bytes((0, 255, 255, 0)))

    def test_rejects_non_binary_or_degenerate_masks(self):
        for grid in (bytes((0, 0, 0, 0)), bytes((1, 1, 1, 1)), bytes((0, 2, 0, 1))):
            with self.subTest(grid=grid):
                with self.assertRaises(ValueError):
                    hair_edit_grid_to_png(grid, 2, 2, 4, 4)

    def test_rejects_dimensions_beyond_processing_limits(self):
        with self.assertRaisesRegex(ValueError, "dimensions exceed"):
            hair_edit_grid_to_png(bytes((1, 0)), 2, 1, 4097, 1)

    def test_rejects_oversized_decoded_storage_payload(self):
        from app.masks.provider_mask import _chunk, PNG_SIGNATURE
        raw = bytes((0, 1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255))
        png = b"".join((PNG_SIGNATURE, _chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 1, 8, 6, 0, 0, 0)), _chunk(b"IDAT", zlib.compress(raw)), _chunk(b"IEND", b"")))
        with self.assertRaisesRegex(ValueError, "oversized"):
            storage_grid_png_to_bytes(png, 2, 1)


if __name__ == "__main__":
    unittest.main()
