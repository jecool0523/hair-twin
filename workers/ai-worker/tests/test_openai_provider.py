from __future__ import annotations

import base64
import json
import os
import unittest
from unittest.mock import patch

from app.masks.provider_mask import hair_edit_grid_to_png
from app.providers.base import ProviderError
from app.providers.openai_image_edit import OpenAIImageEditProvider
from app.schemas import GenerationMode, HairGenerationRequest


REQUEST = HairGenerationRequest(
    job_id="00000000-0000-0000-0000-000000000001",
    seed=1010,
    candidate_count=1,
    mode=GenerationMode.HAIR_INPAINT,
    style_id="layered-medium",
    source_asset_id="source",
    source_mime="image/png",
    hair_edit_mask_asset_id="mask",
    source_width=2,
    source_height=2,
    mask_width=2,
    mask_height=2,
    mask_summary={"hairEditCoverage": 0.5},
    prompt_positive="Change only the hairstyle.",
    prompt_negative="Do not change identity or background.",
)
PNG = hair_edit_grid_to_png(bytes((1, 0, 0, 1)), 2, 2, 2, 2)


class OpenAIProviderTest(unittest.TestCase):
    def test_privacy_gate_blocks_before_loading_private_assets(self):
        loaded: list[str] = []
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}, clear=True):
            provider = OpenAIImageEditProvider()
            with self.assertRaises(ProviderError) as caught:
                provider.generate(REQUEST, lambda asset_id: loaded.append(asset_id))
        self.assertFalse(caught.exception.retryable)
        self.assertEqual(loaded, [])

    def test_posts_source_and_real_png_mask_as_multipart(self):
        observed = {}

        def transport(request, timeout):
            observed["url"] = request.full_url
            observed["body"] = request.data
            observed["authorization"] = request.headers["Authorization"]
            return 200, json.dumps(
                {"id": "redacted", "data": [{"b64_json": base64.b64encode(PNG).decode()}]}
            ).encode()

        env = {
            "OPENAI_API_KEY": "test-key",
            "HAIR_TWIN_ENABLE_EXTERNAL_AI": "true",
            "HAIR_TWIN_OVERSEAS_TRANSFER_CONSENT": "true",
        }
        with patch.dict(os.environ, env, clear=True):
            provider = OpenAIImageEditProvider(transport=transport)
            result = provider.generate(
                REQUEST,
                lambda asset_id: b"source-image-bytes" if asset_id == "source" else bytes((1, 0, 0, 1)),
            )

        self.assertEqual(observed["url"], "https://api.openai.com/v1/images/edits")
        self.assertIn(b"source-image-bytes", observed["body"])
        self.assertIn(PNG, observed["body"])
        self.assertNotIn(base64.b64encode(PNG), observed["body"])
        self.assertEqual(observed["authorization"], "Bearer test-key")
        self.assertEqual(result.model, "gpt-image-2")
        self.assertEqual(result.candidates[0].image_bytes, PNG)
        self.assertEqual(result.candidates[0].signals.face_count, 0)

    def test_rate_limit_is_retryable_and_malformed_response_is_safe(self):
        env = {
            "OPENAI_API_KEY": "test-key",
            "HAIR_TWIN_ENABLE_EXTERNAL_AI": "true",
            "HAIR_TWIN_OVERSEAS_TRANSFER_CONSENT": "true",
            "OPENAI_IMAGE_MAX_RETRIES": "0",
        }
        loader = lambda asset_id: b"source" if asset_id == "source" else bytes((1, 0, 0, 1))
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(ProviderError) as limited:
                OpenAIImageEditProvider(transport=lambda request, timeout: (429, b"{}" )).generate(REQUEST, loader)
            self.assertTrue(limited.exception.retryable)

            with self.assertRaises(ProviderError) as malformed:
                OpenAIImageEditProvider(transport=lambda request, timeout: (200, b'{"data": []}')).generate(REQUEST, loader)
            self.assertTrue(malformed.exception.retryable)

    def test_response_size_and_candidate_count_are_bounded(self):
        env = {
            "OPENAI_API_KEY": "test-key",
            "HAIR_TWIN_ENABLE_EXTERNAL_AI": "true",
            "HAIR_TWIN_OVERSEAS_TRANSFER_CONSENT": "true",
            "OPENAI_IMAGE_MAX_RESPONSE_BYTES": "32",
        }
        loader = lambda asset_id: b"source" if asset_id == "source" else bytes((1, 0, 0, 1))
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(ProviderError):
                OpenAIImageEditProvider(transport=lambda request, timeout: (200, b"x" * 33)).generate(REQUEST, loader)


if __name__ == "__main__":
    unittest.main()
