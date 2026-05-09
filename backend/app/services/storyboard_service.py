"""PR Z — Storyboard Commercial Builder.

Plan three image-to-video shots (Hook / Action / Payoff) and generate
each via the existing `runway_client` pipeline. The same character
portrait (or campaign reference image when no character is attached)
is pinned as `prompt_image` for every shot so the spokesperson stays
consistent across the stitched 15 s commercial.

Mock mode produces deterministic ffmpeg-lavfi placeholder MP4s — same
strategy the host-clip mock path uses. Real mode reuses the existing
`runway_client.create_task` + `_poll_task` plumbing so longer-video
work doesn't introduce a new third-party surface.

This module never raises in normal operation — entry points return
result dataclasses and the router maps them to HTTP responses.
"""
from __future__ import annotations

import logging
import re
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import httpx

from ..config import Settings
from ..models import Campaign, RunwayGenerateRequest, StoryboardShot
from . import runway_client

logger = logging.getLogger(__name__)

# V1 pins to a single shot count + per-shot duration so the demo is
# predictable. Future polish can let the user pick 3 / 4 / 5 shots and
# 5 / 8 / 10 s each.
_SHOT_DURATION = 5
_SHOT_RATIO = "1280:720"
_SHOT_MODEL = "gen4_turbo"
_MAX_SHOT_BYTES = 100 * 1024 * 1024
_POLL_INTERVAL = 5.0
_POLL_DEADLINE = 360.0  # 6 min — same ceiling host-clip + voice use


# ---- result dataclasses ---------------------------------------------

@dataclass
class ShotResult:
    status: str  # "ok" | "failed" | "unavailable"
    output_path: Optional[Path] = None
    task_id: Optional[str] = None
    error: Optional[str] = None
    mock_mode: bool = False


# ---- helpers --------------------------------------------------------

def is_ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def _shot_dir(settings: Settings) -> Path:
    d = settings.data_path / "storyboard"
    d.mkdir(parents=True, exist_ok=True)
    return d


def shot_path(settings: Settings, campaign_id: str, shot_id: str) -> Path:
    return _shot_dir(settings) / f"{campaign_id}-{shot_id}.mp4"


def _character_portrait_url(campaign: Campaign, settings: Settings) -> Optional[str]:
    """Return the local /api/characters/<id>/portrait URL for the
    campaign's attached character, if any. Mirrors the lookup in
    `character_host_client._character_avatar_for`.
    """
    if not campaign.character_id:
        return None
    # Lazy import to mirror character_host_client's no-cycle pattern.
    from .character_store import CharacterStore  # noqa: WPS433

    try:
        store = CharacterStore(settings.data_path)
        record = store.get(campaign.character_id)
    except Exception:  # pragma: no cover — defensive
        return None
    if not record or not record.portrait_url:
        return None
    return record.portrait_url


def _resolve_source_image(campaign: Campaign, settings: Settings) -> Optional[str]:
    """Choose the per-shot `prompt_image`. Character portrait wins;
    falls back to the campaign's reference image so storyboards still
    work when no character is attached. Returns None when neither is
    available (router emits 409).
    """
    portrait = _character_portrait_url(campaign, settings)
    if portrait:
        return portrait
    if campaign.reference_image_url and campaign.reference_image_url.strip():
        return campaign.reference_image_url.strip()
    return None


# ---- prompt planner --------------------------------------------------

def _audience_subject(campaign: Campaign) -> str:
    """Pick a singular subject phrase to anchor the prompts. Keeps the
    structured rule of thumb (one character) — when a character is
    attached the prompts still reference the audience, since the
    character portrait pins identity via the prompt_image.
    """
    audience = (campaign.audience or "").split(",")[0].strip()
    if not audience:
        return "the spokesperson"
    # Crude depluralisation matching simplifyFromConcept in the frontend.
    cleaned = " ".join(
        w[:-1] if w.endswith("s") and len(w) > 3 else w for w in audience.split()
    )
    return cleaned or "the spokesperson"


