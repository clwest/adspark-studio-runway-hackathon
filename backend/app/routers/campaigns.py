import logging
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ..config import Settings, get_settings
from ..models import Campaign, CampaignCreate, CampaignList
from ..services.audio_client import (
    SUPPORTED_DUB_LANGS,
    design_brand_voice,
    dub_brand_voice,
    path_for_audio,
)
from ..services.character_host_client import (
    SUPPORTED_VOICE_PRESETS,
    active_avatar_id as host_active_avatar_id,
    active_avatar_status as host_active_avatar_status,
    build_script as host_build_script,
    create_or_reuse_avatar,
    generate_host_video,
    path_for as host_path_for,
)
from ..services.character_store import CharacterStore
from ..services.color_utils import (
    normalize_brand_color,
    to_ffmpeg_color,
)
from ..services.documents_client import (
    attach_documents_to_avatar as runway_attach_documents,
    build_campaign_brief_markdown,
    create_document as runway_create_document,
)
from ..services.realtime_avatar_client import (
    RealtimeUnavailableError,
    create_session as realtime_create_session,
    delete_session as realtime_delete_session,
)
from ..services.transcript_client import (
    TranscriptResult,
    fetch_transcript as runway_fetch_transcript,
)
from ..services.finisher_service import (
    FORMAT_DIMS,
    LANDSCAPE,
    VideoFinisher,
    has_audio_stream,
    is_ffmpeg_available,
    probe_duration,
)
from ..services import storyboard_service as storyboard_service  # type: ignore[attr-defined]
from ..services import dialogue_service as dialogue_service  # type: ignore[attr-defined]
from ..services.storage import CampaignStore, VideoCache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/campaigns", tags=["campaigns"])


def _store(settings: Settings = Depends(get_settings)) -> CampaignStore:
    return CampaignStore(settings.data_path)


def _video_cache(settings: Settings = Depends(get_settings)) -> VideoCache:
    return VideoCache(settings.data_path)


def _finisher(settings: Settings = Depends(get_settings)) -> VideoFinisher:
    return VideoFinisher(settings.data_path)


@router.post("", response_model=Campaign)
def create_campaign(
    payload: CampaignCreate,
    store: CampaignStore = Depends(_store),
    cache: VideoCache = Depends(_video_cache),
) -> Campaign:
    record = store.create(payload)

    if not (payload.video_url and payload.video_url.strip()):
        updated = store.update_cache_fields(
            record.id, cached_video_url=None, cache_status="skipped", cache_error=None
        )
        return updated or record

    result = cache.fetch(record.id, payload.video_url)
    if result.status == "ok":
        logger.info(
            "cached campaign %s video (%d bytes) from %s",
            record.id,
            result.bytes_written,
            payload.video_url[:80],
        )
        updated = store.update_cache_fields(
            record.id,
            cached_video_url=f"/api/campaigns/{record.id}/video",
            cache_status="ok",
            cache_error=None,
        )
    else:
        logger.warning(
            "campaign %s video cache failed: %s", record.id, result.error
        )
        updated = store.update_cache_fields(
            record.id,
            cached_video_url=None,
            cache_status="failed",
            cache_error=result.error,
        )
    return updated or record


@router.get("", response_model=CampaignList)
def list_campaigns(store: CampaignStore = Depends(_store)) -> CampaignList:
    return CampaignList(campaigns=store.list())


@router.delete("/{campaign_id}", response_model=dict)
def delete_campaign(
    campaign_id: str,
    settings: Settings = Depends(get_settings),
    store: CampaignStore = Depends(_store),
) -> dict:
    """Local delete. Removes the campaign record + every cached artefact
    (video, Pack outputs, host clip, voice preview, per-language dubs).
    Runway-side resources (avatar id, voice id, host avatar id) are
    deliberately not touched — they remain reachable from the Avatar
    Picker / account voice list. Same boundary as ``DELETE /api/characters/{id}``.
    """
    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")

    removed_files: list[str] = []
    data = settings.data_path

    # Cached campaign video + per-format Pack outputs
    candidates: list[Path] = [data / "videos" / f"{campaign_id}.mp4"]
    for fmt in FORMAT_DIMS:
        candidates.append(data / "finished" / f"{campaign_id}-finished-{fmt}.mp4")
    # Legacy landscape filename (pre-PR-B per-format split).
    candidates.append(data / "finished" / f"{campaign_id}-finished.mp4")
    # Host clip
    candidates.append(data / "host" / f"{campaign_id}.mp4")
    # Audio: Brand Voice preview + every language slot in dubbed_audio_urls.
    candidates.append(data / "audio" / f"{campaign_id}-voice-preview.mp3")
    for lang in (record.dub_statuses or {}).keys():
        candidates.append(data / "audio" / f"{campaign_id}-dub-{lang}.mp3")
    # PR S/X — voiced single-cut commercial.
    candidates.append(data / "finished" / f"{campaign_id}-commercial-voice.mp4")
    # PR Z — Storyboard shot caches + stitched + voiced storyboard outputs.
    for shot in (record.storyboard_shots or []):
        candidates.append(data / "storyboard" / f"{campaign_id}-{shot.id}.mp4")
    candidates.append(data / "finished" / f"{campaign_id}-storyboard.mp4")
    candidates.append(data / "finished" / f"{campaign_id}-storyboard-voice.mp4")
    # PR AF — Dialogue scene line caches + stitched output.
    for line in (record.dialogue_lines or []):
        candidates.append(data / "dialogue" / f"{campaign_id}-{line.id}.mp4")
    candidates.append(data / "finished" / f"{campaign_id}-dialogue-scene.mp4")
    # PR AG — Vertical / Reels exports.
    candidates.append(data / "finished" / f"{campaign_id}-spokesperson-reels.mp4")
    candidates.append(data / "finished" / f"{campaign_id}-dialogue-scene-reels.mp4")

    for path in candidates:
        try:
            if path.exists():
                path.unlink()
                removed_files.append(path.name)
        except OSError as exc:
            logger.warning(
                "delete %s: failed to remove %s: %s", campaign_id, path, exc,
            )

    if not store.delete(campaign_id):
        # Race: record vanished between get() and delete().
        raise HTTPException(status_code=404, detail="campaign not found")

    logger.info(
        "deleted campaign %s — removed %d cached file(s): %s",
        campaign_id, len(removed_files), removed_files,
    )
    return {
        "ok": True,
        "id": campaign_id,
        "removed_files": removed_files,
    }


@router.get("/{campaign_id}/video")
def get_campaign_video(
    campaign_id: str,
    cache: VideoCache = Depends(_video_cache),
) -> FileResponse:
    path = cache.path_for(campaign_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="No cached video for this campaign")
    return FileResponse(
        str(path),
        media_type="video/mp4",
        filename=f"adspark-{campaign_id}.mp4",
    )


def _finished_video_url(campaign_id: str, fmt: str) -> str:
    if fmt == LANDSCAPE:
        # Legacy URL kept for backward compatibility — clients that hit
        # /finished-video without a format still resolve to landscape.
        return f"/api/campaigns/{campaign_id}/finished-video"
    return f"/api/campaigns/{campaign_id}/finished-video/{fmt}"


@router.post("/{campaign_id}/finish", response_model=Campaign)
def finish_campaign_video(
    campaign_id: str,
    fmt: str = Query(LANDSCAPE, alias="format", description="landscape | reels | square"),
    store: CampaignStore = Depends(_store),
    cache: VideoCache = Depends(_video_cache),
    finisher: VideoFinisher = Depends(_finisher),
) -> Campaign:
    if fmt not in FORMAT_DIMS:
        raise HTTPException(
            status_code=400,
            detail=f"unsupported format '{fmt}'. supported: {sorted(FORMAT_DIMS)}",
        )
    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")
    cached_path = cache.path_for(campaign_id)
    if not cached_path.exists():
        raise HTTPException(
            status_code=409,
            detail="no cached video to finish for this campaign",
        )
    if not is_ffmpeg_available():
        # Persist the unavailable state so the gallery surfaces a stable badge
        # rather than a transient 503 the user will keep clicking past.
        store.update_finish_fields(
            campaign_id,
            finished_video_url=None,
            finish_status="unavailable",
            finish_error="ffmpeg not found on PATH",
            fmt=fmt,
        )
        raise HTTPException(
            status_code=503,
            detail="ffmpeg is not installed on the server",
        )

    concept = record.selected_concept
    top_text = (concept.title or record.business or "").strip()
    bottom_text = (concept.cta or concept.caption or "").strip()
    result = finisher.finish(campaign_id, cached_path, top_text, bottom_text, fmt=fmt)

    if result.status == "ok":
        logger.info(
            "finished campaign %s [%s] -> %s", campaign_id, fmt, result.output_path
        )
        updated = store.update_finish_fields(
            campaign_id,
            finished_video_url=_finished_video_url(campaign_id, fmt),
            finish_status="ok",
            finish_error=None,
            fmt=fmt,
        )
    else:
        logger.warning(
            "finish failed for campaign %s [%s]: %s", campaign_id, fmt, result.error
        )
        updated = store.update_finish_fields(
            campaign_id,
            finished_video_url=None,
            finish_status=result.status,
            finish_error=result.error,
            fmt=fmt,
        )
    return updated or record


@router.get("/{campaign_id}/finished-video")
def get_finished_video(
    campaign_id: str,
    finisher: VideoFinisher = Depends(_finisher),
) -> FileResponse:
    """Legacy single-format serve route. Always returns the landscape MP4."""
    path = finisher.path_for(campaign_id, LANDSCAPE)
    if not path.exists():
        raise HTTPException(
            status_code=404, detail="No finished video for this campaign"
        )
    return FileResponse(
        str(path),
        media_type="video/mp4",
        filename=f"adspark-{campaign_id}-finished.mp4",
    )


@router.get("/{campaign_id}/finished-video/{fmt}")
def get_finished_video_format(
    campaign_id: str,
    fmt: str,
    finisher: VideoFinisher = Depends(_finisher),
) -> FileResponse:
    if fmt not in FORMAT_DIMS:
        raise HTTPException(
            status_code=400,
            detail=f"unsupported format '{fmt}'. supported: {sorted(FORMAT_DIMS)}",
        )
    path = finisher.path_for(campaign_id, fmt)
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No finished {fmt} video for this campaign",
        )
    return FileResponse(
        str(path),
        media_type="video/mp4",
        filename=f"adspark-{campaign_id}-finished-{fmt}.mp4",
    )


