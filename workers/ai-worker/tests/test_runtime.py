from __future__ import annotations

import json
import unittest
import urllib.error
import urllib.request

from app.runtime import WorkerRuntimeState, start_health_server


class RuntimeTest(unittest.TestCase):
    def test_health_readiness_and_aggregate_metrics(self):
        state = WorkerRuntimeState("fixture-provider", "fail_closed")
        server = start_health_server(state, host="127.0.0.1", port=0)
        base = f"http://127.0.0.1:{server.server_address[1]}"
        try:
            with urllib.request.urlopen(f"{base}/healthz") as response:
                self.assertEqual(json.load(response), {"status": "ok"})
            with self.assertRaises(urllib.error.HTTPError) as not_ready:
                urllib.request.urlopen(f"{base}/readyz")
            self.assertEqual(not_ready.exception.code, 503)

            state.set_ready(True)
            state.record_outcome("completed")
            state.record_cycle(True, 0.125)
            with urllib.request.urlopen(f"{base}/readyz") as response:
                payload = json.load(response)
            self.assertTrue(payload["ready"])
            self.assertEqual(payload["processed_jobs"], 1)
            self.assertEqual(payload["completed_jobs"], 1)
            self.assertEqual(payload["failed_jobs"], 0)
            with urllib.request.urlopen(f"{base}/metrics") as response:
                metrics = response.read().decode()
            self.assertIn("hair_twin_worker_ready 1", metrics)
            self.assertIn("hair_twin_worker_completed_jobs_total 1", metrics)
            self.assertNotIn("test-key", metrics)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    unittest.main()
