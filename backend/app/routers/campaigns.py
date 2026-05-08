import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from ..config import Settings, get_settings
from ..models import Campaign, CampaignCreate, CampaignList
from ..services.storage import CampaignStore, VideoCache

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/campaigns", tags=["campaigns"])


def _store(settings: Settings = Depends(get_settings)) -> CampaignStore:
    return CampaignStore(settings.data_path)


def _video_cache(settings: Settings = Depends(get_settings)) -> VideoCache:
    return VideoCache(settings.data_path)


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
