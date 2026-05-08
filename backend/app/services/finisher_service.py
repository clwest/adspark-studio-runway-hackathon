import logging
import shutil
import subprocess
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


@dataclass
class FinishResult:
    status: str  # "ok" | "failed" | "unavailable"
    output_path: Optional[Path] = None
    error: Optional[str] = None
    fmt: str = LANDSCAPE


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
