"""Runway Character Host (PR F).

Generates a short spokesperson MP4 for a saved campaign by:

1. Ensuring a curated host Avatar exists (created once, cached on disk
   under ``backend/data/host/avatar.json``). Avatar processing requires
   a face — we use a configurable Unsplash portrait URL for V1.
2. Posting a `/v1/avatar_videos` task with a script templated from the
   campaign's ``selected_concept``.
3. Polling the resulting task with the same 5 s + jitter pattern the
   rest of the app uses.
4. Downloading the presigned MP4 to ``backend/data/host/<campaign_id>.mp4``
   so it survives URL expiry.

Mock mode synthesizes a 5 s placeholder MP4 via local ffmpeg
(``-f lavfi -i color`` + ``drawtext "Mock Host"``) — no third-party
calls. ffmpeg is already a dependency for the Campaign Pack so this
introduces no new system requirements.

Never raises in normal operation — callers receive a structured
``HostResult`` and decide what to surface.
"""
from __future__ import annotations

import json
import logging
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import httpx

from ..config import Settings
from ..models import Campaign

logger = logging.getLogger(__name__)

_AVATAR_VIDEO_MODEL = "gwm1_avatars"
_MAX_HOST_BYTES = 100 * 1024 * 1024  # 100 MB cap, same as Campaign cache
_MAX_SCRIPT_CHARS = 300

# Lower-case preset ids enumerated by the Runway validator during the
# probe. Kept here so the router can validate user-supplied overrides
# before round-tripping to Runway.
SUPPORTED_VOICE_PRESETS: tuple[str, ...] = (
    "victoria", "vincent", "clara", "drew", "skye", "max",
    "morgan", "felix", "mia", "marcus", "summer", "ruby",
    "aurora", "jasper", "leo", "adrian", "nina", "emma",
    "blake", "david", "maya", "nathan", "sam", "georgia",
    "petra", "adam", "zach", "violet", "roman", "luna",
)


@dataclass
class HostResult:
    status: str  # "ok" | "failed" | "unavailable"
    output_path: Optional[Path] = None
    task_id: Optional[str] = None
    avatar_id: Optional[str] = None
    error: Optional[str] = None
    mock_mode: bool = False


class HostError(RuntimeError):
    """Raised internally when the Runway path can't proceed; caught by
    the caller and surfaced as a structured ``HostResult``.
    """


def is_ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def _runway_headers(settings: Settings) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.runway_api_key}",
        "X-Runway-Version": settings.runway_api_version,
        "Content-Type": "application/json",
    }


def build_script(campaign: Campaign, override: Optional[str] = None) -> str:
    """Deterministic local templating from the saved concept. No
    third-party LLM. Truncates to ``_MAX_SCRIPT_CHARS`` to stay inside
    Runway's avatar_videos script bounds.
    """
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


# ---- avatar caching ---------------------------------------------------

def _host_dir(settings: Settings) -> Path:
    d = settings.data_path / "host"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _avatar_record_path(settings: Settings) -> Path:
    return _host_dir(settings) / "avatar.json"


def _read_cached_avatar(settings: Settings) -> Optional[dict]:
    p = _avatar_record_path(settings)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


def _write_cached_avatar(settings: Settings, record: dict) -> None:
    p = _avatar_record_path(settings)
    tmp = p.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(record, indent=2), encoding="utf-8")
    tmp.replace(p)


