"""Character Studio routes (PR K).

Eight V1 endpoints under ``/api/characters/*`` plus the integration
point ``POST /api/campaigns/{id}/attach-character`` which lives in
the campaigns router.

Locked design in
``docs/research/CHARACTER_STUDIO_SPIKE.md`` §§4-6.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ..config import Settings, get_settings
from ..models import Character, CharacterCreate, CharacterList
from ..services.character_store import CharacterStore
from ..services.character_studio_client import (
    create_avatar as studio_create_avatar,
    generate_portrait as studio_generate_portrait,
    PORTRAIT_TEMPLATES,
)
from ..services.character_host_client import SUPPORTED_VOICE_PRESETS
from ..services.voice_clone_client import (
    MAX_AUDIO_BYTES,
    SUPPORTED_AUDIO_MIMES,
    clone_voice_from_audio,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/characters", tags=["characters"])


def _store(settings: Settings = Depends(get_settings)) -> CharacterStore:
    return CharacterStore(settings.data_path)


# ---- request bodies ----------------------------------------------


class GeneratePortraitBody(BaseModel):
    template: Optional[str] = Field(default=None, description="mascot|founder|coach|local_guide")
    subject: Optional[str] = Field(default=None, max_length=300)
    style: Optional[str] = Field(default=None, max_length=300)
    prompt_override: Optional[str] = Field(default=None, max_length=1000)


class CreateAvatarBody(BaseModel):
    voice_preset: Optional[str] = Field(default=None)
    personality_override: Optional[str] = Field(default=None, max_length=600)


# ---- routes -------------------------------------------------------


@router.get("", response_model=CharacterList)
def list_characters(store: CharacterStore = Depends(_store)) -> CharacterList:
    return CharacterList(characters=store.list())


@router.post("", response_model=Character)
def create_character(
    payload: CharacterCreate,
    store: CharacterStore = Depends(_store),
) -> Character:
    if payload.template not in PORTRAIT_TEMPLATES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"unsupported template '{payload.template}'. "
                f"supported: {sorted(PORTRAIT_TEMPLATES)}"
            ),
        )
    if payload.voice_preset and payload.voice_preset.lower() not in SUPPORTED_VOICE_PRESETS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"unsupported voice_preset '{payload.voice_preset}'. "
                f"supported: {sorted(SUPPORTED_VOICE_PRESETS)}"
            ),
        )
    record = store.create(payload)
    logger.info("character created id=%s name=%s template=%s", record.id, record.name, record.template)
    return record


@router.get("/{character_id}", response_model=Character)
def get_character(
    character_id: str,
    store: CharacterStore = Depends(_store),
) -> Character:
    record = store.get(character_id)
    if not record:
        raise HTTPException(status_code=404, detail="character not found")
    return record


@router.post("/{character_id}/generate-portrait", response_model=Character)
def post_generate_portrait(
    character_id: str,
    body: Optional[GeneratePortraitBody] = None,
    settings: Settings = Depends(get_settings),
    store: CharacterStore = Depends(_store),
) -> Character:
    record = store.get(character_id)
    if not record:
        raise HTTPException(status_code=404, detail="character not found")

    template = (body.template if body else None) or record.template
    if template not in PORTRAIT_TEMPLATES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"unsupported template '{template}'. "
                f"supported: {sorted(PORTRAIT_TEMPLATES)}"
            ),
        )

    portrait_path = store.portrait_path(character_id)
    result = studio_generate_portrait(
        record,
        portrait_path,
        settings,
        template=template,
        subject=body.subject if body else None,
        style=body.style if body else None,
        prompt_override=body.prompt_override if body else None,
    )

    if result.status == "ok":
        updated = store.update(
            character_id,
            portrait_url=result.portrait_url,
            portrait_source=result.portrait_source,
            portrait_prompt=result.portrait_prompt,
            template=template,
            subject=(body.subject if body else None) or record.subject,
            style=(body.style if body else None) or record.style,
            mock_mode=result.mock_mode,
        )
    else:
        logger.warning(
            "portrait failed character=%s err=%s", character_id, result.error,
        )
        raise HTTPException(
            status_code=502 if not result.mock_mode else 500,
            detail=result.error or "portrait generation failed",
        )
    return updated or record


@router.post("/{character_id}/create-avatar", response_model=Character)
def post_create_avatar(
    character_id: str,
    body: Optional[CreateAvatarBody] = None,
    settings: Settings = Depends(get_settings),
    store: CharacterStore = Depends(_store),
) -> Character:
    record = store.get(character_id)
    if not record:
        raise HTTPException(status_code=404, detail="character not found")
    if not store.has_portrait(character_id):
        raise HTTPException(
            status_code=409,
            detail=(
                "Generate the portrait first. "
                "POST /api/characters/{id}/generate-portrait."
            ),
        )

    voice_preset = body.voice_preset if body else None
    if voice_preset and voice_preset.lower() not in SUPPORTED_VOICE_PRESETS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"unsupported voice_preset '{voice_preset}'. "
                f"supported: {sorted(SUPPORTED_VOICE_PRESETS)}"
            ),
        )

    portrait_path = store.portrait_path(character_id)
    result = studio_create_avatar(
        record,
        portrait_path,
        settings,
        voice_preset=voice_preset,
        personality_override=(body.personality_override if body else None),
    )

    if result.status in {"ready", "mock"}:
        updated = store.update(
            character_id,
            runway_avatar_id=result.avatar_id,
            runway_avatar_status=result.status,
            runway_avatar_thumbnail_url=result.thumbnail_url,
            runway_avatar_error=None,
            voice_preset=(voice_preset or record.voice_preset).lower(),
            mock_mode=result.mock_mode,
        )
    else:
        updated = store.update(
            character_id,
            runway_avatar_status="failed",
            runway_avatar_error=result.error,
        )
    return updated or record


# ---- PR AN — Custom voice cloning foundation ----------------------
#
# Multipart upload of a 10 s – 5 min audio sample. POST /v1/voices
# with from.type=audio creates a Runway voice id; AdSpark persists it
# on the Character record and prefers it over the runway-live-preset
# binding the next time an avatar is created. Mock mode short-circuits
# with a deterministic ``mock_voice_<sha>`` id keyed off the character
# + sample bytes so re-uploads are idempotent and re-recordings yield
# a fresh id.


@router.post("/{character_id}/clone-voice", response_model=Character)
async def post_clone_voice(
    character_id: str,
    audio: UploadFile = File(..., description="10 s – 5 min audio sample (≤ 10 MB)"),
    name: Optional[str] = Form(default=None),
    settings: Settings = Depends(get_settings),
    store: CharacterStore = Depends(_store),
) -> Character:
    """PR AN — clone a voice from an uploaded audio sample. Returns the
    updated Character with ``custom_voice_*`` fields populated.

    Real mode: ``POST /v1/voices`` with ``from.type=audio`` (audio is
    embedded as a base64 data URI). Mock mode: deterministic
    ``mock_voice_<sha256(name + bytes)[:16]>``.

    Failure modes:
    - 404 — character not found.
    - 415 — unsupported audio mime type.
    - 413 — audio sample exceeds the local 15 MB cap.
    - 422 — empty / unreadable audio body.
    - 502 — Runway upstream rejection (real mode only).
    """
    record = store.get(character_id)
    if not record:
        raise HTTPException(status_code=404, detail="character not found")

    mime = (audio.content_type or "").lower().strip()
    if mime not in SUPPORTED_AUDIO_MIMES:
        raise HTTPException(
            status_code=415,
            detail=(
                f"unsupported audio mime type '{mime or audio.filename or ''}'. "
                f"accepted: {sorted(set(SUPPORTED_AUDIO_MIMES))}"
            ),
        )

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=422, detail="audio sample is empty")
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"audio sample is {len(audio_bytes):,} bytes "
                f"(cap: {MAX_AUDIO_BYTES:,}); Runway's documented limit is 10 MB."
            ),
        )

    voice_name = (
        (name or "").strip()
        or f"AdSpark — {(record.name or 'Character')[:60]}"
    )
    result = clone_voice_from_audio(voice_name, audio_bytes, mime, settings)

    if result.status == "failed" or not result.voice_id:
        store.update(
            character_id,
            custom_voice_id=None,
            custom_voice_name=voice_name,
            custom_voice_status="failed",
            custom_voice_error=result.error,
            custom_voice_mock_mode=result.mock_mode,
        )
        raise HTTPException(
            status_code=502,
            detail=f"voice clone failed: {result.error or 'unknown error'}",
        )

    updated = store.update(
        character_id,
        custom_voice_id=result.voice_id,
        custom_voice_name=voice_name,
        custom_voice_status=result.status,
        custom_voice_error=None,
        custom_voice_mock_mode=result.mock_mode,
    )
    logger.info(
        "character %s voice cloned -> %s (status=%s mock=%s)",
        character_id, result.voice_id, result.status, result.mock_mode,
    )
    return updated or record


@router.get("/{character_id}/portrait")
def get_character_portrait(
    character_id: str,
    store: CharacterStore = Depends(_store),
) -> FileResponse:
    path = store.portrait_path(character_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="no portrait for this character")
    return FileResponse(
        str(path),
        media_type="image/png",
        filename=f"adspark-character-{character_id}.png",
    )


@router.delete("/{character_id}", response_model=dict)
def delete_character(
    character_id: str,
    store: CharacterStore = Depends(_store),
) -> dict:
    """Local delete only — does NOT call Runway DELETE /v1/avatars.
    Cached portrait + thumbnail files are removed; the user can run
    DELETE /v1/avatars/{id} via the Runway dashboard if they want
    the avatar entirely gone.
    """
    if not store.delete(character_id):
        raise HTTPException(status_code=404, detail="character not found")
    store.portrait_path(character_id).unlink(missing_ok=True)
    store.thumbnail_path(character_id).unlink(missing_ok=True)
    return {"ok": True, "id": character_id}