def _subject_hint(campaign: Campaign, settings: Settings) -> str:
    """Use the character's name + template when available; otherwise
    fall back to the audience-derived singular subject. The Runway
    prompt is reinforced visually by the prompt_image — this string
    is the textual anchor.
    """
    if campaign.character_id:
        from .character_store import CharacterStore  # noqa: WPS433

        try:
            record = CharacterStore(settings.data_path).get(campaign.character_id)
        except Exception:  # pragma: no cover — defensive
            record = None
        if record and record.name:
            template = record.template or "spokesperson"
            return f"{record.name}, the brand {template}"
    return _audience_subject(campaign)


def _product_phrase(campaign: Campaign) -> str:
    return (campaign.product or campaign.business or "the product").strip() or "the product"


def _location_phrase(campaign: Campaign) -> str:
    """Lift a coarse environment cue from the concept's visual prose
    if present; otherwise default to a neutral cinematic interior.
    """
    visual = (campaign.selected_concept.visual or "").strip().lower()
    if "kitchen" in visual:
        return "a small cozy kitchen"
    if "studio" in visual or "workshop" in visual:
        return "a warm artisan workshop"
    if "outdoor" in visual or "landscape" in visual or "horizon" in visual:
        return "a striking outdoor landscape"
    if "office" in visual:
        return "a modern bright office"
    if "store" in visual or "shop" in visual or "boutique" in visual:
        return "a cozy storefront interior"
    return "a softly lit cinematic interior"


_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


def _split_script_beats(script: str) -> tuple[str, str, str]:
    """PR AC — split the saved Commercial Script into 3 narrative
    beats (intro / problem-or-action / payoff) for script-aware shot
    planning. Empty inputs return three empty strings.

    Heuristic shape:
    - 1 sentence  -> intro=that, mid=that, end=that (single-shot script)
    - 2 sentences -> intro=first, mid=first, end=second
    - 3+ sentences -> first / middle joined / last
    """
    cleaned = (script or "").strip()
    if not cleaned:
        return "", "", ""
    parts = [s.strip() for s in _SENTENCE_SPLIT.split(cleaned) if s.strip()]
    if not parts:
        return "", "", ""
    if len(parts) == 1:
        return parts[0], parts[0], parts[0]
    if len(parts) == 2:
        return parts[0], parts[0], parts[1]
    return parts[0], " ".join(parts[1:-1]), parts[-1]


def _trim_phrase(text: str, limit: int = 110) -> str:
    """Clip a sentence to ``limit`` chars on a word boundary so the
    embedded narrative cue stays inside Runway's prompt budget.
    """
    cleaned = (text or "").strip()
    if not cleaned:
        return ""
    if len(cleaned) <= limit:
        return cleaned
    truncated = cleaned[:limit].rsplit(" ", 1)[0]
    return truncated.rstrip(",.;:!?")


def _shot_prompt(
    campaign: Campaign, settings: Settings, label: str,
) -> str:
    """Compose a single structured Runway prompt for one shot. Mirrors
    the frontend `buildRunwayVideoPrompt` rule of thumb: one character,
    one location, one action, one camera move.

    PR AC — when ``campaign.commercial_script`` is set, weave the
    matching script beat into the prompt as an emotional anchor. The
    structured "subject + action + location + camera" shape stays the
    load-bearing scaffolding so Runway still has concrete physical
    cues; the script beat is supplementary mood / narrative context.
    """
    subject = _subject_hint(campaign, settings)
    product = _product_phrase(campaign)
    location = _location_phrase(campaign)
    tone = (campaign.tone or "warm cinematic").strip()
    intro_beat, mid_beat, end_beat = _split_script_beats(campaign.commercial_script or "")

    if label == "Hook":
        beat = intro_beat
        action = "enters the scene and looks toward camera with anticipation"
        mood = "opening beat, curious, ready"
        camera = "static camera shot"
    elif label == "Action":
        beat = mid_beat
        action = f"interacts with {product}, hands-on, focused on the moment"
        mood = "engaged, satisfied, in the flow"
        camera = "static camera shot, slow push-in"
    else:  # Payoff
        beat = end_beat
        action = "reacts with a satisfied expression and gives a small approving nod toward camera"
        mood = "payoff, warm satisfaction, ready to act on the call to action"
        camera = "static camera shot"

    constraints = "natural movement, high detail, expressive but natural, 16:9"
    narrative_cue = _trim_phrase(beat)

    sentences = [
        f"A realistic {subject} {action} in {location}.",
        f"Narrative cue: {narrative_cue}." if narrative_cue else "",
        f"{mood}.",
        "Soft natural lighting.",
        f"{camera}.",
        f"{tone} cinematic style.",
        f"{constraints}.",
    ]
    return " ".join(s for s in sentences if s).strip()


