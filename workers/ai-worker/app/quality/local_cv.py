"""Bounded, local-only CV measurements for generated hairstyle candidates."""
from __future__ import annotations

import hashlib
import multiprocessing
import os
import queue
import time
from pathlib import Path

from app.schemas import QualityScoringResult, QualitySignals
from app.quality.scorer import FailClosedQualityScorer, QualityScoringInput


YUNET_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
SFACE_SHA256 = "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79"
MODEL_LABEL = "opencv-4.13.0.92/yunet-2023mar+sface-2021dec"


def _bounded_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError as error:
        raise RuntimeError(f"{name} must be an integer") from error
    if value < minimum or value > maximum:
        raise RuntimeError(f"{name} must be between {minimum} and {maximum}")
    return value


def _verified_model(path: Path, expected_sha256: str) -> Path:
    if not path.is_file():
        raise RuntimeError(f"approved CV model is missing: {path.name}")
    digest = hashlib.sha256()
    with path.open("rb") as model:
        while chunk := model.read(1024 * 1024):
            digest.update(chunk)
    if digest.hexdigest() != expected_sha256:
        raise RuntimeError(f"approved CV model checksum mismatch: {path.name}")
    return path


def _clamp(value: float) -> float:
    return max(0.0, min(1.0, float(value)))


