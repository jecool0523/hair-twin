"""Domain contracts mirrored from apps/web/src/lib/domain + providers.

Kept in sync with the TypeScript side so the worker can replace the in-process
simulation without any product change.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class GenerationMode(str, Enum):
    HAIR_INPAINT = "hair_inpaint"
    COLOR_TRANSFER = "color_transfer"
    REFERENCE_STYLE = "reference_style"
    TURNAROUND_REFERENCE = "turnaround_reference"


class JobStatus(str, Enum):
    CREATED = "created"
    PREFLIGHT_FAILED = "preflight_failed"
    QUEUED = "queued"
    MASKING = "masking"
    GENERATING = "generating"
    QUALITY_CHECKING = "quality_checking"
    NEEDS_STYLIST_REVIEW = "needs_stylist_review"
    COMPLETED = "completed"
    FAILED_RETRYABLE = "failed_retryable"
    FAILED_HARD = "failed_hard"
    EXPIRED = "expired"
    DELETED = "deleted"


class QualityStatus(str, Enum):
    ACCEPTED = "accepted"
    NEEDS_STYLIST_REVIEW = "needs_stylist_review"
    REGENERATE = "regenerate"
    BLOCKED_IDENTITY_CHANGED = "blocked_identity_changed"
    BLOCKED_NON_HAIR_CHANGED = "blocked_non_hair_changed"
    BLOCKED_LOW_REALISM = "blocked_low_realism"
    BLOCKED_POLICY_OR_SAFETY = "blocked_policy_or_safety"


@dataclass
class QualitySignals:
    identity_similarity: float
    landmark_delta: float
    non_hair_diff: float
    hair_coverage_ratio: float
    face_count: int
    realism_score: float
    style_match: float


@dataclass
class HairGenerationRequest:
    job_id: str
    seed: int
    candidate_count: int
    mode: GenerationMode
    style_id: str
    source_asset_id: str
    source_width: int
    source_height: int
    mask_summary: dict
    prompt_positive: str
    prompt_negative: str
    allow_hair_expansion: bool = True


@dataclass
class ProviderCandidate:
    image_bytes: bytes
    mime: str
    seed: int
    signals: QualitySignals
    raw_provider_metadata: dict = field(default_factory=dict)


@dataclass
class HairGenerationResult:
    provider: str
    model: str
    candidates: list[ProviderCandidate]