# ---- PR S + PR X — Commercial with Voice ----------------------------


class CommercialWithVoiceBody(BaseModel):
    """PR X — optional knobs on the voiced-commercial route. Defaults
    cover the user-spec happy path: auto-create the Avatar Host Clip
    when missing + loop the visual until the host pitch finishes.
    """

    auto_generate_host: bool = Field(
        default=True,
        description=(
            "When True (default), create the Avatar Host Clip on the "
            "fly if it doesn't exist yet AND a Brand Spokesperson "
            "Avatar (custom / selected / via attached Character) is "
            "already ready. Lets the user click one button and end "
            "up with a voiced commercial."
        ),
    )
    loop_visual: bool = Field(
        default=True,
        description=(
            "When True (default), loop the visual video while the "
            "host audio plays so the full spoken pitch lands. When "
            "False, trim audio to the visual's length (PR S "
            "original behaviour)."
        ),
    )


@router.post("/{campaign_id}/commercial-with-voice", response_model=Campaign)
def post_commercial_with_voice(
    campaign_id: str,
    body: Optional[CommercialWithVoiceBody] = None,
    settings: Settings = Depends(get_settings),
    store: CampaignStore = Depends(_store),
    cache: VideoCache = Depends(_video_cache),
    finisher: VideoFinisher = Depends(_finisher),
) -> Campaign:
    """PR S + PR X — combine the silent visual cut + Avatar Host Clip
    audio into a single voiced MP4 via local ffmpeg. No new Runway
    image_to_video calls. PR X auto-generates the host clip when
    missing (one Runway avatar_videos call) and loops the visual so
    the full spoken pitch lands.

    Preconditions (all surface as 409 Conflict so the UI can display
    actionable copy without retrying):
      - cached visual video exists (Save the campaign first)
      - host clip has at least one audio track (mock placeholders may
        be silent — the user gets an honest message rather than a
        muted output)
      - if host clip is missing AND auto_generate_host is True, a
        Brand Spokesperson Avatar (custom, selected, or via attached
        Character) must be ready — otherwise we can't create a host
        clip to take audio from
    """
    opts = body or CommercialWithVoiceBody()

    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")

    video_path = cache.path_for(campaign_id)
    if not video_path.exists():
        raise HTTPException(
            status_code=409,
            detail="Save the visual video first. The cached MP4 is the input for the voiced commercial.",
        )

    if not is_ffmpeg_available():
        # Persist the unavailable state so the gallery shows a stable
        # badge instead of a transient 503 the user keeps clicking past.
        store.update_voiced_commercial_fields(
            campaign_id,
            voiced_commercial_url=None,
            voiced_commercial_status="unavailable",
            voiced_commercial_error="ffmpeg not found on PATH",
        )
        raise HTTPException(
            status_code=503,
            detail="ffmpeg is not installed on the server",
        )

    # Avatar Host Clip path matches character_host_client.path_for —
    # data/host/<id>.mp4. Computed inline to avoid a circular import.
    host_path = settings.data_path / "host" / f"{campaign_id}.mp4"

    # PR X — auto-create the host clip when missing if the user opted in
    # and a Brand Spokesperson Avatar is ready. Refusing here lets the
    # frontend route the user to the Character tab to attach/create one.
    if not host_path.exists():
        if not opts.auto_generate_host:
            raise HTTPException(
                status_code=409,
                detail="Generate the Avatar Host Clip first. Its audio is the voice track for the commercial.",
            )
        if (
            not host_active_avatar_id(record, settings)
            or host_active_avatar_status(record, settings) not in {"ready", "mock"}
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    "Create or attach a spokesperson first. The voiced "
                    "commercial uses the Avatar Host Clip's audio — "
                    "which needs a ready Brand Spokesperson Avatar to "
                    "exist."
                ),
            )
        # Fire generate_host_video in-place. Mirrors the persistence the
        # standalone /host-video route does so the gallery card opens
        # with the clip visible afterwards.
        logger.info(
            "commercial-with-voice campaign=%s — auto-generating host clip",
            campaign_id,
        )
        # PR AA — pass the saved Commercial Script through so the auto-
        # generated host clip speaks the user's script verbatim.
        host_result = generate_host_video(
            record, settings,
            script_override=record.commercial_script or None,
        )
        if host_result.status == "ok":
            updated_host = store.update_host_video_fields(
                campaign_id,
                host_video_url=f"/api/campaigns/{campaign_id}/host-video",
                host_status="ok",
                host_error=None,
                host_task_id=host_result.task_id,
                host_mock_mode=host_result.mock_mode,
            )
            if updated_host:
                record = updated_host
        else:
            store.update_host_video_fields(
                campaign_id,
                host_video_url=None,
                host_status=host_result.status,
                host_error=host_result.error,
                host_task_id=host_result.task_id,
                host_mock_mode=host_result.mock_mode,
            )
            store.update_voiced_commercial_fields(
                campaign_id,
                voiced_commercial_url=None,
                voiced_commercial_status="failed",
                voiced_commercial_error=(
                    f"auto-host failed: {host_result.error or host_result.status}"
                ),
            )
            raise HTTPException(
                status_code=502,
                detail=(
                    "Failed to auto-generate the Avatar Host Clip. "
                    "Try the Character tab → Present Campaign manually, "
                    "then retry this build. "
                    f"({host_result.error or host_result.status})"
                ),
            )
        # host_path should now exist. Defensive re-check below covers
        # the rare case of a successful result but missing file.
        if not host_path.exists():
            raise HTTPException(
                status_code=502,
                detail="Avatar Host Clip generation reported success but no file was written.",
            )

    if not has_audio_stream(host_path):
        raise HTTPException(
            status_code=409,
            detail=(
                "Host clip has no audio to mix. Mock-mode placeholders "
                "may be silent — re-record with a real Runway key to get "
                "a voiced clip."
            ),
        )

    result = finisher.build_commercial_with_voice(
        campaign_id, video_path, host_path,
        loop_visual=opts.loop_visual,
    )

    if result.status == "ok":
        logger.info(
            "commercial-with-voice ok campaign=%s loop=%s -> %s",
            campaign_id, opts.loop_visual, result.output_path,
        )
        updated = store.update_voiced_commercial_fields(
            campaign_id,
            voiced_commercial_url=f"/api/campaigns/{campaign_id}/commercial-with-voice",
            voiced_commercial_status="ok",
            voiced_commercial_error=None,
        )
    else:
        logger.warning(
            "commercial-with-voice %s campaign=%s err=%s",
            result.status, campaign_id, result.error,
        )
        updated = store.update_voiced_commercial_fields(
            campaign_id,
            voiced_commercial_url=None,
            voiced_commercial_status=result.status,
            voiced_commercial_error=result.error,
        )
    return updated or record


@router.get("/{campaign_id}/commercial-with-voice")
def get_commercial_with_voice(
    campaign_id: str,
    finisher: VideoFinisher = Depends(_finisher),
) -> FileResponse:
    """Stream the cached voiced-commercial MP4. Returns 404 when the
    user hasn't built it yet — the POST route is the way to generate.
    """
    path = finisher.commercial_path_for(campaign_id)
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="No voiced commercial for this campaign",
        )
    return FileResponse(
        str(path),
        media_type="video/mp4",
        filename=f"adspark-{campaign_id}-commercial-voice.mp4",
    )


# ---- PR Z — Storyboard Commercial Builder ---------------------------


def _shot_video_url(campaign_id: str, shot_id: str) -> str:
    return f"/api/campaigns/{campaign_id}/storyboard/shot/{shot_id}"


@router.post("/{campaign_id}/storyboard/plan", response_model=Campaign)
def post_storyboard_plan(
    campaign_id: str,
    settings: Settings = Depends(get_settings),
    store: CampaignStore = Depends(_store),
) -> Campaign:
    """PR Z — generate a deterministic 3-shot storyboard plan from the
    campaign's concept + attached character (or campaign reference
    image fallback). Pure local computation — no Runway calls. Resets
    any previously stitched storyboard output so a re-plan invalidates
    stale visuals.
    """
    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")

    shots = storyboard_service.plan_shots(record, settings)
    if not any(shot.source_image_url for shot in shots):
        raise HTTPException(
            status_code=409,
            detail=(
                "Attach a Character or save a campaign with a "
                "reference image first — the storyboard pins the "
                "same image as prompt_image for every shot."
            ),
        )

    serialised = [shot.model_dump() for shot in shots]
    updated = store.update_storyboard_plan(
        campaign_id,
        shots=serialised,
        storyboard_status="ready",
        storyboard_error=None,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="campaign not found")
    logger.info(
        "storyboard plan campaign=%s shots=%d",
        campaign_id, len(shots),
    )
    return updated


@router.post(
    "/{campaign_id}/storyboard/generate-shot/{shot_id}",
    response_model=Campaign,
)
def post_storyboard_generate_shot(
    campaign_id: str,
    shot_id: str,
    settings: Settings = Depends(get_settings),
    store: CampaignStore = Depends(_store),
) -> Campaign:
    """PR Z — fire one Runway image_to_video task for the named shot.
    Mock mode produces a deterministic ffmpeg-lavfi placeholder MP4.
    """
    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")

    shots = list(record.storyboard_shots or [])
    if not shots:
        raise HTTPException(
            status_code=409,
            detail="Plan the storyboard first (POST /storyboard/plan).",
        )

    target_shot = next((s for s in shots if s.id == shot_id), None)
    if not target_shot:
        raise HTTPException(
            status_code=404,
            detail=f"shot {shot_id!r} not found in storyboard plan",
        )

    if not target_shot.source_image_url:
        raise HTTPException(
            status_code=409,
            detail=(
                "Shot has no source image. Re-plan the storyboard "
                "after attaching a Character or saving a campaign with "
                "a reference image."
            ),
        )

    # Persist a "running" status so the UI can render a busy state.
    store.update_storyboard_shot(
        campaign_id, shot_id,
        status="running",
        error=None,
    )

    result = storyboard_service.generate_shot(record, target_shot, settings)
    if result.status == "ok":
        logger.info(
            "storyboard shot ok campaign=%s shot=%s task=%s mock=%s",
            campaign_id, shot_id, result.task_id, result.mock_mode,
        )
        updated = store.update_storyboard_shot(
            campaign_id, shot_id,
            status="ok",
            task_id=result.task_id,
            video_url=_shot_video_url(campaign_id, shot_id),
            cache_filename=(result.output_path.name if result.output_path else None),
            error=None,
            mock_mode=result.mock_mode,
        )
        # Stitched/voiced storyboard outputs are stale once any shot
        # changes — clear them so the user re-builds before sharing.
        if updated:
            updated = store.update_storyboard_stitch(
                campaign_id,
                storyboard_video_url=None,
                storyboard_status="ready",
                storyboard_error=None,
            ) or updated
            updated = store.update_storyboard_voiced(
                campaign_id,
                storyboard_voiced_url=None,
                storyboard_voiced_status=None,
                storyboard_voiced_error=None,
            ) or updated
    else:
        logger.warning(
            "storyboard shot %s campaign=%s shot=%s err=%s",
            result.status, campaign_id, shot_id, result.error,
        )
        updated = store.update_storyboard_shot(
            campaign_id, shot_id,
            status="failed",
            task_id=result.task_id,
            video_url=None,
            error=result.error,
            mock_mode=result.mock_mode,
        )
    if not updated:
        raise HTTPException(status_code=404, detail="campaign not found")
    return updated


