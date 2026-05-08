import logging
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
    create_or_reuse_avatar,
    generate_host_video,
    path_for as host_path_for,
)
from ..services.character_store import CharacterStore
from ..services.realtime_avatar_client import (
    RealtimeUnavailableError,
    create_session as realtime_create_session,
    delete_session as realtime_delete_session,
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
    return {
        "session_id": session.session_id,
        "session_key": session.session_key,
        "expires_at": session.expires_at,
        "avatar_id": session.avatar_id,
    }


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
