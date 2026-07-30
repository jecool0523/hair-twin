"""Hair Twin generation worker: one database-owned job at a time."""
from __future__ import annotations

import os
import time
import uuid

from app.providers.base import ProviderError
from app.masks.provider_mask import storage_grid_png_to_bytes
from app.providers.mock import MockHairProvider
from app.quality.gate import evaluate
from app.schemas import GenerationMode, HairGenerationRequest
from app.storage.supabase_db import DatabaseError, SupabaseDatabase
from app.storage.supabase_storage import SupabaseStorage


def select_provider():
    configured = os.environ.get("HAIR_TWIN_PROVIDER", "").strip().lower()
    if not configured:
        raise RuntimeError("HAIR_TWIN_PROVIDER is required")
    if configured == "openai":
        from app.providers.openai_image_edit import OpenAIImageEditProvider

        return OpenAIImageEditProvider()
    if configured != "mock":
        raise RuntimeError("unsupported HAIR_TWIN_PROVIDER")
    if os.environ.get("HAIR_TWIN_ALLOW_MOCK", "").strip().lower() not in {"1", "true", "yes"}:
        raise RuntimeError("mock provider requires HAIR_TWIN_ALLOW_MOCK=true")
    return MockHairProvider()


def _prompt(job: dict) -> tuple[str, str]:
    attributes = job.get("style_attributes") if isinstance(job.get("style_attributes"), dict) else {}
    style = ", ".join(f"{key}: {value}" for key, value in sorted(attributes.items()))
    return (
        "Photorealistic salon hairstyle preview. Change only the hair inside the supplied mask. "
        "Preserve identity, facial features, expression, pose, clothing, and background. "
        f"Requested style: {style or job['style_id']}.",
        "identity change, face edit, skin edit, clothing edit, background edit, extra person",
    )


def _quality_payload(candidate) -> dict:
    result = evaluate(candidate.signals)
    signals = candidate.signals
    return {
        "status": result.status.value,
        "hard_fail": result.hard_fail,
        "signals": {
            "identity_similarity": signals.identity_similarity,
            "landmark_delta": signals.landmark_delta,
            "non_hair_diff": signals.non_hair_diff,
            "hair_coverage_ratio": signals.hair_coverage_ratio,
            "face_count": signals.face_count,
            "realism_score": signals.realism_score,
            "style_match": signals.style_match,
        },
        "soft_flags": result.soft_flags,
        "hard_reasons": result.hard_reasons,
    }


def process_once(database=None, storage=None, provider=None) -> bool:
    database = database or SupabaseDatabase()
    storage = storage or SupabaseStorage()
    provider = provider or select_provider()
    job = database.claim()
    if not job:
        return False

    job_id = str(job["job_id"])
    uploaded: list[str] = []
    try:
        salon_id, session_id = str(job["salon_id"]), str(job["session_id"])
        source_width, source_height = int(job["source_width"]), int(job["source_height"])
        mask_width, mask_height = int(job["mask_width"]), int(job["mask_height"])
        if source_width <= 0 or source_height <= 0 or source_width > 4096 or source_height > 4096 or source_width * source_height > 16_777_216:
            raise ValueError("source dimensions exceed worker limits")
        if mask_width <= 0 or mask_height <= 0 or mask_width > 1024 or mask_height > 1024 or mask_width * mask_height > 1_048_576:
            raise ValueError("mask dimensions exceed worker limits")
        source = storage.get_source_bytes(job["source_storage_path"], salon_id, session_id)
        mask_png = storage.get_mask_bytes(job["hair_edit_mask_storage_path"], salon_id, session_id)
        mask = storage_grid_png_to_bytes(mask_png, mask_width, mask_height)
        positive, negative = _prompt(job)
        request = HairGenerationRequest(
            job_id=job_id,
            seed=1000 + int(job["attempts"]) * 10,
            candidate_count=int(job["candidate_count"]),
            mode=GenerationMode(job["mode"]),
            style_id=job["style_id"],
            source_asset_id="source",
            source_mime=job["source_mime"],
            hair_edit_mask_asset_id="mask",
            source_width=source_width,
            source_height=source_height,
            mask_width=mask_width,
            mask_height=mask_height,
            mask_summary={},
            prompt_positive=positive,
            prompt_negative=negative,
        )
        database.transition(job_id, "masking", "generating")
        result = provider.generate(request, lambda asset_id: source if asset_id == "source" else mask)
        database.transition(job_id, "generating", "quality_checking")

        rows = []
        prefix = f"{job['salon_id']}/{job['session_id']}"
        extensions = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
        for index, candidate in enumerate(result.candidates):
            extension = extensions.get(candidate.mime)
            if not extension or not candidate.image_bytes:
                raise ProviderError("invalid candidate bytes", True, "생성 결과를 확인할 수 없습니다.")
            path = f"{prefix}/{job_id}/{uuid.uuid4()}.{extension}"
            storage.put_generated_asset(path, candidate.image_bytes, candidate.mime)
            uploaded.append(path)
            rows.append(
                {
                    "storage_path": path,
                    "mime": candidate.mime,
                    "seed": candidate.seed,
                    "variant_label": f"candidate-{index + 1}",
                    "provider": result.provider,
                    "model": result.model,
                    "quality": _quality_payload(candidate),
                }
            )
        database.finish(job_id, rows)
        return True
    except Exception as error:
        for path in uploaded:
            try:
                storage.delete_generated(path)
            except Exception:
                pass
        try:
            database.fail(job_id, bool(getattr(error, "retryable", True)), type(error).__name__)
        except DatabaseError:
            pass
        return True


def poll_loop(poll_interval_s: float = 2.0) -> None:
    database = SupabaseDatabase()
    storage = SupabaseStorage()
    if not database.enabled() or not storage.enabled():
        raise RuntimeError("SUPABASE_URL and SUPABASE_SECRET_KEY are required")
    provider = select_provider()
    print(f"[ai-worker] provider={provider.name} ready=true")
    while True:
        if not process_once(database, storage, provider):
            time.sleep(poll_interval_s)


if __name__ == "__main__":
    poll_loop()
