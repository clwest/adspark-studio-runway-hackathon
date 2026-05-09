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
    # PR AK — Brand color. Optional ``#RRGGBB`` hex; the reels pipeline
    # passes this to ffmpeg's ``pad=…:color=…`` so vertical exports
    # adopt brand-themed letterbox bars instead of the default dark
    # slate. Validation lives in ``services.color_utils.normalize_brand_color``;
    # invalid values fall back to the default colour rather than 422-ing
    # the save (mirrors PR AA's "empty script clears" semantics).
    brand_color: Optional[str] = None


CacheStatus = Literal["ok", "failed", "skipped"]
FinishStatus = Literal["ok", "failed", "unavailable"]
HostStatus = Literal["ok", "failed", "unavailable"]


# ---- PR Z — Storyboard Commercial Builder --------------------------

StoryboardShotStatus = Literal["idle", "pending", "running", "ok", "failed"]


# ---- PR AF — Multi-Character Dialogue Scene Builder ---------------

DialogueLineStatus = Literal["idle", "pending", "running", "ok", "failed"]


class DialogueLine(BaseModel):
    id: str  # "line-1" / "line-2" / "line-3"
    character_id: Optional[str] = None
    character_name: Optional[str] = None
    avatar_id: Optional[str] = None
    text: str = ""
    status: DialogueLineStatus = "idle"
    task_id: Optional[str] = None
    video_url: Optional[str] = None  # /api/campaigns/{id}/dialogue/line/{line_id}
    cache_filename: Optional[str] = None
    error: Optional[str] = None
    mock_mode: Optional[bool] = None


class TranscriptTurn(BaseModel):
    """PR AJ — one turn of a recorded realtime conversation. Mirrors
    Runway's documented ``transcript[]`` shape from
    ``GET /v1/avatar_conversations/{id}`` while staying tolerant of
    the field-name variance the deep review notes
    (``role``/``speaker``, ``text``/``content``, ``timestamp``/``at``).
    """

    role: Literal["avatar", "user", "system"] = "system"
    speaker: Optional[str] = None
    text: str
    timestamp: Optional[str] = None


# ---- PR BC — Per-campaign transcript history audit trail ----------

TranscriptHistoryStatus = Literal[
    "ok", "failed", "mock", "empty", "no_session"
]


class TranscriptHistoryEntry(BaseModel):
    """PR BC — one entry in a campaign's transcript audit trail. The
    realtime transcript route (``POST /realtime-transcript``)
    persists the most recent fetch in the campaign's
    ``realtime_transcript_*`` fields and ALSO appends one of these
    entries to ``realtime_transcript_history`` so operators can
    review prior fetches over time.

    The store caps each campaign's history at the most recent 20
    entries (``TRANSCRIPT_HISTORY_MAX`` in ``storage.py``) so the
    JSON record never bloats over a long demo session.
    """

    fetched_at: datetime
    conversation_id: Optional[str] = None
    status: Optional[TranscriptHistoryStatus] = None
    turn_count: int = 0
    turns: list[TranscriptTurn] = []
    mock_mode: Optional[bool] = None
    error: Optional[str] = None


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
    # PR AF — Multi-Character Dialogue Scene Builder. Sequential
    # talking-avatar lines stitched into one MP4 — like an Office-style
    # branded skit. Each line targets a specific character's
    # runway_avatar_id; ffmpeg concat preserves audio across lines.
    dialogue_lines: list["DialogueLine"] = []
    dialogue_scene_status: Optional[Literal[
        "idle", "planning", "ready", "stitching", "ok", "failed"
    ]] = None
    dialogue_scene_video_url: Optional[str] = None
    dialogue_scene_error: Optional[str] = None
    # PR AG — Vertical / Reels export. Letterbox the existing
    # Spokesperson Ad and Dialogue Scene MP4s into 720x1280 with a
    # brand-coloured backdrop so the same renders are immediately
    # postable to TikTok / Reels / Shorts. No new Runway calls.
    spokesperson_reels_url: Optional[str] = None
    spokesperson_reels_status: Optional[Literal[
        "ok", "failed", "no_source", "unavailable"
    ]] = None
    spokesperson_reels_error: Optional[str] = None
    dialogue_scene_reels_url: Optional[str] = None
    dialogue_scene_reels_status: Optional[Literal[
        "ok", "failed", "no_source", "unavailable"
    ]] = None
    dialogue_scene_reels_error: Optional[str] = None
    # PR AI — Avatar documentIds for grounded realtime. ``runway_document_id``
    # holds the id returned by ``POST /v1/documents`` for the campaign's
    # generated brand brief; the realtime broker passes it as ``documentIds``
    # on session create so the live avatar grounds answers in the brief
    # text instead of relying solely on the inline ``personality`` string.
    runway_document_id: Optional[str] = None
    runway_document_status: Optional[Literal[
        "ready", "failed", "mock"
    ]] = None
    runway_document_error: Optional[str] = None
    runway_document_mock_mode: Optional[bool] = None
    # PR AJ — Conversation Transcript Retrieval. The realtime
    # session's id doubles as the conversation id (Runway docs
    # ``characters/conversations/``); we capture it after a
    # successful session create so a follow-up fetch can pull the
    # transcript + recording. Mock mode uses a deterministic
    # ``mock_conv_<sha>`` so the replay UX still demos without keys.
    runway_conversation_id: Optional[str] = None
    realtime_transcript_status: Optional[Literal[
        "ok", "failed", "mock", "empty", "no_session"
    ]] = None
    realtime_transcript_error: Optional[str] = None
    realtime_transcript_fetched_at: Optional[datetime] = None
    realtime_transcript_turns: list["TranscriptTurn"] = []
    realtime_transcript_mock_mode: Optional[bool] = None
    # PR BC — transcript audit trail. Each successful (or resolved
    # failure) fetch appends a compact ``TranscriptHistoryEntry`` to
    # this list (newest first). Capped at the most recent 20 entries
    # by the store so the JSON record never grows unbounded across
    # long demo sessions. Latest fetch state remains in the
    # ``realtime_transcript_*`` fields above so existing UI / export
    # surfaces continue operating against the latest fetch.
    realtime_transcript_history: list["TranscriptHistoryEntry"] = []