def plan_shots(campaign: Campaign, settings: Settings) -> list[StoryboardShot]:
    """Build the deterministic 3-shot plan. Pure local computation —
    no Runway calls. Re-running plan_shots resets every shot to idle
    so the user can replan without orphaning state, but the caller
    (router) is responsible for invalidating cached MP4s if it wants a
    completely clean slate.
    """
    source_image = _resolve_source_image(campaign, settings)
    labels = ("Hook", "Action", "Payoff")
    shots: list[StoryboardShot] = []
    for idx, label in enumerate(labels, start=1):
        shot_id = f"shot-{idx}"
        shots.append(
            StoryboardShot(
                id=shot_id,
                label=label,
                prompt=_shot_prompt(campaign, settings, label),
                source_image_url=source_image,
                status="idle",
                duration=_SHOT_DURATION,
            )
        )
    return shots


# ---- shot generation -------------------------------------------------

def _download_shot(url: str, target: Path, timeout: float = 90.0) -> int:
    tmp = target.with_suffix(".mp4.tmp")
    size = 0
    try:
        with httpx.stream("GET", url, timeout=timeout, follow_redirects=True) as resp:
            resp.raise_for_status()
            ctype = (resp.headers.get("content-type") or "").lower()
            if not ctype.startswith("video/"):
                raise RuntimeError(
                    f"unexpected content-type: {ctype or '(missing)'}"
                )
            with open(tmp, "wb") as fh:
                for chunk in resp.iter_bytes():
                    size += len(chunk)
                    if size > _MAX_SHOT_BYTES:
                        raise RuntimeError(
                            f"shot exceeds cap ({_MAX_SHOT_BYTES} bytes)"
                        )
                    fh.write(chunk)
        tmp.replace(target)
        return size
    except Exception:
        tmp.unlink(missing_ok=True)
        raise


def _generate_real(
    campaign: Campaign,
    shot: StoryboardShot,
    settings: Settings,
) -> ShotResult:
    if not shot.prompt or not shot.prompt.strip():
        return ShotResult(status="failed", error="shot prompt is empty")
    if not shot.source_image_url:
        return ShotResult(
            status="failed",
            error="no source image — attach a Character or save a campaign with a reference image first.",
        )
    req = RunwayGenerateRequest(
        prompt_text=shot.prompt,
        prompt_image=shot.source_image_url,
        duration=_SHOT_DURATION,
        ratio=_SHOT_RATIO,
        model=_SHOT_MODEL,
    )
    # Validate before firing so a malformed shot fails fast.
    try:
        runway_client.validate_generation_settings(
            _SHOT_MODEL, _SHOT_RATIO, _SHOT_DURATION, has_image=True,
        )
    except runway_client.GenerationSettingsError as exc:
        return ShotResult(status="failed", error=str(exc))

    try:
        created = runway_client.create_task(req, settings)
    except httpx.HTTPError as exc:
        return ShotResult(
            status="failed", error=f"runway create error: {exc!s}"[:300],
        )
    except Exception as exc:  # pragma: no cover — defensive
        logger.exception("storyboard shot create unexpected")
        return ShotResult(status="failed", error=f"unexpected: {exc!s}"[:200])

    task_id = created.task_id
    deadline = time.time() + _POLL_DEADLINE
    final = None
    while time.time() < deadline:
        try:
            poll = runway_client.get_task(task_id, settings)
        except httpx.HTTPError as exc:
            return ShotResult(
                status="failed",
                task_id=task_id,
                error=f"runway poll error: {exc!s}"[:300],
            )
        if poll.status == "SUCCEEDED":
            final = poll
            break
        if poll.status in {"FAILED", "CANCELED"}:
            return ShotResult(
                status="failed",
                task_id=task_id,
                error=poll.failure_reason or f"task {poll.status}",
            )
        time.sleep(_POLL_INTERVAL)

    if not final or not final.output:
        return ShotResult(
            status="failed",
            task_id=task_id,
            error="runway task timed out without a SUCCEEDED output",
        )

    out_url = final.output[0]
    target = shot_path(settings, campaign.id, shot.id)
    try:
        _download_shot(out_url, target)
    except Exception as exc:
        return ShotResult(
            status="failed",
            task_id=task_id,
            error=f"download error: {exc!s}"[:300],
        )
    return ShotResult(status="ok", output_path=target, task_id=task_id, mock_mode=False)


