"""Brand Spokesperson Avatar + Avatar Host Clip (PR F V2).

Two visible phases for the demo:

    1. ``create_or_reuse_avatar(campaign, settings, ...)``
       - Per-campaign Runway Avatar created from the campaign's own
         reference image when usable; otherwise falls back to a
         curated stock portrait.
       - Polls Runway's avatar processing pipeline to READY/FAILED.
       - Returns an ``AvatarResult`` describing the avatar id, the
         processed thumbnail URL, the image source we ended up using,
         and the persisted status.

    2. ``generate_host_video(campaign, settings, ...)``
       - Requires the campaign's ``host_avatar_id`` to already be
         READY.  Posts ``/v1/avatar_videos`` with a templated script
         from ``selected_concept`` and downloads the resulting MP4 to
         ``backend/data/host/<campaign_id>.mp4``.

Mock mode mirrors both phases — a stdlib PNG stands in for the
processed avatar thumbnail, and an ffmpeg ``lavfi`` placeholder MP4
stands in for the host clip. Same ffmpeg dependency we already require
for the Campaign Pack; no new third-party deps.

Never raises in normal operation — both phases return structured
result dataclasses and the routers map them to HTTP responses.
"""
from __future__ import annotations

import base64
import logging
import shutil
import struct
import subprocess
import time
import uuid
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import httpx

from ..config import Settings
from ..models import Campaign

logger = logging.getLogger(__name__)

_AVATAR_VIDEO_MODEL = "gwm1_avatars"
_MAX_HOST_BYTES = 100 * 1024 * 1024
_MAX_SCRIPT_CHARS = 300

# Lower-case preset ids enumerated by the Runway validator during the
# probe (see docs/research/RUNWAY_CHARACTER_HOST_SPIKE.md §12).
SUPPORTED_VOICE_PRESETS: tuple[str, ...] = (
    "victoria", "vincent", "clara", "drew", "skye", "max",
    "morgan", "felix", "mia", "marcus", "summer", "ruby",
    "aurora", "jasper", "leo", "adrian", "nina", "emma",
    "blake", "david", "maya", "nathan", "sam", "georgia",
    "petra", "adam", "zach", "violet", "roman", "luna",
)

_LOCAL_IMAGE_PREFIX = "/api/runway/image/"


# ---- result dataclasses ---------------------------------------------

@dataclass
class AvatarResult:
    status: str  # "ready" | "failed" | "mock"
    avatar_id: Optional[str] = None
    image_url: Optional[str] = None  # processed thumbnail from Runway
    image_source: Optional[str] = None  # "campaign" | "stock" | "override"
    error: Optional[str] = None
    mock_mode: bool = False


@dataclass
class HostResult:
    status: str  # "ok" | "failed" | "unavailable"
    output_path: Optional[Path] = None
    task_id: Optional[str] = None
    error: Optional[str] = None
    mock_mode: bool = False


class HostError(RuntimeError):
    """Internal — caught by the public entry points."""


# ---- shared helpers --------------------------------------------------

def is_ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def _runway_headers(settings: Settings) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.runway_api_key}",
        "X-Runway-Version": settings.runway_api_version,
        "Content-Type": "application/json",
    }


def _host_dir(settings: Settings) -> Path:
    d = settings.data_path / "host"
    d.mkdir(parents=True, exist_ok=True)
    return d


def path_for(settings: Settings, campaign_id: str) -> Path:
    return _host_dir(settings) / f"{campaign_id}.mp4"


