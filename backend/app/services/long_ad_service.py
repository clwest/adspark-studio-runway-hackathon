"""PR DO — Long Spokesperson Ad pipeline.

Chains multiple ``avatar_videos`` renders into one stitched MP4 so a
spokesperson can deliver 30-60s of speech inside a single Videos-tab
card. Runway's ``speech.text`` field caps a single render at 300
chars (≈10-15s of audio), so longer scripts need this multi-chunk
flow.

Architecture is intentionally minimal:

- ``chunk_script`` splits a 1500-char script at sentence boundaries
  into chunks ≤280 chars (the 20-char buffer keeps us under Runway's
  300 gate). Falls back to clause-split, then word-split for
  pathologically long single sentences.
- ``generate_long_ad`` walks the chunk list, fires one
  ``avatar_videos`` call per chunk (real or lavfi placeholder in
  mock mode), and writes each MP4 to ``data/long_ad/`` keyed by
  ``{campaign_id}-{output_id}-chunk-{n}.mp4``.
- The router then calls ``VideoFinisher.build_dialogue_scene`` (the
  same N-input concat helper PR AF already shipped) to stitch the
  chunk MP4s into one ``data/finished/{campaign_id}-long-{output_id}.mp4``
  output.

Chunks are ephemeral — they live on disk for a future per-chunk
audit / re-render story but are not surfaced in the Videos gallery
as individual OutputRecords. The stitched final ad is the one and
only ``long_spokesperson_ad`` OutputRecord.

Mock mode produces ffmpeg-lavfi placeholder MP4s (same approach as
``dialogue_service``) so smoke + offline demos work end-to-end
without Runway credits.
"""
from __future__ import annotations

import logging
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import httpx

from ..config import Settings

logger = logging.getLogger(__name__)

# Runway gates ``speech.text`` at 300 chars. Reserve a 20-char buffer
# so we never bump the wire on a single chunk.
_CHUNK_MAX_CHARS = 280

# Operator-facing upper bound on the full long script. Big enough
# for a ~60-100s ad without making the textarea feel unbounded.
_LONG_SCRIPT_MAX_CHARS = 1500

# Conservative chars-per-second estimate for the runtime display.
# Real avatar_videos audio is closer to 15-18 cps depending on the
# voice; this number anchors the operator's expectation without
# over-promising.
_CHARS_PER_SECOND = 15.0

_AVATAR_VIDEO_MODEL = "gwm1_avatars"
_POLL_INTERVAL_S = 5.0
_POLL_DEADLINE_S = 360.0
_MAX_CHUNK_BYTES = 50 * 1024 * 1024


@dataclass
class LongAdResult:
    """Returned by :func:`generate_long_ad`. The chunk_paths list is
    ordered so the router can hand it directly to the finisher's
    N-input concat helper."""

    status: str  # "ok" | "failed" | "unavailable"
    chunk_paths: list[Path] = field(default_factory=list)
    chunk_count: int = 0
    duration_estimate: float = 0.0
    task_ids: list[str] = field(default_factory=list)
    error: Optional[str] = None
    mock_mode: bool = False


def _runway_headers(settings: Settings) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.runway_api_key}",
        "X-Runway-Version": settings.runway_api_version,
        "Content-Type": "application/json",
    }


def is_ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def chunk_script(
    script: str, max_chars: int = _CHUNK_MAX_CHARS,
) -> list[str]:
    """Split a long-form script at sentence boundaries into chunks
    of ≤``max_chars`` characters. Greedy: pack as many sentences as
    fit, then start a new chunk.

    Fallback ladder:
    1. Single sentence > max_chars → split at ``,`` / ``;`` clause
       boundaries.
    2. Single clause still > max_chars → split at word boundary.
    3. Single word > max_chars → hard-cut at max_chars (rare).

    Returns ``[]`` for empty input. Never returns chunks above
    max_chars.
    """
    cleaned = (script or "").strip()
    if not cleaned:
        return []

    # Pre-split at sentence boundaries. Captures the punctuation so
    # we can re-attach it; ``re.split`` with a lookbehind preserves
    # the period/?/! on the preceding sentence.
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", cleaned) if s.strip()]
    if not sentences:
        sentences = [cleaned]

    chunks: list[str] = []
    current = ""

    def _flush() -> None:
        nonlocal current
        if current:
            chunks.append(current.strip())
            current = ""

    def _split_oversize(text: str) -> list[str]:
        """Recursive fallback for a single sentence/clause/word
        longer than max_chars. Returns a list of pieces each
        ≤ max_chars."""
        text = text.strip()
        if len(text) <= max_chars:
            return [text]
        # Try clause split first (commas / semicolons).
        clauses = [c.strip() for c in re.split(r"(?<=[,;])\s+", text) if c.strip()]
        if len(clauses) > 1:
            out: list[str] = []
            for c in clauses:
                out.extend(_split_oversize(c))
            return out
        # Word boundary split — pack words greedily.
        words = text.split()
        out_words: list[str] = []
        buf = ""
        for w in words:
            if len(w) > max_chars:
                # Pathological single word — hard-cut.
                if buf:
                    out_words.append(buf.strip())
                    buf = ""
                for i in range(0, len(w), max_chars):
                    out_words.append(w[i:i + max_chars])
                continue
            if len(buf) + 1 + len(w) <= max_chars:
                buf = (buf + " " + w).strip() if buf else w
            else:
                if buf:
                    out_words.append(buf.strip())
                buf = w
        if buf:
            out_words.append(buf.strip())
        return out_words

    for sentence in sentences:
        if len(sentence) <= max_chars:
            # Try to pack into current.
            joined = (current + " " + sentence).strip() if current else sentence
            if len(joined) <= max_chars:
                current = joined
            else:
                _flush()
                current = sentence
        else:
            # Single sentence too long — flush whatever we have +
            # add the split pieces in order.
            _flush()
            for piece in _split_oversize(sentence):
                if not current:
                    current = piece
                    continue
                joined = (current + " " + piece).strip()
                if len(joined) <= max_chars:
                    current = joined
                else:
                    _flush()
                    current = piece

    _flush()
    return chunks


