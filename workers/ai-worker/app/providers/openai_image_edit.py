"""OpenAI Images edit adapter with privacy, configuration, and cost gates."""
from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable

from app.masks.provider_mask import PNG_SIGNATURE, hair_edit_grid_to_png, png_dimensions
from app.providers.base import HairGenerationProvider, ProviderError
from app.schemas import HairGenerationRequest, HairGenerationResult, ProviderCandidate


Transport = Callable[[urllib.request.Request, float], tuple[int, bytes]]
DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024
DEFAULT_MAX_REQUEST_BYTES = 20 * 1024 * 1024
DEFAULT_MAX_SOURCE_BYTES = 10 * 1024 * 1024
ALLOWED_QUALITIES = {"low", "medium", "high", "auto"}
ALLOWED_SIZES = {"1024x1024", "1024x1536", "1536x1024", "auto"}


def _enabled(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes"}


def _bounded_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError as error:
        raise RuntimeError(f"{name} must be an integer") from error
    if value < minimum or value > maximum:
        raise RuntimeError(f"{name} must be between {minimum} and {maximum}")
    return value


def _bounded_float(name: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.environ.get(name, str(default)))
    except ValueError as error:
        raise RuntimeError(f"{name} must be numeric") from error
    if value < minimum or value > maximum:
        raise RuntimeError(f"{name} must be between {minimum} and {maximum}")
    return value


def _valid_source_signature(mime: str, data: bytes) -> bool:
    if mime == "image/png":
        return data.startswith(PNG_SIGNATURE)
    if mime == "image/jpeg":
        return data.startswith(b"\xff\xd8\xff")
    if mime == "image/webp":
        return len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP"
    return False


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
    maximum = _bounded_int(
        "OPENAI_IMAGE_MAX_RESPONSE_BYTES", DEFAULT_MAX_RESPONSE_BYTES, 1024, 64 * 1024 * 1024
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = response.read(maximum + 1)
            if len(data) > maximum:
                raise ProviderError(
                    "OpenAI image response exceeds limit",
                    True,
                    "AI 생성 결과가 허용 크기를 넘었습니다.",
                )
            return response.status, data
    except urllib.error.HTTPError as error:
        return error.code, error.read(maximum + 1)


class OpenAIImageEditProvider(HairGenerationProvider):
    name = "openai"

    def __init__(self, model: str | None = None, transport: Transport | None = None):
        self.model = (model or os.environ.get("OPENAI_IMAGE_MODEL", "")).strip()
        self.quality = os.environ.get("OPENAI_IMAGE_QUALITY", "").strip().lower()
        self.size = os.environ.get("OPENAI_IMAGE_SIZE", "").strip().lower()
        self._key = os.environ.get("OPENAI_API_KEY")
        self._transport = transport or _default_transport
        self._timeout = _bounded_float("OPENAI_IMAGE_TIMEOUT_SECONDS", 90, 1, 300)
        self._max_retries = _bounded_int("OPENAI_IMAGE_MAX_RETRIES", 2, 0, 3)
        self._max_response_bytes = _bounded_int(
            "OPENAI_IMAGE_MAX_RESPONSE_BYTES", DEFAULT_MAX_RESPONSE_BYTES, 1024, 64 * 1024 * 1024
        )
        self._max_request_bytes = _bounded_int(
            "OPENAI_IMAGE_MAX_REQUEST_BYTES", DEFAULT_MAX_REQUEST_BYTES, 1024, 50 * 1024 * 1024
        )
        self._max_source_bytes = _bounded_int(
            "OPENAI_IMAGE_MAX_SOURCE_BYTES", DEFAULT_MAX_SOURCE_BYTES, 1024, 20 * 1024 * 1024
        )
        self._max_candidates = _bounded_int("OPENAI_IMAGE_MAX_CANDIDATES_PER_JOB", 1, 1, 4)
        self._max_calls = _bounded_int("OPENAI_IMAGE_MAX_CALLS_PER_PROCESS", 0, 0, 100)
        self._calls = 0

    def _preflight(self) -> None:
        if not _enabled("HAIR_TWIN_ENABLE_EXTERNAL_AI") or not _enabled(
            "HAIR_TWIN_OVERSEAS_TRANSFER_CONSENT"
        ):
            raise ProviderError(
                "external AI launch gate is closed",
                retryable=False,
                user_message_ko="해외 AI 전송 동의와 운영 승인이 없어 실제 생성을 차단했습니다.",
            )
        if not self._key:
            raise ProviderError(
                "OPENAI_API_KEY missing",
                retryable=False,
                user_message_ko="AI 생성 서비스 설정이 완료되지 않았습니다.",
            )
        if not self.model or self.quality not in ALLOWED_QUALITIES or self.size not in ALLOWED_SIZES:
            raise ProviderError(
                "OpenAI image model, quality, and size require explicit approved values",
                retryable=False,
                user_message_ko="승인된 AI 이미지 모델 설정이 없어 생성을 차단했습니다.",
            )
        if self._max_calls <= 0:
            raise ProviderError(
                "OpenAI process call budget is closed",
                retryable=False,
                user_message_ko="AI 호출 예산이 승인되지 않아 생성을 차단했습니다.",
            )

    def validate_configuration(self) -> None:
        self._preflight()

    def _reserve_call(self) -> None:
        if self._calls >= self._max_calls:
            raise ProviderError(
                "OpenAI process call budget exhausted",
                retryable=False,
                user_message_ko="승인된 AI 호출 한도에 도달했습니다.",
            )
        self._calls += 1

    def generate(self, request: HairGenerationRequest, load_asset_bytes) -> HairGenerationResult:
        self._preflight()
        source = load_asset_bytes(request.source_asset_id)
        grid = load_asset_bytes(request.hair_edit_mask_asset_id)
        if not source or not grid:
            raise ProviderError(
                "required private asset missing",
                retryable=False,
                user_message_ko="원본 사진 또는 편집 마스크를 찾을 수 없습니다.",
            )
        if len(source) > self._max_source_bytes or not _valid_source_signature(request.source_mime, source):
            raise ProviderError(
                "source image type, signature, or size is invalid",
                retryable=False,
                user_message_ko="원본 이미지 형식이나 크기를 확인할 수 없습니다.",
            )
        if request.candidate_count < 1 or request.candidate_count > self._max_candidates:
            raise ProviderError(
                "candidate count exceeds approved per-job limit",
                retryable=False,
                user_message_ko="한 작업의 AI 생성 개수가 승인된 한도를 넘었습니다.",
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
                user_message_ko="머리카락 편집 영역이 올바르지 않습니다.",
            ) from error

        fields = {
            "model": self.model,
            "prompt": request.prompt_positive,
            "n": str(request.candidate_count),
            "output_format": "png",
            "input_fidelity": "high",
            "quality": self.quality,
            "size": self.size,
        }
        body, content_type = _multipart(
            fields,
            {
                "image": ("source", request.source_mime, source),
                "mask": ("hair-edit-mask.png", "image/png", mask),
            },
        )
        if len(body) > self._max_request_bytes:
            raise ProviderError(
                "OpenAI image request exceeds configured limit",
                retryable=False,
                user_message_ko="AI 생성 요청 크기가 허용 한도를 넘었습니다.",
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
            self._reserve_call()
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
                    user_message_ko="AI 이미지 생성에 실패했습니다.",
                )
            time.sleep(min(2**attempt, 4))

        try:
            if len(response_bytes) > self._max_response_bytes:
                raise ValueError("response exceeds configured limit")
            payload = json.loads(response_bytes)
            encoded = [item["b64_json"] for item in payload["data"]]
            if len(encoded) != request.candidate_count or len(encoded) > self._max_candidates:
                raise ValueError("unexpected candidate count")
            images = [base64.b64decode(item, validate=True) for item in encoded]
            if not images or any(not image.startswith(PNG_SIGNATURE) for image in images):
                raise ValueError("missing PNG output")
            dimensions = [png_dimensions(image) for image in images]
            if any(width <= 0 or height <= 0 or width > 4096 or height > 4096 for width, height in dimensions):
                raise ValueError("invalid PNG output dimensions")
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise ProviderError(
                "malformed OpenAI image response",
                retryable=True,
                user_message_ko="AI 생성 결과를 안전하게 확인할 수 없습니다.",
            ) from error

        candidates = [
            ProviderCandidate(
                image_bytes=image,
                mime="image/png",
                seed=request.seed + index,
                signals=None,
                raw_provider_metadata={
                    "request_id_present": bool(payload.get("id")),
                    "width": dimensions[index][0],
                    "height": dimensions[index][1],
                },
            )
            for index, image in enumerate(images)
        ]
        return HairGenerationResult(self.name, self.model, candidates)
