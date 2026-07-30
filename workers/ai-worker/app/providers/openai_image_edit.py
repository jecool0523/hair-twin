"""OpenAI Images edit adapter with a hard privacy launch gate."""
from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable

from app.masks.provider_mask import PNG_SIGNATURE, hair_edit_grid_to_png
from app.providers.base import HairGenerationProvider, ProviderError
from app.schemas import (
    HairGenerationRequest,
    HairGenerationResult,
    ProviderCandidate,
    QualitySignals,
)


Transport = Callable[[urllib.request.Request, float], tuple[int, bytes]]
DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024


def _enabled(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes"}


def _multipart(fields: dict[str, str], files: dict[str, tuple[str, str, bytes]]) -> tuple[bytes, str]:
    boundary = f"hair-twin-{uuid.uuid4().hex}"
    body = bytearray()
    for name, value in fields.items():
        body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())
    for name, (filename, mime, data) in files.items():
        body.extend(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\nContent-Type: {mime}\r\n\r\n".encode()
        )
        body.extend(data)
        body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode())
    return bytes(body), f"multipart/form-data; boundary={boundary}"


def _default_transport(request: urllib.request.Request, timeout: float) -> tuple[int, bytes]:
    maximum = int(os.environ.get("OPENAI_IMAGE_MAX_RESPONSE_BYTES", str(DEFAULT_MAX_RESPONSE_BYTES)))
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = response.read(maximum + 1)
            if len(data) > maximum:
                raise ProviderError("OpenAI image response exceeds limit", True, "AI 생성 결과가 너무 큽니다. 다시 시도해 주세요.")
            return response.status, data
    except urllib.error.HTTPError as error:
        return error.code, error.read(maximum + 1)


class OpenAIImageEditProvider(HairGenerationProvider):
    name = "openai"

    def __init__(self, model: str | None = None, transport: Transport | None = None):
        self.model = model or os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-2")
        self._key = os.environ.get("OPENAI_API_KEY")
        self._transport = transport or _default_transport
        self._timeout = float(os.environ.get("OPENAI_IMAGE_TIMEOUT_SECONDS", "90"))
        self._max_retries = int(os.environ.get("OPENAI_IMAGE_MAX_RETRIES", "2"))
        self._max_response_bytes = int(os.environ.get("OPENAI_IMAGE_MAX_RESPONSE_BYTES", str(DEFAULT_MAX_RESPONSE_BYTES)))

    def _preflight(self) -> None:
        if not _enabled("HAIR_TWIN_ENABLE_EXTERNAL_AI") or not _enabled(
            "HAIR_TWIN_OVERSEAS_TRANSFER_CONSENT"
        ):
            raise ProviderError(
                "external AI launch gate is closed",
                retryable=False,
                user_message_ko="해외 AI 전송 동의와 운영 승인이 없어 실제 생성이 차단되었습니다.",
            )
        if not self._key:
            raise ProviderError(
                "OPENAI_API_KEY missing",
                retryable=False,
                user_message_ko="AI 생성 서비스 설정이 완료되지 않았습니다.",
            )

    def generate(self, request: HairGenerationRequest, load_asset_bytes) -> HairGenerationResult:
        self._preflight()
        source = load_asset_bytes(request.source_asset_id)
        grid = load_asset_bytes(request.hair_edit_mask_asset_id)
        if not source or not grid:
            raise ProviderError(
                "required private asset missing",
                retryable=False,
                user_message_ko="원본 사진 또는 편집 마스크를 찾을 수 없습니다. 다시 촬영해 주세요.",
            )
        try:
            mask = hair_edit_grid_to_png(
                grid,
                request.mask_width,
                request.mask_height,
                request.source_width,
                request.source_height,
            )
        except ValueError as error:
            raise ProviderError(
                f"invalid hair edit mask: {error}",
                retryable=False,
                user_message_ko="머리카락 편집 영역이 올바르지 않습니다. 다시 촬영해 주세요.",
            ) from error

        fields = {
            "model": self.model,
            "prompt": request.prompt_positive,
            "n": str(request.candidate_count),
            "output_format": "png",
            "input_fidelity": "high",
        }
        body, content_type = _multipart(
            fields,
            {
                "image": ("source.png", request.source_mime, source),
                "mask": ("hair-edit-mask.png", "image/png", mask),
            },
        )
        http_request = urllib.request.Request(
            "https://api.openai.com/v1/images/edits",
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self._key}",
                "Content-Type": content_type,
                "Accept": "application/json",
            },
        )

        response_bytes = b""
        for attempt in range(self._max_retries + 1):
            try:
                status, response_bytes = self._transport(http_request, self._timeout)
            except (TimeoutError, urllib.error.URLError):
                status = 599
            if status < 400:
                break
            retryable = status == 429 or status >= 500
            if not retryable or attempt >= self._max_retries:
                raise ProviderError(
                    f"OpenAI image edit failed with HTTP {status}",
                    retryable=retryable,
                    user_message_ko="AI 이미지 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.",
                )
            time.sleep(min(2**attempt, 4))

        try:
            if len(response_bytes) > self._max_response_bytes:
                raise ValueError("response exceeds configured limit")
            payload = json.loads(response_bytes)
            encoded = [item["b64_json"] for item in payload["data"]]
            if len(encoded) != request.candidate_count or len(encoded) > 4:
                raise ValueError("unexpected candidate count")
            images = [base64.b64decode(item, validate=True) for item in encoded]
            if not images or any(not image.startswith(PNG_SIGNATURE) for image in images):
                raise ValueError("missing PNG output")
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise ProviderError(
                "malformed OpenAI image response",
                retryable=True,
                user_message_ko="AI 생성 결과를 확인할 수 없습니다. 다시 시도해 주세요.",
            ) from error

        # Until the separately deployable CV scorer is enabled, outputs are
        # conservatively hard-blocked. This prevents an unmeasured face edit
        # from ever being presented as a successful customer result.
        candidates = [
            ProviderCandidate(
                image_bytes=image,
                mime="image/png",
                seed=request.seed + index,
                signals=QualitySignals(0, 1, 1, 0, 0, 0, 0),
                raw_provider_metadata={"request_id_present": bool(payload.get("id"))},
            )
            for index, image in enumerate(images)
        ]
        return HairGenerationResult(self.name, self.model, candidates)
