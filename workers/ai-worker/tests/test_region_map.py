import unittest

from app.masks.region_map import build_hair_edit_mask


class RegionMapTest(unittest.TestCase):
    def test_derives_binary_grid_and_protects_background_body_and_face_core(self):
        width = height = 5
        region = bytes([
            0, 0, 0, 0, 0,
            0, 1, 1, 1, 0,
            0, 2, 2, 2, 0,
            0, 2, 2, 2, 0,
            3, 3, 3, 3, 3,
        ])
        mask, coverage = build_hair_edit_mask(region, width, height, 1)
        self.assertEqual(len(mask), width * height)
        self.assertTrue(set(mask) <= {0, 1})
        self.assertEqual(mask[3 * width + 2], 0)
        self.assertEqual(mask[4 * width + 2], 0)
        self.assertEqual(coverage, sum(mask) / len(mask))

    def test_rejects_malformed_maps(self):
        with self.assertRaises(ValueError):
            build_hair_edit_mask(b"\x01", 2, 2)
        with self.assertRaises(ValueError):
            build_hair_edit_mask(bytes([1, 9, 2, 3]), 2, 2)
        with self.assertRaises(ValueError):
            build_hair_edit_mask(bytes([1, 1, 2, 3]), 2, 2, -1)


if __name__ == "__main__":
    unittest.main()