@router.post("/{campaign_id}/storyboard/stitch", response_model=Campaign)
def post_storyboard_stitch(
    campaign_id: str,
    settings: Settings = Depends(get_settings),
    store: CampaignStore = Depends(_store),
    finisher: VideoFinisher = Depends(_finisher),
) -> Campaign:
    """PR Z — concat every shot MP4 into a single landscape MP4 via
    ffmpeg's filter_complex concat filter. Refuses unless every shot
    is `ok`.
    """
    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")
    shots = list(record.storyboard_shots or [])
    if not shots:
        raise HTTPException(
            status_code=409,
            detail="Plan the storyboard first (POST /storyboard/plan).",
        )
    if any(shot.status != "ok" for shot in shots):
        raise HTTPException(
            status_code=409,
            detail=(
                "All storyboard shots must be ready before stitching. "
                "Generate every shot first."
            ),
        )
    if not is_ffmpeg_available():
        store.update_storyboard_stitch(
            campaign_id,
            storyboard_video_url=None,
            storyboard_status="failed",
            storyboard_error="ffmpeg not found on PATH",
        )
        raise HTTPException(
            status_code=503,
            detail="ffmpeg is not installed on the server",
        )

    shot_paths = [
        storyboard_service.shot_path(settings, campaign_id, shot.id)
        for shot in shots
    ]
    missing = [p.name for p in shot_paths if not p.exists()]
    if missing:
        raise HTTPException(
            status_code=409,
            detail=(
                "One or more shot caches are missing on disk: "
                f"{missing}. Re-generate those shots."
            ),
        )

    store.update_storyboard_stitch(
        campaign_id,
        storyboard_video_url=None,
        storyboard_status="stitching",
        storyboard_error=None,
    )

    result = finisher.build_storyboard(campaign_id, shot_paths)
    if result.status == "ok":
        logger.info(
            "storyboard stitch ok campaign=%s -> %s",
            campaign_id, result.output_path,
        )
        updated = store.update_storyboard_stitch(
            campaign_id,
            storyboard_video_url=f"/api/campaigns/{campaign_id}/storyboard-video",
            storyboard_status="ok",
            storyboard_error=None,
        )
    else:
        logger.warning(
            "storyboard stitch %s campaign=%s err=%s",
            result.status, campaign_id, result.error,
        )
        updated = store.update_storyboard_stitch(
            campaign_id,
            storyboard_video_url=None,
            storyboard_status="failed",
            storyboard_error=result.error,
        )
    return updated or record


@router.get("/{campaign_id}/storyboard-video")
def get_storyboard_video(
    campaign_id: str,
    finisher: VideoFinisher = Depends(_finisher),
) -> FileResponse:
    path = finisher.storyboard_path(campaign_id)
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="No storyboard video for this campaign",
        )
    return FileResponse(
        str(path),
        media_type="video/mp4",
        filename=f"adspark-{campaign_id}-storyboard.mp4",
    )


@router.get("/{campaign_id}/storyboard/shot/{shot_id}")
def get_storyboard_shot_video(
    campaign_id: str,
    shot_id: str,
    settings: Settings = Depends(get_settings),
) -> FileResponse:
    path = storyboard_service.shot_path(settings, campaign_id, shot_id)
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No cached shot {shot_id!r} for this campaign",
        )
    return FileResponse(
        str(path),
        media_type="video/mp4",
        filename=f"adspark-{campaign_id}-{shot_id}.mp4",
    )


# PR AC — Editable storyboard shot prompts. The user-edited text
# becomes the load-bearing prompt for the next Generate Shot call;
# stitch + voiced storyboard outputs are invalidated since the visual
# narrative changed.
class StoryboardShotPromptBody(BaseModel):
    prompt: str = Field(
        ...,
        min_length=4,
        max_length=1000,
        description="User-edited shot prompt. Replaces the AI suggestion verbatim.",
    )


@router.post(
    "/{campaign_id}/storyboard/shot/{shot_id}/prompt",
    response_model=Campaign,
)
def post_storyboard_shot_prompt(
    campaign_id: str,
    shot_id: str,
    body: StoryboardShotPromptBody,
    store: CampaignStore = Depends(_store),
) -> Campaign:
    """Persist a user-edited storyboard shot prompt. Resets that
    shot's status to ``idle`` so the next ``generate-shot`` call
    uses the new text. Invalidates any stitched / voiced storyboard
    output for the campaign since its narrative just changed.
    """
    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")
    shots = list(record.storyboard_shots or [])
    if not any(s.id == shot_id for s in shots):
        raise HTTPException(
            status_code=404,
            detail=(
                f"shot {shot_id!r} not found — plan the storyboard first "
                "(POST /storyboard/plan)."
            ),
        )
    updated = store.update_storyboard_shot_prompt(campaign_id, shot_id, body.prompt)
    if not updated:
        raise HTTPException(status_code=404, detail="campaign not found")
    logger.info(
        "campaign %s shot %s prompt updated (%d chars)",
        campaign_id, shot_id, len(body.prompt or ""),
    )
    return updated


@router.post("/{campaign_id}/storyboard/voiced", response_model=Campaign)
def post_storyboard_voiced(
    campaign_id: str,
    body: Optional[CommercialWithVoiceBody] = None,
    settings: Settings = Depends(get_settings),
    store: CampaignStore = Depends(_store),
    finisher: VideoFinisher = Depends(_finisher),
) -> Campaign:
    """PR Z — loop the stitched storyboard visual under the Avatar
    Host Clip audio. Mirrors the PR S/X voiced-commercial flow: same
    auto-host fallback, same -stream_loop -1 -shortest strategy.
    """
    opts = body or CommercialWithVoiceBody()

    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")

    storyboard_path = finisher.storyboard_path(campaign_id)
    if not storyboard_path.exists():
        raise HTTPException(
            status_code=409,
            detail=(
                "Stitch the storyboard visual first. The voiced "
                "storyboard mixes host audio over that MP4."
            ),
        )
    if not is_ffmpeg_available():
        store.update_storyboard_voiced(
            campaign_id,
            storyboard_voiced_url=None,
            storyboard_voiced_status="unavailable",
            storyboard_voiced_error="ffmpeg not found on PATH",
        )
        raise HTTPException(
            status_code=503,
            detail="ffmpeg is not installed on the server",
        )

    host_path = settings.data_path / "host" / f"{campaign_id}.mp4"
    if not host_path.exists():
        if not opts.auto_generate_host:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Generate the Avatar Host Clip first. Its audio is "
                    "the voice track for the storyboard commercial."
                ),
            )
        if (
            not host_active_avatar_id(record, settings)
            or host_active_avatar_status(record, settings) not in {"ready", "mock"}
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    "Create or attach a spokesperson first. The voiced "
                    "storyboard uses the Avatar Host Clip's audio — "
                    "which needs a ready Brand Spokesperson Avatar."
                ),
            )
        logger.info(
            "voiced storyboard campaign=%s — auto-generating host clip",
            campaign_id,
        )
        # PR AA — same script-first rule for storyboard auto-host.
        host_result = generate_host_video(
            record, settings,
            script_override=record.commercial_script or None,
        )
        if host_result.status == "ok":
            updated_host = store.update_host_video_fields(
                campaign_id,
                host_video_url=f"/api/campaigns/{campaign_id}/host-video",
                host_status="ok",
                host_error=None,
                host_task_id=host_result.task_id,
                host_mock_mode=host_result.mock_mode,
            )
            if updated_host:
                record = updated_host
        else:
            store.update_host_video_fields(
                campaign_id,
                host_video_url=None,
                host_status=host_result.status,
                host_error=host_result.error,
                host_task_id=host_result.task_id,
                host_mock_mode=host_result.mock_mode,
            )
            store.update_storyboard_voiced(
                campaign_id,
                storyboard_voiced_url=None,
                storyboard_voiced_status="failed",
                storyboard_voiced_error=(
                    f"auto-host failed: {host_result.error or host_result.status}"
                ),
            )
            raise HTTPException(
                status_code=502,
                detail=(
                    "Failed to auto-generate the Avatar Host Clip. "
                    f"({host_result.error or host_result.status})"
                ),
            )
        if not host_path.exists():
            raise HTTPException(
                status_code=502,
                detail=(
                    "Avatar Host Clip generation reported success but "
                    "no file was written."
                ),
            )

    if not has_audio_stream(host_path):
        raise HTTPException(
            status_code=409,
            detail=(
                "Host clip has no audio to mix. Mock-mode placeholders "
                "may be silent — re-record with a real Runway key for "
                "voiced output."
            ),
        )

    result = finisher.build_voiced_storyboard(
        campaign_id, storyboard_path, host_path,
    )
    if result.status == "ok":
        logger.info(
            "voiced storyboard ok campaign=%s -> %s",
            campaign_id, result.output_path,
        )
        updated = store.update_storyboard_voiced(
            campaign_id,
            storyboard_voiced_url=f"/api/campaigns/{campaign_id}/storyboard-voiced-video",
            storyboard_voiced_status="ok",
            storyboard_voiced_error=None,
        )
    else:
        logger.warning(
            "voiced storyboard %s campaign=%s err=%s",
            result.status, campaign_id, result.error,
        )
        updated = store.update_storyboard_voiced(
            campaign_id,
            storyboard_voiced_url=None,
            storyboard_voiced_status=result.status,
            storyboard_voiced_error=result.error,
        )
    return updated or record


