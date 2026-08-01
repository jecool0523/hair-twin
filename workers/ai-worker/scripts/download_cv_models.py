"""Download only approved OpenCV Zoo models and verify immutable hashes."""
from __future__ import annotations

import hashlib
import os
import urllib.request
from pathlib import Path


MODELS = (
    (
        "face_detection_yunet_2023mar.onnx",
        "https://github.com/opencv/opencv_zoo/raw/refs/heads/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
        "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
        1_000_000,
    ),
    (
        "face_recognition_sface_2021dec.onnx",
        "https://github.com/opencv/opencv_zoo/raw/refs/heads/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
        "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
        45_000_000,
    ),
)


def main() -> None:
    target = Path(os.environ.get("HAIR_TWIN_CV_MODEL_DIR", "/app/models"))
    target.mkdir(parents=True, exist_ok=True)
    for filename, url, expected, maximum in MODELS:
        destination = target / filename
        temporary = target / f".{filename}.download"
        digest = hashlib.sha256()
        total = 0
        with urllib.request.urlopen(url, timeout=180) as response, temporary.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > maximum:
                    raise RuntimeError(f"approved model exceeds size limit: {filename}")
                digest.update(chunk)
                output.write(chunk)
        if digest.hexdigest() != expected:
            temporary.unlink(missing_ok=True)
            raise RuntimeError(f"approved model checksum mismatch: {filename}")
        temporary.replace(destination)


if __name__ == "__main__":
    main()
