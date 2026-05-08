from fastapi import APIRouter, Depends

from ..config import Settings, get_settings
from ..models import Campaign, CampaignCreate, CampaignList
from ..services.storage import CampaignStore

router = APIRouter(prefix="/api/campaigns", tags=["campaigns"])


def _store(settings: Settings = Depends(get_settings)) -> CampaignStore:
    return CampaignStore(settings.data_path)


@router.post("", response_model=Campaign)
def create_campaign(payload: CampaignCreate, store: CampaignStore = Depends(_store)) -> Campaign:
    return store.create(payload)


@router.get("", response_model=CampaignList)
def list_campaigns(store: CampaignStore = Depends(_store)) -> CampaignList:
    return CampaignList(campaigns=store.list())
