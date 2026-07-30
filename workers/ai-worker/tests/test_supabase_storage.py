from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from app.storage.supabase_storage import StorageError, SupabaseStorage


class SupabaseStorageTest(unittest.TestCase):
    def test_uses_server_secret_and_private_bucket_binary_transport(self):
        requests = []

        def transport(request, timeout):
            requests.append(request)
            return (200, b"private-bytes")

        with patch.dict(
            os.environ,
            {"SUPABASE_URL": "http://127.0.0.1:54321", "SUPABASE_SECRET_KEY": "test-secret"},
            clear=True,
        ):
            storage = SupabaseStorage(transport)
            self.assertEqual(storage.get_source_bytes("salon/session/photo.png", "salon", "session"), b"private-bytes")
            storage.put_generated_asset("salon/session/result.png", b"png", "image/png")
            storage.delete_generated("salon/session/result.png")

        self.assertIn("source-images-private/salon/session/photo.png", requests[0].full_url)
        self.assertEqual(requests[0].headers["Authorization"], "Bearer test-secret")
        self.assertEqual(requests[1].method, "POST")
        self.assertEqual(requests[1].data, b"png")
        self.assertEqual(requests[2].method, "DELETE")

    def test_rejects_path_traversal_and_classifies_errors(self):
        with patch.dict(
            os.environ,
            {"SUPABASE_URL": "http://localhost", "SUPABASE_SECRET_KEY": "test-secret"},
            clear=True,
        ):
            storage = SupabaseStorage(lambda request, timeout: (503, b"redacted"))
            with self.assertRaises(ValueError):
                storage.get_source_bytes("../other-salon/private.png", "salon", "session")
            with self.assertRaises(StorageError) as caught:
                storage.get_source_bytes("salon/session/photo.png", "salon", "session")
            self.assertTrue(caught.exception.retryable)
            self.assertNotIn("redacted", str(caught.exception))

    def test_rejects_noncanonical_or_cross_tenant_paths(self):
        with patch.dict(os.environ, {"SUPABASE_URL": "http://localhost", "SUPABASE_SECRET_KEY": "test-secret"}, clear=True):
            storage = SupabaseStorage(lambda request, timeout: (200, b"ok"))
            for path in ("/salon/session/photo.png", "salon\\session\\photo.png", "other/session/photo.png", "salon/other/photo.png"):
                with self.subTest(path=path), self.assertRaises(ValueError):
                    storage.get_source_bytes(path, "salon", "session")


if __name__ == "__main__":
    unittest.main()
