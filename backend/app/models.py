from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class ConceptRequest(BaseModel):
    business: str = Field(..., min_length=2, max_length=200)
    product: str = Field("", max_length=200)
    tone: str = Field("cinematic", max_length=80)
    audience: str = Field("", max_length=200)


class AdConcept(BaseModel):
    title: str
    hook: str
    visual: str
    caption: str
    cta: str


class ConceptResponse(BaseModel):
    concepts: list[AdConcept]
    recommended_index: int = 0
    runway_prompt: str
    mock_mode: bool


SUPPORTED_VIDEO_MODELS = ("gen4_turbo", "gen4.5")


class RunwayGenerateRequest(BaseModel):
    prompt_text: str = Field(..., min_length=4, max_length=1000)
    prompt_image: Optional[str] = None
    duration: int = Field(5, ge=5, le=10)
    ratio: str = Field("1280:720")
    model: Optional[str] = None


class RunwayGenerateResponse(BaseModel):
    task_id: str
    status: str
    mock_mode: bool
    model: Optional[str] = None
    endpoint: Optional[str] = None  # "image_to_video" | "text_to_video"


class ImageGenerateRequest(BaseModel):
    prompt_text: str = Field(..., min_length=4, max_length=1000)
    ratio: str = Field("1280:720")


class ImageGenerateResponse(BaseModel):
    image_id: str
    image_url: str
    mock_mode: bool
    model: str


TaskStatus = Literal["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"]


class RunwayTaskResponse(BaseModel):
    task_id: str
    status: TaskStatus
    progress: float = 0.0
    output: list[str] = []
    failure_reason: Optional[str] = None
    mock_mode: bool


class CampaignSocialPost(BaseModel):
    caption: str
    cta: str
    hashtags: list[str] = []


class CampaignCreate(BaseModel):
    business: str
    product: str = ""
    tone: str = ""
    audience: str = ""
    selected_concept: AdConcept
    runway_prompt: str
    runway_task_id: Optional[str] = None
    runway_model: Optional[str] = None
    reference_image_url: Optional[str] = None
    video_url: Optional[str] = None
    social_post: CampaignSocialPost


CacheStatus = Literal["ok", "failed", "skipped"]
FinishStatus = Literal["ok", "failed", "unavailable"]
HostStatus = Literal["ok", "failed", "unavailable"]


class Campaign(CampaignCreate):
    id: str
    created_at: datetime
    cached_video_url: Optional[str] = None
    cache_status: Optional[CacheStatus] = None
    cache_error: Optional[str] = None
    finished_video_url: Optional[str] = None  # legacy: mirrors finished_videos["landscape"]
    finished_videos: dict[str, str] = {}  # PR B: per-format URLs
    finish_status: Optional[FinishStatus] = None  # status of the most recent finish op
    finish_error: Optional[str] = None  # error from the most recent finish op
    # PR F — Brand Spokesperson Avatar (per-campaign Runway Avatar) +
    # Avatar Host Clip (avatar_videos task output).
    host_avatar_id: Optional[str] = None
    host_avatar_status: Optional[Literal["pending", "ready", "failed", "mock"]] = None
    host_avatar_image_url: Optional[str] = None  # processed thumbnail from Runway
    host_avatar_image_source: Optional[Literal["campaign", "stock", "override"]] = None
    host_avatar_error: Optional[str] = None
    host_video_url: Optional[str] = None
    host_status: Optional[HostStatus] = None
    host_error: Optional[str] = None
    host_task_id: Optional[str] = None
    host_mock_mode: Optional[bool] = None


class CampaignList(BaseModel):
    campaigns: list[Campaign]
