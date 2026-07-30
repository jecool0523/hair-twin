from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from app.main import process_once, select_provider
from app.masks.provider_mask import hair_edit_grid_to_png
from app.providers.mock import MockHairProvider
from app.schemas import HairGenerationResult, ProviderCandidate
from app.storage.supabase_db import SupabaseDatabase


JOB = {
    "job_id": "f6000000-0000-0000-0000-000000000001",
    "salon_id": "f1000000-0000-0000-0000-000000000001",
    "session_id": "f2000000-0000-0000-0000-000000000001",
    "source_storage_path": "f1000000-0000-0000-0000-000000000001/f2000000-0000-0000-0000-000000000001/source.png",
    "hair_edit_mask_storage_path": "f1000000-0000-0000-0000-000000000001/f2000000-0000-0000-0000-000000000001/mask.png",
    "source_mime": "image/png",
    "source_width": 2,
    "source_height": 2,
    "mask_width": 2,
    "mask_height": 2,
    "style_id": "worker-style",
    "style_attributes": {"length": "medium"},
    "mode": "hair_inpaint",
    "candidate_count": 1,
    "attempts": 1,
}
PNG = hair_edit_grid_to_png(bytes((1, 0, 0, 1)), 2, 2, 2, 2)


class FakeDatabase:
    def __init__(self, fail_finish=False):
        self.job = dict(JOB)
        self.transitions = []
        self.finished = None
        self.failed = None
        self.fail_finish = fail_finish

    def claim(self):
        job, self.job = self.job, None
        return job

    def transition(self, job_id, expected, next_status):
        self.transitions.append((expected, next_status))

    def finish(self, job_id, candidates):
        if self.fail_finish:
            raise RuntimeError("fixture finish failure")
        self.finished = candidates
        return "completed"

    def fail(self, job_id, retryable, reason):
        self.failed = (retryable, reason)
        return "failed_retryable"


class FakeStorage:
    def __init__(self):
        self.uploaded = []
        self.deleted = []

    def get_source_bytes(self, path, salon_id, session_id):
        return PNG

    def get_mask_bytes(self, path, salon_id, session_id):
        # Same lossless grid PNG contract used by SupabaseStore.
        from app.masks.provider_mask import _chunk, PNG_SIGNATURE
        import struct, zlib
        rgba = bytes((1,1,1,255, 0,0,0,255, 0,0,0,255, 1,1,1,255))
        raw = b"\x00" + rgba[:8] + b"\x00" + rgba[8:]
        return b"".join((PNG_SIGNATURE, _chunk(b"IHDR", struct.pack(">IIBBBBB",2,2,8,6,0,0,0)), _chunk(b"IDAT",zlib.compress(raw)), _chunk(b"IEND",b"")))

    def put_generated_asset(self, path, data, mime):
        self.uploaded.append((path, data, mime))

    def delete_generated(self, path):
        self.deleted.append(path)


class UnmeasuredRealProvider:
    name = "real-fixture"
    model = "approved-fixture"

    def generate(self, request, load_asset_bytes):
        return HairGenerationResult(
            self.name,
            self.model,
            [ProviderCandidate(load_asset_bytes(request.source_asset_id), request.source_mime, request.seed)],
        )


class WorkerPipelineTest(unittest.TestCase):
    def test_processes_claim_through_qc_and_atomic_finish(self):
        database, storage = FakeDatabase(), FakeStorage()
        self.assertTrue(process_once(database, storage, MockHairProvider()))
        self.assertEqual(
            database.transitions,
            [("masking", "generating"), ("generating", "quality_checking")],
        )
        self.assertEqual(len(storage.uploaded), 1)
        self.assertEqual(len(database.finished), 1)
        self.assertEqual(database.finished[0]["quality"]["status"], "needs_stylist_review")
        self.assertIsNone(database.failed)

    def test_removes_uploaded_object_if_database_finish_fails(self):
        database, storage = FakeDatabase(fail_finish=True), FakeStorage()
        self.assertTrue(process_once(database, storage, MockHairProvider()))
        self.assertEqual(storage.deleted, [storage.uploaded[0][0]])
        self.assertEqual(database.failed, (True, "RuntimeError"))

    def test_unmeasured_real_candidate_is_persisted_only_as_hard_blocked(self):
        database, storage = FakeDatabase(), FakeStorage()
        outcomes = []
        with patch.dict(os.environ, {}, clear=True):
            self.assertTrue(
                process_once(database, storage, UnmeasuredRealProvider(), on_outcome=outcomes.append)
            )
        quality = database.finished[0]["quality"]
        self.assertTrue(quality["hard_fail"])
        self.assertEqual(quality["status"], "blocked_identity_changed")
        self.assertEqual(outcomes, ["completed"])

    def test_provider_must_be_explicit_and_mock_requires_opt_in(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(RuntimeError):
                select_provider()
        with patch.dict(os.environ, {"HAIR_TWIN_PROVIDER": "mock"}, clear=True):
            with self.assertRaises(RuntimeError):
                select_provider()
        with patch.dict(os.environ, {"HAIR_TWIN_PROVIDER": "mock", "HAIR_TWIN_ALLOW_MOCK": "true"}, clear=True):
            self.assertIsInstance(select_provider(), MockHairProvider)

    def test_postgrest_client_calls_only_worker_rpc_surface(self):
        urls = []

        def transport(request, timeout):
            urls.append(request.full_url)
            return 200, b"null"

        with patch.dict(
            os.environ,
            {"SUPABASE_URL": "http://localhost", "SUPABASE_SECRET_KEY": "secret"},
            clear=True,
        ):
            self.assertIsNone(SupabaseDatabase(transport).claim())
        self.assertEqual(urls, ["http://localhost/rest/v1/rpc/worker_claim_generation_job"])


if __name__ == "__main__":
    unittest.main()