def _solid_png_data_uri() -> str:
    """Local stdlib mock avatar thumbnail. Same primitive used by
    ``image_client.py`` for the mock reference image — no new deps.
    """

    def chunk(typ: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(typ + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + typ + data + struct.pack(">I", crc)

    sig = b"\x89PNG\r\n\x1a\n"
    width = height = 320
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    row = bytes([0]) + bytes((30, 50, 70)) * width
    raw = row * height
    idat = zlib.compress(raw, level=9)
    payload = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    return "data:image/png;base64," + base64.b64encode(payload).decode("ascii")


def build_script(campaign: Campaign, override: Optional[str] = None) -> str:
    """Deterministic local templating from the saved concept. No LLM."""
    if override and override.strip():
        return override.strip()[:_MAX_SCRIPT_CHARS]
    concept = campaign.selected_concept
    parts = [
        f"Meet {campaign.business}." if campaign.business else "",
        concept.hook.strip().rstrip(".") + "." if concept.hook else "",
        concept.caption.strip().rstrip(".") + "." if concept.caption else "",
        concept.cta.strip().rstrip(".") + "." if concept.cta else "",
    ]
    script = " ".join(p for p in parts if p)
    return script[:_MAX_SCRIPT_CHARS]


def _resolve_image_for_runway(image_url: str, settings: Settings) -> str:
    """Convert local ``/api/runway/image/<id>`` URLs to base64 data URIs
    so Runway can ingest them.  External URLs and existing data URIs
    pass through unchanged.
    """
    if not image_url:
        return image_url
    if not image_url.startswith(_LOCAL_IMAGE_PREFIX):
        return image_url
    image_id = image_url[len(_LOCAL_IMAGE_PREFIX):]
    if "/" in image_id or ".." in image_id:
        return image_url
    local = settings.data_path / "images" / f"{image_id}.png"
    if not local.exists():
        return image_url
    data = local.read_bytes()
    b64 = base64.b64encode(data).decode("ascii")
    return f"data:image/png;base64,{b64}"


def _pick_source(
    campaign: Campaign,
    override: Optional[str],
    settings: Settings,
) -> tuple[str, str]:
    """Returns (image_to_send_to_runway, source_label).

    Preference order: explicit override → campaign reference image →
    configured stock portrait.
    """
    if override and override.strip():
        return override.strip(), "override"
    if campaign.reference_image_url and campaign.reference_image_url.strip():
        return campaign.reference_image_url.strip(), "campaign"
    return settings.runway_host_portrait_url, "stock"


# ---- phase 1: create or reuse avatar ---------------------------------

def _create_avatar_real(
    image_url: str,
    voice_preset: str,
    settings: Settings,
) -> dict:
    """POST /v1/avatars and poll until READY/FAILED. Raises HostError
    with a structured message on any non-200 status or terminal FAILED.
    """
    body = {
        "name": "AdSpark Brand Spokesperson",
        "referenceImage": _resolve_image_for_runway(image_url, settings),
        "voice": {"type": "runway-live-preset", "presetId": voice_preset},
        "personality": "Concise, friendly product spokesperson.",
    }
    create_url = f"{settings.runway_api_base}/v1/avatars"
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(create_url, headers=_runway_headers(settings), json=body)
        if resp.status_code != 200:
            raise HostError(
                f"avatar create failed: {resp.status_code} {resp.text[:300]}"
            )
        avatar = resp.json()
    avatar_id = avatar.get("id")
    if not avatar_id:
        raise HostError(f"avatar create response missing id: {avatar}")

    deadline = time.time() + 180
    detail_url = f"{settings.runway_api_base}/v1/avatars/{avatar_id}"
    final_status = (avatar.get("status") or "").upper()
    with httpx.Client(timeout=20.0) as client:
        while time.time() < deadline and final_status not in {"READY", "FAILED"}:
            time.sleep(5)
            r = client.get(detail_url, headers=_runway_headers(settings))
            r.raise_for_status()
            avatar = r.json()
            final_status = (avatar.get("status") or "").upper()
    if final_status == "FAILED":
        raise HostError(
            "Runway rejected the reference image — typically because it "
            "does not contain a recognisable face."
        )
    if final_status != "READY":
        raise HostError(f"avatar processing did not reach READY (final: {final_status})")
    avatar["_finalStatus"] = final_status
    return avatar


def create_or_reuse_avatar(
    campaign: Campaign,
    settings: Settings,
    *,
    voice_preset: Optional[str] = None,
    image_url_override: Optional[str] = None,
    force_recreate: bool = False,
) -> AvatarResult:
    """Public entry point for **Phase 1 — Create Brand Spokesperson**.

    Reuses an existing READY avatar on the campaign unless
    ``force_recreate=True``.  When creating, picks the source image
    (override → campaign reference → stock portrait), tries that, and
    on failure surfaces the failure honestly — the caller (router)
    decides whether to expose a "Try again with stock portrait"
    follow-up to the user.

    Mock mode produces a synthetic READY avatar with a stdlib PNG
    thumbnail so the UI flow works identically.
    """
    voice = (voice_preset or settings.runway_host_voice_preset).lower()
    if voice not in SUPPORTED_VOICE_PRESETS:
        return AvatarResult(
            status="failed",
            error=(
                f"unsupported voice preset '{voice}'. supported: "
                f"{sorted(SUPPORTED_VOICE_PRESETS)}"
            ),
            mock_mode=settings.runway_mock,
        )

    # Reuse path
    if (
        not force_recreate
        and campaign.host_avatar_id
        and (campaign.host_avatar_status in {"ready", "mock"})
    ):
        return AvatarResult(
            status=campaign.host_avatar_status or "ready",
            avatar_id=campaign.host_avatar_id,
            image_url=campaign.host_avatar_image_url,
            image_source=campaign.host_avatar_image_source,
            mock_mode=campaign.host_avatar_status == "mock",
        )

    # Pick the source image
    chosen_url, source_label = _pick_source(campaign, image_url_override, settings)

    if settings.runway_mock:
        avatar_id = f"mock_avatar_{uuid.uuid4().hex[:10]}"
        return AvatarResult(
            status="mock",
            avatar_id=avatar_id,
            image_url=_solid_png_data_uri(),
            image_source=source_label,
            mock_mode=True,
        )

    try:
        avatar = _create_avatar_real(chosen_url, voice, settings)
    except HostError as exc:
        logger.warning(
            "avatar create failed campaign=%s source=%s: %s",
            campaign.id, source_label, exc,
        )
        return AvatarResult(
            status="failed",
            image_source=source_label,
            error=str(exc)[:300],
            mock_mode=False,
        )
    except httpx.HTTPError as exc:
        logger.warning("avatar create http error: %s", exc)
        return AvatarResult(
            status="failed",
            image_source=source_label,
            error=f"http error: {exc!s}"[:300],
            mock_mode=False,
        )
    except Exception as exc:  # pragma: no cover — defensive
        logger.exception("avatar create unexpected")
        return AvatarResult(
            status="failed",
            image_source=source_label,
            error=f"unexpected: {exc!s}"[:300],
            mock_mode=False,
        )

    return AvatarResult(
        status="ready",
        avatar_id=avatar.get("id"),
        image_url=avatar.get("processedImageUri") or avatar.get("referenceImageUri"),
        image_source=source_label,
        mock_mode=False,
    )


# ---- phase 2: avatar_videos ------------------------------------------

def _download(url: str, target: Path, timeout: float = 60.0) -> int:
    tmp = target.with_suffix(".mp4.tmp")
    size = 0
    try:
        with httpx.stream("GET", url, timeout=timeout, follow_redirects=True) as resp:
            resp.raise_for_status()
            ctype = (resp.headers.get("content-type") or "").lower()
            if not ctype.startswith("video/"):
                raise HostError(f"unexpected content-type: {ctype or '(missing)'}")
            with open(tmp, "wb") as fh:
                for chunk in resp.iter_bytes():
                    size += len(chunk)
                    if size > _MAX_HOST_BYTES:
                        raise HostError(
                            f"host video exceeds cap ({_MAX_HOST_BYTES} bytes)"
                        )
                    fh.write(chunk)
        tmp.replace(target)
        return size
    except HostError:
        tmp.unlink(missing_ok=True)
        raise
    except httpx.HTTPError as exc:
        tmp.unlink(missing_ok=True)
        raise HostError(f"download error: {exc!s}"[:300]) from exc


def _generate_real(
    campaign: Campaign,
    settings: Settings,
    *,
    script_override: Optional[str],
) -> HostResult:
    if not campaign.host_avatar_id or campaign.host_avatar_status != "ready":
        raise HostError(
            "Brand Spokesperson Avatar must be READY before generating a host clip."
        )
    script = build_script(campaign, script_override)
    if not script:
        raise HostError("empty script — campaign concept fields all blank")

    body = {
        "model": _AVATAR_VIDEO_MODEL,
        "avatar": {"type": "custom", "avatarId": campaign.host_avatar_id},
        "speech": {"type": "text", "text": script},
    }
    url = f"{settings.runway_api_base}/v1/avatar_videos"
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(url, headers=_runway_headers(settings), json=body)
        if resp.status_code != 200:
            raise HostError(
                f"avatar_videos rejected: {resp.status_code} {resp.text[:300]}"
            )
        created = resp.json()
    task_id = created.get("id")
    if not task_id:
        raise HostError(f"avatar_videos missing task id: {created}")

    deadline = time.time() + 360
    final = None
    with httpx.Client(timeout=20.0) as client:
        while time.time() < deadline:
            r = client.get(
                f"{settings.runway_api_base}/v1/tasks/{task_id}",
                headers=_runway_headers(settings),
            )
            r.raise_for_status()
            payload = r.json()
            status = (payload.get("status") or "").upper()
            if status == "SUCCEEDED":
                final = payload
                break
            if status in {"FAILED", "CANCELED"}:
                reason = payload.get("failure") or payload.get("error") or status
                raise HostError(f"avatar_videos task {status}: {reason}")
            time.sleep(5)
    if not final:
        raise HostError(f"avatar_videos task {task_id} timed out after 6 min")

    output = final.get("output")
    out_url: Optional[str] = None
    if isinstance(output, list):
        for v in output:
            if isinstance(v, str):
                out_url = v
                break
    elif isinstance(output, dict):
        for v in output.values():
            if isinstance(v, str):
                out_url = v
                break
    if not out_url:
        raise HostError(f"avatar_videos task {task_id} produced no output url")

    target = path_for(settings, campaign.id)
    size = _download(out_url, target)
    logger.info(
        "host video saved campaign=%s bytes=%d avatar=%s task=%s",
        campaign.id, size, campaign.host_avatar_id, task_id,
    )
    return HostResult(
        status="ok",
        output_path=target,
        task_id=task_id,
        mock_mode=False,
    )


def _generate_mock(
    campaign: Campaign,
    settings: Settings,
    *,
    script_override: Optional[str],
) -> HostResult:
    """Synthesize a 5 s placeholder MP4 with ffmpeg lavfi."""
    if not campaign.host_avatar_id or campaign.host_avatar_status not in {"ready", "mock"}:
        return HostResult(
            status="failed",
            error="Brand Spokesperson Avatar must exist before generating a host clip.",
            mock_mode=True,
        )
    if not is_ffmpeg_available():
        return HostResult(
            status="unavailable",
            error="ffmpeg not found on PATH",
            mock_mode=True,
        )
    raw_label = (
        campaign.selected_concept.title or campaign.business or "Mock Host"
    )[:60]
    label = raw_label.replace("'", "").replace(":", "\\:")
    target = path_for(settings, campaign.id)
    tmp = target.with_suffix(".mp4.tmp")
    cmd = [
        "ffmpeg",
        "-y",
        "-loglevel", "error",
        "-f", "lavfi",
        "-i", "color=c=0x29293a:s=720x720:d=5:rate=30",
        "-f", "lavfi",
        "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
        "-shortest",
        "-vf", (
            "drawtext=text='Mock Host':fontcolor=white:fontsize=44:"
            "x=(w-text_w)/2:y=(h*0.35),"
            f"drawtext=text='{label}':fontcolor=white:fontsize=28:"
            "x=(w-text_w)/2:y=(h*0.55)"
        ),
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-c:a", "aac",
        "-shortest",
        "-movflags", "+faststart",
        "-f", "mp4",
        str(tmp),
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired:
        tmp.unlink(missing_ok=True)
        return HostResult(
            status="failed",
            error="ffmpeg mock host timed out after 60s",
            mock_mode=True,
        )
    if result.returncode != 0:
        tmp.unlink(missing_ok=True)
        stderr = (result.stderr or "").strip()[-200:]
        return HostResult(
            status="failed",
            error=f"ffmpeg rc={result.returncode}: {stderr}",
            mock_mode=True,
        )
    if not tmp.exists():
        return HostResult(
            status="failed",
            error="ffmpeg ok but output missing",
            mock_mode=True,
        )
    tmp.replace(target)
    _ = script_override  # accepted but ignored in mock — script is implied by label
    return HostResult(
        status="ok",
        output_path=target,
        task_id=f"mock_host_{uuid.uuid4().hex[:8]}",
        mock_mode=True,
    )


def generate_host_video(
    campaign: Campaign,
    settings: Settings,
    *,
    script_override: Optional[str] = None,
) -> HostResult:
    """Public entry point for **Phase 2 — Present Campaign**."""
    try:
        if settings.runway_mock:
            return _generate_mock(campaign, settings, script_override=script_override)
        return _generate_real(campaign, settings, script_override=script_override)
    except HostError as exc:
        logger.warning("host generation failed: %s", exc)
        return HostResult(
            status="failed",
            error=str(exc)[:300],
            mock_mode=settings.runway_mock,
        )
    except httpx.HTTPError as exc:
        logger.warning("host generation http error: %s", exc)
        return HostResult(
            status="failed",
            error=f"http error: {exc!s}"[:300],
            mock_mode=settings.runway_mock,
        )
    except Exception as exc:  # pragma: no cover — defensive
        logger.exception("host generation unexpected")
        return HostResult(
            status="failed",
            error=f"unexpected: {exc!s}"[:300],
            mock_mode=settings.runway_mock,
        )
