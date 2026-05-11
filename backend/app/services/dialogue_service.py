"""PR AF — Dialogue Scene Builder.

Sequential talking-avatar lines stitched into one MP4. Each line
targets a specific Character's ``runway_avatar_id`` and is rendered
through the existing Runway ``avatar_videos`` pipeline (same
primitive as the Spokesperson Ad). The stitched output is the
multi-character branded skit — like an Office-style cold open.

V1 is intentionally simple:
- 3 default lines (Character A → Character B → Character A closer)
- Sequential, not simultaneous
- One character per line
- Each line ≤ 300 chars (matches avatar_videos speech limit)
- ffmpeg concat preserves audio across lines

This module mirrors ``storyboard_service`` in shape so the codebase
stays readable. Real-mode rendering reuses the existing
``avatar_videos`` HTTP plumbing patterns from ``character_host_client``;
mock mode produces deterministic ffmpeg-lavfi placeholder MP4s the
stitch can concat cleanly.

Never raises in normal operation — entry points return result
dataclasses and the router maps them to HTTP responses.
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
from ..models import Campaign, DialogueLine

logger = logging.getLogger(__name__)

_AVATAR_VIDEO_MODEL = "gwm1_avatars"
_MAX_LINE_BYTES = 100 * 1024 * 1024
_MAX_LINE_CHARS = 300
_POLL_INTERVAL = 5.0
_POLL_DEADLINE = 360.0
# PR DL — six-line scene default. The original 3-line default
# (Hook / Beat / Closer) was tight enough that office-style skits
# felt clipped; 6 lines (Hook / Setup / Beat 1 / Beat 2 / Twist /
# Closer) gives room for a proper back-and-forth between three
# spokespeople. Stitch + per-line generate paths are length-agnostic;
# the constant + the labels + the speaker rotation are the only
# moving parts.
_DEFAULT_LINE_COUNT = 6
_DEFAULT_LINE_LABELS: tuple[str, ...] = (
    "Hook",
    "Setup",
    "Beat 1",
    "Beat 2",
    "Twist",
    "Closer",
)
assert len(_DEFAULT_LINE_LABELS) == _DEFAULT_LINE_COUNT


# ---- result dataclass -----------------------------------------------

@dataclass
class LineResult:
    status: str  # "ok" | "failed" | "unavailable"
    output_path: Optional[Path] = None
    task_id: Optional[str] = None
    avatar_id: Optional[str] = None
    error: Optional[str] = None
    mock_mode: bool = False


# ---- helpers --------------------------------------------------------

def is_ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def _line_dir(settings: Settings) -> Path:
    d = settings.data_path / "dialogue"
    d.mkdir(parents=True, exist_ok=True)
    return d


def line_path(settings: Settings, campaign_id: str, line_id: str) -> Path:
    return _line_dir(settings) / f"{campaign_id}-{line_id}.mp4"


def _runway_headers(settings: Settings) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.runway_api_key}",
        "X-Runway-Version": settings.runway_api_version,
        "Content-Type": "application/json",
    }


def _ready_characters(settings: Settings) -> list[dict]:
    """Return all Character records whose Runway avatar is usable for
    dialogue rendering (status `ready` or `mock`). Lazy-imports
    CharacterStore to avoid the same circular dependency the host
    client documented.
    """
    from .character_store import CharacterStore  # noqa: WPS433

    try:
        store = CharacterStore(settings.data_path)
        records = store.list()
    except Exception:  # pragma: no cover — defensive
        logger.exception("dialogue: character store list failed")
        return []
    out = []
    for rec in records:
        status = (rec.runway_avatar_status or "").lower()
        if rec.runway_avatar_id and status in {"ready", "mock"}:
            out.append({
                "id": rec.id,
                "name": rec.name,
                "avatar_id": rec.runway_avatar_id,
                "voice_preset": rec.voice_preset,
                "template": rec.template,
                "personality": rec.personality,
                "status": status,
            })
    return out


def _attached_character(campaign: Campaign, settings: Settings) -> Optional[dict]:
    if not campaign.character_id:
        return None
    chars = _ready_characters(settings)
    return next((c for c in chars if c["id"] == campaign.character_id), None)


# ---- planner --------------------------------------------------------

def _split_script_sentences(script: str, n: int) -> list[str]:
    """Split commercial_script into ``n`` rough beats. Mirrors
    ``storyboard_service._split_script_beats`` shape but returns a
    list so we can map to N lines cleanly.
    """
    cleaned = (script or "").strip()
    if not cleaned:
        return []
    parts = [p.strip() for p in re.split(r"(?<=[.!?])\s+", cleaned) if p.strip()]
    if not parts:
        return []
    if len(parts) <= n:
        return parts + [parts[-1]] * (n - len(parts))
    # Distribute sentences across N buckets so the script's narrative
    # arc maps to consecutive lines.
    buckets: list[list[str]] = [[] for _ in range(n)]
    per = len(parts) / n
    for i, p in enumerate(parts):
        idx = min(int(i / per), n - 1)
        buckets[idx].append(p)
    return [" ".join(b) for b in buckets]


def _truncate_line(text: str, limit: int = _MAX_LINE_CHARS) -> str:
    cleaned = (text or "").strip()
    if not cleaned:
        return ""
    if len(cleaned) <= limit:
        return cleaned
    truncated = cleaned[:limit]
    stop = max(
        truncated.rfind("."),
        truncated.rfind("!"),
        truncated.rfind("?"),
    )
    if stop > limit // 2:
        return truncated[: stop + 1].strip()
    return truncated.rsplit(" ", 1)[0].rstrip(",.;:!?").strip()


def _default_line_text(campaign: Campaign, label: str, beat: str) -> str:
    """Office-style template per beat. Used when no script-derived
    sentence is available for a beat or the script is too short.

    PR DL — extended for 6-line scenes. The fallback strings stay
    silly + brand-aware so an operator who hasn't authored lines yet
    still ends up with a renderable skit that hints at the next
    edits. Label mapping intentionally tolerant: any unknown beat
    label falls through to the generic Beat copy.
    """
    biz = (campaign.business or "this brand").strip()
    product = (campaign.product or biz).strip()
    if label == "Hook":
        return _truncate_line(
            beat
            or f"We built {product} at 3AM because sleep started asking too many questions."
        )
    if label == "Setup":
        return _truncate_line(
            beat
            or f"Long story short: {biz} needed a spokesperson. We brought three."
        )
    if label in ("Beat", "Beat 1"):
        return _truncate_line(
            beat
            or f"That explains the budget spreadsheet labeled vibes."
        )
    if label == "Beat 2":
        return _truncate_line(
            beat
            or f"Also the calendar invite titled 'urgent fun'."
        )
    if label == "Twist":
        return _truncate_line(
            beat
            or f"Then somebody asked who actually owns the brand voice."
        )
    # Closer (and any unknown label)
    return _truncate_line(
        beat
        or f"Drink smarter. Build harder. Tell {biz} we sent you."
    )


def plan_lines(
    campaign: Campaign, settings: Settings,
) -> tuple[list[DialogueLine], Optional[str]]:
    """Build the deterministic dialogue plan from the saved campaign
    + attached character + up to two more ready characters. Returns
    ``(lines, error_message)``. ``error_message`` is non-None when
    the campaign has no usable characters at all (caller emits 409).

    PR DL — scene length is ``_DEFAULT_LINE_COUNT`` (6 today).
    Speaker rotation walks a small cast of up to 3 distinct ready
    characters and cycles A → B → C → A → B → C across the labels;
    with two ready characters it degrades to A/B/A/B/A/B, with one
    it degrades to a monologue (all primary). The plan is purely a
    starting point — operators reshape every line + speaker in
    Step 3 of the lane.
    """
    ready = _ready_characters(settings)
    if not ready:
        return [], (
            "No characters with a ready Runway avatar are available. "
            "Create at least one character first (Stage 1 / Character "
            "Studio), then re-plan the dialogue scene."
        )

    # Cast: primary first (campaign-attached character if any, else
    # the first ready character), then up to 2 more distinct ready
    # characters. Capped at 3 so the A/B/C rotation across N lines
    # stays predictable.
    primary = _attached_character(campaign, settings) or ready[0]
    cast: list[dict] = [primary]
    seen_ids = {primary["id"]}
    for c in ready:
        if c["id"] in seen_ids:
            continue
        cast.append(c)
        seen_ids.add(c["id"])
        if len(cast) >= 3:
            break

    speakers = tuple(
        cast[i % len(cast)] for i in range(_DEFAULT_LINE_COUNT)
    )

    beats = _split_script_sentences(
        campaign.commercial_script or "", _DEFAULT_LINE_COUNT,
    )
    while len(beats) < _DEFAULT_LINE_COUNT:
        beats.append("")

    lines: list[DialogueLine] = []
    for idx, (label, speaker, beat) in enumerate(
        zip(_DEFAULT_LINE_LABELS, speakers, beats), start=1,
    ):
        line_id = f"line-{idx}"
        text = _default_line_text(campaign, label, beat)
        lines.append(
            DialogueLine(
                id=line_id,
                character_id=speaker["id"],
                character_name=speaker["name"],
                avatar_id=speaker["avatar_id"],
                text=text,
                status="idle",
            )
        )
    return lines, None


# ---- generation -----------------------------------------------------

def _download_line(url: str, target: Path, timeout: float = 90.0) -> int:
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
                    if size > _MAX_LINE_BYTES:
                        raise RuntimeError(
                            f"dialogue line exceeds cap ({_MAX_LINE_BYTES} bytes)"
                        )
                    fh.write(chunk)
        tmp.replace(target)
        return size
    except Exception:
        tmp.unlink(missing_ok=True)
        raise


def _generate_real(
    campaign: Campaign,
    line: DialogueLine,
    settings: Settings,
) -> LineResult:
    if not line.avatar_id:
        return LineResult(
            status="failed",
            error=(
                "Line has no avatar_id. Pick a character with a ready "
                "Runway avatar before generating."
            ),
        )
    text = (line.text or "").strip()
    if not text:
        return LineResult(
            status="failed",
            error="Line text is empty. Write the spoken line before generating.",
        )
    if len(text) > _MAX_LINE_CHARS:
        return LineResult(
            status="failed",
            error=(
                f"Line text exceeds the {_MAX_LINE_CHARS}-char "
                f"avatar_videos limit ({len(text)} chars)."
            ),
        )

    body = {
        "model": _AVATAR_VIDEO_MODEL,
        "avatar": {"type": "custom", "avatarId": line.avatar_id},
        "speech": {"type": "text", "text": text},
    }
    create_url = f"{settings.runway_api_base}/v1/avatar_videos"
    try:
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(create_url, headers=_runway_headers(settings), json=body)
            if resp.status_code != 200:
                return LineResult(
                    status="failed",
                    avatar_id=line.avatar_id,
                    error=f"avatar_videos rejected: {resp.status_code} {resp.text[:200]}",
                )
            created = resp.json()
    except httpx.HTTPError as exc:
        return LineResult(
            status="failed",
            avatar_id=line.avatar_id,
            error=f"avatar_videos http error: {exc!s}"[:300],
        )

    task_id = created.get("id")
    if not task_id:
        return LineResult(
            status="failed",
            avatar_id=line.avatar_id,
            error=f"avatar_videos missing task id: {created}",
        )

    deadline = time.time() + _POLL_DEADLINE
    final = None
    with httpx.Client(timeout=20.0) as client:
        while time.time() < deadline:
            try:
                r = client.get(
                    f"{settings.runway_api_base}/v1/tasks/{task_id}",
                    headers=_runway_headers(settings),
                )
                r.raise_for_status()
                payload = r.json()
            except httpx.HTTPError as exc:
                return LineResult(
                    status="failed",
                    task_id=task_id,
                    avatar_id=line.avatar_id,
                    error=f"task poll error: {exc!s}"[:300],
                )
            status_str = (payload.get("status") or "").upper()
            if status_str == "SUCCEEDED":
                final = payload
                break
            if status_str in {"FAILED", "CANCELED"}:
                reason = payload.get("failure") or payload.get("error") or status_str
                return LineResult(
                    status="failed",
                    task_id=task_id,
                    avatar_id=line.avatar_id,
                    error=f"task {status_str}: {reason}",
                )
            time.sleep(_POLL_INTERVAL)

    if not final:
        return LineResult(
            status="failed",
            task_id=task_id,
            avatar_id=line.avatar_id,
            error=f"avatar_videos task {task_id} timed out",
        )

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
        return LineResult(
            status="failed",
            task_id=task_id,
            avatar_id=line.avatar_id,
            error="avatar_videos task produced no output url",
        )

    target = line_path(settings, campaign.id, line.id)
    try:
        _download_line(out_url, target)
    except Exception as exc:
        return LineResult(
            status="failed",
            task_id=task_id,
            avatar_id=line.avatar_id,
            error=f"download error: {exc!s}"[:300],
        )
    return LineResult(
        status="ok",
        output_path=target,
        task_id=task_id,
        avatar_id=line.avatar_id,
        mock_mode=False,
    )


def _generate_mock(
    campaign: Campaign,
    line: DialogueLine,
    settings: Settings,
) -> LineResult:
    """Mock-mode dialogue line. Produces a 5 s 1088×704 ffmpeg-lavfi
    placeholder with the speaker name + a snippet of the line text
    drawn over a neutral background. Mirrors `character_host_client`
    mock host clip + `storyboard_service._generate_mock`.
    """
    if not is_ffmpeg_available():
        return LineResult(
            status="unavailable",
            error="ffmpeg not found on PATH",
            mock_mode=True,
        )
    target = line_path(settings, campaign.id, line.id)
    tmp = target.with_suffix(".mp4.tmp")
    raw_speaker = (line.character_name or "Mock Speaker").replace("'", "").replace(":", "\\:")[:48]
    raw_text = (line.text or "Mock line").replace("'", "").replace(":", "\\:")[:80]
    cmd = [
        "ffmpeg",
        "-y",
        "-loglevel", "error",
        "-f", "lavfi",
        "-i", "color=c=0x1a1f2e:s=1088x704:d=5:rate=30",
        "-f", "lavfi",
        "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
        "-shortest",
        "-vf", (
            f"drawtext=text='{raw_speaker}':fontcolor=0xff8b3d:fontsize=44:"
            "x=(w-text_w)/2:y=(h*0.30),"
            f"drawtext=text='{raw_text}':fontcolor=white:fontsize=24:"
            "x=(w-text_w)/2:y=(h*0.50)"
        ),
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-shortest",
        "-movflags", "+faststart",
        "-f", "mp4",
        str(tmp),
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            stderr = (result.stderr or "").strip()[-300:]
            tmp.unlink(missing_ok=True)
            return LineResult(
                status="failed",
                avatar_id=line.avatar_id,
                error=f"mock ffmpeg rc={result.returncode}: {stderr}",
                mock_mode=True,
            )
        if not tmp.exists():
            return LineResult(
                status="failed",
                avatar_id=line.avatar_id,
                error="mock ffmpeg ok but output missing",
                mock_mode=True,
            )
        tmp.replace(target)
        return LineResult(
            status="ok",
            output_path=target,
            task_id=f"mock_dialogue_{campaign.id}_{line.id}",
            avatar_id=line.avatar_id,
            mock_mode=True,
        )
    except subprocess.TimeoutExpired:
        tmp.unlink(missing_ok=True)
        return LineResult(
            status="failed",
            avatar_id=line.avatar_id,
            error="mock ffmpeg timed out",
            mock_mode=True,
        )
    except Exception as exc:
        tmp.unlink(missing_ok=True)
        logger.exception("unexpected mock-line ffmpeg error")
        return LineResult(
            status="failed",
            avatar_id=line.avatar_id,
            error=f"unexpected: {exc!s}"[:200],
            mock_mode=True,
        )


def generate_line(
    campaign: Campaign,
    line: DialogueLine,
    settings: Settings,
) -> LineResult:
    """Public entry point. Routes to mock or real depending on settings.
    Never raises.
    """
    if settings.runway_mock:
        return _generate_mock(campaign, line, settings)
    return _generate_real(campaign, line, settings)