@router.get("/{campaign_id}/storyboard-voiced-video")
def get_storyboard_voiced_video(
    campaign_id: str,
    finisher: VideoFinisher = Depends(_finisher),
) -> FileResponse:
    path = finisher.storyboard_voiced_path(campaign_id)
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="No voiced storyboard for this campaign",
        )
    return FileResponse(
        str(path),
        media_type="video/mp4",
        filename=f"adspark-{campaign_id}-storyboard-voice.mp4",
    )


# ---- PR AF — Multi-Character Dialogue Scene Builder ----------------


def _line_video_url(campaign_id: str, line_id: str) -> str:
    return f"/api/campaigns/{campaign_id}/dialogue/line/{line_id}"


_DIALOGUE_LINE_MAX = 300


@router.post("/{campaign_id}/dialogue/plan", response_model=Campaign)
def post_dialogue_plan(
    campaign_id: str,
    settings: Settings = Depends(get_settings),
    store: CampaignStore = Depends(_store),
) -> Campaign:
    """Generate a deterministic 3-line dialogue scene from the saved
    campaign + attached character + a second ready character (when
    available). Pure local computation — no Runway calls.
    """
    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")

    lines, err = dialogue_service.plan_lines(record, settings)
    if err:
        raise HTTPException(status_code=409, detail=err)

    serialised = [line.model_dump() for line in lines]
    updated = store.update_dialogue_plan(
        campaign_id,
        lines=serialised,
        dialogue_scene_status="ready",
        dialogue_scene_error=None,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="campaign not found")
    logger.info(
        "dialogue plan campaign=%s lines=%d",
        campaign_id, len(lines),
    )
    return updated


class DialogueLineBody(BaseModel):
    """PATCH-shaped body for editing a planned dialogue line."""

    text: Optional[str] = Field(default=None, max_length=_DIALOGUE_LINE_MAX)
    character_id: Optional[str] = Field(default=None)


@router.post(
    "/{campaign_id}/dialogue/line/{line_id}",
    response_model=Campaign,
)
def post_dialogue_line(
    campaign_id: str,
    line_id: str,
    body: DialogueLineBody,
    settings: Settings = Depends(get_settings),
    store: CampaignStore = Depends(_store),
) -> Campaign:
    """Update a planned dialogue line's text and/or speaker. Resets
    that line's status to ``idle`` so the next Generate Line uses the
    new text + character; invalidates the stitched scene.
    """
    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")
    if not any(l.id == line_id for l in (record.dialogue_lines or [])):
        raise HTTPException(
            status_code=404,
            detail=(
                f"line {line_id!r} not found — plan the dialogue first "
                "(POST /dialogue/plan)."
            ),
        )

    update_kwargs: dict = {"status": "idle"}
    if body.text is not None:
        text = body.text.strip()
        if text and len(text) > _DIALOGUE_LINE_MAX:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"line text exceeds the {_DIALOGUE_LINE_MAX}-char "
                    f"avatar_videos limit ({len(text)} chars)."
                ),
            )
        update_kwargs["text"] = text
    if body.character_id is not None:
        cid = body.character_id.strip() or None
        if cid:
            # Verify the character exists + has a ready avatar.
            ready = dialogue_service._ready_characters(settings)
            match = next((c for c in ready if c["id"] == cid), None)
            if not match:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"character {cid!r} has no ready Runway avatar. "
                        "Create or finish binding the avatar first."
                    ),
                )
            update_kwargs["character_id"] = match["id"]
            update_kwargs["character_name"] = match["name"]
            update_kwargs["avatar_id"] = match["avatar_id"]
        else:
            update_kwargs["clear_character"] = True

    updated = store.update_dialogue_line(campaign_id, line_id, **update_kwargs)
    if not updated:
        raise HTTPException(status_code=404, detail="campaign not found")
    return updated


@router.post(
    "/{campaign_id}/dialogue/generate-line/{line_id}",
    response_model=Campaign,
)
def post_dialogue_generate_line(
    campaign_id: str,
    line_id: str,
    settings: Settings = Depends(get_settings),
    store: CampaignStore = Depends(_store),
) -> Campaign:
    """Render one dialogue line via Runway avatar_videos. Mock mode
    produces a deterministic ffmpeg-lavfi placeholder MP4.
    """
    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")

    lines = list(record.dialogue_lines or [])
    if not lines:
        raise HTTPException(
            status_code=409,
            detail="Plan the dialogue first (POST /dialogue/plan).",
        )
    target = next((l for l in lines if l.id == line_id), None)
    if not target:
        raise HTTPException(
            status_code=404,
            detail=f"line {line_id!r} not found in dialogue plan",
        )

    if not target.avatar_id:
        raise HTTPException(
            status_code=409,
            detail=(
                "Line has no avatar_id. Pick a character with a ready "
                "Runway avatar before generating."
            ),
        )
    if not (target.text or "").strip():
        raise HTTPException(
            status_code=409,
            detail="Line text is empty. Write the spoken line first.",
        )

    store.update_dialogue_line(campaign_id, line_id, status="running", error=None)

    result = dialogue_service.generate_line(record, target, settings)
    if result.status == "ok":
        logger.info(
            "dialogue line ok campaign=%s line=%s task=%s mock=%s",
            campaign_id, line_id, result.task_id, result.mock_mode,
        )
        updated = store.update_dialogue_line(
            campaign_id, line_id,
            status="ok",
            task_id=result.task_id,
            video_url=_line_video_url(campaign_id, line_id),
            cache_filename=(
                result.output_path.name if result.output_path else None
            ),
            error=None,
            mock_mode=result.mock_mode,
        )
        # Stitched scene is stale once any line changes.
        if updated:
            updated = store.update_dialogue_stitch(
                campaign_id,
                dialogue_scene_video_url=None,
                dialogue_scene_status="ready",
                dialogue_scene_error=None,
            ) or updated
    else:
        logger.warning(
            "dialogue line %s campaign=%s line=%s err=%s",
            result.status, campaign_id, line_id, result.error,
        )
        updated = store.update_dialogue_line(
            campaign_id, line_id,
            status="failed",
            task_id=result.task_id,
            video_url=None,
            error=result.error,
            mock_mode=result.mock_mode,
        )
    if not updated:
        raise HTTPException(status_code=404, detail="campaign not found")
    return updated


@router.post("/{campaign_id}/dialogue/stitch", response_model=Campaign)
def post_dialogue_stitch(
    campaign_id: str,
    settings: Settings = Depends(get_settings),
    store: CampaignStore = Depends(_store),
    finisher: VideoFinisher = Depends(_finisher),
) -> Campaign:
    """Concat all generated dialogue line clips into one MP4 with
    audio preserved. Refuses unless every line is ``ok``.
    """
    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")
    lines = list(record.dialogue_lines or [])
    if not lines:
        raise HTTPException(
            status_code=409,
            detail="Plan the dialogue first (POST /dialogue/plan).",
        )
    if any(line.status != "ok" for line in lines):
        raise HTTPException(
            status_code=409,
            detail=(
                "All dialogue lines must be ready before stitching. "
                "Generate every line first."
            ),
        )
    if not is_ffmpeg_available():
        store.update_dialogue_stitch(
            campaign_id,
            dialogue_scene_video_url=None,
            dialogue_scene_status="failed",
            dialogue_scene_error="ffmpeg not found on PATH",
        )
        raise HTTPException(
            status_code=503,
            detail="ffmpeg is not installed on the server",
        )

    line_paths = [
        dialogue_service.line_path(settings, campaign_id, line.id)
        for line in lines
    ]
    missing = [p.name for p in line_paths if not p.exists()]
    if missing:
        raise HTTPException(
            status_code=409,
            detail=(
                "One or more line caches are missing on disk: "
                f"{missing}. Re-generate those lines."
            ),
        )

    store.update_dialogue_stitch(
        campaign_id,
        dialogue_scene_video_url=None,
        dialogue_scene_status="stitching",
        dialogue_scene_error=None,
    )

    result = finisher.build_dialogue_scene(campaign_id, line_paths)
    if result.status == "ok":
        logger.info(
            "dialogue stitch ok campaign=%s -> %s",
            campaign_id, result.output_path,
        )
        updated = store.update_dialogue_stitch(
            campaign_id,
            dialogue_scene_video_url=f"/api/campaigns/{campaign_id}/dialogue-scene",
            dialogue_scene_status="ok",
            dialogue_scene_error=None,
        )
    else:
        logger.warning(
            "dialogue stitch %s campaign=%s err=%s",
            result.status, campaign_id, result.error,
        )
        updated = store.update_dialogue_stitch(
            campaign_id,
            dialogue_scene_video_url=None,
            dialogue_scene_status="failed",
            dialogue_scene_error=result.error,
        )
    return updated or record


@router.get("/{campaign_id}/dialogue-scene")
def get_dialogue_scene_video(
    campaign_id: str,
    finisher: VideoFinisher = Depends(_finisher),
) -> FileResponse:
    path = finisher.dialogue_scene_path(campaign_id)
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="No stitched dialogue scene for this campaign",
        )
    return FileResponse(
        str(path),
        media_type="video/mp4",
        filename=f"adspark-{campaign_id}-dialogue-scene.mp4",
    )


@router.get("/{campaign_id}/dialogue/line/{line_id}")
def get_dialogue_line_video(
    campaign_id: str,
    line_id: str,
    settings: Settings = Depends(get_settings),
) -> FileResponse:
    path = dialogue_service.line_path(settings, campaign_id, line_id)
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"No cached line {line_id!r} for this campaign",
        )
    return FileResponse(
        str(path),
        media_type="video/mp4",
        filename=f"adspark-{campaign_id}-{line_id}.mp4",
    )


# ---- PR F — Brand Spokesperson Avatar + Avatar Host Clip ------------


# ---- PR AK — Brand colour ----------------------------------------


class BrandColorBody(BaseModel):
    """PR AK — set or clear the campaign brand colour. Pass an empty
    string / null to clear (reverts the reels backdrop to the default
    dark slate); any other value is normalised + validated server-side.
    """

    color: Optional[str] = Field(
        default=None,
        max_length=16,
        description=(
            "Brand colour as #RRGGBB / RRGGBB / 0xRRGGBB / #RGB. "
            "Empty / null clears the stored value."
        ),
    )


