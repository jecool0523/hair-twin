"""Dependency-free health/readiness and aggregate worker metrics."""
from __future__ import annotations

import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class WorkerRuntimeState:
    def __init__(self, provider: str, scorer: str):
        self.provider = provider
        self.scorer = scorer
        self.started_at = time.monotonic()
        self.ready = False
        self.processed_jobs = 0
        self.completed_jobs = 0
        self.failed_jobs = 0
        self.idle_polls = 0
        self.last_cycle_seconds = 0.0
        self._lock = threading.Lock()

    def set_ready(self, ready: bool) -> None:
        with self._lock:
            self.ready = ready

    def record_cycle(self, processed: bool, duration_seconds: float) -> None:
        with self._lock:
            self.processed_jobs += int(processed)
            self.idle_polls += int(not processed)
            self.last_cycle_seconds = max(0.0, duration_seconds)

    def record_outcome(self, outcome: str) -> None:
        with self._lock:
            if outcome == "completed":
                self.completed_jobs += 1
            elif outcome == "failed":
                self.failed_jobs += 1

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "status": "ready" if self.ready else "not_ready",
                "ready": self.ready,
                "provider": self.provider,
                "scorer": self.scorer,
                "uptime_seconds": round(max(0.0, time.monotonic() - self.started_at), 3),
                "processed_jobs": self.processed_jobs,
                "completed_jobs": self.completed_jobs,
                "failed_jobs": self.failed_jobs,
                "idle_polls": self.idle_polls,
                "last_cycle_seconds": round(self.last_cycle_seconds, 6),
            }


def _handler(state: WorkerRuntimeState):
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            snapshot = state.snapshot()
            if self.path == "/healthz":
                self._json(200, {"status": "ok"})
            elif self.path == "/readyz":
                self._json(200 if snapshot["ready"] else 503, snapshot)
            elif self.path == "/metrics":
                body = (
                    f"hair_twin_worker_ready {int(snapshot['ready'])}\n"
                    f"hair_twin_worker_processed_jobs_total {snapshot['processed_jobs']}\n"
                    f"hair_twin_worker_completed_jobs_total {snapshot['completed_jobs']}\n"
                    f"hair_twin_worker_failed_jobs_total {snapshot['failed_jobs']}\n"
                    f"hair_twin_worker_idle_polls_total {snapshot['idle_polls']}\n"
                    f"hair_twin_worker_last_cycle_seconds {snapshot['last_cycle_seconds']}\n"
                ).encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/plain; version=0.0.4")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                self._json(404, {"status": "not_found"})

        def _json(self, status: int, payload: dict) -> None:
            body = json.dumps(payload, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format, *_args):
            # Avoid request paths/headers leaking through default access logs.
            return

    return Handler


def start_health_server(
    state: WorkerRuntimeState, host: str = "0.0.0.0", port: int = 8080
) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((host, port), _handler(state))
    thread = threading.Thread(target=server.serve_forever, name="health-server", daemon=True)
    thread.start()
    return server