def estimate_runtime(chunks: list[str]) -> float:
    """Rough duration estimate (seconds) for the concatenated audio.
    Computed from the total character count at
    ``_CHARS_PER_SECOND``. Conservative — real ad audio sits closer
    to 15-18 cps depending on voice preset."""
    total = sum(len(c) for c in chunks)
    if total == 0:
        return 0.0
    return round(total / _CHARS_PER_SECOND, 1)


def chunk_dir(settings: Settings) -> Path:
    d = settings.data_path / "long_ad"
    d.mkdir(parents=True, exist_ok=True)
    return d


def chunk_path(
    settings: Settings, campaign_id: str, output_id: str, idx: int,
) -> Path:
    return chunk_dir(settings) / (
        f"{campaign_id}-{output_id}-chunk-{idx:02d}.mp4"
    )


def _download_chunk(url: str, target: Path, timeout: float = 90.0) -> int:
    tmp = target.with_suffix(".mp4.tmp")
    size = 0
    try:
        with httpx.stream("GET", url, timeout=timeout, follow_redirects=True) as resp:
            resp.raise_for_status()
            ctype = (resp.headers.get("content-type") or "").lower()
            if not ctype.startswith("video/"):
                raise RuntimeError(f"unexpected content-type: {ctype or '(missing)'}")
            with open(tmp, "wb") as fh:
                for buf in resp.iter_bytes():
                    size += len(buf)
                    if size > _MAX_CHUNK_BYTES:
                        raise RuntimeError(
                            f"chunk MP4 exceeds cap ({_MAX_CHUNK_BYTES} bytes)"
                        )
                    fh.write(buf)
        tmp.replace(target)
        return size
    except Exception:
        tmp.unlink(missing_ok=True)
        raise


def build_avatar_video_body(
    avatar_id: str,
    *,
    chunk_text: Optional[str] = None,
    audio_source: Optional[str] = None,
) -> dict:
    """PR DZ — pure body builder for ``POST /v1/avatar_videos``.

    Exactly one of ``chunk_text`` / ``audio_source`` must be set.
    The ``audio_source`` path is what the PR DY probe validated
    (42s audio, no truncation) and what PR EA will wire into the
    Long Ad orchestrator for the single-pass rewrite.
    """
    if (chunk_text is None) == (audio_source is None):
        raise ValueError(
            "build_avatar_video_body requires exactly one of "
            "chunk_text or audio_source"
        )
    if audio_source is not None:
        speech_block: dict = {"type": "audio", "audio": audio_source}
    else:
        speech_block = {"type": "text", "text": chunk_text}
    return {
        "model": _AVATAR_VIDEO_MODEL,
        "avatar": {"type": "custom", "avatarId": avatar_id},
        "speech": speech_block,
    }