@router.post("/{campaign_id}/brand-color", response_model=Campaign)
def post_set_brand_color(
    campaign_id: str,
    body: BrandColorBody,
    store: CampaignStore = Depends(_store),
) -> Campaign:
    """PR AK — persist a brand colour for the campaign. Used by the
    reels pipeline as the ffmpeg ``pad=…:color=…`` value so vertical
    exports adopt brand-themed letterbox bars instead of the default
    dark slate. Initial save normalises silently; this explicit
    setter 422s on invalid input so operators see clear feedback.
    """
    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")

    raw = (body.color or "").strip()
    if not raw:
        # Explicit clear — drop back to the default backdrop.
        updated = store.update_brand_color(campaign_id, None)
        return updated or record

    normalised = normalize_brand_color(raw)
    if not normalised:
        raise HTTPException(
            status_code=422,
            detail=(
                f"invalid brand colour {raw!r}; expected #RRGGBB hex "
                "(e.g. #ff7a00). Pass null or '' to clear."
            ),
        )
    updated = store.update_brand_color(campaign_id, normalised)
    return updated or record


class SelectAvatarBody(BaseModel):
    avatar_id: Optional[str] = Field(
        default=None,
        description=(
            "Runway avatar id to use for Avatar Host Clip and realtime "
            "Spokesperson session.  Pass null/empty to clear the "
            "selection and revert to the per-campaign custom avatar."
        ),
    )
    avatar_name: Optional[str] = Field(default=None, max_length=200)
    avatar_source: Optional[str] = Field(default=None, max_length=40)
    thumbnail_url: Optional[str] = Field(default=None, max_length=4000)


@router.post("/{campaign_id}/select-avatar", response_model=Campaign)
def post_select_avatar(
    campaign_id: str,
    body: SelectAvatarBody,
    store: CampaignStore = Depends(_store),
) -> Campaign:
    """Persist the picker selection. The Avatar Host Clip and
    realtime Spokesperson session prefer this field over
    ``host_avatar_id`` when set.
    """
    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")
    avatar_id = (body.avatar_id or "").strip() or None
    avatar_source = (body.avatar_source or "").strip() or None
    if avatar_source and avatar_source not in {
        "preset", "custom", "stock", "campaign", "unknown",
    }:
        raise HTTPException(
            status_code=400,
            detail=f"unsupported avatar_source '{avatar_source}'",
        )
    updated = store.update_selected_avatar_fields(
        campaign_id,
        selected_avatar_id=avatar_id,
        selected_avatar_name=(body.avatar_name or "").strip() or None,
        selected_avatar_source=avatar_source,
        selected_avatar_thumbnail_url=(body.thumbnail_url or "").strip() or None,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="campaign not found")
    logger.info(
        "selected avatar campaign=%s avatar_id=%s source=%s",
        campaign_id, avatar_id, avatar_source,
    )
    return updated


class CreateAvatarBody(BaseModel):
    voice_preset: Optional[str] = Field(
        default=None, description="lowercase preset id (e.g. 'vincent')"
    )
    image_url: Optional[str] = Field(
        default=None,
        description=(
            "override reference image URL for the avatar. If omitted, "
            "uses the campaign's reference_image_url; otherwise falls "
            "back to the configured stock portrait."
        ),
    )
    image_source: Optional[str] = Field(
        default=None,
        description=(
            "explicit image source preference. 'stock' bypasses the "
            "campaign reference image and uses the configured stock "
            "portrait directly — the recovery path the UI's "
            "'Retry with stock portrait' button takes when the "
            "campaign image fails Runway's face check."
        ),
    )
    force_recreate: bool = Field(
        default=False,
        description="discard the cached avatar id and create a new one",
    )


class HostVideoBody(BaseModel):
    script_override: Optional[str] = Field(
        default=None, max_length=300, description="overrides the templated script"
    )


# PR AA — Commercial Script field. Persists the user-edited script so
# downstream host-video / commercial-with-voice / storyboard voiced
# passes can speak it verbatim.
class CommercialScriptBody(BaseModel):
    script: Optional[str] = Field(
        default=None,
        max_length=300,
        description=(
            "Editable spoken-pitch script. Persisted on the campaign. "
            "Pass null/empty to clear (downstream falls back to the "
            "deterministic build_script template). Capped at 300 chars "
            "to match Runway avatar_videos' speech limit."
        ),
    )


class BriefUpdateBody(BaseModel):
    """PR BQ — request body for the inline brief editor in the v2
    lane Step 1. Each field is optional so the operator can clear or
    update a single value without echoing the rest. ``business`` is
    required-on-create at the campaign level, but the editor still
    treats it as patch-shaped — the v2 UI always sends a non-empty
    value. Empty strings on optional fields intentionally clear them.
    """

    business: Optional[str] = Field(default=None, max_length=200)
    product: Optional[str] = Field(default=None, max_length=300)
    audience: Optional[str] = Field(default=None, max_length=300)
    tone: Optional[str] = Field(default=None, max_length=200)


@router.post("/{campaign_id}/brief", response_model=Campaign)
def post_brief(
    campaign_id: str,
    body: BriefUpdateBody,
    store: CampaignStore = Depends(_store),
) -> Campaign:
    """PR BQ — patch the editable brief fields on a saved campaign.

    Every field is optional and uses three-way semantics: ``None`` =
    leave alone, ``""`` = clear, anything else = set. The 4 fields
    business / product / audience / tone are the v2 lane's Step 1
    inputs. This route does NOT touch generated media or fire any
    Runway calls; it's pure storage mutation.

    Failure modes:
    - 404 — campaign not found.
    - 422 — pydantic validation (max_length per field).
    """
    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")
    updated = store.update_brief_fields(
        campaign_id,
        business=body.business,
        product=body.product,
        audience=body.audience,
        tone=body.tone,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="campaign not found")
    logger.info(
        "campaign %s brief updated business=%s product=%s audience=%s tone=%s",
        campaign_id,
        body.business is not None,
        body.product is not None,
        body.audience is not None,
        body.tone is not None,
    )
    return updated


@router.post("/{campaign_id}/script", response_model=Campaign)
def post_commercial_script(
    campaign_id: str,
    body: CommercialScriptBody,
    store: CampaignStore = Depends(_store),
) -> Campaign:
    """Persist or clear the saved Commercial Script for this campaign.
    Read by the host-video route (when no explicit override is sent)
    and by the auto-host paths inside commercial-with-voice and the
    voiced storyboard.
    """
    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")
    updated = store.update_commercial_script(campaign_id, body.script)
    if not updated:
        raise HTTPException(status_code=404, detail="campaign not found")
    logger.info(
        "campaign %s commercial_script %s",
        campaign_id,
        f"set ({len(body.script or '')} chars)" if body.script else "cleared",
    )
    return updated


@router.post("/{campaign_id}/avatar", response_model=Campaign)
def post_create_avatar(
    campaign_id: str,
    body: Optional[CreateAvatarBody] = None,
    settings: Settings = Depends(get_settings),
    store: CampaignStore = Depends(_store),
) -> Campaign:
    """Phase 1 — Create the Brand Spokesperson Avatar for the campaign.

    Calls Runway ``POST /v1/avatars`` (or a mock equivalent), polls to
    READY, and persists the avatar identity onto the campaign record.
    """
    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")

    voice_preset = body.voice_preset if body else None
    image_url_override = body.image_url if body else None
    image_source_pref = body.image_source if body else None
    force_recreate = bool(body.force_recreate) if body else False

    # If the caller explicitly asks for the stock portrait, route the
    # configured Unsplash URL through as an override. The image-source
    # label resolves as "override" inside create_or_reuse_avatar; the
    # stored campaign field still distinguishes it from a manual
    # image_url override since the UI surfaces the source verbatim.
    if image_source_pref == "stock" and not image_url_override:
        image_url_override = settings.runway_host_portrait_url

    if voice_preset and voice_preset.lower() not in SUPPORTED_VOICE_PRESETS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"unsupported voice_preset '{voice_preset}'. "
                f"supported: {sorted(SUPPORTED_VOICE_PRESETS)}"
            ),
        )

    result = create_or_reuse_avatar(
        record,
        settings,
        voice_preset=voice_preset,
        image_url_override=image_url_override,
        force_recreate=force_recreate,
    )

    if result.status in {"ready", "mock"}:
        logger.info(
            "avatar %s campaign=%s id=%s source=%s",
            result.status, campaign_id, result.avatar_id, result.image_source,
        )
        updated = store.update_host_avatar_fields(
            campaign_id,
            host_avatar_id=result.avatar_id,
            host_avatar_status=result.status,
            host_avatar_image_url=result.image_url,
            host_avatar_image_source=result.image_source,
            host_avatar_error=None,
        )
    else:
        logger.warning(
            "avatar %s campaign=%s source=%s err=%s",
            result.status, campaign_id, result.image_source, result.error,
        )
        updated = store.update_host_avatar_fields(
            campaign_id,
            host_avatar_id=None,
            host_avatar_status=result.status,
            host_avatar_image_url=None,
            host_avatar_image_source=result.image_source,
            host_avatar_error=result.error,
        )
    return updated or record


@router.post("/{campaign_id}/host-video", response_model=Campaign)
def post_host_video(
    campaign_id: str,
    body: Optional[HostVideoBody] = None,
    settings: Settings = Depends(get_settings),
    store: CampaignStore = Depends(_store),
) -> Campaign:
    """Phase 2 — Generate the Avatar Host Clip for the campaign.

    Requires the campaign's Brand Spokesperson Avatar to be READY.
    """
    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")
    if (
        not host_active_avatar_id(record, settings)
        or host_active_avatar_status(record, settings) not in {"ready", "mock"}
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                "A Brand Spokesperson Avatar (custom, selected, or "
                "via attached Character) is required first. Pick one "
                "from the avatar list, attach a Character, or POST "
                "/api/campaigns/{id}/avatar to create a new one."
            ),
        )

    # PR AA — host clip prefers the saved Commercial Script when no
    # explicit override is supplied. character_host_client.build_script
    # remains the deterministic fallback when neither exists.
    script_override = body.script_override if body and body.script_override else None
    if not script_override and record.commercial_script:
        script_override = record.commercial_script
    result = generate_host_video(record, settings, script_override=script_override)
    if result.status == "ok":
        logger.info(
            "host video ok campaign=%s mock=%s task=%s",
            campaign_id, result.mock_mode, result.task_id,
        )
        updated = store.update_host_video_fields(
            campaign_id,
            host_video_url=f"/api/campaigns/{campaign_id}/host-video",
            host_status="ok",
            host_error=None,
            host_task_id=result.task_id,
            host_mock_mode=result.mock_mode,
        )
    else:
        logger.warning(
            "host video %s for campaign=%s: %s",
            result.status, campaign_id, result.error,
        )
        updated = store.update_host_video_fields(
            campaign_id,
            host_video_url=None,
            host_status=result.status,
            host_error=result.error,
            host_task_id=result.task_id,
            host_mock_mode=result.mock_mode,
        )
    return updated or record