class CampaignList(BaseModel):
    campaigns: list[Campaign]


# ---- PR K — Character Studio --------------------------------------

CharacterTemplate = Literal["mascot", "founder", "coach", "local_guide"]
CharacterAvatarStatus = Literal["pending", "ready", "failed", "mock"]
PortraitSource = Literal["generated", "uploaded", "stock", "mock"]


# ---- PR BB — Voice repair / apply audit trail ---------------------

VoiceHistoryAction = Literal["clone", "apply", "repair", "refresh", "verify"]


class VoiceRepairHistoryEntry(BaseModel):
    """PR BB — single audit-trail entry for a voice clone/apply/repair/
    refresh event. Compact by design — one row per operator action.

    The store caps each character's history at the most recent 20
    entries (``VOICE_HISTORY_MAX`` in ``character_store.py``) so the
    JSON record never bloats over a long demo session.
    """

    timestamp: datetime
    action: VoiceHistoryAction
    before_voice_id: Optional[str] = None
    after_voice_id: Optional[str] = None
    resolved_voice_id: Optional[str] = None
    drift_status: Optional[Literal["match", "drift", "unknown"]] = None
    # ``status`` mirrors the action's primary outcome string —
    # PR AN clone status (ready/mock/failed), PR AQ apply_result
    # status (applied/mock_patched/pending_avatar/failed), or PR AS
    # verify state (verified/mock_verified/unverified/failed).
    status: Optional[str] = None
    error: Optional[str] = None
    mock_mode: Optional[bool] = None


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
    # PR AN — Custom voice cloning foundation. ``custom_voice_id`` is
    # the Runway voice id returned by ``POST /v1/voices`` with
    # ``from.type=audio`` (or a deterministic ``mock_voice_<sha>`` in
    # mock mode). When set, downstream avatar creation prefers
    # ``voice: {type: "custom", voiceId: <id>}`` over the runway-live-
    # preset binding.
    custom_voice_id: Optional[str] = None
    custom_voice_name: Optional[str] = None
    custom_voice_status: Optional[Literal["ready", "failed", "mock"]] = None
    custom_voice_error: Optional[str] = None
    custom_voice_mock_mode: Optional[bool] = None
    # PR AR — Runway voice ``previewUrl`` from the READY poll
    # response. ``None`` in mock mode (no playable URL) and when the
    # poll didn't surface one before timeout. UI surfaces an inline
    # `<audio controls>` when set, or "Preview unavailable" copy
    # when the voice exists but the URL doesn't.
    custom_voice_preview_url: Optional[str] = None
    # PR AQ — Avatar PATCH for custom voice swap. After a successful
    # clone, AdSpark auto-PATCHes the existing Runway avatar (when
    # one is bound) so the cloned voice applies without an avatar
    # recreate. ``pending_avatar`` is the safe baseline when no
    # avatar exists yet — the next Create Runway Avatar will bind
    # the voice via the PR AN create-avatar payload.
    custom_voice_avatar_patch_status: Optional[Literal[
        "applied", "mock_patched", "failed", "pending_avatar"
    ]] = None
    custom_voice_avatar_patch_error: Optional[str] = None
    custom_voice_avatar_patched_at: Optional[datetime] = None
    # PR AS — Avatar resource introspection. After a successful
    # PATCH (PR AQ), `GET /v1/avatars/{id}` confirms the avatar's
    # voice binding actually landed. ``avatar_voice_resolved_*`` are
    # the values pulled from the avatar's voice block (defensive
    # extraction tolerates Runway shape changes); ``status`` /
    # ``verified_at`` / ``verify_error`` mirror the introspection
    # outcome (verified / mock_verified / unverified / failed).
    avatar_voice_resolved_type: Optional[str] = None
    avatar_voice_resolved_id: Optional[str] = None
    avatar_voice_resolved_label: Optional[str] = None
    avatar_voice_verify_status: Optional[Literal[
        "verified", "mock_verified", "unverified", "failed"
    ]] = None
    avatar_voice_verified_at: Optional[datetime] = None
    avatar_voice_verify_error: Optional[str] = None
    # PR AT — drift detection. Compares ``custom_voice_id`` to
    # ``avatar_voice_resolved_id`` after every PR AQ PATCH + PR AS
    # verify. The UI surfaces a single drift-aware pill instead of
    # inferring from the underlying ids.
    avatar_voice_drift_status: Optional[Literal[
        "match", "drift", "unknown"
    ]] = None
    # PR BB — Voice repair/apply audit trail. Each clone / apply /
    # repair / refresh appends a compact entry to this list (newest
    # first). Capped at the most recent 20 entries by the store so
    # the JSON record never grows unbounded over a long demo session.
    voice_repair_history: list[VoiceRepairHistoryEntry] = []

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
