"""Private storage access (STUB). Uses the service role key, server-side only.

Never exposes bucket credentials to the browser. Reads source images and writes
generated assets to PRIVATE buckets; the app serves them via short-lived signed
URLs. Not wired until a Supabase project is chosen (ADR-0003).
"""
from __future__ import annotations

import os


class SupabaseStorage:
    def __init__(self):
        self.url = os.environ.get("SUPABASE_URL")
        self.service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    def enabled(self) -> bool:
        return bool(self.url and self.service_role_key)

    def get_source_bytes(self, path: str) -> bytes | None:  # pragma: no cover
        raise NotImplementedError("supabase storage not wired yet")

    def put_generated_asset(self, path: str, data: bytes, mime: str) -> str:  # pragma: no cover
        raise NotImplementedError("supabase storage not wired yet")