def _render_chunk_real(
    avatar_id: str,
    target: Path,
    settings: Settings,
    *,
    chunk_text: Optional[str] = None,
    audio_source: Optional[str] = None,
) -> Optional[str]:
    """Real-mode single-chunk render via avatar_videos. Returns the
    task_id on success; raises RuntimeError on any failure path so
    the orchestrator can surface a clean error per chunk.

    PR DZ — Accepts EITHER ``chunk_text`` (Runway TTSes the text
    using the avatar's bound voice, 300-char cap applies) OR
    ``audio_source`` (a ``data:audio/...;base64,…`` data URI or a
    URL — Runway lip-syncs the avatar to the supplied audio,
    duration-only gated). Exactly one must be provided. The
    audio path was validated end-to-end in the PR DY probe at
    42s/no truncation; PR EA wires it through the orchestrator
    for the single-pass Long Ad rewrite. Today the orchestrator
    still calls with ``chunk_text`` — the audio branch is
    plumbing-only.
    """
    body = build_avatar_video_body(
        avatar_id, chunk_text=chunk_text, audio_source=audio_source,
    )
    create_url = f"{settings.runway_api_base}/v1/avatar_videos"
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(create_url, headers=_runway_headers(settings), json=body)
        if resp.status_code != 200:
            raise RuntimeError(
                f"avatar_videos rejected: {resp.status_code} {resp.text[:200]}"
            )
        created = resp.json()
    task_id = created.get("id")
    if not task_id:
        raise RuntimeError(f"avatar_videos missing task id: {created}")

    deadline = time.time() + _POLL_DEADLINE_S
    final: Optional[dict] = None
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
                raise RuntimeError(f"avatar_videos task {status}: {reason}")
            time.sleep(_POLL_INTERVAL_S)
    if not final:
        raise RuntimeError(
            f"avatar_videos task {task_id} timed out after "
            f"{int(_POLL_DEADLINE_S)}s"
        )

    output = final.get("output")
    out_url: Optional[str] = None
    if isinstance(output, list):
        for v in output:
            if isinstance(v, str):
                out_url = v
                break
    elif isinstance(output, str):
        out_url = output
    if not out_url:
        raise RuntimeError("avatar_videos task produced no output url")

    _download_chunk(out_url, target)
    return task_id