@router.get("/{campaign_id}/host-video")
def get_host_video(
    campaign_id: str,
    settings: Settings = Depends(get_settings),
) -> FileResponse:
    path = host_path_for(settings, campaign_id)
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="No host video for this campaign",
        )
    return FileResponse(
        str(path),
        media_type="video/mp4",
        filename=f"adspark-{campaign_id}-host.mp4",
    )


# ---- PR AB — Spokesperson Ad (alias) ------------------------------
#
# The Avatar Host Clip + the "Spokesperson Ad" are the same MP4: a
# Runway avatar_videos render where the selected character speaks the
# saved Commercial Script directly to camera with lip sync. The
# host-video route remains the implementation surface; these aliases
# expose the same behaviour under the user-facing vocabulary so the
# API + UI agree. No new files are written; the cached MP4 still
# lives at backend/data/host/<id>.mp4.


class SpokespersonAdBody(BaseModel):
    """Optional override identical in shape to ``HostVideoBody``."""

    script_override: Optional[str] = Field(
        default=None,
        max_length=300,
        description=(
            "Optional override for the spoken script. When omitted, "
            "the route prefers ``campaign.commercial_script`` (PR AA) "
            "and falls back to the deterministic ``build_script`` "
            "template otherwise."
        ),
    )


@router.post("/{campaign_id}/spokesperson-ad", response_model=Campaign)
def post_spokesperson_ad(
    campaign_id: str,
    body: Optional[SpokespersonAdBody] = None,
    settings: Settings = Depends(get_settings),
    store: CampaignStore = Depends(_store),
) -> Campaign:
    """PR AB — Spokesperson Ad (talking-to-camera) generator. Delegates
    to the existing host-video pipeline so the cached MP4, the
    persisted ``host_*`` fields, and the script-override behaviour all
    stay in sync with the legacy endpoint.
    """
    host_body = (
        HostVideoBody(script_override=body.script_override) if body else None
    )
    return post_host_video(
        campaign_id,
        body=host_body,
        settings=settings,
        store=store,
    )


@router.get("/{campaign_id}/spokesperson-ad")
def get_spokesperson_ad(
    campaign_id: str,
    settings: Settings = Depends(get_settings),
) -> FileResponse:
    """PR AB — serves the same MP4 as ``GET /host-video`` under the
    user-facing vocabulary.
    """
    return get_host_video(campaign_id, settings=settings)


# ---- PR AG / PR AH — Vertical / Reels export (captioned) ----------
#
# Reuse the existing Spokesperson Ad and Dialogue Scene MP4s as input
# to a local ffmpeg pad/letterbox + drawtext pass that produces a
# 720x1280 vertical export with burned-in captions, suitable for
# TikTok / Reels / Shorts. No new Runway calls; outputs land alongside
# the other finisher artefacts under backend/data/finished/ and are
# gitignored.


def _spokesperson_caption_schedule(
    record: Campaign, source_path: Path,
) -> "list[tuple[float, float, str]]":
    """PR AH — build a single-segment caption schedule for the
    Spokesperson Reels export. Prefer the editable Commercial Script
    (PR AA); fall back to the deterministic ``build_script`` template
    that the host pipeline uses when no script is saved. Span the full
    clip duration so the caption stays visible for the whole take.
    Returns an empty list when no script is derivable or the source
    has no measurable duration.
    """
    text = (record.commercial_script or "").strip()
    if not text:
        text = host_build_script(record).strip()
    if not text:
        return []
    duration = probe_duration(source_path)
    if duration is None or duration <= 0:
        return []
    return [(0.0, duration, text)]


def _dialogue_caption_schedule(
    record: Campaign, settings: Settings, fallback_total: Optional[float],
) -> "list[tuple[float, float, str]]":
    """PR AH — build a per-line caption schedule for the Dialogue
    Reels export. ffprobe each cached line MP4 to derive its duration
    and accumulate ``(start, end, text)`` tuples in dialogue order.
    Lines without measurable durations get an even slice of
    ``fallback_total`` so the schedule still spans the stitched output.
    Lines whose text is empty are skipped (a silent gap is kinder than
    an empty caption box). Returns an empty list when the campaign has
    no planned dialogue lines at all.
    """
    from ..services import dialogue_service as _dlg
    lines = list(record.dialogue_lines or [])
    if not lines:
        return []
    durations: list[float] = []
    missing: list[int] = []
    for idx, line in enumerate(lines):
        clip = _dlg.line_path(settings, record.id, line.id)
        d = probe_duration(clip)
        if d is None or d <= 0:
            durations.append(0.0)
            missing.append(idx)
        else:
            durations.append(d)
    if missing:
        # Spread the unaccounted-for runtime across lines that had no
        # measurable duration (e.g. cleared cache + stale stitch).
        known_total = sum(durations[i] for i in range(len(durations)) if i not in missing)
        remaining = max(0.0, (fallback_total or 0.0) - known_total)
        if remaining <= 0:
            # Nothing to spread: give each missing line a 1.5 s nominal
            # window so its caption still shows.
            for i in missing:
                durations[i] = 1.5
        else:
            slice_each = remaining / len(missing)
            for i in missing:
                durations[i] = slice_each
    schedule: list[tuple[float, float, str]] = []
    cursor = 0.0
    for line, duration in zip(lines, durations):
        text = (line.text or "").strip()
        end = cursor + max(duration, 0.0)
        if text:
            schedule.append((cursor, end, text))
        cursor = end
    return schedule


@router.post("/{campaign_id}/spokesperson-ad/reels", response_model=Campaign)
def post_spokesperson_reels(
    campaign_id: str,
    settings: Settings = Depends(get_settings),
    store: CampaignStore = Depends(_store),
    finisher: VideoFinisher = Depends(_finisher),
) -> Campaign:
    """PR AG — letterbox the cached Spokesperson Ad into a 720x1280
    vertical MP4. PR AH — burn the saved Commercial Script in as a
    bottom-safe caption overlay. Source must already exist (caller
    surfaces 409 when the talking-head clip hasn't been generated yet).
    """
    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")

    source = host_path_for(settings, campaign_id)
    if not source.exists():
        store.update_reels_fields(
            campaign_id, "spokesperson",
            url=None, status="no_source",
            error="generate the Spokesperson Ad first",
        )
        raise HTTPException(
            status_code=409,
            detail="Generate the Spokesperson Ad before exporting Reels",
        )
    if not is_ffmpeg_available():
        store.update_reels_fields(
            campaign_id, "spokesperson",
            url=None, status="unavailable",
            error="ffmpeg not found on PATH",
        )
        raise HTTPException(
            status_code=503,
            detail="ffmpeg is unavailable on the server",
        )

    target = finisher.spokesperson_reels_path(campaign_id)
    captions = _spokesperson_caption_schedule(record, source)
    backdrop = to_ffmpeg_color(record.brand_color)  # PR AK
    result = finisher.build_reels_export(
        source, target, captions=captions, backdrop_color=backdrop,
    )
    if result.status == "ok":
        updated = store.update_reels_fields(
            campaign_id, "spokesperson",
            url=f"/api/campaigns/{campaign_id}/spokesperson-ad/reels",
            status="ok",
            error=None,
        )
    else:
        logger.warning(
            "spokesperson reels %s campaign=%s err=%s",
            result.status, campaign_id, result.error,
        )
        updated = store.update_reels_fields(
            campaign_id, "spokesperson",
            url=None,
            status=("unavailable" if result.status == "unavailable" else "failed"),
            error=result.error,
        )
        if result.status == "unavailable":
            raise HTTPException(status_code=503, detail=result.error or "ffmpeg unavailable")
        raise HTTPException(status_code=500, detail=result.error or "reels export failed")
    return updated or record


@router.get("/{campaign_id}/spokesperson-ad/reels")
def get_spokesperson_reels(
    campaign_id: str,
    finisher: VideoFinisher = Depends(_finisher),
) -> FileResponse:
    path = finisher.spokesperson_reels_path(campaign_id)
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="No Spokesperson Reels export for this campaign",
        )
    return FileResponse(
        str(path),
        media_type="video/mp4",
        filename=f"adspark-{campaign_id}-spokesperson-reels.mp4",
    )


@router.post("/{campaign_id}/dialogue-scene/reels", response_model=Campaign)
def post_dialogue_scene_reels(
    campaign_id: str,
    settings: Settings = Depends(get_settings),
    store: CampaignStore = Depends(_store),
    finisher: VideoFinisher = Depends(_finisher),
) -> Campaign:
    """PR AG — letterbox the stitched Dialogue Scene into a 720x1280
    vertical MP4. PR AH — burn each saved line's text in as a caption
    overlay timed to that line's segment. Per-line durations come from
    ffprobe over the cached line clips so captions track the actual
    speech in the stitched output.
    """
    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")

    source = finisher.dialogue_scene_path(campaign_id)
    if not source.exists():
        store.update_reels_fields(
            campaign_id, "dialogue_scene",
            url=None, status="no_source",
            error="stitch the dialogue scene first",
        )
        raise HTTPException(
            status_code=409,
            detail="Stitch the Dialogue Scene before exporting Reels",
        )
    if not is_ffmpeg_available():
        store.update_reels_fields(
            campaign_id, "dialogue_scene",
            url=None, status="unavailable",
            error="ffmpeg not found on PATH",
        )
        raise HTTPException(
            status_code=503,
            detail="ffmpeg is unavailable on the server",
        )

    target = finisher.dialogue_scene_reels_path(campaign_id)
    fallback_total = probe_duration(source)
    captions = _dialogue_caption_schedule(record, settings, fallback_total)
    backdrop = to_ffmpeg_color(record.brand_color)  # PR AK
    result = finisher.build_reels_export(
        source, target, captions=captions, backdrop_color=backdrop,
    )
    if result.status == "ok":
        updated = store.update_reels_fields(
            campaign_id, "dialogue_scene",
            url=f"/api/campaigns/{campaign_id}/dialogue-scene/reels",
            status="ok",
            error=None,
        )
    else:
        logger.warning(
            "dialogue scene reels %s campaign=%s err=%s",
            result.status, campaign_id, result.error,
        )
        updated = store.update_reels_fields(
            campaign_id, "dialogue_scene",
            url=None,
            status=("unavailable" if result.status == "unavailable" else "failed"),
            error=result.error,
        )
        if result.status == "unavailable":
            raise HTTPException(status_code=503, detail=result.error or "ffmpeg unavailable")
        raise HTTPException(status_code=500, detail=result.error or "reels export failed")
    return updated or record