def _decode(cv2, np, payload: bytes, expected_width: int, expected_height: int):
    image = cv2.imdecode(np.frombuffer(payload, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None or image.ndim != 3 or image.shape[2] != 3:
        raise ValueError("image decode failed")
    if image.shape[1] != expected_width or image.shape[0] != expected_height:
        raise ValueError("image dimensions do not match the source contract")
    return image


def _faces(cv2, detector, image):
    detector.setInputSize((image.shape[1], image.shape[0]))
    _status, faces = detector.detect(image)
    return [] if faces is None else list(faces)


def _normalized_landmarks(np, face):
    x, y, width, height = [float(value) for value in face[:4]]
    if width <= 0 or height <= 0:
        raise ValueError("invalid face dimensions")
    points = np.asarray(face[4:14], dtype=np.float64).reshape(5, 2)
    points[:, 0] = (points[:, 0] - x) / width
    points[:, 1] = (points[:, 1] - y) / height
    return points


def _measure(request: QualityScoringInput, yunet_path: str, sface_path: str) -> QualitySignals:
    import cv2
    import numpy as np

    source = _decode(cv2, np, request.source_bytes, request.source_width, request.source_height)
    candidate = _decode(cv2, np, request.candidate_bytes, request.source_width, request.source_height)
    if len(request.hair_edit_mask_bytes) != request.mask_width * request.mask_height:
        raise ValueError("mask dimensions are invalid")
    mask_grid = np.frombuffer(request.hair_edit_mask_bytes, dtype=np.uint8).reshape(
        request.mask_height, request.mask_width
    )
    if not np.all((mask_grid == 0) | (mask_grid == 1)):
        raise ValueError("mask must be binary")
    mask = cv2.resize(
        mask_grid,
        (request.source_width, request.source_height),
        interpolation=cv2.INTER_NEAREST,
    ).astype(bool)
    coverage = float(mask.mean())
    if coverage <= 0 or coverage >= 1:
        raise ValueError("mask coverage is invalid")

    detector = cv2.FaceDetectorYN.create(yunet_path, "", (320, 320), 0.75, 0.3, 5000)
    source_faces = _faces(cv2, detector, source)
    candidate_faces = _faces(cv2, detector, candidate)

    pixel_diff = cv2.absdiff(source, candidate).astype(np.float32).mean(axis=2) / 255.0
    outside = float(pixel_diff[~mask].mean())
    inside = float(pixel_diff[mask].mean())
    style_match = _clamp(max(0.0, inside - outside) * 5.0)

    gray_source = cv2.cvtColor(source, cv2.COLOR_BGR2GRAY)
    gray_candidate = cv2.cvtColor(candidate, cv2.COLOR_BGR2GRAY)
    source_sharpness = float(cv2.Laplacian(gray_source, cv2.CV_64F).var())
    candidate_sharpness = float(cv2.Laplacian(gray_candidate, cv2.CV_64F).var())
    sharpness_preservation = _clamp(candidate_sharpness / max(source_sharpness, 1.0))
    clipping = float(((gray_candidate <= 4) | (gray_candidate >= 251)).mean())
    exposure_quality = _clamp(1.0 - clipping * 4.0)

    if len(source_faces) != 1 or len(candidate_faces) != 1:
        observed_count = len(candidate_faces) if len(source_faces) == 1 else len(source_faces)
        return QualitySignals(0.0, 1.0, outside, coverage, observed_count, 0.0, style_match)

    source_face, candidate_face = source_faces[0], candidate_faces[0]
    recognizer = cv2.FaceRecognizerSF.create(sface_path, "")
    source_feature = recognizer.feature(recognizer.alignCrop(source, source_face))
    candidate_feature = recognizer.feature(recognizer.alignCrop(candidate, candidate_face))
    cosine = float(recognizer.match(source_feature, candidate_feature, cv2.FaceRecognizerSF_FR_COSINE))
    identity = _clamp((cosine + 1.0) / 2.0)
    landmark_delta = _clamp(
        float(np.sqrt(np.mean((_normalized_landmarks(np, source_face) - _normalized_landmarks(np, candidate_face)) ** 2)))
    )
    face_confidence = _clamp(float(candidate_face[14]))
    image_quality = _clamp(
        0.5 * face_confidence + 0.3 * sharpness_preservation + 0.2 * exposure_quality
    )
    return QualitySignals(identity, landmark_delta, outside, coverage, 1, image_quality, style_match)


def _child(result_queue, request, yunet_path: str, sface_path: str) -> None:
    try:
        result_queue.put(("ok", _measure(request, yunet_path, sface_path)))
    except BaseException as error:
        # Never serialize exception messages: native libraries may include paths
        # or input-derived details. Only a stable class name crosses the boundary.
        result_queue.put(("error", type(error).__name__))


class LocalCVQualityScorer:
    name = "local_cv"

    def __init__(self, timeout_seconds: float | None = None):
        configured_timeout = timeout_seconds if timeout_seconds is not None else float(
            os.environ.get("HAIR_TWIN_CV_TIMEOUT_SECONDS", "30")
        )
        if configured_timeout <= 0 or configured_timeout > 120:
            raise RuntimeError("HAIR_TWIN_CV_TIMEOUT_SECONDS must be greater than 0 and at most 120")
        self.timeout_seconds = configured_timeout
        model_dir = Path(os.environ.get("HAIR_TWIN_CV_MODEL_DIR", "/app/models"))
        self._yunet = _verified_model(model_dir / "face_detection_yunet_2023mar.onnx", YUNET_SHA256)
        self._sface = _verified_model(model_dir / "face_recognition_sface_2021dec.onnx", SFACE_SHA256)
        self._max_image_bytes = _bounded_int(
            "HAIR_TWIN_CV_MAX_IMAGE_BYTES", 20 * 1024 * 1024, 1024, 32 * 1024 * 1024
        )
        self._context = multiprocessing.get_context("spawn")

    def _failed(self, request: QualityScoringInput, started: float, code: str) -> QualityScoringResult:
        fallback = FailClosedQualityScorer(self.timeout_seconds).score(request)
        return QualityScoringResult(
            fallback.signals,
            self.name,
            MODEL_LABEL,
            False,
            int((time.monotonic() - started) * 1000),
            code,
        )

    def score(self, request: QualityScoringInput) -> QualityScoringResult:
        started = time.monotonic()
        if (
            len(request.source_bytes) > self._max_image_bytes
            or len(request.candidate_bytes) > self._max_image_bytes
            or request.source_width <= 0
            or request.source_height <= 0
            or request.source_width * request.source_height > 8_294_400
        ):
            return self._failed(request, started, "input_limits")

        result_queue = self._context.Queue(maxsize=1)
        process = self._context.Process(
            target=_child,
            args=(result_queue, request, str(self._yunet), str(self._sface)),
            daemon=True,
        )
        process.start()
        process.join(self.timeout_seconds)
        if process.is_alive():
            process.terminate()
            process.join(2)
            if process.is_alive():
                process.kill()
                process.join(1)
            result_queue.close()
            return self._failed(request, started, "timeout")
        try:
            status, value = result_queue.get(timeout=1)
        except queue.Empty:
            return self._failed(request, started, "worker_exit")
        finally:
            result_queue.close()
        if status != "ok" or not isinstance(value, QualitySignals):
            return self._failed(request, started, "measurement_error")
        return QualityScoringResult(
            value,
            self.name,
            MODEL_LABEL,
            True,
            int((time.monotonic() - started) * 1000),
        )
