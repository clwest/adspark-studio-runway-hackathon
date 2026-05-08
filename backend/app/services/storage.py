import json
import logging
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx

from ..models import Campaign, CampaignCreate

logger = logging.getLogger(__name__)

_LOCK = threading.Lock()

# Cap downloaded asset size to avoid pulling something pathological
# from a misconfigured URL. Runway 5s clips are ~3 MB; allow generous headroom.
MAX_VIDEO_BYTES = 100 * 1024 * 1024


class CampaignStore:
    """JSON-file backed campaign store. Single-process safe via threading.Lock."""

    def __init__(self, data_dir: Path):
        self.path = data_dir / "campaigns.json"
        data_dir.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text("[]", encoding="utf-8")

    def _read(self) -> list[dict]:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return []

    def _write(self, rows: list[dict]) -> None:
        tmp = self.path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(rows, indent=2, default=str), encoding="utf-8")
        tmp.replace(self.path)

    def list(self) -> list[Campaign]:
        with _LOCK:
            rows = self._read()
        return [Campaign.model_validate(r) for r in rows]

    def get(self, campaign_id: str) -> Optional[Campaign]:
        with _LOCK:
            rows = self._read()
        for row in rows:
            if row.get("id") == campaign_id:
                return Campaign.model_validate(row)
        return None

    def create(self, payload: CampaignCreate) -> Campaign:
        record = Campaign(
            id=uuid.uuid4().hex[:12],
            created_at=datetime.now(timezone.utc),
            **payload.model_dump(),
        )
        with _LOCK:
            rows = self._read()
            rows.insert(0, json.loads(record.model_dump_json()))
            self._write(rows)
        return record

    def update_cache_fields(
        self,
        campaign_id: str,
        cached_video_url: Optional[str],
        cache_status: Optional[str],
        cache_error: Optional[str],
    ) -> Optional[Campaign]:
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == campaign_id:
                    row["cached_video_url"] = cached_video_url
                    row["cache_status"] = cache_status
                    row["cache_error"] = cache_error
                    self._write(rows)
                    return Campaign.model_validate(row)
        return None

    def update_finish_fields(
        self,
        campaign_id: str,
        finished_video_url: Optional[str],
        finish_status: Optional[str],
        finish_error: Optional[str],
    ) -> Optional[Campaign]:
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == campaign_id:
                    row["finished_video_url"] = finished_video_url
                    row["finish_status"] = finish_status
                    row["finish_error"] = finish_error
                    self._write(rows)
                    return Campaign.model_validate(row)
        return None


@dataclass
class CacheResult:
    status: str  # "ok" | "failed"
    bytes_written: int = 0
    error: Optional[str] = None


class VideoCache:
    """Local cache for Runway artifact MP4s.

    Files live at <data_dir>/videos/<campaign_id>.mp4. The directory is
    gitignored via backend/.gitignore (`data/`).
    """

    def __init__(self, data_dir: Path):
        self.dir = data_dir / "videos"
        self.dir.mkdir(parents=True, exist_ok=True)

    def path_for(self, campaign_id: str) -> Path:
        return self.dir / f"{campaign_id}.mp4"

    def has(self, campaign_id: str) -> bool:
        return self.path_for(campaign_id).exists()

    def fetch(
        self,
        campaign_id: str,
        source_url: str,
        timeout: float = 30.0,
    ) -> CacheResult:
        """Download to disk. Never raises — caller inspects CacheResult."""
        target = self.path_for(campaign_id)
        tmp = target.with_suffix(".mp4.tmp")
        try:
            with httpx.stream(
                "GET", source_url, timeout=timeout, follow_redirects=True
            ) as resp:
                resp.raise_for_status()
                ctype = (resp.headers.get("content-type") or "").lower()
                if not ctype.startswith("video/"):
                    return CacheResult(
                        status="failed",
                        error=f"unexpected content-type: {ctype or '(missing)'}",
                    )
                size = 0
                with open(tmp, "wb") as f:
                    for chunk in resp.iter_bytes():
                        size += len(chunk)
                        if size > MAX_VIDEO_BYTES:
                            f.close()
                            tmp.unlink(missing_ok=True)
                            return CacheResult(
                                status="failed",
                                error=f"asset exceeds cap ({MAX_VIDEO_BYTES} bytes)",
                            )
                        f.write(chunk)
            tmp.replace(target)
            return CacheResult(status="ok", bytes_written=size)
        except httpx.HTTPError as exc:
            tmp.unlink(missing_ok=True)
            return CacheResult(status="failed", error=f"http error: {exc!s}"[:200])
        except OSError as exc:
            tmp.unlink(missing_ok=True)
            return CacheResult(status="failed", error=f"io error: {exc!s}"[:200])
        except Exception as exc:  # broad guard so saves never break
            tmp.unlink(missing_ok=True)
            logger.exception("unexpected video cache error")
            return CacheResult(status="failed", error=f"unexpected: {exc!s}"[:200])
