"""AI worker entrypoint (skeleton).

Poll generation_jobs for queued work, run the Provider Adapter + Quality Gate,
write generated_assets + quality_checks, and update job status. Mirrors
apps/web/src/lib/services/generation-worker.ts.

Not wired to a DB yet (ADR-0003). Running it prints the intended loop and
exits, so the module is importable and the architecture is explicit.
"""
from __future__ import annotations

import time

from app.providers.mock import MockHairProvider
from app.quality.gate import evaluate
from app.storage.supabase_storage import SupabaseStorage


def select_provider():
    # Same selection logic as factory.ts: default to mock unless configured.
    import os

    if os.environ.get("HAIR_TWIN_PROVIDER") == "openai" and os.environ.get("OPENAI_API_KEY"):
        from app.providers.openai_image_edit import OpenAIImageEditProvider

        return OpenAIImageEditProvider()
    return MockHairProvider()


def poll_loop(poll_interval_s: float = 2.0) -> None:
    storage = SupabaseStorage()
    provider = select_provider()
    print(f"[ai-worker] provider={provider.name} storage_enabled={storage.enabled()}")
    if not storage.enabled():
        print(
            "[ai-worker] Supabase not configured. Worker is a skeleton; the "
            "consultation flow runs via the in-process simulation in apps/web. "
            "See workers/ai-worker/README.md and ADR-0003."
        )
        return
    # TODO(ADR-0003): claim queued jobs, load mask + source, generate, evaluate.
    while True:  # pragma: no cover
        # jobs = claim_queued_jobs()
        # for job in jobs: process(job, provider, storage, evaluate)
        time.sleep(poll_interval_s)


if __name__ == "__main__":
    poll_loop()