def _render_chunk_mock(chunk_text: str, target: Path, idx: int) -> None:
    """Mock-mode placeholder: ffmpeg-lavfi 4s 1088×704 silent clip
    with the chunk index + a short text preview drawn over it.
    Matches the dim of real gwm1_avatars output so concat stays
    clean. Preview lets the operator visually tell mock chunks
    apart in `data/long_ad/` without watching audio.
    """
    label = f"chunk {idx + 1}"
    raw_label = label.replace(":", " ").replace("'", " ")
    label_for_filter = raw_label.replace(",", " ")
    # First ~30 chars of the chunk text — visually distinguishes
    # mock chunks. Strip ffmpeg-special chars (single quote,
    # colon, comma) so the drawtext filter doesn't choke.
    preview = (chunk_text or "")[:30]
    preview = preview.replace("'", " ").replace(":", " ").replace(",", " ")
    duration = 4
    cmd = [
        "ffmpeg",
        "-y",
        "-f", "lavfi",
        "-i", f"color=size=1088x704:rate=30:color=0x1a1a2e:duration={duration}",
        "-f", "lavfi",
        "-i", f"anullsrc=channel_layout=stereo:sample_rate=48000",
        "-vf",
        (
            f"drawtext=text='{label_for_filter}':fontcolor=white:fontsize=64:"
            "x=(w-text_w)/2:y=(h-text_h)/2-40,"
            f"drawtext=text='{preview}':fontcolor=0xa9a9a9:fontsize=22:"
            "x=(w-text_w)/2:y=(h-text_h)/2+40"
        ),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-shortest",
        "-t", str(duration),
        str(target),
    ]
    result = subprocess.run(
        cmd, capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        stderr = (result.stderr or "").strip()[-300:]
        raise RuntimeError(f"ffmpeg lavfi placeholder failed: {stderr}")


def generate_long_ad(
    *,
    avatar_id: str,
    script: str,
    campaign_id: str,
    output_id: str,
    settings: Settings,
) -> LongAdResult:
    """Top-level orchestrator. Caller is expected to have:

    - validated the avatar is ready,
    - validated the script length (>0 and ≤_LONG_SCRIPT_MAX_CHARS).

    Returns a LongAdResult. Never raises in normal operation — the
    caller inspects ``result.status`` and maps to HTTP.
    """
    if not is_ffmpeg_available():
        return LongAdResult(
            status="unavailable",
            error="ffmpeg not found on PATH",
            mock_mode=settings.runway_mock,
        )
    if not script or not script.strip():
        return LongAdResult(
            status="failed",
            error="script is empty",
            mock_mode=settings.runway_mock,
        )
    if len(script) > _LONG_SCRIPT_MAX_CHARS:
        return LongAdResult(
            status="failed",
            error=(
                f"script exceeds the {_LONG_SCRIPT_MAX_CHARS}-char "
                f"long-ad cap ({len(script)} chars). Trim and retry."
            ),
            mock_mode=settings.runway_mock,
        )

    chunks = chunk_script(script)
    if not chunks:
        return LongAdResult(
            status="failed",
            error="script produced zero chunks after stripping",
            mock_mode=settings.runway_mock,
        )

    chunk_paths: list[Path] = []
    task_ids: list[str] = []
    for idx, chunk_text in enumerate(chunks):
        target = chunk_path(settings, campaign_id, output_id, idx)
        try:
            if settings.runway_mock:
                # Mock path doesn't use chunk_text for audio — placeholder
                # is silent — but we still want the chunk index drawn
                # over the placeholder so the operator can tell the
                # chunks apart in the cached per-chunk MP4s.
                _render_chunk_mock(chunk_text, target, idx)
            else:
                tid = _render_chunk_real(
                    avatar_id, target, settings,
                    chunk_text=chunk_text,
                )
                if tid:
                    task_ids.append(tid)
        except (RuntimeError, httpx.HTTPError) as exc:
            # Clean up any chunk files we already wrote — the
            # router won't get a partial-success result.
            for cleanup in chunk_paths:
                cleanup.unlink(missing_ok=True)
            target.unlink(missing_ok=True)
            return LongAdResult(
                status="failed",
                error=(
                    f"chunk {idx + 1}/{len(chunks)} failed: {exc!s}"
                )[:400],
                mock_mode=settings.runway_mock,
            )
        chunk_paths.append(target)

    return LongAdResult(
        status="ok",
        chunk_paths=chunk_paths,
        chunk_count=len(chunk_paths),
        duration_estimate=estimate_runtime(chunks),
        task_ids=task_ids,
        mock_mode=settings.runway_mock,
    )


def cleanup_chunks(chunk_paths: list[Path]) -> None:
    """Delete the per-chunk MP4 files after a successful stitch.
    Best-effort — never raises. Called by the router post-stitch so
    `data/long_ad/` doesn't accumulate orphan chunks."""
    for p in chunk_paths:
        try:
            p.unlink(missing_ok=True)
        except OSError:
            logger.warning("could not delete chunk file: %s", p)


def stitch_chunks(
    chunk_paths: list[Path],
    target: Path,
    *,
    target_w: int = 1088,
    target_h: int = 704,
    fps: int = 30,
    timeout: float = 240.0,
) -> tuple[bool, Optional[str]]:
    """Stitch N chunk MP4s into one MP4 at ``target`` via ffmpeg's
    filter_complex concat (audio preserved). Mirrors
    `VideoFinisher.build_dialogue_scene` filter graph but writes to
    a caller-supplied target path instead of the dialogue canonical.

    Returns ``(ok, error_msg)``. Best-effort: writes to a `.tmp`
    sibling then atomically replaces on success.
    """
    if not is_ffmpeg_available():
        return False, "ffmpeg not found on PATH"
    if not chunk_paths:
        return False, "no chunks to stitch"
    for p in chunk_paths:
        if not p.exists():
            return False, f"missing chunk input: {p.name}"

    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(".mp4.tmp")

    norm_filters: list[str] = []
    concat_in = ""
    for idx in range(len(chunk_paths)):
        norm_filters.append(
            f"[{idx}:v]scale={target_w}:{target_h}:force_original_aspect_ratio=increase,"
            f"crop={target_w}:{target_h},setsar=1,fps={fps}[v{idx}]"
        )
        norm_filters.append(
            f"[{idx}:a]aresample=async=1,asetpts=N/SR/TB[a{idx}]"
        )
        concat_in += f"[v{idx}][a{idx}]"
    filter_complex = (
        ";".join(norm_filters)
        + f";{concat_in}concat=n={len(chunk_paths)}:v=1:a=1[outv][outa]"
    )

    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    for p in chunk_paths:
        cmd += ["-i", str(p)]
    cmd += [
        "-filter_complex", filter_complex,
        "-map", "[outv]",
        "-map", "[outa]",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        "-f", "mp4",
        str(tmp),
    ]
    try:
        logger.info(
            "long-ad ffmpeg stitch target=%s chunks=%d",
            target.name, len(chunk_paths),
        )
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout,
        )
        if result.returncode != 0:
            stderr = (result.stderr or "").strip()[-400:]
            tmp.unlink(missing_ok=True)
            return False, f"ffmpeg rc={result.returncode}: {stderr}"
        if not tmp.exists():
            return False, "ffmpeg ok but output missing"
        tmp.replace(target)
        return True, None
    except subprocess.TimeoutExpired:
        tmp.unlink(missing_ok=True)
        return False, f"ffmpeg timed out after {timeout}s"
    except OSError as exc:
        tmp.unlink(missing_ok=True)
        return False, f"ffmpeg OSError: {exc!s}"
