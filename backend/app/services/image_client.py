"""Reference-image generation for Runway image_to_video.

Real path: POST /v1/text_to_image with `gen4_image_turbo`, poll the resulting
task synchronously, then download the produced PNG to local disk. Runway's
gen4_image* models require at least one `referenceImages` entry, so we seed
the request with a flat-colour PNG that contributes negligible visual
information (the prompt remains the dominant signal).

Mock path: synthesize a small, deterministic PNG locally with stdlib only.
No third-party network calls in mock mode — safe for CI and the Playwright
smoke.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import struct
import time
import uuid
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, cast

import httpx

from ..config import Settings
from ..models import ImageGenerateRequest, ImageGenerateResponse

logger = logging.getLogger(__name__)

_IMAGE_MODEL = "gen4_image_turbo"
_LOCAL_IMAGE_ROUTE = "/api/runway/image"

# Cap on bytes we'll persist from a generated image. Real Gen-4 image outputs
# are well under 5 MB; the cap keeps a misbehaving upstream from filling disk.
_MAX_IMAGE_BYTES = 16 * 1024 * 1024


def _runway_headers(settings: Settings) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.runway_api_key}",
        "X-Runway-Version": settings.runway_api_version,
        "Content-Type": "application/json",
    }


def _solid_png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    """Generate a valid PNG of `rgb` color, no third-party deps.

    Used only by the mock path so the demo + Playwright can show a real
    ``<img>`` preview without requiring Pillow or shipping a binary asset.
    """
    sig = b"\x89PNG\r\n\x1a\n"

    def chunk(typ: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(typ + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + typ + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit RGB
    row = bytes([0]) + bytes(rgb) * width  # filter type 0 + RGB pixels
    raw = row * height
    idat = zlib.compress(raw, level=9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def _mock_color_for(prompt: str) -> tuple[int, int, int]:
    """Deterministic colour from prompt so two identical prompts produce the
    same mock image — keeps demos and tests reproducible.
    """
    digest = hashlib.sha256(prompt.encode("utf-8", errors="ignore")).digest()
    return (40 + digest[0] % 120, 30 + digest[1] % 100, 50 + digest[2] % 130)


@dataclass
class _ImageWriteResult:
    image_id: str
    path: Path


class ImageGenerationError(RuntimeError):
    """Raised by the real Runway path on a non-recoverable failure."""


def _images_dir(settings: Settings) -> Path:
    d = settings.data_path / "images"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _write_atomic(images_dir: Path, image_id: str, payload: bytes) -> _ImageWriteResult:
    target = images_dir / f"{image_id}.png"
    tmp = target.with_suffix(".png.tmp")
    tmp.write_bytes(payload)
    tmp.replace(target)
    return _ImageWriteResult(image_id=image_id, path=target)


def path_for(settings: Settings, image_id: str) -> Path:
    return _images_dir(settings) / f"{image_id}.png"


def _generate_mock(req: ImageGenerateRequest, settings: Settings) -> ImageGenerateResponse:
    image_id = f"mockimg_{uuid.uuid4().hex[:10]}"
    payload = _solid_png(512, 288, _mock_color_for(req.prompt_text))
    written = _write_atomic(_images_dir(settings), image_id, payload)
    logger.info("mock reference image written: %s (%d bytes)", written.path.name, len(payload))
    return ImageGenerateResponse(
        image_id=image_id,
        image_url=f"{_LOCAL_IMAGE_ROUTE}/{image_id}",
        mock_mode=True,
        model="mock",
    )


def _poll_task(
    task_id: str, settings: Settings, *, timeout_s: float = 90.0, interval_s: float = 3.0
) -> dict:
    """Synchronous poll for /v1/tasks/{id} until terminal status or timeout."""
    deadline = time.time() + timeout_s
    url = f"{settings.runway_api_base}/v1/tasks/{task_id}"
    with httpx.Client(timeout=20.0) as client:
        while True:
            resp = client.get(url, headers=_runway_headers(settings))
            resp.raise_for_status()
            payload = cast(dict, resp.json())
            status = (payload.get("status") or "").upper()
            if status == "SUCCEEDED":
                return payload
            if status in {"FAILED", "CANCELED"}:
                reason = payload.get("failure") or payload.get("error") or status
                raise ImageGenerationError(f"text_to_image task {status}: {reason}")
            if time.time() >= deadline:
                raise ImageGenerationError(
                    f"text_to_image task {task_id} timed out after {int(timeout_s)}s"
                )
            time.sleep(interval_s)


def _extract_first_url(payload: dict) -> Optional[str]:
    output = payload.get("output")
    if isinstance(output, list):
        for v in output:
            if isinstance(v, str):
                return v
    if isinstance(output, dict):
        for v in output.values():
            if isinstance(v, str):
                return v
    return None


def _download_image(url: str, *, timeout_s: float = 30.0) -> bytes:
    with httpx.stream("GET", url, timeout=timeout_s, follow_redirects=True) as resp:
        resp.raise_for_status()
        ctype = (resp.headers.get("content-type") or "").lower()
        if not ctype.startswith("image/"):
            raise ImageGenerationError(f"unexpected content-type: {ctype or '(missing)'}")
        size = 0
        chunks: list[bytes] = []
        for chunk in resp.iter_bytes():
            size += len(chunk)
            if size > _MAX_IMAGE_BYTES:
                raise ImageGenerationError(f"image exceeds cap ({_MAX_IMAGE_BYTES} bytes)")
            chunks.append(chunk)
        return b"".join(chunks)


def _seed_reference_uri() -> str:
    """Generate a flat-colour PNG and return it as a data URI suitable for
    Runway's `referenceImages` field. The image is small (320x320) and a
    near-neutral charcoal — enough to satisfy the gen4_image_turbo schema
    while keeping the prompt the dominant signal.
    """
    payload = _solid_png(320, 320, (45, 45, 55))
    return "data:image/png;base64," + base64.b64encode(payload).decode("ascii")


def _generate_real(req: ImageGenerateRequest, settings: Settings) -> ImageGenerateResponse:
    body = {
        "model": _IMAGE_MODEL,
        "promptText": req.prompt_text,
        "ratio": req.ratio,
        # gen4_image_turbo rejects requests without at least one
        # referenceImages entry. We seed a flat charcoal PNG so the prompt
        # text remains the dominant signal — see _seed_reference_uri.
        "referenceImages": [{"uri": _seed_reference_uri(), "tag": "seed"}],
    }
    create_url = f"{settings.runway_api_base}/v1/text_to_image"
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(create_url, headers=_runway_headers(settings), json=body)
        resp.raise_for_status()
        created = resp.json()
    task_id = created.get("id") or created.get("taskId") or ""
    if not task_id:
        raise ImageGenerationError(f"Runway text_to_image missing task id: {created}")

    payload = _poll_task(task_id, settings)
    image_url = _extract_first_url(payload)
    if not image_url:
        raise ImageGenerationError(f"text_to_image task {task_id} produced no output url")

    raw = _download_image(image_url)
    image_id = uuid.uuid4().hex[:12]
    written = _write_atomic(_images_dir(settings), image_id, raw)
    logger.info(
        "real reference image written: %s (%d bytes) via task %s",
        written.path.name, len(raw), task_id,
    )
    return ImageGenerateResponse(
        image_id=image_id,
        image_url=f"{_LOCAL_IMAGE_ROUTE}/{image_id}",
        mock_mode=False,
        model=_IMAGE_MODEL,
    )


def generate_prompt_image(
    req: ImageGenerateRequest, settings: Settings
) -> ImageGenerateResponse:
    """Public entry point. Mock-safe; real path raises ImageGenerationError on
    any non-recoverable upstream failure (caught by the router and surfaced
    as a 502).
    """
    if settings.runway_mock:
        return _generate_mock(req, settings)
    return _generate_real(req, settings)