def _generate_mock(
    campaign: Campaign,
    shot: StoryboardShot,
    settings: Settings,
) -> ShotResult:
    """Mock-mode shot generator. Produces a deterministic 5 s 720p
    placeholder MP4 with a label drawn on a coloured background — same
    primitive the host-clip mock path uses. ffmpeg is required.
    """
    if not is_ffmpeg_available():
        return ShotResult(
            status="unavailable",
            error="ffmpeg not found on PATH",
            mock_mode=True,
        )
    target = shot_path(settings, campaign.id, shot.id)
    tmp = target.with_suffix(".mp4.tmp")
    raw_label = (shot.label or shot.id or "Shot").replace("'", "").replace(":", "\\:")
    sub_raw = (campaign.business or "AdSpark").replace("'", "").replace(":", "\\:")[:48]
    cmd = [
        "ffmpeg",
        "-y",
        "-loglevel", "error",
        "-f", "lavfi",
        "-i", f"color=c=0x1a1f2e:s=1280x720:d={_SHOT_DURATION}:rate=30",
        "-vf", (
            f"drawtext=text='Storyboard {raw_label}':fontcolor=white:fontsize=56:"
            "x=(w-text_w)/2:y=(h*0.40),"
            f"drawtext=text='{sub_raw}':fontcolor=0xff8b3d:fontsize=32:"
            "x=(w-text_w)/2:y=(h*0.55)"
        ),
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-f", "mp4",
        str(tmp),
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            stderr = (result.stderr or "").strip()[-300:]
            tmp.unlink(missing_ok=True)
            return ShotResult(
                status="failed",
                error=f"mock ffmpeg rc={result.returncode}: {stderr}",
                mock_mode=True,
            )
        if not tmp.exists():
            return ShotResult(
                status="failed",
                error="mock ffmpeg ok but output missing",
                mock_mode=True,
            )
        tmp.replace(target)
        return ShotResult(
            status="ok",
            output_path=target,
            task_id=f"mock_storyboard_{campaign.id}_{shot.id}",
            mock_mode=True,
        )
    except subprocess.TimeoutExpired:
        tmp.unlink(missing_ok=True)
        return ShotResult(
            status="failed",
            error="mock ffmpeg timed out",
            mock_mode=True,
        )
    except OSError as exc:
        tmp.unlink(missing_ok=True)
        return ShotResult(
            status="failed",
            error=f"io error: {exc!s}"[:200],
            mock_mode=True,
        )
    except Exception as exc:
        tmp.unlink(missing_ok=True)
        logger.exception("unexpected mock-shot ffmpeg error")
        return ShotResult(
            status="failed",
            error=f"unexpected: {exc!s}"[:200],
            mock_mode=True,
        )


def generate_shot(
    campaign: Campaign,
    shot: StoryboardShot,
    settings: Settings,
) -> ShotResult:
    """Public entry point. Routes to mock or real depending on
    settings.runway_mock. Never raises.
    """
    if settings.runway_mock:
        return _generate_mock(campaign, shot, settings)
    return _generate_real(campaign, shot, settings)