@router.get("/{campaign_id}/dialogue-scene/reels")
def get_dialogue_scene_reels(
    campaign_id: str,
    finisher: VideoFinisher = Depends(_finisher),
) -> FileResponse:
    path = finisher.dialogue_scene_reels_path(campaign_id)
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail="No Dialogue Scene Reels export for this campaign",
        )
    return FileResponse(
        str(path),
        media_type="video/mp4",
        filename=f"adspark-{campaign_id}-dialogue-scene-reels.mp4",
    )


# ---- PR H — Brand Voice + Multilingual Dub --------------------------


class BrandVoiceBody(BaseModel):
    description_override: Optional[str] = Field(
        default=None, max_length=600,
        description="overrides the templated voice description",
    )
    force_recreate: bool = Field(default=False)


class DubBody(BaseModel):
    target_lang: str = Field(..., description="ISO 639-1 lang code")


@router.post("/{campaign_id}/brand-voice", response_model=Campaign)
def post_design_brand_voice(
    campaign_id: str,
    body: Optional[BrandVoiceBody] = None,
    settings: Settings = Depends(get_settings),
    store: CampaignStore = Depends(_store),
) -> Campaign:
    """PR H Phase 1 — Design the Brand Voice for this campaign via
    Runway ``/v1/voices`` text design.  Persists voice id + cached
    preview URL on the campaign record.
    """
    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")

    description_override = body.description_override if body else None
    force_recreate = bool(body.force_recreate) if body else False

    result = design_brand_voice(
        record,
        settings,
        description_override=description_override,
        force_recreate=force_recreate,
    )
    if result.status in {"ready", "mock"}:
        logger.info(
            "brand voice %s campaign=%s id=%s",
            result.status, campaign_id, result.voice_id,
        )
        updated = store.update_brand_voice_fields(
            campaign_id,
            brand_voice_id=result.voice_id,
            brand_voice_status=result.status,
            brand_voice_preview_url=result.preview_url,
            brand_voice_error=None,
            brand_voice_mock_mode=result.mock_mode,
        )
    else:
        logger.warning(
            "brand voice %s campaign=%s err=%s",
            result.status, campaign_id, result.error,
        )
        updated = store.update_brand_voice_fields(
            campaign_id,
            brand_voice_id=None,
            brand_voice_status=result.status,
            brand_voice_preview_url=None,
            brand_voice_error=result.error,
            brand_voice_mock_mode=result.mock_mode,
        )
    return updated or record


@router.post("/{campaign_id}/dub", response_model=Campaign)
def post_dub_voice(
    campaign_id: str,
    body: DubBody,
    settings: Settings = Depends(get_settings),
    store: CampaignStore = Depends(_store),
) -> Campaign:
    """PR H Phase 2 — Multilingual Dub. Dubs the cached Brand Voice
    preview MP3 into ``body.target_lang`` via Runway
    ``/v1/voice_dubbing``.  Requires Phase 1 to be ready.
    """
    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")
    target_lang = body.target_lang.strip().lower()
    if target_lang not in SUPPORTED_DUB_LANGS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"unsupported target_lang '{target_lang}'. supported: "
                f"{sorted(SUPPORTED_DUB_LANGS)}"
            ),
        )
    if (
        not record.brand_voice_id
        or record.brand_voice_status not in {"ready", "mock"}
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                "Brand Voice must be designed first. "
                "POST /api/campaigns/{id}/brand-voice."
            ),
        )

    result = dub_brand_voice(record, settings, target_lang)
    if result.status == "ok":
        logger.info(
            "dub ok campaign=%s lang=%s task=%s",
            campaign_id, target_lang, result.task_id,
        )
        updated = store.update_dub_fields(
            campaign_id,
            target_lang=target_lang,
            url=f"/api/campaigns/{campaign_id}/audio/dub-{target_lang}",
            status="ok",
            error=None,
        )
    else:
        logger.warning(
            "dub %s campaign=%s lang=%s err=%s",
            result.status, campaign_id, target_lang, result.error,
        )
        updated = store.update_dub_fields(
            campaign_id,
            target_lang=target_lang,
            url=None,
            status=result.status,
            error=result.error,
        )
    return updated or record


# ---- PR K — Character Studio attachment ---------------------------


def _character_store(settings: Settings = Depends(get_settings)) -> CharacterStore:
    return CharacterStore(settings.data_path)


class AttachCharacterBody(BaseModel):
    character_id: Optional[str] = Field(
        default=None,
        description=(
            "Character to attach to this campaign. Pass null/empty "
            "to detach. When attached, the character's "
            "runway_avatar_id wins over selected_avatar_id and "
            "host_avatar_id for downstream features."
        ),
    )


@router.post("/{campaign_id}/attach-character", response_model=Campaign)
def post_attach_character(
    campaign_id: str,
    body: AttachCharacterBody,
    store: CampaignStore = Depends(_store),
    char_store: CharacterStore = Depends(_character_store),
) -> Campaign:
    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")

    cid = (body.character_id or "").strip() or None
    if cid is not None:
        # Verify the character exists before persisting the attach.
        if not char_store.get(cid):
            raise HTTPException(
                status_code=404,
                detail=f"character {cid!r} not found",
            )

    updated = store.update_character_attachment(campaign_id, cid)
    if not updated:
        raise HTTPException(status_code=404, detail="campaign not found")
    logger.info(
        "campaign %s character_id %s",
        campaign_id, cid if cid else "(detached)",
    )
    return updated


# ---- PR AI — Avatar documents for grounded realtime ----------------
#
# Generate a Markdown campaign brief, POST it to /v1/documents, and
# persist the returned id on the campaign so the realtime broker can
# pass ``documentIds=[...]`` on session create. The same document is
# also best-effort PATCHed onto the resolved Runway avatar so a brand
# that hits the avatar without a campaign-scoped session still sees
# the grounding. Mock mode returns a deterministic id so smoke +
# offline demo flows can flip the grounding badge on without burning
# credits.


@router.post("/{campaign_id}/realtime-document", response_model=Campaign)
def post_attach_realtime_document(
    campaign_id: str,
    settings: Settings = Depends(get_settings),
    store: CampaignStore = Depends(_store),
    char_store: CharacterStore = Depends(_character_store),
) -> Campaign:
    """PR AI — create a Runway document from the saved campaign brief
    and bind it to the realtime grounding flow. Returns the updated
    Campaign with ``runway_document_*`` fields populated.

    Real mode: ``POST /v1/documents`` with the generated Markdown +
    best-effort ``PATCH /v1/avatars/{avatar_id}`` with ``documentIds=[...]``.
    Mock mode: deterministic ``mock_doc_<sha>`` id; the realtime
    broker still includes it in the session body so the UI can display
    a "Document-grounded" badge end-to-end without a Runway key.
    """
    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")

    character: Optional[dict] = None
    if record.character_id:
        char = char_store.get(record.character_id)
        if char:
            character = char.model_dump()

    name, content = build_campaign_brief_markdown(
        record.model_dump(), character,
    )
    if not content:
        raise HTTPException(
            status_code=409,
            detail=(
                "campaign has no content to ground on; fill the brief "
                "and / or save a Commercial Script first."
            ),
        )

    result = runway_create_document(name, content, settings)
    if result.status == "failed" or not result.document_id:
        store.update_realtime_document_fields(
            campaign_id,
            runway_document_id=None,
            runway_document_status="failed",
            runway_document_error=result.error,
            runway_document_mock_mode=result.mock_mode,
        )
        raise HTTPException(
            status_code=502,
            detail=(
                f"document create failed: {result.error or 'unknown error'}"
            ),
        )

    # Best-effort secondary binding: PATCH the avatar so a session
    # opened directly against the avatar (no campaign body) still
    # inherits the document. Skipped in mock mode + when the active
    # avatar is mock/unset. Failure is logged but never breaks the
    # primary per-session grounding path the realtime broker uses.
    avatar_id = host_active_avatar_id(record, settings)
    avatar_status = host_active_avatar_status(record, settings)
    if (
        result.status == "ready"
        and avatar_id
        and avatar_status == "ready"
    ):
        bound = runway_attach_documents(
            avatar_id, [result.document_id], settings,
        )
        if not bound:
            logger.warning(
                "avatar PATCH bind skipped/failed for campaign=%s avatar=%s",
                campaign_id, avatar_id,
            )

    updated = store.update_realtime_document_fields(
        campaign_id,
        runway_document_id=result.document_id,
        runway_document_status=result.status,
        runway_document_error=None,
        runway_document_mock_mode=result.mock_mode,
    )
    logger.info(
        "campaign %s grounded with document %s (status=%s mock=%s)",
        campaign_id, result.document_id, result.status, result.mock_mode,
    )
    return updated or record


# ---- PR I — Realtime Brand Spokesperson session broker -------------


