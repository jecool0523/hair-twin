"""Provider Adapter interface (mirror of adapter.ts). Product code depends only
on this abstraction, never a specific provider's request/response shape."""
from __future__ import annotations

from abc import ABC, abstractmethod

from app.schemas import HairGenerationRequest, HairGenerationResult


class HairGenerationProvider(ABC):
    name: str
    model: str

    def validate_configuration(self) -> None:
        """Fail before polling when a real provider is not launch-ready."""

    @abstractmethod
    def generate(
        self,
        request: HairGenerationRequest,
        load_asset_bytes,
    ) -> HairGenerationResult:
        """load_asset_bytes: Callable[[str], bytes | None]."""
        raise NotImplementedError


class ProviderError(Exception):
    def __init__(self, message: str, retryable: bool, user_message_ko: str):
        super().__init__(message)
        self.retryable = retryable
        self.user_message_ko = user_message_ko
