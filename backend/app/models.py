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
    # PR AC — script-first save. The frontend can persist the
    # author-edited Commercial Script in the same atomic CampaignCreate
    # write so the script lives on the record from the very first save
    # (instead of requiring a follow-up POST /script call).
    commercial_script: Optional[str] = None


CacheStatus = Literal["ok", "failed", "skipped"]
FinishStatus = Literal["ok", "failed", "unavailable"]
HostStatus = Literal["ok", "failed", "unavailable"]


# ---- PR Z — Storyboard Commercial Builder --------------------------

StoryboardShotStatus = Literal["idle", "pending", "running", "ok", "failed"]


class StoryboardShot(BaseModel):
    id: str  # "shot-1" / "shot-2" / "shot-3"
    label: str  # human-readable beat label ("Hook" / "Action" / "Payoff")
    prompt: str
    source_image_url: Optional[str] = None
    task_id: Optional[str] = None
    status: StoryboardShotStatus = "idle"
    video_url: Optional[str] = None  # /api/campaigns/{id}/storyboard/shot/<shot_id>
    cache_filename: Optional[str] = None  # filename only; full path resolved server-side
    duration: int = 5
    error: Optional[str] = None
    mock_mode: Optional[bool] = None


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
    # PR I+ — Avatar Picker. When set, takes precedence over
    # host_avatar_id for both the Avatar Host Clip and the realtime
    # Spokesperson session. Falls back to host_avatar_id when null.
    selected_avatar_id: Optional[str] = None
    selected_avatar_name: Optional[str] = None
    selected_avatar_source: Optional[Literal["preset", "custom", "stock", "campaign", "unknown"]] = None
    selected_avatar_thumbnail_url: Optional[str] = None
    # PR K — Character Studio. When set, takes precedence over
    # selected_avatar_id and host_avatar_id. Resolution order:
    # character.runway_avatar_id > selected_avatar_id > host_avatar_id.
    character_id: Optional[str] = None
    generated_character_prompt: Optional[str] = None
    # PR H — Brand Voice Studio + Multilingual Dub Pack
    brand_voice_id: Optional[str] = None
    brand_voice_status: Optional[Literal["pending", "ready", "failed", "mock"]] = None
    brand_voice_preview_url: Optional[str] = None  # local /api/campaigns/{id}/audio/voice-preview
    brand_voice_error: Optional[str] = None
    brand_voice_mock_mode: Optional[bool] = None
    dubbed_audio_urls: dict[str, str] = {}  # lang_code -> /api/campaigns/{id}/audio/dub-{lang}
    dub_statuses: dict[str, str] = {}       # lang_code -> "ok" | "failed"
    dub_errors: dict[str, str] = {}         # lang_code -> error message
    # PR S — Commercial with Voice. Combines the silent visual cut with the
    # Avatar Host Clip's audio track via local ffmpeg. All optional;
    # backward-compatible with old campaign records that predate the field.
    voiced_commercial_url: Optional[str] = None
    voiced_commercial_status: Optional[Literal["ok", "failed", "no_video", "no_host", "no_audio", "unavailable"]] = None
    voiced_commercial_error: Optional[str] = None
    # PR Z — Storyboard Commercial Builder. Three image-to-video shots
    # stitched into a longer commercial via ffmpeg. Shots are
    # individually retryable; stitch refuses until all are `ok`.
    storyboard_shots: list["StoryboardShot"] = []
    storyboard_status: Optional[Literal[
        "idle", "planning", "ready", "stitching", "ok", "failed"
    ]] = None
    storyboard_video_url: Optional[str] = None
    storyboard_error: Optional[str] = None
    storyboard_voiced_url: Optional[str] = None
    storyboard_voiced_status: Optional[Literal[
        "ok", "failed", "no_video", "no_host", "no_audio", "unavailable"
    ]] = None
    storyboard_voiced_error: Optional[str] = None
    # PR AA — Script-first voiced commercial flow. The user (or the
    # deterministic builder) writes a Commercial Script before the
    # spokesperson clip is generated; downstream host-video + voiced-
    # commercial passes use this when present, falling back to
    # `character_host_client.build_script` otherwise.
    commercial_script: Optional[str] = None
    commercial_script_updated_at: Optional[datetime] = None


class CampaignList(BaseModel):
    campaigns: list[Campaign]


# ---- PR K — Character Studio --------------------------------------

CharacterTemplate = Literal["mascot", "founder", "coach", "local_guide"]
CharacterAvatarStatus = Literal["pending", "ready", "failed", "mock"]
PortraitSource = Literal["generated", "uploaded", "stock", "mock"]


class Character(BaseModel):
    id: str
    slug: str
    name: str
    template: CharacterTemplate = "mascot"
    subject: Optional[str] = None
    style: Optional[str] = None

    personality: Optional[str] = None
    catchphrases: list[str] = []
    voice_preset: str = "vincent"

    # Portrait — local cache lives at backend/data/characters/<id>-portrait.png
    portrait_url: Optional[str] = None  # /api/characters/{id}/portrait
    portrait_source: Optional[PortraitSource] = None
    portrait_prompt: Optional[str] = None

    # Runway avatar binding
    runway_avatar_id: Optional[str] = None
    runway_avatar_status: Optional[CharacterAvatarStatus] = None
    runway_avatar_thumbnail_url: Optional[str] = None
    runway_avatar_error: Optional[str] = None

    # Provenance
    source_campaign_id: Optional[str] = None
    mock_mode: Optional[bool] = None
    metadata: dict = {}

    created_at: datetime
    updated_at: datetime


class CharacterCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    template: CharacterTemplate = "mascot"
    subject: Optional[str] = Field(default=None, max_length=300)
    style: Optional[str] = Field(default=None, max_length=300)
    personality: Optional[str] = Field(default=None, max_length=600)
    catchphrases: list[str] = []
    voice_preset: Optional[str] = None
    source_campaign_id: Optional[str] = None


class CharacterList(BaseModel):
    characters: list[Character]