@router.post("/{campaign_id}/spokesperson-session")
def post_spokesperson_session(
    campaign_id: str,
    settings: Settings = Depends(get_settings),
    store: CampaignStore = Depends(_store),
) -> dict:
    """PR I — broker a Runway realtime session for the campaign's host
    avatar. Returns ONLY client-safe fields (session id + session key
    + expiry). The Runway API key never leaves FastAPI.
    """
    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")
    if (
        not host_active_avatar_id(record, settings)
        or host_active_avatar_status(record, settings) not in {"ready"}
    ):
        # Mock avatars are explicitly not allowed here — they're not
        # real Runway resources.  An avatar must be created via
        # /v1/avatars, selected from the picker, or attached via a
        # Character before realtime can fire.
        raise HTTPException(
            status_code=409,
            detail=(
                "A ready Runway Avatar (custom, selected, or via attached "
                "Character) is required before starting a realtime session."
            ),
        )
    try:
        session = realtime_create_session(record, settings)
    except RealtimeUnavailableError as exc:
        # Mock mode hits this path. Use 503 so the frontend can show
        # "available in real mode only" instead of attempting WebRTC.
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "realtime upstream error: %s %s",
            exc.response.status_code, exc.response.text[:200],
        )
        raise HTTPException(
            status_code=502,
            detail=f"runway upstream {exc.response.status_code}",
        ) from exc
    except Exception as exc:  # pragma: no cover — defensive
        logger.exception("realtime broker crashed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    logger.info(
        "realtime session ok campaign=%s session=%s avatar=%s",
        campaign_id, session.session_id, session.avatar_id,
    )
    # PR AJ — Runway's session id doubles as the conversation id for
    # transcript / recording retrieval (deep review §7). Capture it
    # now so a follow-up POST /realtime-transcript can pull the
    # transcript without an extra parameter from the operator.
    if session.session_id:
        try:
            store.update_runway_conversation_id(campaign_id, session.session_id)
        except Exception:  # pragma: no cover — defensive: persistence
            # is a side effect; never let it break the live broker.
            logger.exception(
                "could not persist conversation id for campaign=%s session=%s",
                campaign_id, session.session_id,
            )
    return {
        "session_id": session.session_id,
        "session_key": session.session_key,
        "expires_at": session.expires_at,
        "avatar_id": session.avatar_id,
    }


# ---- PR AJ — Conversation Transcript Retrieval --------------------
#
# Runway's realtime ``sessionId`` doubles as the conversation id (deep
# review §7). After a session ends, AdSpark fetches the transcript via
# ``GET /v1/avatar_conversations/{id}`` and persists the structured
# turns so the Realtime tab can render a replay UX. Mock mode returns
# a deterministic 3-turn conversation derived from the saved campaign
# brief so the replay flow is demoable / testable without keys.


class TranscriptFetchBody(BaseModel):
    """Optional override so an operator can replay a conversation that
    wasn't created from this AdSpark instance (e.g. someone shared a
    sessionId with them out of band).
    """

    conversation_id: Optional[str] = Field(
        default=None,
        max_length=128,
        description=(
            "Optional Runway sessionId / conversationId to fetch instead "
            "of the one persisted on the campaign."
        ),
    )


# ---- PR BC — transcript history helper ----------------------------
#
# Centralised so every branch of the transcript route appends entries
# with a consistent shape. Best-effort: the wrapper logs a warning on
# failure but never aborts the underlying transcript fetch flow.


def _append_transcript_history_safe(
    store: CampaignStore,
    campaign_id: str,
    *,
    fetched_at,
    conversation_id: Optional[str],
    status: Optional[str],
    turns,
    mock_mode: Optional[bool],
    error: Optional[str] = None,
) -> Optional[Campaign]:
    """Append one entry; returns the updated Campaign so the route
    can return the post-append snapshot. ``None`` when the campaign
    id is unknown OR when the append raises (best-effort).
    """
    from datetime import datetime as _dt, timezone as _tz  # local import keeps top tidy
    serialised_turns: list = []
    if turns:
        for t in turns:
            try:
                if hasattr(t, "model_dump"):
                    serialised_turns.append(t.model_dump())
                elif isinstance(t, dict):
                    serialised_turns.append(dict(t))
            except Exception:  # pragma: no cover - history is best-effort
                continue
    when = fetched_at or _dt.now(_tz.utc)
    entry = {
        "fetched_at": when.isoformat() if hasattr(when, "isoformat") else str(when),
        "conversation_id": conversation_id,
        "status": status,
        "turn_count": len(serialised_turns),
        "turns": serialised_turns,
        "mock_mode": mock_mode,
        "error": error,
    }
    try:
        return store.append_transcript_history(campaign_id, entry)
    except Exception as exc:  # pragma: no cover - audit is best-effort
        logger.warning(
            "transcript history append failed for campaign %s status=%s: %s",
            campaign_id, status, exc,
        )
        return None


@router.post("/{campaign_id}/realtime-transcript", response_model=Campaign)
def post_fetch_realtime_transcript(
    campaign_id: str,
    body: Optional[TranscriptFetchBody] = None,
    settings: Settings = Depends(get_settings),
    store: CampaignStore = Depends(_store),
    char_store: CharacterStore = Depends(_character_store),
) -> Campaign:
    """PR AJ — fetch the transcript for the most recent realtime
    session on this campaign and persist it for replay. Returns the
    updated Campaign with ``realtime_transcript_*`` fields populated.

    Real mode: requires a persisted ``runway_conversation_id`` (or an
    explicit ``conversation_id`` override on the body); 409 otherwise.
    Mock mode: short-circuits to a deterministic 3-turn replay built
    from the campaign brief; the conversation id is a stable
    ``mock_conv_<sha-of-campaign-id>`` so re-fetches return the same
    handle and the replay UX stays predictable.
    """
    record = store.get(campaign_id)
    if not record:
        raise HTTPException(status_code=404, detail="campaign not found")

    override = (body.conversation_id or "").strip() if body else ""
    has_id_real_mode = bool(record.runway_conversation_id) or bool(override)
    if not settings.runway_mock and not has_id_real_mode:
        # Don't waste a Runway round-trip; the operator hasn't run a
        # session yet. Persist the no_session state so the UI can
        # render the explanatory copy without a second call.
        store.update_realtime_transcript_fields(
            campaign_id,
            runway_conversation_id=None,
            realtime_transcript_status="no_session",
            realtime_transcript_error=(
                "no realtime session has been created for this campaign yet"
            ),
            realtime_transcript_fetched_at=None,
            realtime_transcript_turns=None,  # leave any cached turns alone
            realtime_transcript_mock_mode=False,
        )
        # PR BC — record the no-session resolution in the audit trail
        # so the operator can see when a fetch was attempted before
        # any session existed.
        _append_transcript_history_safe(
            store,
            campaign_id,
            fetched_at=None,
            conversation_id=None,
            status="no_session",
            turns=None,
            mock_mode=False,
            error="no realtime session has been created for this campaign yet",
        )
        raise HTTPException(
            status_code=409,
            detail=(
                "no realtime session for this campaign yet — start a "
                "conversation first, or pass conversation_id in the body."
            ),
        )

    character: Optional[dict] = None
    if record.character_id:
        char = char_store.get(record.character_id)
        if char:
            character = char.model_dump()

    result: TranscriptResult = runway_fetch_transcript(
        record,
        settings,
        character=character,
        conversation_id_override=override or None,
    )

    persisted_id = result.conversation_id or record.runway_conversation_id
    turns_serialised = (
        [t.model_dump() for t in result.turns] if result.turns else []
    )

    if result.status in {"failed", "empty", "no_session"}:
        logger.warning(
            "transcript fetch %s campaign=%s err=%s",
            result.status, campaign_id, result.error,
        )
        # Preserve any previously-fetched turns when the new fetch
        # comes back empty / failed; only clear them on an explicit
        # successful re-fetch (which we handle in the ok branch).
        updated = store.update_realtime_transcript_fields(
            campaign_id,
            runway_conversation_id=persisted_id,
            realtime_transcript_status=result.status,
            realtime_transcript_error=result.error,
            realtime_transcript_fetched_at=result.fetched_at,
            realtime_transcript_turns=None,
            realtime_transcript_mock_mode=result.mock_mode,
        )
        # PR BC — log the failure / empty / no-session resolution in
        # the audit trail. Turns stay empty for these states so the
        # row carries diagnostic value (status + error) rather than
        # replayable content. Captures the post-append snapshot so
        # the response includes the freshly-added history row.
        post_history = _append_transcript_history_safe(
            store,
            campaign_id,
            fetched_at=result.fetched_at,
            conversation_id=persisted_id,
            status=result.status,
            turns=None,
            mock_mode=result.mock_mode,
            error=result.error,
        )
        if result.status == "failed":
            raise HTTPException(
                status_code=502,
                detail=f"transcript fetch failed: {result.error}",
            )
        return post_history or updated or record

    updated = store.update_realtime_transcript_fields(
        campaign_id,
        runway_conversation_id=persisted_id,
        realtime_transcript_status=result.status,
        realtime_transcript_error=None,
        realtime_transcript_fetched_at=result.fetched_at,
        realtime_transcript_turns=turns_serialised,
        realtime_transcript_mock_mode=result.mock_mode,
    )
    logger.info(
        "transcript fetched campaign=%s conversation=%s turns=%d mock=%s",
        campaign_id, persisted_id, len(turns_serialised), result.mock_mode,
    )
    # PR BC — log the successful (or mock) fetch in the audit trail.
    # Stores the full turns array so a future surface can render
    # historical replays without a second backend call. Captures the
    # post-append snapshot so the response includes the freshly-
    # added history row.
    post_history = _append_transcript_history_safe(
        store,
        campaign_id,
        fetched_at=result.fetched_at,
        conversation_id=persisted_id,
        status=result.status,
        turns=result.turns,
        mock_mode=result.mock_mode,
        error=None,
    )
    return post_history or updated or record


@router.delete("/{campaign_id}/spokesperson-session/{session_id}")
def delete_spokesperson_session(
    campaign_id: str,
    session_id: str,
    settings: Settings = Depends(get_settings),
) -> dict:
    """PR I — best-effort DELETE for clean teardown when the user clicks
    End Conversation. Always returns 200 with an ``ok`` boolean even if
    Runway already cancelled the session — the frontend's behaviour
    shouldn't depend on the result.
    """
    ok = realtime_delete_session(session_id, settings)
    return {"ok": ok, "session_id": session_id}


@router.get("/{campaign_id}/audio/{kind}")
def get_campaign_audio(
    campaign_id: str,
    kind: str,
    settings: Settings = Depends(get_settings),
) -> FileResponse:
    """Stream a campaign audio artefact. ``kind`` ∈ {voice-preview, dub-<lang>}."""
    path = path_for_audio(settings, campaign_id, kind)
    if path is None:
        raise HTTPException(status_code=400, detail=f"unsupported audio kind '{kind}'")
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"no {kind} audio for this campaign")
    return FileResponse(
        str(path),
        media_type="audio/mpeg",
        filename=f"adspark-{campaign_id}-{kind}.mp3",
    )
