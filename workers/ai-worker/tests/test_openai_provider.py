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


def approved_env(**overrides: str) -> dict[str, str]:
    env = {
        "OPENAI_API_KEY": "test-key",
        "OPENAI_IMAGE_MODEL": "approved-test-model",
        "OPENAI_IMAGE_QUALITY": "low",
        "OPENAI_IMAGE_SIZE": "1024x1024",
        "OPENAI_IMAGE_MAX_CALLS_PER_PROCESS": "1",
        "HAIR_TWIN_ENABLE_EXTERNAL_AI": "true",
        "HAIR_TWIN_OVERSEAS_TRANSFER_CONSENT": "true",
    }
    env.update(overrides)
    return env


class OpenAIProviderTest(unittest.TestCase):
    def test_privacy_gate_blocks_before_loading_private_assets(self):
        loaded: list[str] = []
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}, clear=True):
            provider = OpenAIImageEditProvider()
            with self.assertRaises(ProviderError) as caught:
                provider.generate(REQUEST, lambda asset_id: loaded.append(asset_id))
        self.assertFalse(caught.exception.retryable)
        self.assertEqual(loaded, [])

    def test_approved_model_and_call_budget_are_required_before_asset_loading(self):
        loaded: list[str] = []
        env = approved_env()
        env["OPENAI_IMAGE_MODEL"] = ""
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(ProviderError) as caught:
                OpenAIImageEditProvider().generate(REQUEST, lambda asset_id: loaded.append(asset_id))
        self.assertFalse(caught.exception.retryable)
        self.assertEqual(loaded, [])

        env = approved_env(OPENAI_IMAGE_MAX_CALLS_PER_PROCESS="0")
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(ProviderError):
                OpenAIImageEditProvider().validate_configuration()

    def test_posts_source_and_real_png_mask_as_multipart(self):
        observed = {}

        def transport(request, timeout):
            observed["url"] = request.full_url
            observed["body"] = request.data
            observed["authorization"] = request.headers["Authorization"]
            return 200, json.dumps(
                {"id": "redacted", "data": [{"b64_json": base64.b64encode(PNG).decode()}]}
            ).encode()

        with patch.dict(os.environ, approved_env(), clear=True):
            result = OpenAIImageEditProvider(transport=transport).generate(
                REQUEST,
                lambda asset_id: PNG if asset_id == "source" else bytes((1, 0, 0, 1)),
            )

        self.assertEqual(observed["url"], "https://api.openai.com/v1/images/edits")
        self.assertIn(PNG, observed["body"])
        self.assertNotIn(base64.b64encode(PNG), observed["body"])
        self.assertIn(b' name="quality"\r\n\r\nlow', observed["body"])
        self.assertIn(b' name="size"\r\n\r\n1024x1024', observed["body"])
        self.assertEqual(observed["authorization"], "Bearer test-key")
        self.assertEqual(result.model, "approved-test-model")
        self.assertEqual(result.candidates[0].image_bytes, PNG)
        self.assertIsNone(result.candidates[0].signals)
        self.assertEqual(result.candidates[0].raw_provider_metadata["width"], 2)

    def test_rate_limit_is_retryable_and_malformed_response_is_safe(self):
        loader = lambda asset_id: PNG if asset_id == "source" else bytes((1, 0, 0, 1))
        with patch.dict(os.environ, approved_env(OPENAI_IMAGE_MAX_RETRIES="0"), clear=True):
            with self.assertRaises(ProviderError) as limited:
                OpenAIImageEditProvider(transport=lambda request, timeout: (429, b"{}")).generate(REQUEST, loader)
            self.assertTrue(limited.exception.retryable)

            with self.assertRaises(ProviderError) as malformed:
                OpenAIImageEditProvider(transport=lambda request, timeout: (200, b'{"data": []}')).generate(REQUEST, loader)
            self.assertTrue(malformed.exception.retryable)

    def test_retries_count_against_process_call_budget(self):
        calls = 0

        def transport(_request, _timeout):
            nonlocal calls
            calls += 1
            return 500, b"{}"

        env = approved_env(OPENAI_IMAGE_MAX_RETRIES="1", OPENAI_IMAGE_MAX_CALLS_PER_PROCESS="1")
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(ProviderError) as caught:
                OpenAIImageEditProvider(transport=transport).generate(
                    REQUEST, lambda asset_id: PNG if asset_id == "source" else bytes((1, 0, 0, 1))
                )
        self.assertEqual(calls, 1)
        self.assertFalse(caught.exception.retryable)

    def test_response_size_and_source_signature_are_bounded(self):
        loader = lambda asset_id: PNG if asset_id == "source" else bytes((1, 0, 0, 1))
        env = approved_env(OPENAI_IMAGE_MAX_RESPONSE_BYTES="1024")
        with patch.dict(os.environ, env, clear=True):
            with self.assertRaises(ProviderError):
                OpenAIImageEditProvider(transport=lambda request, timeout: (200, b"x" * 1025)).generate(REQUEST, loader)

            with self.assertRaises(ProviderError) as invalid_source:
                OpenAIImageEditProvider(transport=lambda request, timeout: (200, b"{}" )).generate(
                    REQUEST, lambda asset_id: b"not-an-image" if asset_id == "source" else bytes((1, 0, 0, 1))
                )
            self.assertFalse(invalid_source.exception.retryable)


if __name__ == "__main__":
    unittest.main()
