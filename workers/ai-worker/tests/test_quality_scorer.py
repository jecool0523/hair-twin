from __future__ import annotations

import os
import unittest
from pathlib import Path
from unittest.mock import patch

from app.quality.gate import evaluate
from app.quality.scorer import QualityScoringInput, select_quality_scorer
from app.quality.local_cv import LocalCVQualityScorer
from app.schemas import QualitySignals


def scoring_input(signals=None):
    return QualityScoringInput(
        b"source", b"candidate", b"mask", "image/png", "image/png",
        2, 2, 1, 1, "style", signals,
    )


class QualityScorerTest(unittest.TestCase):
    def test_real_provider_without_approved_cv_is_hard_blocked(self):
        with patch.dict(os.environ, {}, clear=True):
            scorer = select_quality_scorer("openai")
            scored = scorer.score(scoring_input())
            result = evaluate(scored.signals)
        self.assertEqual(scorer.name, "fail_closed")
        self.assertFalse(scored.measured)
        self.assertTrue(result.hard_fail)

    def test_mock_fixture_signals_are_local_only(self):
        signals = QualitySignals(0.95, 0.01, 0.01, 0.2, 1, 0.9, 0.9)
        with patch.dict(os.environ, {}, clear=True):
            scorer = select_quality_scorer("mock")
            scored = scorer.score(scoring_input(signals))
            self.assertIs(scored.signals, signals)
            self.assertFalse(scored.measured)

    def test_unknown_cv_provider_and_unbounded_timeout_fail_startup(self):
        with patch.dict(os.environ, {"HAIR_TWIN_CV_PROVIDER": "unapproved"}, clear=True):
            with self.assertRaises(RuntimeError):
                select_quality_scorer("openai")
        with patch.dict(
            os.environ,
            {"HAIR_TWIN_CV_PROVIDER": "fail_closed", "HAIR_TWIN_CV_TIMEOUT_SECONDS": "121"},
            clear=True,
        ):
            with self.assertRaises(RuntimeError):
                select_quality_scorer("openai")

    def test_invalid_numeric_signals_are_blocked_by_policy(self):
        for identity in (float("nan"), float("inf"), -0.1, 1.1):
            result = evaluate(QualitySignals(identity, 0.01, 0.01, 0.2, 1, 0.9, 0.9))
            self.assertTrue(result.hard_fail)
            self.assertEqual(result.status.value, "blocked_policy_or_safety")

    def test_python_thresholds_cover_identity_background_face_realism_and_style(self):
        good = QualitySignals(0.96, 0.01, 0.01, 0.15, 1, 0.85, 0.8)
        cases = (
            (QualitySignals(0.6, 0.01, 0.01, 0.15, 1, 0.85, 0.8), "blocked_identity_changed", True),
            (QualitySignals(0.96, 0.2, 0.01, 0.15, 1, 0.85, 0.8), "blocked_identity_changed", True),
            (QualitySignals(0.96, 0.01, 0.2, 0.15, 1, 0.85, 0.8), "blocked_non_hair_changed", True),
            (QualitySignals(0.96, 0.01, 0.01, 0.15, 0, 0.85, 0.8), "blocked_identity_changed", True),
            (QualitySignals(0.96, 0.01, 0.01, 0.15, 2, 0.85, 0.8), "blocked_identity_changed", True),
            (QualitySignals(0.96, 0.01, 0.01, 0.15, 1, 0.3, 0.8), "blocked_low_realism", True),
            (QualitySignals(0.96, 0.01, 0.01, 0.15, 1, 0.85, 0.05), "needs_stylist_review", False),
        )
        self.assertEqual(evaluate(good).status.value, "accepted")
        for signals, status, hard_fail in cases:
            result = evaluate(signals)
            self.assertEqual(result.status.value, status)
            self.assertEqual(result.hard_fail, hard_fail)

    def test_local_cv_requires_the_pinned_models_at_startup(self):
        with patch.dict(
            os.environ,
            {"HAIR_TWIN_CV_PROVIDER": "local_cv", "HAIR_TWIN_CV_MODEL_DIR": "missing-models"},
            clear=True,
        ):
            with self.assertRaises(RuntimeError):
                select_quality_scorer("openai")

    def test_local_cv_timeout_and_invalid_child_result_fail_closed(self):
        class FakeQueue:
            def __init__(self, value=None):
                self.value = value

            def get(self, timeout):
                return self.value

            def close(self):
                pass

        class FakeProcess:
            def __init__(self, alive):
                self.alive = alive

            def start(self):
                pass

            def join(self, timeout=None):
                pass

            def is_alive(self):
                return self.alive

            def terminate(self):
                self.alive = False

            def kill(self):
                self.alive = False

        class FakeContext:
            def __init__(self, alive, value=None):
                self.alive = alive
                self.value = value

            def Queue(self, maxsize):
                return FakeQueue(self.value)

            def Process(self, **kwargs):
                return FakeProcess(self.alive)

        scorer = LocalCVQualityScorer.__new__(LocalCVQualityScorer)
        scorer.timeout_seconds = 0.001
        scorer._max_image_bytes = 1024
        scorer._yunet = Path("yunet")
        scorer._sface = Path("sface")

        scorer._context = FakeContext(True)
        timed_out = scorer.score(scoring_input())
        self.assertFalse(timed_out.measured)
        self.assertEqual(timed_out.failure_code, "timeout")
        self.assertTrue(evaluate(timed_out.signals).hard_fail)

        scorer._context = FakeContext(False, ("ok", {"not": "signals"}))
        invalid = scorer.score(scoring_input())
        self.assertFalse(invalid.measured)
        self.assertEqual(invalid.failure_code, "measurement_error")


if __name__ == "__main__":
    unittest.main()
