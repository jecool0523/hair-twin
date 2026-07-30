"""Server-only access to Hair Twin's private Supabase Storage buckets."""
from __future__ import annotations

import os
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable


Transport = Callable[[urllib.request.Request, float], tuple[int, bytes]]


class StorageError(RuntimeError):
    def __init__(self, operation: str, status: int, retryable: bool):
        super().__init__(f"storage {operation} failed with HTTP {status}")
        self.retryable = retryable


def _default_transport(request: urllib.request.Request, timeout: float) -> tuple[int, bytes]:
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()


def _object_path(path: str, salon_id: str | None = None, session_id: str | None = None) -> str:
    if not path or path != path.strip("/") or "\\" in path:
        raise ValueError("invalid storage path")
    parts = path.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise ValueError("invalid storage path")
    if salon_id is not None and (len(parts) < 3 or parts[0] != salon_id or parts[1] != session_id):
        raise ValueError("storage path does not match the claimed tenant and session")
    return urllib.parse.quote(path, safe="/")


class SupabaseStorage:
    def __init__(self, transport: Transport | None = None):
        self.url = os.environ.get("SUPABASE_URL", "").rstrip("/")
        self.secret_key = os.environ.get("SUPABASE_SECRET_KEY", "")
        self.timeout = float(os.environ.get("SUPABASE_STORAGE_TIMEOUT_SECONDS", "30"))
        self._transport = transport or _default_transport

    def enabled(self) -> bool:
        return bool(self.url and self.secret_key)

    def _request(
        self,
        method: str,
        bucket: str,
        path: str,
        data: bytes | None = None,
        mime: str | None = None,
        salon_id: str | None = None,
        session_id: str | None = None,
    ) -> bytes:
        if not self.enabled():
            raise StorageError("configuration", 0, False)
        endpoint = f"{self.url}/storage/v1/object/{urllib.parse.quote(bucket, safe='')}/{_object_path(path, salon_id, session_id)}"
        headers = {
            "Authorization": f"Bearer {self.secret_key}",
            "apikey": self.secret_key,
        }
        if mime:
            headers["Content-Type"] = mime
            headers["x-upsert"] = "false"
        request = urllib.request.Request(endpoint, data=data, method=method, headers=headers)
        try:
            status, body = self._transport(request, self.timeout)
        except (TimeoutError, urllib.error.URLError) as error:
            raise StorageError(method.lower(), 599, True) from error
        if status >= 400:
            raise StorageError(method.lower(), status, status == 429 or status >= 500)
        return body

    def get_source_bytes(self, path: str, salon_id: str, session_id: str) -> bytes:
        return self._request("GET", "source-images-private", path, salon_id=salon_id, session_id=session_id)

    def get_mask_bytes(self, path: str, salon_id: str, session_id: str) -> bytes:
        return self._request("GET", "masks-private", path, salon_id=salon_id, session_id=session_id)

    def put_generated_asset(self, path: str, data: bytes, mime: str) -> str:
        self._request("POST", "generated-assets-private", path, data, mime)
        return path

    def delete_source(self, path: str) -> None:
        self._request("DELETE", "source-images-private", path)

    def delete_mask(self, path: str) -> None:
        self._request("DELETE", "masks-private", path)

    def delete_generated(self, path: str) -> None:
        self._request("DELETE", "generated-assets-private", path)
