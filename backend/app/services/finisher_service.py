import logging
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

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


class VideoFinisher:
    """Burn-in branded text overlays onto a cached campaign MP4.

    Outputs land at <data_dir>/finished/<campaign_id>-finished.mp4.
    The directory is gitignored via backend/.gitignore (`data/`).
    Never raises — caller inspects FinishResult.
    """

    def __init__(self, data_dir: Path):
        self.dir = data_dir / "finished"
        self.dir.mkdir(parents=True, exist_ok=True)
        self._font = _resolve_font()

    def path_for(self, campaign_id: str) -> Path:
        return self.dir / f"{campaign_id}-finished.mp4"

    def has(self, campaign_id: str) -> bool:
        return self.path_for(campaign_id).exists()

    def finish(
        self,
        campaign_id: str,
        source_path: Path,
        top_text: str,
        bottom_text: str,
        timeout: float = 90.0,
    ) -> FinishResult:
        if not is_ffmpeg_available():
            return FinishResult(
                status="unavailable", error="ffmpeg not found on PATH"
            )
        if not source_path.exists():
            return FinishResult(
                status="failed", error=f"source not found: {source_path.name}"
            )
        if not self._font:
            return FinishResult(
                status="failed", error="no usable system font found for drawtext"
            )

        target = self.path_for(campaign_id)
        tmp = target.with_suffix(".mp4.tmp")
        # textfile= avoids drawtext escaping headaches with : ' \ %
        top_file = self.dir / f".{campaign_id}-top.txt"
        bot_file = self.dir / f".{campaign_id}-bot.txt"
        try:
            top_file.write_text((top_text or "").strip()[:120], encoding="utf-8")
            bot_file.write_text((bottom_text or "").strip()[:140], encoding="utf-8")

            # Backslash-escape colons in the file paths so ffmpeg's filter
            # parser doesn't treat them as option separators.
            font_esc = self._font.replace(":", r"\:")
            top_esc = str(top_file).replace(":", r"\:")
            bot_esc = str(bot_file).replace(":", r"\:")

            vf = (
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

            logger.info("running ffmpeg finish for campaign %s", campaign_id)
            result = subprocess.run(
                cmd, capture_output=True, text=True, timeout=timeout
            )
            if result.returncode != 0:
                stderr = (result.stderr or "").strip()[-300:]
                tmp.unlink(missing_ok=True)
                return FinishResult(
                    status="failed",
                    error=f"ffmpeg rc={result.returncode}: {stderr}",
                )
            if not tmp.exists():
                return FinishResult(
                    status="failed", error="ffmpeg ok but output missing"
                )
            tmp.replace(target)
            return FinishResult(status="ok", output_path=target)
        except subprocess.TimeoutExpired:
            tmp.unlink(missing_ok=True)
            return FinishResult(
                status="failed", error=f"ffmpeg timed out after {timeout}s"
            )
        except OSError as exc:
            tmp.unlink(missing_ok=True)
            return FinishResult(status="failed", error=f"io error: {exc}"[:200])
        except Exception as exc:
            tmp.unlink(missing_ok=True)
            logger.exception("unexpected ffmpeg error")
            return FinishResult(
                status="failed", error=f"unexpected: {exc!s}"[:200]
            )
        finally:
            top_file.unlink(missing_ok=True)
            bot_file.unlink(missing_ok=True)
