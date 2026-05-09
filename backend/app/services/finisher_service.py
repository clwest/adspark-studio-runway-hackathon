import logging
import shutil
import subprocess
import textwrap
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

logger = logging.getLogger(__name__)

# drawtext requires either a font name (via fontconfig) or an explicit
# font file. We prefer an explicit file so the pipeline doesn't depend
# on fontconfig being correctly set up.
_FONT_CANDIDATES = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
]

# Per-platform target dimensions for the Campaign Pack (PR B).
# Source video is typically 16:9 1280x720 (Runway Gen-4 Turbo default). For
# Reels and Square we cover-fit (scale up so the target box is fully covered)
# then center-crop — the same strategy social platforms apply when re-encoding.
FORMAT_DIMS: dict[str, tuple[int, int]] = {
    "landscape": (1280, 720),
    "reels": (720, 1280),
    "square": (960, 960),
}

LANDSCAPE = "landscape"


def supported_formats() -> Iterable[str]:
    return tuple(FORMAT_DIMS.keys())


def _resolve_font() -> Optional[str]:
    for f in _FONT_CANDIDATES:
        if Path(f).exists():
            return f
    return None


def is_ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def is_ffprobe_available() -> bool:
    return shutil.which("ffprobe") is not None


def _caption_style_for_backdrop(backdrop_color: str) -> dict:
    """PR AM — local indirection so the finisher doesn't need to know
    about ``services.color_utils`` at module import time. Resolves at
    call time and degrades gracefully if the import fails (returns the
    legacy PR AH default style).
    """
    try:
        from .color_utils import caption_style_for_backdrop  # noqa: WPS433
        return caption_style_for_backdrop(backdrop_color)
    except Exception:  # pragma: no cover — defensive
        logger.warning("caption_style_for_backdrop unavailable; using dark default")
        return {"font_color": "white", "box_color": "black", "box_alpha": 0.6}


def _wrap_caption_text(text: str, max_chars: int = 28) -> str:
    """PR AH — collapse whitespace and wrap a caption string into
    short lines that fit a 720-wide vertical frame at fontsize 36.
    ``\\n``-joined output reads cleanly when handed to ffmpeg's
    ``drawtext`` via ``textfile=``. Returns an empty string for blank
    or whitespace-only input so callers can decide whether to skip
    the segment entirely.
    """
    if not text:
        return ""
    flat = " ".join(text.split())
    if not flat:
        return ""
    return "\n".join(textwrap.wrap(flat, width=max_chars)) or flat


