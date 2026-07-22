"""OpenAI image-edit provider (ADR-0002 first benchmark). STUB.

Sends source + hair_edit mask to the managed image-editing API, then hands the
output to the CV quality stage. Not wired in the first slice — see ADR-0003.
The API key is read from the worker environment only; it never reaches the
browser.
"""
from __future__ import annotations

import os

from app.providers.base import HairGenerationProvider, ProviderError
from app.schemas import HairGenerationRequest, HairGenerationResult


class OpenAIImageEditProvider(HairGenerationProvider):
    name = "openai"

    def __init__(self, model: str | None = None):
        self.model = model or os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-1")
        self._key = os.environ.get("OPENAI_API_KEY")

    def generate(self, request: HairGenerationRequest, load_source_bytes) -> HairGenerationResult:
        if not self._key:
            raise ProviderError(
                "OPENAI_API_KEY missing",
                retryable=False,
                user_message_ko="OpenAI 키가 없어 실제 생성이 불가능합니다. Mock으로 진행하세요.",
            )
        # TODO: POST /v1/images/edits with source + hair_edit mask PNG, then run
        # CV quality models to fill QualitySignals.
        raise ProviderError(
            "OpenAI image-edit provider not wired yet",
            retryable=False,
            user_message_ko="실제 OpenAI 경로는 아직 연결되지 않았습니다.",
        )
