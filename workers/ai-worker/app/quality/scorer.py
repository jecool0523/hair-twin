"""Quality-scoring boundary for generated images.

The fail-closed adapter remains available and is the default. `local_cv` is an
explicit opt-in and analyzes bytes in a bounded child process; it never sends
images or embeddings to another service.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Protocol

from app.schemas import QualityScoringResult, QualitySignals


@dataclass(frozen=True)
class QualityScoringInput:
    source_bytes: bytes
    candidate_bytes: bytes
    hair_edit_mask_bytes: bytes
    source_mime: str
    candidate_mime: str
    source_width: int
    source_height: int
    mask_width: int
    mask_height: int
    style_id: str
    provider_signals: QualitySignals | None = None


class QualityScorer(Protocol):
    name: str
    timeout_seconds: float

    def score(self, request: QualityScoringInput) -> QualityScoringResult:
        """Return measured signals without retaining image inputs."""


class FailClosedQualityScorer:
    name = "fail_closed"

    def __init__(self, timeout_seconds: float | None = None):
        configured = timeout_seconds if timeout_seconds is not None else float(
            os.environ.get("HAIR_TWIN_CV_TIMEOUT_SECONDS", "15")
        )
        if configured <= 0 or configured > 120:
            raise RuntimeError("HAIR_TWIN_CV_TIMEOUT_SECONDS must be greater than 0 and at most 120")
        self.timeout_seconds = configured

    def score(self, request: QualityScoringInput) -> QualityScoringResult:
        # Deliberately fails every hard gate. Missing measurement is not a
        # weak score and must never be interpreted as an approved candidate.
        return QualityScoringResult(
            QualitySignals(0.0, 1.0, 1.0, 0.0, 0, 0.0, 0.0),
            self.name,
            "none",
            False,
            0,
            "measurement_unavailable",
        )


class ProviderSignalsQualityScorer:
    """Local/CI adapter for deterministic mock-provider fixture signals."""

    name = "provider_signals"
    timeout_seconds = 0.0

    def score(self, request: QualityScoringInput) -> QualityScoringResult:
        if request.provider_signals is None:
            return FailClosedQualityScorer().score(request)
        return QualityScoringResult(
            request.provider_signals,
            self.name,
            "test-fixture",
            False,
            0,
        )


def select_quality_scorer(provider_name: str) -> QualityScorer:
    configured = os.environ.get("HAIR_TWIN_CV_PROVIDER", "").strip().lower()
    if provider_name == "mock" and configured in {"", "provider_signals"}:
        return ProviderSignalsQualityScorer()
    if configured in {"", "disabled", "fail_closed"}:
        return FailClosedQualityScorer()
    if configured == "local_cv":
        from app.quality.local_cv import LocalCVQualityScorer

        return LocalCVQualityScorer()
    raise RuntimeError("unsupported HAIR_TWIN_CV_PROVIDER")