def _ensure_real_avatar(
    settings: Settings, voice_preset: Optional[str] = None
) -> str:
    """Idempotently produce an Avatar id usable by `/v1/avatar_videos`.

    Cached on disk so we don't recreate on every host-video request.
    """
    cached = _read_cached_avatar(settings)
    if cached and cached.get("status") == "READY" and cached.get("id"):
        return cached["id"]

    voice = (voice_preset or settings.runway_host_voice_preset).lower()
    if voice not in SUPPORTED_VOICE_PRESETS:
        raise HostError(
            f"unsupported voice preset '{voice}'. supported: {sorted(SUPPORTED_VOICE_PRESETS)}"
        )

    body = {
        "name": "AdSpark Host",
        "referenceImage": settings.runway_host_portrait_url,
        "voice": {"type": "runway-live-preset", "presetId": voice},
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

    # Poll PROCESSING -> READY (~30-45s typical based on probe)
    deadline = time.time() + 180
    interval = 5.0
    detail_url = f"{settings.runway_api_base}/v1/avatars/{avatar_id}"
    final_status = avatar.get("status") or ""
    with httpx.Client(timeout=20.0) as client:
        while time.time() < deadline:
            r = client.get(detail_url, headers=_runway_headers(settings))
            r.raise_for_status()
            avatar = r.json()
            final_status = (avatar.get("status") or "").upper()
            if final_status in {"READY", "FAILED"}:
                break
            time.sleep(interval)

    if final_status != "READY":
        # Don't cache the failed record — let the next request retry.
        raise HostError(
            f"avatar processing did not reach READY (final: {final_status})"
        )

    _write_cached_avatar(settings, {
        "id": avatar_id,
        "status": "READY",
        "voice_preset": voice,
        "portrait": settings.runway_host_portrait_url,
        "processed_image_uri": avatar.get("processedImageUri"),
    })
    logger.info("cached host avatar id=%s voice=%s", avatar_id, voice)
    return avatar_id


# ---- video generation ------------------------------------------------

def _path_for(settings: Settings, campaign_id: str) -> Path:
    return _host_dir(settings) / f"{campaign_id}.mp4"


def path_for(settings: Settings, campaign_id: str) -> Path:
    """Public alias used by routers."""
    return _path_for(settings, campaign_id)


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
    voice_preset: Optional[str],
    script_override: Optional[str],
) -> HostResult:
    avatar_id = _ensure_real_avatar(settings, voice_preset)
    script = build_script(campaign, script_override)
    if not script:
        raise HostError("empty script — campaign concept fields all blank")

    body = {
        "model": _AVATAR_VIDEO_MODEL,
        "avatar": {"type": "custom", "avatarId": avatar_id},
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

    # Poll the task — same 5s + jitter pattern as elsewhere, sync.
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

    # Extract first output URL
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

    target = _path_for(settings, campaign.id)
    size = _download(out_url, target)
    logger.info(
        "host video saved campaign=%s bytes=%d avatar=%s task=%s",
        campaign.id, size, avatar_id, task_id,
    )
    return HostResult(
        status="ok",
        output_path=target,
        task_id=task_id,
        avatar_id=avatar_id,
        mock_mode=False,
    )


def _generate_mock(
    campaign: Campaign,
    settings: Settings,
    *,
    script_override: Optional[str],
) -> HostResult:
    """Synthesize a 5 s silent placeholder MP4 with ffmpeg lavfi.

    Stays mock-safe: no third-party calls. ffmpeg already required by
    the Campaign Pack pipeline so we don't add a new dependency.
    """
    if not is_ffmpeg_available():
        return HostResult(
            status="unavailable",
            error="ffmpeg not found on PATH",
            mock_mode=True,
        )
    script = build_script(campaign, script_override)
    target = _path_for(settings, campaign.id)
    tmp = target.with_suffix(".mp4.tmp")
    raw_label = (
        campaign.selected_concept.title or campaign.business or "Mock Host"
    )[:60]
    # Strip apostrophes (drawtext text='...' would break) and escape colons
    # (drawtext option separator).
    label = raw_label.replace("'", "").replace(":", "\\:")

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
    logger.info("mock host video written for campaign %s (%d bytes)", campaign.id, target.stat().st_size)
    _ = script  # script unused in mock; logged via campaign label above
    return HostResult(
        status="ok",
        output_path=target,
        task_id="mock_host",
        avatar_id="mock_avatar",
        mock_mode=True,
    )


def generate_host_video(
    campaign: Campaign,
    settings: Settings,
    *,
    voice_preset: Optional[str] = None,
    script_override: Optional[str] = None,
) -> HostResult:
    """Public entry point. Mock-safe; never raises HostError above this
    boundary — the structured HostResult is the only failure surface.
    """
    try:
        if settings.runway_mock:
            return _generate_mock(campaign, settings, script_override=script_override)
        return _generate_real(
            campaign,
            settings,
            voice_preset=voice_preset,
            script_override=script_override,
        )
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
    except Exception as exc:
        logger.exception("host generation unexpected")
        return HostResult(
            status="failed",
            error=f"unexpected: {exc!s}"[:300],
            mock_mode=settings.runway_mock,
        )
