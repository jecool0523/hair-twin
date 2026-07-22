"""Mock provider (mirror of mock.ts). Deterministic candidates + signals so the
worker path can be exercised without any external API. The TS in-process
simulation is the one actually running the first slice; this keeps parity."""
from __future__ import annotations

import hashlib

from app.providers.base import HairGenerationProvider
from app.schemas import (
    HairGenerationRequest,
    HairGenerationResult,
    ProviderCandidate,
    QualitySignals,
)


def _rand(seed_str: str) -> float:
    h = hashlib.sha256(seed_str.encode()).digest()
    return int.from_bytes(h[:4], "big") / 0xFFFFFFFF


class MockHairProvider(HairGenerationProvider):
    name = "mock"
    model = "mock-hair-preview-1"

    def generate(self, request: HairGenerationRequest, load_source_bytes):
        candidates: list[ProviderCandidate] = []
        edit_cov = float(request.mask_summary.get("hairEditCoverage", 0.18))
        expansion = float(request.mask_summary.get("expansionRadius", 6))
        for idx in range(request.candidate_count):
            seed = request.seed + idx
            r = _rand(f"{request.job_id}:{seed}")
            risk = min(0.2, edit_cov * 0.35 + expansion * 0.004)

            identity = 0.95 - r * 0.03
            landmark = 0.01 + r * 0.02
            non_hair = risk * (0.4 + r * 0.3)
            realism = 0.82 - r * 0.08
            style = 0.8 - r * 0.12
            face_count = 1

            if idx == 1:
                identity = 0.87 - r * 0.02
                non_hair = 0.045 + r * 0.01
                style = 0.55 - r * 0.05
            if idx == 2:
                identity = 0.72 - r * 0.05
                landmark = 0.09 + r * 0.02
                face_count = 2 if r > 0.6 else 1

            candidates.append(
                ProviderCandidate(
                    image_bytes=b"",  # real worker renders/edits pixels here
                    mime="image/png",
                    seed=seed,
                    signals=QualitySignals(
                        identity_similarity=identity,
                        landmark_delta=landmark,
                        non_hair_diff=non_hair,
                        hair_coverage_ratio=max(0.04, min(0.5, edit_cov)),
                        face_count=face_count,
                        realism_score=realism,
                        style_match=style,
                    ),
                    raw_provider_metadata={"mock": True, "variant": idx},
                )
            )
        return HairGenerationResult(self.name, self.model, candidates)
