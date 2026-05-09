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
        now = datetime.now(timezone.utc)
        # PR AC — when the frontend persists the Commercial Script in
        # the same save call, stamp the updated_at field so downstream
        # code can tell the difference between "never touched" and
        # "set at create time".
        script = (payload.commercial_script or "").strip() or None
        record = Campaign(
            id=uuid.uuid4().hex[:12],
            created_at=now,
            commercial_script_updated_at=now if script else None,
            **{**payload.model_dump(), "commercial_script": script},
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

    def update_host_avatar_fields(
        self,
        campaign_id: str,
        host_avatar_id: Optional[str],
        host_avatar_status: Optional[str],
        host_avatar_image_url: Optional[str],
        host_avatar_image_source: Optional[str],
        host_avatar_error: Optional[str],
    ) -> Optional[Campaign]:
        """PR F — persist Phase 1 (Brand Spokesperson Avatar) fields."""
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == campaign_id:
                    row["host_avatar_id"] = host_avatar_id
                    row["host_avatar_status"] = host_avatar_status
                    row["host_avatar_image_url"] = host_avatar_image_url
                    row["host_avatar_image_source"] = host_avatar_image_source
                    row["host_avatar_error"] = host_avatar_error
                    self._write(rows)
                    return Campaign.model_validate(row)
        return None

    def update_character_attachment(
        self,
        campaign_id: str,
        character_id: Optional[str],
    ) -> Optional[Campaign]:
        """PR K — attach or detach a Character. ``character_id=None``
        clears the attachment; the avatar resolution chain falls
        back to selected_avatar_id / host_avatar_id.
        """
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == campaign_id:
                    row["character_id"] = character_id
                    self._write(rows)
                    return Campaign.model_validate(row)
        return None

    def update_selected_avatar_fields(
        self,
        campaign_id: str,
        selected_avatar_id: Optional[str],
        selected_avatar_name: Optional[str] = None,
        selected_avatar_source: Optional[str] = None,
        selected_avatar_thumbnail_url: Optional[str] = None,
    ) -> Optional[Campaign]:
        """PR I+ — persist the picker selection on the campaign. Pass
        ``selected_avatar_id=None`` to clear the selection (re-enable
        the host_avatar_id fallback path).
        """
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == campaign_id:
                    row["selected_avatar_id"] = selected_avatar_id
                    row["selected_avatar_name"] = selected_avatar_name
                    row["selected_avatar_source"] = selected_avatar_source
                    row["selected_avatar_thumbnail_url"] = selected_avatar_thumbnail_url
                    self._write(rows)
                    return Campaign.model_validate(row)
        return None

    def update_brand_voice_fields(
        self,
        campaign_id: str,
        brand_voice_id: Optional[str],
        brand_voice_status: Optional[str],
        brand_voice_preview_url: Optional[str],
        brand_voice_error: Optional[str],
        brand_voice_mock_mode: Optional[bool] = None,
    ) -> Optional[Campaign]:
        """PR H — persist Brand Voice (Phase 1) fields."""
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == campaign_id:
                    row["brand_voice_id"] = brand_voice_id
                    row["brand_voice_status"] = brand_voice_status
                    row["brand_voice_preview_url"] = brand_voice_preview_url
                    row["brand_voice_error"] = brand_voice_error
                    if brand_voice_mock_mode is not None:
                        row["brand_voice_mock_mode"] = brand_voice_mock_mode
                    self._write(rows)
                    return Campaign.model_validate(row)
        return None

    def update_dub_fields(
        self,
        campaign_id: str,
        target_lang: str,
        url: Optional[str],
        status: Optional[str],
        error: Optional[str],
    ) -> Optional[Campaign]:
        """PR H — persist a single language slot of the Multilingual Dub
        Pack. Other languages remain untouched.  Mirrors PR B's
        per-format finished_videos pattern.
        """
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == campaign_id:
                    dub_urls = dict(row.get("dubbed_audio_urls") or {})
                    dub_statuses = dict(row.get("dub_statuses") or {})
                    dub_errors = dict(row.get("dub_errors") or {})
                    if url and status == "ok":
                        dub_urls[target_lang] = url
                    else:
                        dub_urls.pop(target_lang, None)
                    if status:
                        dub_statuses[target_lang] = status
                    if error:
                        dub_errors[target_lang] = error
                    elif target_lang in dub_errors and status == "ok":
                        dub_errors.pop(target_lang, None)
                    row["dubbed_audio_urls"] = dub_urls
                    row["dub_statuses"] = dub_statuses
                    row["dub_errors"] = dub_errors
                    self._write(rows)
                    return Campaign.model_validate(row)
        return None

    def update_host_video_fields(
        self,
        campaign_id: str,
        host_video_url: Optional[str],
        host_status: Optional[str],
        host_error: Optional[str],
        host_task_id: Optional[str] = None,
        host_mock_mode: Optional[bool] = None,
    ) -> Optional[Campaign]:
        """PR F — persist Phase 2 (Avatar Host Clip) fields. The avatar
        identity persists across host-clip operations.
        """
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == campaign_id:
                    row["host_video_url"] = host_video_url
                    row["host_status"] = host_status
                    row["host_error"] = host_error
                    if host_task_id is not None:
                        row["host_task_id"] = host_task_id
                    if host_mock_mode is not None:
                        row["host_mock_mode"] = host_mock_mode
                    self._write(rows)
                    return Campaign.model_validate(row)
        return None

    def delete(self, campaign_id: str) -> bool:
        """Remove the campaign record from the JSON store. Returns True
        when a row was removed, False when no campaign matched.

        Callers are responsible for cleaning up any cached files that
        live outside this store (videos / finished / host / audio /
        finished). Runway-side resources (avatar id, voice id, host
        avatar id) are deliberately not touched — see the parallel
        decision in CharacterStore.delete.
        """
        with _LOCK:
            rows = self._read()
            new_rows = [r for r in rows if r.get("id") != campaign_id]
            if len(new_rows) == len(rows):
                return False
            self._write(new_rows)
            return True

    def update_voiced_commercial_fields(
        self,
        campaign_id: str,
        voiced_commercial_url: Optional[str],
        voiced_commercial_status: Optional[str],
        voiced_commercial_error: Optional[str],
    ) -> Optional[Campaign]:
        """PR S — persist Commercial with Voice fields. Mirrors the per-feature
        update helpers used elsewhere in this store.
        """
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == campaign_id:
                    row["voiced_commercial_url"] = voiced_commercial_url
                    row["voiced_commercial_status"] = voiced_commercial_status
                    row["voiced_commercial_error"] = voiced_commercial_error
                    self._write(rows)
                    return Campaign.model_validate(row)
        return None

    def update_storyboard_plan(
        self,
        campaign_id: str,
        shots: "list[dict]",
        storyboard_status: Optional[str],
        storyboard_error: Optional[str] = None,
    ) -> Optional[Campaign]:
        """PR Z — write the planned storyboard shots + status. Resets
        the stitched MP4 + voiced storyboard fields so a re-plan
        invalidates any older stitched output.
        """
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == campaign_id:
                    row["storyboard_shots"] = shots
                    row["storyboard_status"] = storyboard_status
                    row["storyboard_error"] = storyboard_error
                    row["storyboard_video_url"] = None
                    row["storyboard_voiced_url"] = None
                    row["storyboard_voiced_status"] = None
                    row["storyboard_voiced_error"] = None
                    self._write(rows)
                    return Campaign.model_validate(row)
        return None

    def update_storyboard_shot_prompt(
        self,
        campaign_id: str,
        shot_id: str,
        prompt: str,
    ) -> Optional[Campaign]:
        """PR AC — overwrite a single shot's prompt with the user-edited
        text + reset its generation state to ``idle`` so the next
        Generate Shot call uses the new prompt and can retry without
        keeping a stale failed/ok status. Other shots are untouched.
        Also clears the stitched + voiced storyboard outputs so a
        re-stitch is required after editing any shot.
        """
        cleaned = (prompt or "").strip()
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == campaign_id:
                    shots = list(row.get("storyboard_shots") or [])
                    matched = False
                    for shot in shots:
                        if shot.get("id") == shot_id:
                            matched = True
                            shot["prompt"] = cleaned
                            shot["status"] = "idle"
                            shot["task_id"] = None
                            shot["video_url"] = None
                            shot["error"] = None
                            break
                    if not matched:
                        return None
                    row["storyboard_shots"] = shots
                    # Stale outputs invalidated by the prompt change.
                    row["storyboard_video_url"] = None
                    if row.get("storyboard_status") == "ok":
                        row["storyboard_status"] = "ready"
                    row["storyboard_voiced_url"] = None
                    row["storyboard_voiced_status"] = None
                    row["storyboard_voiced_error"] = None
                    self._write(rows)
                    return Campaign.model_validate(row)
        return None

    def update_storyboard_shot(
        self,
        campaign_id: str,
        shot_id: str,
        *,
        status: Optional[str] = None,
        task_id: Optional[str] = None,
        video_url: Optional[str] = None,
        cache_filename: Optional[str] = None,
        error: Optional[str] = None,
        mock_mode: Optional[bool] = None,
    ) -> Optional[Campaign]:
        """PR Z — patch one shot's status / output URL / error. Other
        shots stay untouched.
        """
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == campaign_id:
                    shots = list(row.get("storyboard_shots") or [])
                    matched = False
                    for shot in shots:
                        if shot.get("id") == shot_id:
                            matched = True
                            if status is not None:
                                shot["status"] = status
                            if task_id is not None:
                                shot["task_id"] = task_id
                            if video_url is not None or status == "ok":
                                shot["video_url"] = video_url
                            if cache_filename is not None:
                                shot["cache_filename"] = cache_filename
                            shot["error"] = error
                            if mock_mode is not None:
                                shot["mock_mode"] = mock_mode
                            break
                    if not matched:
                        return None
                    row["storyboard_shots"] = shots
                    self._write(rows)
                    return Campaign.model_validate(row)
        return None

    def update_storyboard_stitch(
        self,
        campaign_id: str,
        storyboard_video_url: Optional[str],
        storyboard_status: Optional[str],
        storyboard_error: Optional[str],
    ) -> Optional[Campaign]:
        """PR Z — persist stitched-output fields after ffmpeg concat."""
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == campaign_id:
                    row["storyboard_video_url"] = storyboard_video_url
                    row["storyboard_status"] = storyboard_status
                    row["storyboard_error"] = storyboard_error
                    self._write(rows)
                    return Campaign.model_validate(row)
        return None

    # ---- PR AF — Multi-Character Dialogue Scene Builder ------------

    def update_dialogue_plan(
        self,
        campaign_id: str,
        lines: "list[dict]",
        dialogue_scene_status: Optional[str],
        dialogue_scene_error: Optional[str] = None,
    ) -> Optional[Campaign]:
        """Persist a freshly-planned dialogue scene. Resets the stitched
        video so a re-plan invalidates any older final output.
        """
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == campaign_id:
                    row["dialogue_lines"] = lines
                    row["dialogue_scene_status"] = dialogue_scene_status
                    row["dialogue_scene_error"] = dialogue_scene_error
                    row["dialogue_scene_video_url"] = None
                    self._write(rows)
                    return Campaign.model_validate(row)
        return None

    def update_dialogue_line(
        self,
        campaign_id: str,
        line_id: str,
        *,
        character_id: Optional[str] = None,
        character_name: Optional[str] = None,
        avatar_id: Optional[str] = None,
        text: Optional[str] = None,
        status: Optional[str] = None,
        task_id: Optional[str] = None,
        video_url: Optional[str] = None,
        cache_filename: Optional[str] = None,
        error: Optional[str] = None,
        mock_mode: Optional[bool] = None,
        clear_text: bool = False,
        clear_character: bool = False,
    ) -> Optional[Campaign]:
        """Patch a single dialogue line. Pass ``None`` to leave a field
        untouched; use ``clear_text=True`` / ``clear_character=True`` to
        explicitly clear those fields. When status is set to ``idle`` we
        also clear video_url + task_id + error (e.g. after a text/character
        edit that invalidates the previous render).
        """
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == campaign_id:
                    lines = list(row.get("dialogue_lines") or [])
                    matched = False
                    for line in lines:
                        if line.get("id") == line_id:
                            matched = True
                            if clear_character:
                                line["character_id"] = None
                                line["character_name"] = None
                                line["avatar_id"] = None
                            if character_id is not None:
                                line["character_id"] = character_id
                            if character_name is not None:
                                line["character_name"] = character_name
                            if avatar_id is not None:
                                line["avatar_id"] = avatar_id
                            if clear_text:
                                line["text"] = ""
                            elif text is not None:
                                line["text"] = text
                            if status is not None:
                                line["status"] = status
                                if status == "idle":
                                    line["video_url"] = None
                                    line["task_id"] = None
                                    line["error"] = None
                            if task_id is not None:
                                line["task_id"] = task_id
                            if video_url is not None:
                                line["video_url"] = video_url
                            if cache_filename is not None:
                                line["cache_filename"] = cache_filename
                            line["error"] = error
                            if mock_mode is not None:
                                line["mock_mode"] = mock_mode
                            break
                    if not matched:
                        return None
                    row["dialogue_lines"] = lines
                    # Any line edit invalidates the stitched output.
                    if row.get("dialogue_scene_status") == "ok":
                        row["dialogue_scene_status"] = "ready"
                    row["dialogue_scene_video_url"] = None
                    self._write(rows)
                    return Campaign.model_validate(row)
        return None

    def update_dialogue_stitch(
        self,
        campaign_id: str,
        dialogue_scene_video_url: Optional[str],
        dialogue_scene_status: Optional[str],
        dialogue_scene_error: Optional[str],
    ) -> Optional[Campaign]:
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == campaign_id:
                    row["dialogue_scene_video_url"] = dialogue_scene_video_url
                    row["dialogue_scene_status"] = dialogue_scene_status
                    row["dialogue_scene_error"] = dialogue_scene_error
                    self._write(rows)
                    return Campaign.model_validate(row)
        return None

    def update_commercial_script(
        self,
        campaign_id: str,
        commercial_script: Optional[str],
    ) -> Optional[Campaign]:
        """PR AA — persist the editable Commercial Script. Pass an empty
        string / None to clear (downstream falls back to the deterministic
        ``character_host_client.build_script``).
        """
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == campaign_id:
                    cleaned = (commercial_script or "").strip() or None
                    row["commercial_script"] = cleaned
                    row["commercial_script_updated_at"] = (
                        datetime.now(timezone.utc).isoformat()
                        if cleaned
                        else None
                    )
                    self._write(rows)
                    return Campaign.model_validate(row)
        return None

    def update_storyboard_voiced(
        self,
        campaign_id: str,
        storyboard_voiced_url: Optional[str],
        storyboard_voiced_status: Optional[str],
        storyboard_voiced_error: Optional[str],
    ) -> Optional[Campaign]:
        """PR Z — persist voiced-storyboard fields. Mirrors
        update_voiced_commercial_fields shape.
        """
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == campaign_id:
                    row["storyboard_voiced_url"] = storyboard_voiced_url
                    row["storyboard_voiced_status"] = storyboard_voiced_status
                    row["storyboard_voiced_error"] = storyboard_voiced_error
                    self._write(rows)
                    return Campaign.model_validate(row)
        return None

    def update_runway_conversation_id(
        self,
        campaign_id: str,
        conversation_id: Optional[str],
    ) -> Optional[Campaign]:
        """PR AJ — capture the conversation id Runway returns from
        ``POST /v1/realtime_sessions``. Stored as a plain string; the
        transcript fetch route reads it later. Pass ``None`` to clear.
        """
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == campaign_id:
                    row["runway_conversation_id"] = conversation_id
                    self._write(rows)
                    return Campaign.model_validate(row)
        return None

    def update_realtime_transcript_fields(
        self,
        campaign_id: str,
        runway_conversation_id: Optional[str],
        realtime_transcript_status: Optional[str],
        realtime_transcript_error: Optional[str],
        realtime_transcript_fetched_at: Optional[datetime],
        realtime_transcript_turns: "Optional[list[dict]]",
        realtime_transcript_mock_mode: Optional[bool] = None,
    ) -> Optional[Campaign]:
        """PR AJ — persist the transcript + retrieval metadata the
        replay UX renders. Mirrors the per-feature update shape used
        across the store. Pass ``realtime_transcript_turns=None`` to
        leave existing turns untouched (e.g. on a soft-fail refresh)
        or ``[]`` to explicitly clear them.
        """
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == campaign_id:
                    if runway_conversation_id is not None:
                        row["runway_conversation_id"] = runway_conversation_id
                    row["realtime_transcript_status"] = realtime_transcript_status
                    row["realtime_transcript_error"] = realtime_transcript_error
                    if realtime_transcript_fetched_at is not None:
                        row["realtime_transcript_fetched_at"] = (
                            realtime_transcript_fetched_at.isoformat()
                            if hasattr(realtime_transcript_fetched_at, "isoformat")
                            else str(realtime_transcript_fetched_at)
                        )
                    if realtime_transcript_turns is not None:
                        row["realtime_transcript_turns"] = realtime_transcript_turns
                    if realtime_transcript_mock_mode is not None:
                        row["realtime_transcript_mock_mode"] = realtime_transcript_mock_mode
                    self._write(rows)
                    return Campaign.model_validate(row)
        return None

    def update_realtime_document_fields(
        self,
        campaign_id: str,
        runway_document_id: Optional[str],
        runway_document_status: Optional[str],
        runway_document_error: Optional[str],
        runway_document_mock_mode: Optional[bool] = None,
    ) -> Optional[Campaign]:
        """PR AI — persist Avatar Document fields used by the realtime
        broker for grounded answers. Pass ``runway_document_id=None`` to
        clear the binding (e.g. on a re-attach failure or an explicit
        revoke). Mirrors the per-feature update shape used elsewhere.
        """
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == campaign_id:
                    row["runway_document_id"] = runway_document_id
                    row["runway_document_status"] = runway_document_status
                    row["runway_document_error"] = runway_document_error
                    if runway_document_mock_mode is not None:
                        row["runway_document_mock_mode"] = runway_document_mock_mode
                    self._write(rows)
                    return Campaign.model_validate(row)
        return None

    def update_reels_fields(
        self,
        campaign_id: str,
        kind: str,
        url: Optional[str],
        status: Optional[str],
        error: Optional[str],
    ) -> Optional[Campaign]:
        """PR AG — persist Vertical / Reels export fields. ``kind`` is
        either ``"spokesperson"`` or ``"dialogue_scene"`` and selects
        which pair of fields to write. Mirrors the per-feature update
        shape used elsewhere in this store; never raises.
        """
        if kind not in {"spokesperson", "dialogue_scene"}:
            return None
        url_field = (
            "spokesperson_reels_url"
            if kind == "spokesperson"
            else "dialogue_scene_reels_url"
        )
        status_field = (
            "spokesperson_reels_status"
            if kind == "spokesperson"
            else "dialogue_scene_reels_status"
        )
        error_field = (
            "spokesperson_reels_error"
            if kind == "spokesperson"
            else "dialogue_scene_reels_error"
        )
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == campaign_id:
                    row[url_field] = url
                    row[status_field] = status
                    row[error_field] = error
                    self._write(rows)
                    return Campaign.model_validate(row)
        return None

    def update_finish_fields(
        self,
        campaign_id: str,
        finished_video_url: Optional[str],
        finish_status: Optional[str],
        finish_error: Optional[str],
        fmt: Optional[str] = None,
    ) -> Optional[Campaign]:
        """Update per-finish fields. When ``fmt`` is supplied this also merges
        the result into the per-format ``finished_videos`` dict (PR B). The
        legacy ``finished_video_url`` continues to mirror landscape success
        so old gallery code still resolves a single URL.
        """
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == campaign_id:
                    finished_videos = dict(row.get("finished_videos") or {})
                    if fmt:
                        if finished_video_url and finish_status == "ok":
                            finished_videos[fmt] = finished_video_url
                        else:
                            # On failure/unavailable, drop any stale URL for
                            # this format so the gallery doesn't show a
                            # broken pack entry.
                            finished_videos.pop(fmt, None)
                    row["finished_videos"] = finished_videos

                    # Maintain the legacy single URL field. Only the landscape
                    # op writes to it; non-landscape ops leave it untouched
                    # so an existing landscape result still survives.
                    if not fmt or fmt == "landscape":
                        row["finished_video_url"] = finished_video_url
                    elif "finished_video_url" not in row:
                        row["finished_video_url"] = None

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
