from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from app.quality.gate import evaluate
from app.quality.scorer import QualityScoringInput, select_quality_scorer
from app.schemas import QualitySignals


def scoring_input(signals=None):
    return QualityScoringInput(b"source", b"candidate", b"mask", "image/png", "image/png", 2, 2, "style", signals)


class QualityScorerTest(unittest.TestCase):
    def test_real_provider_without_approved_cv_is_hard_blocked(self):
        with patch.dict(os.environ, {}, clear=True):
            scorer = select_quality_scorer("openai")
            result = evaluate(scorer.score(scoring_input()))
        self.assertEqual(scorer.name, "fail_closed")
        self.assertTrue(result.hard_fail)

    def test_mock_fixture_signals_are_local_only(self):
        signals = QualitySignals(0.95, 0.01, 0.01, 0.2, 1, 0.9, 0.9)
        with patch.dict(os.environ, {}, clear=True):
            scorer = select_quality_scorer("mock")
            self.assertIs(scorer.score(scoring_input(signals)), signals)

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


if __name__ == "__main__":
    unittest.main()
