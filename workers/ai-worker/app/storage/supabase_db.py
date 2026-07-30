"""PostgREST client limited to the database-authoritative worker RPCs."""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from collections.abc import Callable


Transport = Callable[[urllib.request.Request, float], tuple[int, bytes]]


class DatabaseError(RuntimeError):
    def __init__(self, operation: str, status: int, retryable: bool):
        super().__init__(f"database {operation} failed with HTTP {status}")
        self.retryable = retryable


def _default_transport(request: urllib.request.Request, timeout: float) -> tuple[int, bytes]:
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


class SupabaseDatabase:
    def __init__(self, transport: Transport | None = None):
        self.url = os.environ.get("SUPABASE_URL", "").rstrip("/")
        self.secret_key = os.environ.get("SUPABASE_SECRET_KEY", "")
        self.timeout = float(os.environ.get("SUPABASE_DATABASE_TIMEOUT_SECONDS", "30"))
        self._transport = transport or _default_transport

    def enabled(self) -> bool:
        return bool(self.url and self.secret_key)

    def _rpc(self, name: str, payload: dict) -> object:
        if not self.enabled():
            raise DatabaseError("configuration", 0, False)
        request = urllib.request.Request(
            f"{self.url}/rest/v1/rpc/{name}",
            data=json.dumps(payload, separators=(",", ":")).encode(),
            method="POST",
            headers={
                "Authorization": f"Bearer {self.secret_key}",
                "apikey": self.secret_key,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        try:
            status, body = self._transport(request, self.timeout)
        except (TimeoutError, urllib.error.URLError) as error:
            raise DatabaseError(name, 599, True) from error
        if status >= 400:
            raise DatabaseError(name, status, status == 429 or status >= 500)
        if not body:
            return None
        try:
            return json.loads(body)
        except json.JSONDecodeError as error:
            raise DatabaseError(name, 502, True) from error

    def claim(self) -> dict | None:
        result = self._rpc("worker_claim_generation_job", {})
        return result if isinstance(result, dict) else None

    def transition(self, job_id: str, expected: str, next_status: str) -> None:
        self._rpc(
            "worker_transition_generation_job",
            {"p_job_id": job_id, "p_expected": expected, "p_next": next_status},
        )

    def finish(self, job_id: str, candidates: list[dict]) -> str:
        result = self._rpc(
            "worker_finish_generation_job",
            {"p_job_id": job_id, "p_candidates": candidates},
        )
        if not isinstance(result, str):
            raise DatabaseError("worker_finish_generation_job", 502, True)
        return result

    def fail(self, job_id: str, retryable: bool, reason: str) -> str:
        result = self._rpc(
            "worker_fail_generation_job",
            {"p_job_id": job_id, "p_retryable": retryable, "p_reason": reason[:500]},
        )
        if not isinstance(result, str):
            raise DatabaseError("worker_fail_generation_job", 502, True)
        return result