def probe_duration(path: Path) -> Optional[float]:
    """PR AH — return the duration in seconds of an MP4 (or any media
    file ffprobe understands), or None when ffprobe is missing / the
    file is unreadable / the duration field is absent. Used by the
    captioned reels pipeline to derive per-line timing schedules from
    cached dialogue line clips.
    """
    if not is_ffprobe_available() or not path.exists():
        return None
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    except (subprocess.TimeoutExpired, OSError):
        return None
    if result.returncode != 0:
        return None
    raw = (result.stdout or "").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def has_audio_stream(path: Path) -> bool:
    """PR S — return True iff the file at ``path`` has at least one audio
    stream. Uses ffprobe; gracefully returns False when ffprobe is missing
    or the file is unreadable (caller surfaces the right user-facing
    message).
    """
    if not is_ffprobe_available() or not path.exists():
        return False
    cmd = [
        "ffprobe",
        "-v", "error",
        "-select_streams", "a",
        "-show_entries", "stream=codec_type",
        "-of", "csv=p=0",
        str(path),
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
    except (subprocess.TimeoutExpired, OSError):
        return False
    if result.returncode != 0:
        return False
    return "audio" in (result.stdout or "")


@dataclass
class FinishResult:
    status: str  # "ok" | "failed" | "unavailable"
    output_path: Optional[Path] = None
    error: Optional[str] = None
    fmt: str = LANDSCAPE


# PR S — Commercial with Voice result. Mirrors FinishResult so the router
# can surface failures the same way Campaign Pack does, but with its own
# error vocabulary (no_video / no_host / no_audio / unavailable / failed).
@dataclass
class CommercialResult:
    status: str  # "ok" | "no_video" | "no_host" | "no_audio" | "unavailable" | "failed"
    output_path: Optional[Path] = None
    error: Optional[str] = None


class VideoFinisher:
    """Burn-in branded text overlays onto a cached campaign MP4 at one of
    three platform-tuned aspect ratios.

    Outputs land at:
      landscape (1280x720)  -> <data_dir>/finished/<id>-finished.mp4         (legacy)
      reels     (720x1280)  -> <data_dir>/finished/<id>-finished-reels.mp4
      square    (960x960)   -> <data_dir>/finished/<id>-finished-square.mp4

    The legacy landscape filename is preserved so finished MP4s produced
    before PR B remain accessible via path_for(id, "landscape").

    The directory is gitignored via backend/.gitignore (`data/`).
    Never raises — caller inspects FinishResult.
    """

    def __init__(self, data_dir: Path):
        self.dir = data_dir / "finished"
        self.dir.mkdir(parents=True, exist_ok=True)
        self._font = _resolve_font()

    def path_for(self, campaign_id: str, fmt: str = LANDSCAPE) -> Path:
        if fmt == LANDSCAPE:
            return self.dir / f"{campaign_id}-finished.mp4"
        return self.dir / f"{campaign_id}-finished-{fmt}.mp4"

    def has(self, campaign_id: str, fmt: str = LANDSCAPE) -> bool:
        return self.path_for(campaign_id, fmt).exists()

    def existing_formats(self, campaign_id: str) -> dict[str, Path]:
        out: dict[str, Path] = {}
        for fmt in FORMAT_DIMS:
            p = self.path_for(campaign_id, fmt)
            if p.exists():
                out[fmt] = p
        return out

    # ---- PR S — Commercial with Voice ------------------------------

    def commercial_path_for(self, campaign_id: str) -> Path:
        """Where the voiced-commercial MP4 lives (gitignored under
        backend/data/finished/). Distinct filename so it doesn't collide
        with the Campaign Pack outputs.
        """
        return self.dir / f"{campaign_id}-commercial-voice.mp4"

    def has_commercial_with_voice(self, campaign_id: str) -> bool:
        return self.commercial_path_for(campaign_id).exists()

    def build_commercial_with_voice(
        self,
        campaign_id: str,
        video_path: Path,
        host_path: Path,
        *,
        loop_visual: bool = True,
        timeout: float = 120.0,
    ) -> CommercialResult:
        """Combine the silent campaign visual (input A) with the audio
        track from the Avatar Host Clip (input B) into a single MP4.

        PR X — `loop_visual=True` (the default) loops the visual via
        `-stream_loop -1` so the full host audio plays. ``-shortest``
        with an infinite video stream means the output ends when the
        host audio finishes (~11s on a real Brewster pitch instead of
        the previous ~5s trim). Visual is re-encoded with libx264 in
        this mode since `-stream_loop` doesn't compose with `-c:v copy`.

        `loop_visual=False` falls back to PR S's original strategy:
        ``-c:v copy -c:a aac -shortest`` — output trims to the visual
        cut length. Faster (no re-encode) but the user only hears the
        first ~5 s of the spoken pitch.

        Preconditions are caller-checked (router emits 409s); this
        method assumes both files exist + host has audio.
        """
        if not is_ffmpeg_available():
            return CommercialResult(
                status="unavailable",
                error="ffmpeg not found on PATH",
            )
        if not video_path.exists():
            return CommercialResult(
                status="no_video",
                error=f"visual video missing: {video_path.name}",
            )
        if not host_path.exists():
            return CommercialResult(
                status="no_host",
                error=f"host clip missing: {host_path.name}",
            )
        if not has_audio_stream(host_path):
            return CommercialResult(
                status="no_audio",
                error="host clip has no audio stream",
            )

        target = self.commercial_path_for(campaign_id)
        tmp = target.with_suffix(".mp4.tmp")

        if loop_visual:
            # PR X — loop visual until host audio ends. Forces a video
            # re-encode (libx264) since -stream_loop doesn't compose
            # with -c:v copy. -shortest with an infinitely-looped video
            # input means output duration = host audio duration.
            cmd = [
                "ffmpeg",
                "-y",
                "-loglevel", "error",
                "-stream_loop", "-1",
                "-i", str(video_path),
                "-i", str(host_path),
                "-map", "0:v:0",
                "-map", "1:a:0",
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "23",
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-b:a", "192k",
                "-shortest",
                "-movflags", "+faststart",
                "-f", "mp4",
                str(tmp),
            ]
        else:
            # PR S — copy visual stream verbatim, trim audio to visual
            # length. Faster but the user only hears the first ~5 s of
            # the spoken pitch.
            cmd = [
                "ffmpeg",
                "-y",
                "-loglevel", "error",
                "-i", str(video_path),
                "-i", str(host_path),
                "-map", "0:v:0",
                "-map", "1:a:0",
                "-c:v", "copy",
                "-c:a", "aac",
                "-b:a", "192k",
                "-shortest",
                "-movflags", "+faststart",
                "-f", "mp4",
                str(tmp),
            ]
        try:
            logger.info(
                "running ffmpeg commercial-with-voice for campaign %s",
                campaign_id,
            )
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=timeout
            )
            if result.returncode != 0:
                stderr = (result.stderr or "").strip()[-300:]
                tmp.unlink(missing_ok=True)
                # Re-encode fallback. PR X — when loop_visual=True the
                # primary path already re-encodes, so this fallback
                # mostly handles non-loop cases where -c:v copy fails on
                # unusual codec parameters. Carry the loop flag through
                # so the fallback's behaviour matches what the caller
                # asked for.
                reencode_cmd = ["ffmpeg", "-y", "-loglevel", "error"]
                if loop_visual:
                    reencode_cmd += ["-stream_loop", "-1"]
                reencode_cmd += [
                    "-i", str(video_path),
                    "-i", str(host_path),
                    "-map", "0:v:0",
                    "-map", "1:a:0",
                    "-c:v", "libx264",
                    "-preset", "veryfast",
                    "-crf", "23",
                    "-pix_fmt", "yuv420p",
                    "-c:a", "aac",
                    "-b:a", "192k",
                    "-shortest",
                    "-movflags", "+faststart",
                    "-f", "mp4",
                    str(tmp),
                ]
                result = subprocess.run(
                    reencode_cmd, capture_output=True, text=True, timeout=timeout * 2,
                )
                if result.returncode != 0:
                    stderr = (result.stderr or "").strip()[-300:]
                    tmp.unlink(missing_ok=True)
                    return CommercialResult(
                        status="failed",
                        error=f"ffmpeg rc={result.returncode}: {stderr}",
                    )
            if not tmp.exists():
                return CommercialResult(
                    status="failed",
                    error="ffmpeg ok but output missing",
                )
            tmp.replace(target)
            return CommercialResult(status="ok", output_path=target)
        except subprocess.TimeoutExpired:
            tmp.unlink(missing_ok=True)
            return CommercialResult(
                status="failed",
                error=f"ffmpeg timed out after {timeout}s",
            )
        except OSError as exc:
            tmp.unlink(missing_ok=True)
            return CommercialResult(
                status="failed",
                error=f"io error: {exc}"[:200],
            )
        except Exception as exc:
            tmp.unlink(missing_ok=True)
            logger.exception("unexpected ffmpeg error (commercial-with-voice)")
            return CommercialResult(
                status="failed",
                error=f"unexpected: {exc!s}"[:200],
            )

    # ---- PR Z — Storyboard Commercial Builder -----------------------

    def storyboard_dir(self) -> Path:
        d = self.dir.parent / "storyboard"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def storyboard_shot_path(self, campaign_id: str, shot_id: str) -> Path:
        return self.storyboard_dir() / f"{campaign_id}-{shot_id}.mp4"

    def storyboard_path(self, campaign_id: str) -> Path:
        """Where the stitched (silent) storyboard MP4 lives."""
        return self.dir / f"{campaign_id}-storyboard.mp4"

    def has_storyboard(self, campaign_id: str) -> bool:
        return self.storyboard_path(campaign_id).exists()

    def storyboard_voiced_path(self, campaign_id: str) -> Path:
        """Where the voiced storyboard MP4 lives."""
        return self.dir / f"{campaign_id}-storyboard-voice.mp4"

    def has_storyboard_voiced(self, campaign_id: str) -> bool:
        return self.storyboard_voiced_path(campaign_id).exists()

    def build_storyboard(
        self,
        campaign_id: str,
        shot_paths: list[Path],
        *,
        target_w: int = 1280,
        target_h: int = 720,
        fps: int = 30,
        timeout: float = 180.0,
    ) -> CommercialResult:
        """PR Z — concat N cached shot MP4s into a single landscape MP4
        via ffmpeg's filter_complex `concat` filter. Each input is
        normalised to the target dims / fps / square pixels first so
        the output has a uniform stream regardless of any small
        differences across Runway clips.

        Mirrors `build_commercial_with_voice` in shape: never raises,
        returns a `CommercialResult` whose status the caller maps to
        an HTTP response. Output is **silent** — voiced storyboard is
        a separate ffmpeg pass.
        """
        if not is_ffmpeg_available():
            return CommercialResult(
                status="unavailable",
                error="ffmpeg not found on PATH",
            )
        if not shot_paths:
            return CommercialResult(
                status="failed",
                error="no shot inputs supplied",
            )
        for p in shot_paths:
            if not p.exists():
                return CommercialResult(
                    status="failed",
                    error=f"missing shot input: {p.name}",
                )

        target = self.storyboard_path(campaign_id)
        tmp = target.with_suffix(".mp4.tmp")

        # Build filter_complex: normalise each input then concat.
        norm_filters = []
        concat_in = ""
        for idx in range(len(shot_paths)):
            norm_filters.append(
                f"[{idx}:v]scale={target_w}:{target_h}:force_original_aspect_ratio=increase,"
                f"crop={target_w}:{target_h},setsar=1,fps={fps}[v{idx}]"
            )
            concat_in += f"[v{idx}]"
        filter_complex = (
            ";".join(norm_filters)
            + f";{concat_in}concat=n={len(shot_paths)}:v=1:a=0[outv]"
        )

        cmd = ["ffmpeg", "-y", "-loglevel", "error"]
        for p in shot_paths:
            cmd += ["-i", str(p)]
        cmd += [
            "-filter_complex", filter_complex,
            "-map", "[outv]",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "23",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            "-f", "mp4",
            str(tmp),
        ]
        try:
            logger.info(
                "ffmpeg storyboard concat campaign=%s shots=%d",
                campaign_id, len(shot_paths),
            )
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=timeout
            )
            if result.returncode != 0:
                stderr = (result.stderr or "").strip()[-400:]
                tmp.unlink(missing_ok=True)
                return CommercialResult(
                    status="failed",
                    error=f"ffmpeg rc={result.returncode}: {stderr}",
                )
            if not tmp.exists():
                return CommercialResult(
                    status="failed",
                    error="ffmpeg ok but storyboard output missing",
                )
            tmp.replace(target)
            return CommercialResult(status="ok", output_path=target)
        except subprocess.TimeoutExpired:
            tmp.unlink(missing_ok=True)
            return CommercialResult(
                status="failed",
                error=f"ffmpeg timed out after {timeout}s",
            )
        except OSError as exc:
            tmp.unlink(missing_ok=True)
            return CommercialResult(
                status="failed",
                error=f"io error: {exc}"[:200],
            )
        except Exception as exc:
            tmp.unlink(missing_ok=True)
            logger.exception("unexpected ffmpeg error (storyboard concat)")
            return CommercialResult(
                status="failed",
                error=f"unexpected: {exc!s}"[:200],
            )

    # ---- PR AF — Dialogue Scene Builder ----------------------------

    def dialogue_dir(self) -> Path:
        d = self.dir.parent / "dialogue"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def dialogue_line_path(self, campaign_id: str, line_id: str) -> Path:
        return self.dialogue_dir() / f"{campaign_id}-{line_id}.mp4"

    def dialogue_scene_path(self, campaign_id: str) -> Path:
        return self.dir / f"{campaign_id}-dialogue-scene.mp4"

    def has_dialogue_scene(self, campaign_id: str) -> bool:
        return self.dialogue_scene_path(campaign_id).exists()

    def build_dialogue_scene(
        self,
        campaign_id: str,
        line_paths: "list[Path]",
        *,
        target_w: int = 1088,
        target_h: int = 704,
        fps: int = 30,
        timeout: float = 240.0,
    ) -> CommercialResult:
        """PR AF — concat N talking-avatar line clips into a single
        sequential dialogue MP4 via ffmpeg's filter_complex `concat`
        filter with **audio preserved** (a=1). Each line is normalised
        to the avatar_videos native dim (1088×704) at 30 fps so a
        future polish pass with mixed-source clips would still concat
        cleanly, even though all V1 inputs share the gwm1_avatars
        dimensions.

        Outputs h264 video + AAC audio. Mirrors `build_storyboard` in
        shape but keeps the audio track because dialogue lines carry
        the spokesperson speech.
        """
        if not is_ffmpeg_available():
            return CommercialResult(
                status="unavailable",
                error="ffmpeg not found on PATH",
            )
        if not line_paths:
            return CommercialResult(
                status="failed",
                error="no dialogue line inputs supplied",
            )
        for p in line_paths:
            if not p.exists():
                return CommercialResult(
                    status="failed",
                    error=f"missing dialogue line input: {p.name}",
                )

        target = self.dialogue_scene_path(campaign_id)
        tmp = target.with_suffix(".mp4.tmp")

        # Normalise each input then concat with audio.
        norm_filters = []
        concat_in = ""
        for idx in range(len(line_paths)):
            norm_filters.append(
                f"[{idx}:v]scale={target_w}:{target_h}:force_original_aspect_ratio=increase,"
                f"crop={target_w}:{target_h},setsar=1,fps={fps}[v{idx}]"
            )
            # Re-encode + resample audio so silent placeholders + real
            # AAC tracks share a uniform stream the concat filter accepts.
            norm_filters.append(
                f"[{idx}:a]aresample=async=1,asetpts=N/SR/TB[a{idx}]"
            )
            concat_in += f"[v{idx}][a{idx}]"
        filter_complex = (
            ";".join(norm_filters)
            + f";{concat_in}concat=n={len(line_paths)}:v=1:a=1[outv][outa]"
        )

        cmd = ["ffmpeg", "-y", "-loglevel", "error"]
        for p in line_paths:
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
                "ffmpeg dialogue stitch campaign=%s lines=%d",
                campaign_id, len(line_paths),
            )
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=timeout
            )
            if result.returncode != 0:
                stderr = (result.stderr or "").strip()[-400:]
                tmp.unlink(missing_ok=True)
                return CommercialResult(
                    status="failed",
                    error=f"ffmpeg rc={result.returncode}: {stderr}",
                )
            if not tmp.exists():
                return CommercialResult(
                    status="failed",
                    error="ffmpeg ok but dialogue scene output missing",
                )
            tmp.replace(target)
            return CommercialResult(status="ok", output_path=target)
        except subprocess.TimeoutExpired:
            tmp.unlink(missing_ok=True)
            return CommercialResult(
                status="failed",
                error=f"ffmpeg timed out after {timeout}s",
            )
        except OSError as exc:
            tmp.unlink(missing_ok=True)
            return CommercialResult(
                status="failed",
                error=f"io error: {exc}"[:200],
            )
        except Exception as exc:
            tmp.unlink(missing_ok=True)
            logger.exception("unexpected ffmpeg error (dialogue stitch)")
            return CommercialResult(
                status="failed",
                error=f"unexpected: {exc!s}"[:200],
            )

    # ---- PR AG — Vertical / Reels export ---------------------------

    def spokesperson_reels_path(self, campaign_id: str) -> Path:
        """Where the 720x1280 vertical Spokesperson Ad lives."""
        return self.dir / f"{campaign_id}-spokesperson-reels.mp4"

    def has_spokesperson_reels(self, campaign_id: str) -> bool:
        return self.spokesperson_reels_path(campaign_id).exists()

    def dialogue_scene_reels_path(self, campaign_id: str) -> Path:
        """Where the 720x1280 vertical Dialogue Scene lives."""
        return self.dir / f"{campaign_id}-dialogue-scene-reels.mp4"

    def has_dialogue_scene_reels(self, campaign_id: str) -> bool:
        return self.dialogue_scene_reels_path(campaign_id).exists()

    def build_reels_export(
        self,
        source_path: Path,
        target_path: Path,
        *,
        backdrop_color: str = "0x0b1220",
        target_w: int = 720,
        target_h: int = 1280,
        captions: Optional[list[tuple[float, float, str]]] = None,
        caption_max_chars: int = 28,
        caption_style: Optional[dict] = None,
        timeout: float = 120.0,
    ) -> CommercialResult:
        """PR AG — pad/letterbox an existing horizontal MP4 into a 720x1280
        vertical export suitable for TikTok / Reels / Shorts. Aspect-preserve
        scale-to-fit then pad the remaining bars with ``backdrop_color``.

        Output is h264 + AAC. Audio is re-encoded so the muxer always has a
        well-formed AAC track even when the source's audio params drift
        (silent placeholders, weird sample rates, etc). Duration matches the
        source within ffmpeg's normal frame-boundary precision.

        Backdrop default is a dark slate that reads as intentional letterbox
        on any avatar/dialogue clip; callers can pass an explicit ffmpeg
        color spec (``"0xRRGGBB"`` or a named colour) when a brand colour
        is available.

        PR AH — when ``captions`` is supplied, each ``(start, end, text)``
        triple becomes a chained ffmpeg ``drawtext`` filter with an
        ``enable=between(t,start,end)`` time gate. Captions are word-wrapped
        with ``textwrap`` to ``caption_max_chars`` per line so they fit
        comfortably inside a 720-wide vertical frame at fontsize 36; the
        block sits in the bottom-safe region with a translucent black box
        so the talking head above stays readable. When the system has no
        usable font we silently skip the captions — never blocks the export.

        PR AM — caption styling is contrast-aware. ``caption_style`` is
        a dict ``{font_color, box_color, box_alpha}``; when omitted the
        style is auto-derived from ``backdrop_color`` so captions stay
        readable on light brand backdrops (black text on white box) and
        on dark / unset backdrops (white text on black box, the original
        PR AH default).

        Never raises — caller inspects the returned CommercialResult.
        """
        if not is_ffmpeg_available():
            return CommercialResult(
                status="unavailable",
                error="ffmpeg not found on PATH",
            )
        if not source_path.exists():
            return CommercialResult(
                status="no_video",
                error=f"source missing: {source_path.name}",
            )

        target_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = target_path.with_suffix(".mp4.tmp")

        # scale=…:force_original_aspect_ratio=decrease keeps the source
        # aspect; pad fills the remaining bars centered. setsar=1 forces
        # square pixels so downstream players don't apply a stretch hint.
        filter_parts = [
            f"scale={target_w}:{target_h}:force_original_aspect_ratio=decrease",
            f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2:color={backdrop_color}",
            "setsar=1",
        ]

        # PR AH — caption layer. Each segment becomes its own drawtext
        # node; we write the text to a file so ffmpeg's filter parser
        # never has to escape ' \ : etc inside the user text. Files live
        # in self.dir under a hidden prefix so they don't clutter the
        # finished/ ledger and are wiped via the try/finally below.
        # PR AM — caption styling is contrast-aware. Caller can pass an
        # explicit caption_style dict; otherwise we derive it from the
        # backdrop colour via color_utils.caption_style_for_backdrop.
        caption_files: list[Path] = []
        if captions:
            if self._font:
                style = caption_style or _caption_style_for_backdrop(backdrop_color)
                font_color = str(style.get("font_color", "white"))
                box_color = str(style.get("box_color", "black"))
                box_alpha = float(style.get("box_alpha", 0.6))
                font_esc = self._font.replace(":", r"\:")
                stem = target_path.stem
                for idx, (start, end, raw_text) in enumerate(captions):
                    wrapped = _wrap_caption_text(raw_text, caption_max_chars)
                    if not wrapped:
                        continue
                    cf = self.dir / f".{stem}-cap-{idx}.txt"
                    cf.write_text(wrapped, encoding="utf-8")
                    caption_files.append(cf)
                    cf_esc = str(cf).replace(":", r"\:")
                    # Bottom-safe placement: leaves ~110 px of breathing
                    # room beneath the caption block on a 1280-tall frame
                    # (TikTok safe zone for the like / comment column).
                    # box=1 + boxborderw=18 keeps text readable; the
                    # box/text colours flex by backdrop luminance via
                    # PR AM's caption_style_for_backdrop helper.
                    filter_parts.append(
                        "drawtext="
                        f"fontfile='{font_esc}':"
                        f"textfile='{cf_esc}':"
                        "fontsize=36:"
                        f"fontcolor={font_color}:"
                        "line_spacing=8:"
                        "x=(w-text_w)/2:"
                        "y=h-text_h-110:"
                        "box=1:"
                        f"boxcolor={box_color}@{box_alpha:.2f}:"
                        "boxborderw=18:"
                        f"enable='between(t\\,{start:.3f}\\,{end:.3f})'"
                    )
            else:
                logger.warning(
                    "reels captions skipped: no usable system font (font candidates exhausted)"
                )

        vf = ",".join(filter_parts)

        cmd = [
            "ffmpeg",
            "-y",
            "-loglevel", "error",
            "-i", str(source_path),
            "-vf", vf,
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
        if not has_audio_stream(source_path):
            # No audio on the source (e.g. ffmpeg lavfi mock placeholder
            # without an audio stream) — synthesise a silent AAC track so
            # the output keeps the h264 + AAC contract regardless of what
            # the source carried.
            cmd = [
                "ffmpeg",
                "-y",
                "-loglevel", "error",
                "-i", str(source_path),
                "-f", "lavfi",
                "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
                "-vf", vf,
                "-map", "0:v:0",
                "-map", "1:a:0",
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "23",
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-b:a", "192k",
                "-shortest",
                "-movflags", "+faststart",
                "-f", "mp4",
                str(tmp),
            ]

        try:
            logger.info(
                "ffmpeg reels export src=%s -> %s captions=%d",
                source_path.name, target_path.name, len(caption_files),
            )
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=timeout
            )
            if result.returncode != 0:
                stderr = (result.stderr or "").strip()[-300:]
                tmp.unlink(missing_ok=True)
                return CommercialResult(
                    status="failed",
                    error=f"ffmpeg rc={result.returncode}: {stderr}",
                )
            if not tmp.exists():
                return CommercialResult(
                    status="failed",
                    error="ffmpeg ok but reels output missing",
                )
            tmp.replace(target_path)
            return CommercialResult(status="ok", output_path=target_path)
        except subprocess.TimeoutExpired:
            tmp.unlink(missing_ok=True)
            return CommercialResult(
                status="failed",
                error=f"ffmpeg timed out after {timeout}s",
            )
        except OSError as exc:
            tmp.unlink(missing_ok=True)
            return CommercialResult(
                status="failed",
                error=f"io error: {exc}"[:200],
            )
        except Exception as exc:
            tmp.unlink(missing_ok=True)
            logger.exception("unexpected ffmpeg error (reels export)")
            return CommercialResult(
                status="failed",
                error=f"unexpected: {exc!s}"[:200],
            )
        finally:
            for cf in caption_files:
                cf.unlink(missing_ok=True)

    def build_voiced_storyboard(
        self,
        campaign_id: str,
        storyboard_path: Path,
        host_path: Path,
        *,
        timeout: float = 180.0,
    ) -> CommercialResult:
        """PR Z — loop the stitched storyboard visual under the Avatar
        Host Clip audio. Same -stream_loop / -shortest strategy PR X
        uses for the single-cut voiced commercial. Output ends when
        host audio ends; storyboard visual loops if shorter.

        Caller is responsible for confirming both inputs exist + host
        has audio.
        """
        if not is_ffmpeg_available():
            return CommercialResult(
                status="unavailable",
                error="ffmpeg not found on PATH",
            )
        if not storyboard_path.exists():
            return CommercialResult(
                status="no_video",
                error=f"storyboard missing: {storyboard_path.name}",
            )
        if not host_path.exists():
            return CommercialResult(
                status="no_host",
                error=f"host clip missing: {host_path.name}",
            )
        if not has_audio_stream(host_path):
            return CommercialResult(
                status="no_audio",
                error="host clip has no audio stream",
            )

        target = self.storyboard_voiced_path(campaign_id)
        tmp = target.with_suffix(".mp4.tmp")
        cmd = [
            "ffmpeg",
            "-y",
            "-loglevel", "error",
            "-stream_loop", "-1",
            "-i", str(storyboard_path),
            "-i", str(host_path),
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "23",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "192k",
            "-shortest",
            "-movflags", "+faststart",
            "-f", "mp4",
            str(tmp),
        ]
        try:
            logger.info(
                "ffmpeg voiced storyboard campaign=%s",
                campaign_id,
            )
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=timeout
            )
            if result.returncode != 0:
                stderr = (result.stderr or "").strip()[-400:]
                tmp.unlink(missing_ok=True)
                return CommercialResult(
                    status="failed",
                    error=f"ffmpeg rc={result.returncode}: {stderr}",
                )
            if not tmp.exists():
                return CommercialResult(
                    status="failed",
                    error="ffmpeg ok but voiced storyboard output missing",
                )
            tmp.replace(target)
            return CommercialResult(status="ok", output_path=target)
        except subprocess.TimeoutExpired:
            tmp.unlink(missing_ok=True)
            return CommercialResult(
                status="failed",
                error=f"ffmpeg timed out after {timeout}s",
            )
        except OSError as exc:
            tmp.unlink(missing_ok=True)
            return CommercialResult(
                status="failed",
                error=f"io error: {exc}"[:200],
            )
        except Exception as exc:
            tmp.unlink(missing_ok=True)
            logger.exception("unexpected ffmpeg error (voiced storyboard)")
            return CommercialResult(
                status="failed",
                error=f"unexpected: {exc!s}"[:200],
            )

    def finish(
        self,
        campaign_id: str,
        source_path: Path,
        top_text: str,
        bottom_text: str,
        fmt: str = LANDSCAPE,
        timeout: float = 90.0,
    ) -> FinishResult:
        if fmt not in FORMAT_DIMS:
            return FinishResult(
                status="failed",
                error=f"unsupported format: {fmt}",
                fmt=fmt,
            )
        if not is_ffmpeg_available():
            return FinishResult(
                status="unavailable",
                error="ffmpeg not found on PATH",
                fmt=fmt,
            )
        if not source_path.exists():
            return FinishResult(
                status="failed",
                error=f"source not found: {source_path.name}",
                fmt=fmt,
            )
        if not self._font:
            return FinishResult(
                status="failed",
                error="no usable system font found for drawtext",
                fmt=fmt,
            )

        target_w, target_h = FORMAT_DIMS[fmt]
        target = self.path_for(campaign_id, fmt)
        tmp = target.with_suffix(".mp4.tmp")
        # textfile= avoids drawtext escaping headaches with : ' \ %
        top_file = self.dir / f".{campaign_id}-{fmt}-top.txt"
        bot_file = self.dir / f".{campaign_id}-{fmt}-bot.txt"
        try:
            top_file.write_text((top_text or "").strip()[:120], encoding="utf-8")
            bot_file.write_text((bottom_text or "").strip()[:140], encoding="utf-8")

            # Backslash-escape colons in the file paths so ffmpeg's filter
            # parser doesn't treat them as option separators.
            font_esc = self._font.replace(":", r"\:")
            top_esc = str(top_file).replace(":", r"\:")
            bot_esc = str(bot_file).replace(":", r"\:")

            # Cover-fit then center-crop. force_original_aspect_ratio=increase
            # scales the source so it fully covers (target_w, target_h) without
            # distortion; the subsequent crop trims any overflow from the
            # center. This is the same strategy social platforms apply when
            # re-encoding a square upload to vertical, etc.
            scale_crop = (
                f"scale={target_w}:{target_h}:force_original_aspect_ratio=increase,"
                f"crop={target_w}:{target_h}"
            )
            # Drawtext sizes are relative to *output* height (h after the crop),
            # so the overlays look correctly proportioned in every format.
            vf = (
                f"{scale_crop},"
                f"drawtext=fontfile='{font_esc}':textfile='{top_esc}':"
                "fontsize=h*0.06:fontcolor=white:x=(w-text_w)/2:y=h*0.05:"
                "box=1:boxcolor=black@0.55:boxborderw=18,"
                f"drawtext=fontfile='{font_esc}':textfile='{bot_esc}':"
                "fontsize=h*0.05:fontcolor=white:x=(w-text_w)/2:y=h*0.85:"
                "box=1:boxcolor=black@0.55:boxborderw=14"
            )

            cmd = [
                "ffmpeg",
                "-y",
                "-loglevel", "error",
                "-i", str(source_path),
                "-vf", vf,
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "23",
                "-c:a", "copy",
                "-movflags", "+faststart",
                # Force the MP4 muxer because the .mp4.tmp filename otherwise
                # makes ffmpeg infer an unknown format from the .tmp suffix.
                "-f", "mp4",
                str(tmp),
            ]

            logger.info("running ffmpeg finish for campaign %s [%s]", campaign_id, fmt)
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=timeout
            )
            if result.returncode != 0:
                stderr = (result.stderr or "").strip()[-300:]
                tmp.unlink(missing_ok=True)
                return FinishResult(
                    status="failed",
                    error=f"ffmpeg rc={result.returncode}: {stderr}",
                    fmt=fmt,
                )
            if not tmp.exists():
                return FinishResult(
                    status="failed",
                    error="ffmpeg ok but output missing",
                    fmt=fmt,
                )
            tmp.replace(target)
            return FinishResult(status="ok", output_path=target, fmt=fmt)
        except subprocess.TimeoutExpired:
            tmp.unlink(missing_ok=True)
            return FinishResult(
                status="failed",
                error=f"ffmpeg timed out after {timeout}s",
                fmt=fmt,
            )
        except OSError as exc:
            tmp.unlink(missing_ok=True)
            return FinishResult(status="failed", error=f"io error: {exc}"[:200], fmt=fmt)
        except Exception as exc:
            tmp.unlink(missing_ok=True)
            logger.exception("unexpected ffmpeg error")
            return FinishResult(
                status="failed",
                error=f"unexpected: {exc!s}"[:200],
                fmt=fmt,
            )
        finally:
            top_file.unlink(missing_ok=True)
            bot_file.unlink(missing_ok=True)
