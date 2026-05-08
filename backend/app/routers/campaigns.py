import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ..config import Settings, get_settings
from ..models import Campaign, CampaignCreate, CampaignList
from ..services.character_host_client import (
    SUPPORTED_VOICE_PRESETS,
    create_or_reuse_avatar,
    generate_host_video,
    path_for as host_path_for,
)
from ..services.finisher_service import (
    FORMAT_DIMS,
    LANDSCAPE,
    VideoFinisher,
    is_ffmpeg_available,
)
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


# ---- PR F — Brand Spokesperson Avatar + Avatar Host Clip ------------


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
    force_recreate: bool = Field(
        default=False,
        description="discard the cached avatar id and create a new one",
    )


class HostVideoBody(BaseModel):
    script_override: Optional[str] = Field(
        default=None, max_length=300, description="overrides the templated script"
    )


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
    force_recreate = bool(body.force_recreate) if body else False

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
    if not record.host_avatar_id or record.host_avatar_status not in {"ready", "mock"}:
        raise HTTPException(
            status_code=409,
            detail=(
                "Brand Spokesperson Avatar must be created first. "
                "POST /api/campaigns/{id}/avatar."
            ),
        )

    script_override = body.script_override if body else None
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
